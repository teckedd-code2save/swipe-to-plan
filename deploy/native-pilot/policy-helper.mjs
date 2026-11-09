// Preparation-only fixed-path operator utility. Never activates a service.
import * as fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {parsePilotPolicy} from '../../backend/src/native-pilot.js';
export const ROOT='/opt/unstressed/data',ACCOUNT=ROOT+'/accounts.json',POLICY=ROOT+'/native-pilot-policy.json',LOCK=ROOT+'/native-pilot-policy.lock';
const reject=()=>{throw Error('Pilot policy preparation failed. Check approved selection, window, epoch, permissions, journals and disabled-writer isolation; no private values are included in this report.');};
export function selectPolicy(request,data,existing,now){
 if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!['email','epoch','issuedAt','expiresAt','accessMode','image','isolationVerified'].includes(k))||typeof request.email!=='string'||!request.email.trim()||request.email!==request.email.trim()||request.email.length>254)reject();
 if(!/^ghcr\.io\/teckedd-code2save\/unstressed@sha256:[a-f0-9]{64}$/.test(request.image||''))reject();
 if(request.isolationVerified!==undefined&&typeof request.isolationVerified!=='boolean')reject();
 const users=Object.entries(data.users||{}).filter(([,user])=>typeof user.email==='string'&&user.email.toLowerCase()===request.email.toLowerCase());
 if(users.length!==1||users[0][0]!==users[0][1].id||typeof users[0][1].googleSubject!=='string'||!users[0][1].googleSubject)reject();
 const highWater=data.nativePilot?.highWater??0;
 if(!Number.isSafeInteger(highWater)||highWater<0||data.nativePilot&&(!Number.isSafeInteger(data.nativePilot.epoch)||data.nativePilot.epoch<0))reject();
 if(existing&&(!Number.isSafeInteger(existing.epoch)||existing.epoch<1))reject();
 if(request.epoch<=Math.max(highWater,data.nativePilot?.epoch||0,existing?.epoch||0))reject();
 const candidate={version:1,epoch:request.epoch,origin:'https://unstressed.serendepify.com',issuedAt:request.issuedAt,expiresAt:request.expiresAt,accountIds:[users[0][0]],accessMode:request.accessMode===undefined?'read-only':request.accessMode};
 const policy=parsePilotPolicy(candidate,candidate.origin,now);if(!policy)reject();delete policy.fingerprint;return policy;
}
export function validateStat(stat,{directory=false,uid=1000,mode=0o600}={}){if(stat.isSymbolicLink()||!(directory?stat.isDirectory():stat.isFile())||stat.uid!==uid||(stat.mode&0o777)!==mode||(!directory&&stat.nlink!==1))reject();}
export function validateWriters(containers,approvedImage){
 const touches=m=>typeof m.Source==='string'&&(m.Source==='/'||m.Source===ROOT||ROOT.startsWith(m.Source+'/')||m.Source.startsWith(ROOT+'/'));
 const relevant=containers.filter(c=>(c.Mounts||[]).some(touches));
 if(relevant.length>1)reject();
 for(const c of relevant){if(typeof c.Id!=='string'||!c.Id||typeof c.Running!=='boolean'||c.Name!=='/unstressed-web'||c.Mounts.filter(touches).length!==1||c.Mounts.filter(m=>m.Type==='bind'&&m.Source===ROOT&&m.Destination==='/data').length!==1||c.PilotProtocol!=='1'||!/^sha256:[a-f0-9]{64}$/.test(c.Image||'')||!Array.isArray(c.RepoDigests)||!c.RepoDigests.includes(approvedImage)||c.NativeDisabled!=='yes')reject();}
 return relevant.map(c=>({id:c.Id,running:c.Running,image:c.Image,approvedImage}));
}
export function inspectWriters(approvedImage,execute=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}).trim(),canonical=path=>fs.realpathSync(path)){
 const ids=execute('docker',['ps','-aq']).split('\n').filter(Boolean);
 const format='{"Id":{{json .Id}},"Name":{{json .Name}},"Running":{{json .State.Running}},"Image":{{json .Image}},"Mounts":{{json .Mounts}},"PilotProtocol":{{json (index .Config.Labels "io.unstressed.native-pilot")}},"NativeDisabled":"{{range .Config.Env}}{{if eq (index (split . "=") 0) "NATIVE_AUTH_ENABLED"}}{{if eq . "NATIVE_AUTH_ENABLED=false"}}yes{{else}}invalid{{end}}{{end}}{{end}}"}';
 return validateWriters(ids.map(id=>{const container=JSON.parse(execute('docker',['inspect','--format',format,id]));if(!/^sha256:[a-f0-9]{64}$/.test(container.Image||''))reject();container.RepoDigests=JSON.parse(execute('docker',['image','inspect','--format','{{json .RepoDigests}}',container.Image]));container.Mounts=(container.Mounts||[]).map(m=>m.Type==='bind'?{...m,Source:canonical(m.Source)}:m);return container;}),approvedImage);
}
export function preparePolicy(request,{apply=false,io=fs,now=Date.now,uid=process.getuid(),inspect=inspectWriters,random=randomUUID}={}){
 if(uid!==0)reject();
 // Trusted parent paths, private data, no aliases or pending recovery journal.
 for(const path of ['/opt','/opt/unstressed']){const st=io.lstatSync(path);if(st.isSymbolicLink()||!st.isDirectory()||st.uid!==0||(st.mode&0o022)||io.realpathSync(path)!==path)reject();}
 validateStat(io.lstatSync(ROOT),{directory:true,mode:0o700});if(io.realpathSync(ROOT)!==ROOT)reject();
 const absent=path=>{try{io.lstatSync(path);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}};
 if(!absent(ACCOUNT+'.intent')||!absent(LOCK))reject();
 const readAccount=()=>{validateStat(io.lstatSync(ACCOUNT));if(io.realpathSync(ACCOUNT)!==ACCOUNT)reject();const data=JSON.parse(io.readFileSync(ACCOUNT,'utf8'));if(!data||typeof data.users!=='object')reject();return data;};
 const readExisting=()=>{if(absent(POLICY))return null;const st=io.lstatSync(POLICY);validateStat(st);if(st.size>8192||io.realpathSync(POLICY)!==POLICY)reject();return io.readFileSync(POLICY,'utf8');};
 const writers=inspect(request.image),raw=readExisting();let existing;try{existing=raw===null?null:JSON.parse(raw);}catch{reject();}
 // Existing policy must be recognizable even if its window has expired.
 if(existing&&!parsePilotPolicy(existing,'https://unstressed.serendepify.com',existing.issuedAt))reject();
 const candidate=selectPolicy(request,readAccount(),existing,now());
 if(!apply)return {dryRun:true,selectedAccounts:1,accessMode:candidate.accessMode,expiresAt:candidate.expiresAt,epoch:candidate.epoch,writerMayRemainRunning:writers.some(w=>w.running),requiresOperatorIsolationVerification:true};
 if(request.isolationVerified!==true)reject();
 let lockFd,tempFd,temp,ownedTemp=false,renameAttempted=false,confirmed=false;
 try{
  lockFd=io.openSync(LOCK,'wx',0o600);io.fsyncSync(lockFd);const lockDirectory=io.openSync(ROOT,'r');try{io.fsyncSync(lockDirectory);}finally{io.closeSync(lockDirectory);}
  if(!absent(ACCOUNT+'.intent')||JSON.stringify(inspect(request.image))!==JSON.stringify(writers)||readExisting()!==raw)reject();
  const rechecked=selectPolicy(request,readAccount(),existing,now());if(JSON.stringify(rechecked)!==JSON.stringify(candidate))reject();
  temp=POLICY+'.'+random()+'.tmp';tempFd=io.openSync(temp,'wx',0o600);ownedTemp=true;io.fchownSync(tempFd,1000,1000);io.fchmodSync(tempFd,0o600);io.writeFileSync(tempFd,JSON.stringify(candidate)+'\n');io.fsyncSync(tempFd);io.closeSync(tempFd);tempFd=undefined;
  if(!absent(ACCOUNT+'.intent')||JSON.stringify(inspect(request.image))!==JSON.stringify(writers)||readExisting()!==raw)reject();
  if(JSON.stringify(selectPolicy(request,readAccount(),existing,now()))!==JSON.stringify(candidate))reject();
  // No native writer may run enabled during this operation. No service change.
  renameAttempted=true;io.renameSync(temp,POLICY);const directory=io.openSync(ROOT,'r');try{io.fsyncSync(directory);}finally{io.closeSync(directory);}
  confirmed=true;return {installed:true,nativeActivated:false,selectedAccounts:1,accessMode:candidate.accessMode,expiresAt:candidate.expiresAt,epoch:candidate.epoch};
 }catch(e){if(renameAttempted)throw Error('Pilot policy install outcome is uncertain after rename. Do not retry or activate; reconcile the fixed policy file and directory durability.');throw e;}
 finally{if(tempFd!==undefined)io.closeSync(tempFd);if(ownedTemp&&!renameAttempted)try{io.unlinkSync(temp);}catch{}if(lockFd!==undefined){io.closeSync(lockFd);if(!renameAttempted||confirmed)try{io.unlinkSync(LOCK);}catch{}}}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length>3||process.argv[2]&&!['--dry-run','--apply'].includes(process.argv[2]))reject();const input=fs.readFileSync(0,'utf8');if(input.length>4096)reject();console.log(JSON.stringify(preparePolicy(JSON.parse(input),{apply:process.argv[2]==='--apply'})));}
 catch{console.error('Pilot policy preparation was not confirmed. Do not retry an uncertain write or activate; reconcile approved inputs and host isolation privately.');process.exitCode=1;}
}
