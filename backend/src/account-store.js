import * as fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname} from 'node:path';

const empty=()=>({users:{},sessions:{},flows:{},circles:{},nativeFlows:{},nativeSessions:{}});
const digest=text=>createHash('sha256').update(text).digest('hex');
const blocked=()=>Object.assign(new Error('Account saving is unavailable until a storage issue is reconciled. The last change may already be saved. Refresh to check your current account state; do not repeat the change blindly.'),{status:503,code:'account_commit_unknown'});

// Exactly one writer/process per file. Transaction callbacks must have no external
// side effects. Resolving transact is the ONLY durable commit acknowledgement.
export function createAccountStore({file=null,now=Date.now,io=fs}={}){
  let data,loading,uncertain=false,queue=Promise.resolve();
  const intent=file&&`${file}.intent`;
  const validIntent=record=>record&&typeof record==='object'&&!Array.isArray(record)&&record.version===1&&
    (record.base===null||/^[a-f0-9]{64}$/.test(record.base))&&/^[a-f0-9]{64}$/.test(record.next)&&
    typeof record.temp==='string'&&record.temp.startsWith(`${file}.`)&&/^\.[0-9a-f-]{36}\.tmp$/.test(record.temp.slice(file.length));
  const serial=fn=>{const task=queue.then(fn);queue=task.catch(()=>{});return task;};
  async function syncDirectory(path){const handle=await io.open(path,'r');try{await handle.sync();}finally{await handle.close();}}
  async function snapshot(){try{return await io.readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  async function load(){
    if(data)return;
    if(!loading)loading=(async()=>{
      const raw=file?await snapshot():null;
      const candidate=raw===null?empty():JSON.parse(raw);
      if(file)try{
        const text=await io.readFile(intent,'utf8');uncertain=true;
        let record,parsed=false;try{record=JSON.parse(text);parsed=true;}catch{/* Incomplete intent precedes rename. Reads remain available. */}
        if(parsed){const hash=raw===null?null:digest(raw);if(!validIntent(record)||![record.base,record.next].includes(hash))throw blocked();}
      }catch(e){if(e.code!=='ENOENT')throw e;}
      data=candidate;
    })().catch(e=>{data=undefined;loading=undefined;throw e;});
    await loading;
  }
  async function writeSynced(path,text){
    const handle=await io.open(path,'wx',0o600);
    try{await handle.writeFile(text);await handle.sync();}finally{await handle.close();}
  }
  async function remove(path){try{await io.unlink(path);}catch(e){if(e.code!=='ENOENT')throw e;}}
  async function directory(){
    // mkdir returns the first created directory. Persist every newly created
    // directory entry, including the top one's parent, before writing intent.
    const first=await io.mkdir(dirname(file),{recursive:true,mode:0o700});
    if(first){let path=dirname(file);while(true){await syncDirectory(path);if(path===dirname(first))break;path=dirname(path);}}
  }
  return {
    async read(fn){await queue;await load();return structuredClone(fn(structuredClone(data)));},
    transact(fn){return serial(async()=>{
      await load();if(uncertain)throw blocked();
      const next=structuredClone(data);
      for(const collection of ['flows','sessions','nativeFlows','nativeSessions'])for(const [id,value] of Object.entries(next[collection]||{}))if(value.expiresAt<=now())delete next[collection][id];
      const result=structuredClone(await fn(next));
      if(!file){data=next;return result;}
      const raw=JSON.stringify(next),temp=`${file}.${randomUUID()}.tmp`;
      let ownedTemp=false,intentStarted=false;
      try{
        await directory();
        // Exclusive temp creation; cleanup never scans or removes other files.
        const handle=await io.open(temp,'wx',0o600);ownedTemp=true;
        try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
        const base=await snapshot();
        intentStarted=true;
        await writeSynced(intent,JSON.stringify({version:1,temp,base:base===null?null:digest(base),next:digest(raw)}));
        await syncDirectory(dirname(file));
        // From this point even rename throwing may mean it completed. Never
        // restore the old snapshot or acknowledge an unsaved transaction.
        await io.rename(temp,file);ownedTemp=false;
        await syncDirectory(dirname(file));
        data=next;
        await remove(intent);
        await syncDirectory(dirname(file));
        return result;
      }catch(e){
        if(intentStarted){
          uncertain=true;
          // Reads reflect the currently visible complete snapshot, not stale RAM.
          // If unreadable, don't serve a misleading cached account/session view.
          data=undefined;loading=undefined;
          const error=blocked();error.cause=e;throw error;
        }
        throw e;
      }finally{
        // Once intent exists, recovery owns the temp. Never delete possible
        // recovery evidence after an ambiguous rename or directory sync.
        if(ownedTemp&&!intentStarted)await remove(temp).catch(()=>{});
      }
    });},
    // Operator-only storage repair, not an HTTP action and NOT request replay.
    // Caller must inspect the returned outcome and reconcile business intent.
    reconcile(){return serial(async()=>{
      await load();if(!file)return {outcome:'memory_only'};
      let record;
      try{record=JSON.parse(await io.readFile(intent,'utf8'));if(!validIntent(record))throw blocked();}catch(e){if(e.code!=='ENOENT')throw blocked();}
      const raw=await snapshot(),hash=raw===null?null:digest(raw);
      if(record&&(record.version!==1||!['base','next'].some(key=>record[key]===hash)))throw blocked();
      if(raw!==null){const handle=await io.open(file,'r');try{await handle.sync();}finally{await handle.close();}}
      await syncDirectory(dirname(file));
      const outcome=record?(hash===record.next?'committed':'not_committed'):'current_snapshot';
      // A malformed/untrusted path must never let recovery unlink another file.
      if(record?.temp&&record.temp.startsWith(`${file}.`)&&/^\.[0-9a-f-]{36}\.tmp$/.test(record.temp.slice(file.length)))await remove(record.temp);
      await remove(intent);await syncDirectory(dirname(file));
      data=raw===null?empty():JSON.parse(raw);loading=undefined;uncertain=false;
      return {outcome,snapshotHash:hash};
    });},
  };
}
