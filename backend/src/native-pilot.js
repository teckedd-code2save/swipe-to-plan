import * as fs from 'node:fs';
import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function parsePilotPolicy(value,origin,now){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['version','epoch','origin','issuedAt','expiresAt','accountIds','accessMode'].includes(k))||value.version!==1||(value.accessMode!==undefined&&!['read-only','account-sync'].includes(value.accessMode))||!Number.isSafeInteger(value.epoch)||value.epoch<1||value.origin!==origin||!Number.isSafeInteger(value.issuedAt)||!Number.isSafeInteger(value.expiresAt)||value.issuedAt>now||value.expiresAt<=now||value.expiresAt<=value.issuedAt||value.expiresAt-value.issuedAt>86400000||!Array.isArray(value.accountIds)||value.accountIds.length<1||value.accountIds.length>5||value.accountIds.some(id=>typeof id!=='string'||!/^[-a-zA-Z0-9_]{1,64}$/.test(id))||new Set(value.accountIds).size!==value.accountIds.length)return null;
 const policy={...value,accessMode:value.accessMode??'read-only',accountIds:[...value.accountIds].sort()};return {...policy,fingerprint:digest(policy)};
}
export function createNativePilot({store,origin,now,enabled,readPolicy=()=>{
 const path='/data/native-pilot-policy.json',stat=fs.lstatSync(path);
 if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1||stat.uid!==1000||(stat.mode&0o777)!==0o600||stat.size>8192||fs.realpathSync(path)!==path)throw Error();
 return JSON.parse(fs.readFileSync(path,'utf8'));
}}){
 const current=()=>{try{return parsePilotPolicy(readPolicy(),origin,now());}catch{return null;}};
 let invalidatedEpoch=0;
 const valid=(data)=>{const p=current(),s=data.nativePilot;if(s?.active&&(!p||s.fingerprint!==p.fingerprint||s.epoch!==p.epoch))invalidatedEpoch=Math.max(invalidatedEpoch,s.epoch);if(!enabled||!p||!s?.active||invalidatedEpoch>=s.epoch||s.fingerprint!==p.fingerprint||s.epoch!==p.epoch)return null;return p;};
 const userValid=(data,user)=>{const p=valid(data);return p&&user&&p.accountIds.includes(user.id)&&typeof user.googleSubject==='string'&&user.googleSubject.length>0&&data.nativePilot.bindings[user.id]===digest(user.googleSubject)?p:null;};
 let queue=Promise.resolve();
 const observe=async()=>{
  if(!enabled)return;
  const p=current(),previous=await store.read(data=>data.nativePilot);
  if(previous?.active&&p?.fingerprint!==previous.fingerprint)invalidatedEpoch=Math.max(invalidatedEpoch,previous.epoch);
  if(previous?.active&&p?.fingerprint===previous.fingerprint&&invalidatedEpoch<previous.epoch)return;
  if(!previous&&!p)return;
  if(previous&&!previous.active&&(!p||p.epoch<=previous.highWater))return;
  await store.transact(data=>{
   const policy=current(),old=data.nativePilot;
   if(old?.active&&policy?.fingerprint!==old.fingerprint)invalidatedEpoch=Math.max(invalidatedEpoch,old.epoch);
   if(old?.active&&policy?.fingerprint===old.fingerprint&&invalidatedEpoch<old.epoch)return;
   if(old&&!old.active&&(!policy||policy.epoch<=old.highWater))return;
   const highWater=Math.max(old?.highWater||0,old?.epoch||0);
   const bindings={};const allowed=policy&&policy.epoch>highWater&&policy.accountIds.every(id=>{const user=data.users[id];if(!user||typeof user.googleSubject!=='string'||!user.googleSubject)return false;bindings[id]=digest(user.googleSubject);return true;});
   data.nativePilot={active:!!allowed,highWater:Math.max(highWater,policy?.epoch||0),epoch:policy?.epoch||0,fingerprint:policy?.fingerprint||null,bindings:allowed?bindings:{}};
   // Retired flows and sessions never return when a policy is reinstated.
   data.nativeFlows={};data.nativeSessions={};
  });
 };
 return {observe(){const result=queue.then(observe);queue=result.catch(()=>{});return result;},valid,userValid,
 binding(data,user){const p=user?userValid(data,user):valid(data);if(!p)throw Object.assign(new Error('Native account pilot access is unavailable.'),{status:403,code:'account_error'});return {pilotEpoch:p.epoch,pilotFingerprint:p.fingerprint,pilotDeadline:p.expiresAt,pilotAccessMode:p.accessMode};},
 matches(data,record,user,requiredMode){const p=user?userValid(data,user):valid(data);return !!(p&&(!requiredMode||p.accessMode===requiredMode)&&record?.pilotEpoch===p.epoch&&record.pilotFingerprint===p.fingerprint&&record.pilotDeadline===p.expiresAt);}
 };
}
