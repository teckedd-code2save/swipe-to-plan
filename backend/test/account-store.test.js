import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAccountStore} from '../src/account-store.js';

async function fixture(t){const dir=await fs.mkdtemp(join(tmpdir(),'account-durable-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=join(dir,'accounts.json');const store=createAccountStore({file});await store.transact(d=>{d.users.owner={id:'owner',savedPlans:{private:{revision:1}},secret:'not-in-intent'};d.sessions.active={expiresAt:Date.now()+100000,userId:'owner'};});return {dir,file,store};}
function faultIO(file,stage,{after=false}={}){
 let armed=true,dirSync=0;
 const fail=async(name,fn)=>{if(armed&&name===stage){armed=false;if(after)await fn();throw Error(`Injected ${name}`);}return fn();};
 return {...fs,rename:(...args)=>fail('rename',()=>fs.rename(...args)),unlink:(path)=>fail(path===`${file}.intent`?'intent-unlink':'unlink',()=>fs.unlink(path)),open:async(path,...args)=>{
   const h=await fs.open(path,...args),kind=path===`${file}.intent`?'intent':path===file?'file':path.endsWith('.tmp')?'temp':'directory';
   return {writeFile:(...a)=>fail(`${kind}-write`,()=>h.writeFile(...a)),sync:()=>fail(kind==='directory'?`directory-sync-${++dirSync}`:`${kind}-sync`,()=>h.sync()),close:()=>h.close()};
 }};
}
test('durable snapshot survives restart, private read callbacks cannot mutate storage',async t=>{const {file,store}=await fixture(t);await store.read(d=>{d.users.owner.secret='changed';});assert.equal(await createAccountStore({file}).read(d=>d.users.owner.secret),'not-in-intent');assert.equal((await fs.stat(file)).mode&0o777,0o600);assert.deepEqual((await fs.readdir(join(file,'..'))),['accounts.json']);});
for(const stage of ['temp-write','temp-sync'])test(`${stage} fails before intent, old data remains and queue recovers`,async t=>{const {file,dir}=await fixture(t),store=createAccountStore({file,io:faultIO(file,stage)});await assert.rejects(store.transact(d=>{d.users.owner.id='new';}),/Injected/);assert.equal(await store.read(d=>d.users.owner.id),'owner');assert.deepEqual(await fs.readdir(dir),['accounts.json']);await store.transact(d=>{d.users.owner.id='later';});assert.equal(await createAccountStore({file}).read(d=>d.users.owner.id),'later');});
for(const [stage,after,expected] of [['intent-sync',false,'not_committed'],['directory-sync-1',false,'not_committed'],['rename',false,'not_committed'],['rename',true,'committed'],['directory-sync-2',false,'committed'],['intent-unlink',false,'committed'],['directory-sync-3',false,'current_snapshot']])test(`${stage}, after=${after}: unknown never permits follow-on effects or replay`,async t=>{
 const {file}=await fixture(t),store=createAccountStore({file,io:faultIO(file,stage,{after})});let effects=0;
 const first=store.transact(d=>{d.users.owner.id='new';});const queued=store.transact(()=>{effects++;});
 await assert.rejects(first.then(()=>{effects++;}),{code:'account_commit_unknown'});await assert.rejects(queued,{code:'account_commit_unknown'});assert.equal(effects,0);
 assert.equal(await store.read(d=>d.users.owner.id),expected==='not_committed'?'owner':'new');
 const restarted=createAccountStore({file});
 if(stage!=='directory-sync-3')await assert.rejects(restarted.transact(()=>{effects++;}),{code:'account_commit_unknown'});
 const recovered=await restarted.reconcile();assert.equal(recovered.outcome,expected);assert.equal(effects,0);
 await restarted.transact(d=>{d.users.owner.savedPlans.private.revision++;});assert.equal(await createAccountStore({file}).read(d=>d.users.owner.savedPlans.private.revision),2);
});
test('intent contains only metadata, restart does not promote temp, cleanup preserves unrelated files',async t=>{
 const {file,dir}=await fixture(t),store=createAccountStore({file,io:faultIO(file,'rename')});await assert.rejects(store.transact(d=>{d.users.owner.id='new';}));
 const intent=JSON.parse(await fs.readFile(`${file}.intent`,'utf8'));assert.deepEqual(Object.keys(intent).sort(),['base','next','temp','version']);assert.equal(JSON.stringify(intent).includes('not-in-intent'),false);
 const unrelated=join(dir,'accounts.json.unrelated.tmp');await fs.writeFile(unrelated,'keep');assert.equal((await createAccountStore({file}).reconcile()).outcome,'not_committed');assert.equal(await fs.readFile(unrelated,'utf8'),'keep');assert.equal(await createAccountStore({file}).read(d=>d.users.owner.id),'owner');
});
test('invalid intent or unknown snapshot fails closed without deleting evidence; reads remain available',async t=>{
 const {file}=await fixture(t);await fs.writeFile(`${file}.intent`,'partial');const store=createAccountStore({file});assert.equal(await store.read(d=>d.users.owner.id),'owner');await assert.rejects(store.transact(()=>{}),{code:'account_commit_unknown'});await assert.rejects(store.reconcile(),{code:'account_commit_unknown'});assert.equal(await fs.readFile(`${file}.intent`,'utf8'),'partial');
});
test('nested new directory and first-file creation are durable; interrupted first commit reconciles absence',async t=>{
 const {dir}=await fixture(t),file=join(dir,'nested','more','accounts.json');const store=createAccountStore({file});await store.transact(d=>{d.users.first={id:'first'};});assert.equal(await createAccountStore({file}).read(d=>d.users.first.id),'first');
 const missing=join(dir,'first.json'),broken=createAccountStore({file:missing,io:faultIO(missing,'rename')});await assert.rejects(broken.transact(d=>{d.users.first={};}));assert.deepEqual(await createAccountStore({file:missing}).read(d=>d.users),{});assert.equal((await createAccountStore({file:missing}).reconcile()).outcome,'not_committed');
});
test('reconciliation failure keeps current process write-blocked and never replays callback',async t=>{const {file}=await fixture(t);const broken=createAccountStore({file,io:faultIO(file,'rename',{after:true})});await assert.rejects(broken.transact(d=>{d.users.owner.id='new';}));const restarted=createAccountStore({file,io:faultIO(file,'file-sync')});await assert.rejects(restarted.reconcile());await assert.rejects(restarted.transact(()=>{}),{code:'account_commit_unknown'});assert.equal(await restarted.read(d=>d.users.owner.id),'new');assert.equal((await restarted.reconcile()).outcome,'committed');});
test('ambiguous logout/member removal reads disk rather than stale authorization',async t=>{const {file,store}=await fixture(t);await store.transact(d=>{d.circles.shared={members:['owner','guest']};});const broken=createAccountStore({file,io:faultIO(file,'rename',{after:true})});await assert.rejects(broken.transact(d=>{delete d.sessions.active;d.circles.shared.members=['owner'];}));assert.equal(await broken.read(d=>d.sessions.active),undefined);assert.deepEqual(await broken.read(d=>d.circles.shared.members),['owner']);const restarted=createAccountStore({file});assert.equal(await restarted.read(d=>d.sessions.active),undefined);});
test('unrecognized or unreadable target after ambiguous commit does not serve cached authorization',async t=>{const {file}=await fixture(t),broken=createAccountStore({file,io:faultIO(file,'rename',{after:true})});await assert.rejects(broken.transact(d=>{delete d.sessions.active;}));await fs.writeFile(file,JSON.stringify({users:{},sessions:{active:{userId:'owner'}},flows:{},circles:{}}));await assert.rejects(broken.read(d=>d.sessions.active),{code:'account_commit_unknown'});await assert.rejects(broken.reconcile());await fs.writeFile(file,'bad JSON');await assert.rejects(broken.read(d=>d.sessions.active));});

for(const phase of ['intent','rename','commit'])test(`process exit at ${phase} requires explicit reconciliation after restart`,async t=>{
 const {file}=await fixture(t),moduleUrl=new URL('../src/account-store.js',import.meta.url).href;
 const script=`import * as fs from 'node:fs/promises'; import {createAccountStore} from ${JSON.stringify(moduleUrl)};
 const file=${JSON.stringify(file)},phase=${JSON.stringify(phase)};let syncs=0;
 const io={...fs,rename:async(...args)=>{await fs.rename(...args);if(phase==='rename')process.exit(73);},open:async(path,...args)=>{const h=await fs.open(path,...args);return {writeFile:(...a)=>h.writeFile(...a),close:()=>h.close(),sync:async()=>{await h.sync();if(path===${JSON.stringify(join(file,'..'))}){syncs++;if(phase==='intent'&&syncs===1||phase==='commit'&&syncs===2)process.exit(73);}}};}};
 await createAccountStore({file,io}).transact(d=>{d.users.owner.id='new';});`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});assert.equal(child.status,73,child.stderr);
 const restarted=createAccountStore({file});await assert.rejects(restarted.transact(()=>{}),{code:'account_commit_unknown'});assert.equal(await restarted.read(d=>d.users.owner.id),phase==='intent'?'owner':'new');assert.equal((await restarted.reconcile()).outcome,phase==='intent'?'not_committed':'committed');
});
test('concurrent cold reads both await intent validation before exposing authorization',async t=>{
 const {file}=await fixture(t);await fs.writeFile(`${file}.intent`,JSON.stringify({version:1,base:'wrong',next:'wrong'}));let release,entered;
 const gate=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});const io={...fs,readFile:async(path,...args)=>{if(path===`${file}.intent`){entered();await gate;}return fs.readFile(path,...args);}};
 const store=createAccountStore({file,io}),first=store.read(d=>d.sessions.active);await started;const second=store.read(d=>d.sessions.active);
 const checks=[assert.rejects(first,{code:'account_commit_unknown'}),assert.rejects(second,{code:'account_commit_unknown'})];release();await Promise.all(checks);
});
test('interrupted intent write leaves readable old snapshot but blocks writes and automated repair',async t=>{
 const {file}=await fixture(t),store=createAccountStore({file,io:faultIO(file,'intent-write')});await assert.rejects(store.transact(d=>{d.users.owner.id='new';}),{code:'account_commit_unknown'});assert.equal(await store.read(d=>d.users.owner.id),'owner');const restarted=createAccountStore({file});assert.equal(await restarted.read(d=>d.users.owner.id),'owner');await assert.rejects(restarted.transact(()=>{}),{code:'account_commit_unknown'});await assert.rejects(restarted.reconcile(),{code:'account_commit_unknown'});assert.equal(await fs.readFile(`${file}.intent`,'utf8'),'');
});
for(const malformed of ['null','false','0','""','{}'])test(`malformed parsed intent ${malformed} cannot be cleared by reconciliation`,async t=>{const {file}=await fixture(t);await fs.writeFile(`${file}.intent`,malformed);const store=createAccountStore({file});await assert.rejects(store.reconcile(),{code:'account_commit_unknown'});await assert.rejects(store.transact(()=>{}),{code:'account_commit_unknown'});assert.equal(await fs.readFile(`${file}.intent`,'utf8'),malformed);});
