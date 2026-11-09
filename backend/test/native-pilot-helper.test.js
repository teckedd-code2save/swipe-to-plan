import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPolicy,validateWriters,validateStat,preparePolicy,ROOT,ACCOUNT,POLICY,LOCK} from '../../deploy/native-pilot/policy-helper.mjs';
const image='ghcr.io/teckedd-code2save/unstressed@sha256:'+'a'.repeat(64);
const input=()=>({image,isolationVerified:true,email:'synthetic@example.test',epoch:2,issuedAt:1000,expiresAt:2000,accessMode:'read-only'});
const data=()=>({users:{a:{id:'a',email:'synthetic@example.test',googleSubject:'synthetic-verified'}},nativePilot:{highWater:1,epoch:1}});
const writer=()=>({Id:'canonical',Name:'/unstressed-web',Running:true,NativeDisabled:'yes',PilotProtocol:'1',Image:'sha256:'+'b'.repeat(64),RepoDigests:[image],Mounts:[{Type:'bind',Source:ROOT,Destination:'/data'}]});
function stat({directory=false,uid=1000,mode=0o600,nlink=1,symlink=false,size=100}={}){return {uid,mode,nlink,size,isSymbolicLink:()=>symlink,isFile:()=>!directory,isDirectory:()=>directory};}
function mock(){
 const files=new Map([[ACCOUNT,JSON.stringify(data())]]),handles=new Map(),ops=[];let next=1;
 const error=code=>Object.assign(Error(code),{code});
 const io={lstatSync:p=>{if(['/opt','/opt/unstressed',ROOT].includes(p))return stat({directory:true,uid:p===ROOT?1000:0,mode:p===ROOT?0o700:0o755});if(!files.has(p))throw error('ENOENT');return stat({size:files.get(p).length});},realpathSync:p=>p,readFileSync:p=>files.get(p),openSync:(p,flags)=>{ops.push(['open',p,flags]);if(flags==='wx'){if(files.has(p))throw error('EEXIST');files.set(p,'');}handles.set(next,p);return next++;},fsyncSync:fd=>ops.push(['sync',handles.get(fd)]),closeSync:fd=>handles.delete(fd),fchownSync:()=>{},fchmodSync:()=>{},writeFileSync:(fd,value)=>files.set(handles.get(fd),value),renameSync:(a,b)=>{ops.push(['rename',a,b]);files.set(b,files.get(a));files.delete(a);},unlinkSync:p=>{ops.push(['unlink',p]);files.delete(p);}};
 return {io,files,ops};
}
test('helper selects one existing verified identity privately and rejects collisions, invalid identities, epochs and windows',()=>{
 assert.deepEqual(selectPolicy(input(),data(),null,1000).accountIds,['a']);
 for(const edit of [d=>d.users.b={...d.users.a,id:'b'},d=>d.users.a.googleSubject='',d=>d.users.a.email='different@example.test',d=>d.nativePilot.epoch='corrupt',d=>{d.users.a.id='b';d.users.b={id:'b',email:'other@example.test',googleSubject:'different'};}]){const d=data();edit(d);assert.throws(()=>selectPolicy(input(),d,null,1000));}
 for(const edit of [r=>r.epoch=1,r=>r.expiresAt=1000,r=>r.expiresAt=86402000,r=>r.image='ghcr.io/teckedd-code2save/unstressed:latest',r=>r.accessMode='full',r=>r.accessMode=null,r=>r.email=' synthetic@example.test']){const r=input();edit(r);assert.throws(()=>selectPolicy(r,data(),null,1000));}
 assert.throws(()=>selectPolicy(input(),data(),{epoch:2},1000));
});
test('helper permits the verified running disabled writer but rejects enabled, foreign, shared or old-image writers',()=>{
 assert.deepEqual(validateWriters([writer()],image),[{id:'canonical',running:true,image:'sha256:'+'b'.repeat(64),approvedImage:image}]);
 for(const edit of [c=>c.NativeDisabled='',c=>{c.Running=false;c.NativeDisabled='';},c=>c.NativeDisabled='yesyes',c=>c.NativeDisabled='yesinvalid',c=>c.PilotProtocol='',c=>c.Running=undefined,c=>c.RepoDigests=['unapproved'],c=>c.Image='mutable',c=>c.Name='/other',c=>c.Mounts[0].Destination='/elsewhere']){const c=writer();edit(c);assert.throws(()=>validateWriters([c],image));}
 assert.throws(()=>validateWriters([writer(),{...writer(),Id:'second'}]));assert.throws(()=>validateWriters([{...writer(),Name:'/foreign',Mounts:[{Type:'bind',Source:'/',Destination:'/host'}]}]));assert.deepEqual(validateWriters([]),[]);
});
test('helper ownership and alias boundaries reject symlink, hardlink and permissive policy files',()=>{
 for(const value of [stat({symlink:true}),stat({nlink:2}),stat({uid:0}),stat({mode:0o644})])assert.throws(()=>validateStat(value));
 const m=mock();m.io.realpathSync=()=>'/different';assert.throws(()=>preparePolicy(input(),{io:m.io,uid:0,now:()=>1000,inspect:()=>[]}));
});
test('dry-run writes nothing and reports no private identity; apply changes only the fixed policy and owned temporary/lock files',()=>{
 const m=mock(),options={io:m.io,uid:0,now:()=>1000,inspect:()=>validateWriters([writer()],image),random:()=> 'test'};
 const dry=preparePolicy(input(),options);assert.equal(dry.dryRun,true);assert.equal(m.ops.length,0);assert.equal(JSON.stringify(dry).includes('synthetic'),false);
 const result=preparePolicy(input(),{...options,apply:true});assert.equal(result.nativeActivated,false);assert.deepEqual(JSON.parse(m.files.get(POLICY)).accountIds,['a']);assert.equal(m.files.has(LOCK),false);assert.equal(m.files.get(ACCOUNT),JSON.stringify(data()));
 assert.ok(m.ops.every(([,path])=>[ROOT,POLICY,POLICY+'.test.tmp',LOCK].includes(path)));
});
test('lock/temp collisions, pending journal, changed writer and unknown policy fail closed without deleting unrelated files',()=>{
 for(const path of [LOCK,ACCOUNT+'.intent',POLICY+'.test.tmp']){const m=mock();m.files.set(path,'retain');assert.throws(()=>preparePolicy(input(),{apply:true,io:m.io,uid:0,now:()=>1000,inspect:()=>[],random:()=> 'test'}));assert.equal(m.files.get(path),'retain');}
 const m=mock();m.files.set(POLICY,'unrecognized');assert.throws(()=>preparePolicy(input(),{apply:true,io:m.io,uid:0,now:()=>1000,inspect:()=>[]}));assert.equal(m.files.get(POLICY),'unrecognized');
 const n=mock();let checks=0;assert.throws(()=>preparePolicy(input(),{apply:true,io:n.io,uid:0,now:()=>1000,inspect:()=>++checks===1?[]:[{id:'changed'}]}));assert.equal(n.files.has(POLICY),false);
});
test('uncertain rename preserves lock/recovery evidence and never claims install success',()=>{
 const m=mock();m.io.renameSync=()=>{throw Error('uncertain');};assert.throws(()=>preparePolicy(input(),{apply:true,io:m.io,uid:0,now:()=>1000,inspect:()=>[],random:()=> 'test'}),/uncertain/);assert.equal(m.files.has(LOCK),true);assert.equal(m.files.has(POLICY+'.test.tmp'),true);
});

test('final account reselection prevents identity or epoch drift before rename and lock evidence is synced first',()=>{
 const m=mock(),read=m.io.readFileSync;let accountReads=0;m.io.readFileSync=p=>{if(p===ACCOUNT&&++accountReads===3){const changed=data();changed.nativePilot.highWater=2;return JSON.stringify(changed);}return read(p);};
 assert.throws(()=>preparePolicy(input(),{apply:true,io:m.io,uid:0,now:()=>1000,inspect:()=>[],random:()=> 'test'}));assert.equal(m.files.has(POLICY),false);assert.equal(m.ops.some(op=>op[0]==='rename'),false);
 assert.ok(m.ops.findIndex(op=>op[0]==='sync'&&op[1]===ROOT)<m.ops.findIndex(op=>op[0]==='open'&&op[1]===POLICY+'.test.tmp'));
});

test('apply requires explicit operator verification of volume aliases and non-container writers',()=>{
 const m=mock(),request=input();delete request.isolationVerified;const options={io:m.io,uid:0,now:()=>1000,inspect:()=>[]};
 assert.equal(preparePolicy(request,options).requiresOperatorIsolationVerification,true);assert.throws(()=>preparePolicy(request,{...options,apply:true}));assert.equal(m.ops.length,0);
});
