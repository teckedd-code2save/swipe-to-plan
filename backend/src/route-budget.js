import * as fs from 'node:fs/promises';
import {dirname,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createAccountStore} from './account-store.js';
import {RouteActionError} from './route-contract.js';
const fail=()=>new RouteActionError('routes_budget_unavailable');
const periodAt=now=>{const value=now();if(!Number.isFinite(value))throw fail();return new Date(value).toISOString().slice(0,10);};
export function routeRequestLimit(value){return typeof value==='number'?Number.isSafeInteger(value)&&value>0?value:null:typeof value==='string'&&/^[1-9]\d{0,8}$/.test(value)?Number(value):null;}
function validate(data){
  if(!data||Object.keys(data).sort().join(',')!=='circles,flows,routeBudget,sessions,users')throw fail();
  // Reuse the proven single-writer journal; no personal/account records belong here.
  for(const key of ['users','sessions','flows','circles'])if(!data[key]||Array.isArray(data[key])||typeof data[key]!=='object'||Object.keys(data[key]).length)throw fail();
  const record=data.routeBudget;
  if(!record||Array.isArray(record)||Object.keys(record).sort().join(',')!=='period,requests,version'||record.version!==1||
     !/^\d{4}-\d{2}-\d{2}$/.test(record.period)||!Number.isFinite(Date.parse(`${record.period}T00:00:00Z`))||new Date(`${record.period}T00:00:00Z`).toISOString().slice(0,10)!==record.period||
     !Number.isSafeInteger(record.requests)||record.requests<0)throw fail();
  return record;
}
// One process/writer per durable ledger. Never share a path with account or day data.
// Missing, malformed, ambiguous or future-dated ledgers fail closed, not reset.
export function createRouteBudget({file,dailyLimit,now=Date.now,io=fs}={}){
  const limit=routeRequestLimit(dailyLimit),configured=!!limit&&typeof file==='string'&&isAbsolute(file);
  const store=configured?createAccountStore({file,now,io}):null;
  let blocked=false;
  return {configured,async claim(){
    if(!configured||blocked)throw fail();
    try{
      await store.transact(data=>{
        const record=validate(data),today=periodAt(now);
        if(record.period>today)throw fail();
        if(record.period<today){record.period=today;record.requests=0;}
        if(record.requests>=limit)throw new RouteActionError('routes_budget_exceeded');
        record.requests++;
      });
    }catch(error){
      if(error instanceof RouteActionError&&error.code==='routes_budget_exceeded')throw error;
      // No further calls in this process after any persistence/schema uncertainty.
      blocked=true;throw fail();
    }
  }};
}
// Explicit operator setup only, never invoked by the app or an HTTP request.
// A preflight is not a creation guard: a competing setup may finish after it.
// The exclusive journal serializes cooperating writers; link publishes the fully
// synced snapshot atomically without replacing ANY existing target, even a
// damaged ledger or symlink. No account-store transaction is used to initialize.
export async function initializeRouteBudget({file,now=Date.now,io=fs}={}){
  if(typeof file!=='string'||!isAbsolute(file))throw fail();
  const directory=dirname(file),intent=`${file}.intent`,temp=`${file}.${randomUUID()}.tmp`;
  let ownTemp=false,ownIntent=false,publicationAttempted=false;
  async function absent(path){
    try{await io.lstat(path);throw fail();}catch(error){if(error.code!=='ENOENT')throw fail();}
  }
  async function syncDirectory(path){const handle=await io.open(path,'r');try{await handle.sync();}finally{await handle.close();}}
  async function prepareDirectory(){
    const first=await io.mkdir(directory,{recursive:true,mode:0o700});
    if(first){let path=directory;while(true){await syncDirectory(path);if(path===dirname(first))break;path=dirname(path);}}
  }
  try{
    await absent(file);await absent(intent);
    await prepareDirectory();
    const raw=JSON.stringify({users:{},sessions:{},flows:{},circles:{},routeBudget:{version:1,period:periodAt(now),requests:0}});
    const snapshot=await io.open(temp,'wx',0o600);ownTemp=true;
    try{await snapshot.writeFile(raw);await snapshot.sync();}finally{await snapshot.close();}
    const journal=await io.open(intent,'wx',0o600);ownIntent=true;
    try{
      await journal.writeFile(JSON.stringify({version:1,temp,base:null,next:createHash('sha256').update(raw).digest('hex')}));
      await journal.sync();
    }finally{await journal.close();}
    await syncDirectory(directory);
    // A completed setup and subsequent claims may have appeared since preflight.
    // While our journal is held, cooperating writers cannot begin a new commit.
    await absent(file);
    publicationAttempted=true;
    await io.link(temp,file); // Atomic no-replace publication; NEVER rename over it.
    await syncDirectory(directory);
    await io.unlink(temp);ownTemp=false;
    await io.unlink(intent);ownIntent=false;
    await syncDirectory(directory);
  }catch{
    if(!publicationAttempted){
      // Nothing could have published our snapshot. Clean only paths exclusively
      // created by this invocation, never a competing writer's journal or temp.
      if(ownTemp)await io.unlink(temp).catch(()=>{});
      if(ownIntent)await io.unlink(intent).catch(()=>{});
      if(ownTemp||ownIntent)await syncDirectory(directory).catch(()=>{});
    }
    // A failed/unknown link or later I/O keeps remaining recovery evidence and
    // never resets the ledger. An operator must reconcile before activation.
    throw fail();
  }
}
