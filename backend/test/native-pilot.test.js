import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNativePilot,parsePilotPolicy} from '../src/native-pilot.js';
import {createAccounts,createAccountStore} from '../src/accounts.js';
import {createNativeAuth} from '../src/native-auth.js';
import {createApp} from '../src/app.js';
import {createDemoProvider} from '../src/demo-provider.js';
const origin='https://unstressed.serendepify.com',hash=s=>createHash('sha256').update(s).digest('base64url'),opaque=()=>randomBytes(32).toString('base64url');
const policy=(epoch=1)=>({version:1,epoch,origin,issuedAt:0,expiresAt:3600000,accountIds:['a']});
async function fixture(t,{storeFactory}={}){
 let current=policy(),sequence=[],clock=1000,calls=0;const now=()=>clock,store=storeFactory?storeFactory(now):createAccountStore({now}),web={a:opaque(),b:opaque()};
 await store.transact(data=>{for(const id of ['a','b']){data.users[id]={id,googleSubject:'verified-'+id,email:id+'@example.test',profile:{id,name:id,artists:[],vibes:[]}};data.sessions[hash(web[id])]={userId:id,expiresAt:10000000};}});
 const accounts=createAccounts({store,now,origin,clientId:'test',clientSecret:'test',nativeAuthEnabled:true,readNativePilotPolicy:()=>sequence.length?sequence.shift():current});const provider=createDemoProvider();provider.audienceCatalog=async()=>{calls++;return [];};
 const app=createApp({accounts,provider,agent:{interpret:async()=>({status:'reply',message:'test'})},now,rateLimit:true}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 async function request(path,{body,token,user,headers={},method}={}){const res=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method:method||(body?'POST':'GET'),headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(user?{Cookie:'__Host-outing-session='+web[user]}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});const text=await res.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:res.status,data};}
 async function start(){const verifier=opaque(),result=await request('/api/auth/native/start',{body:{codeChallenge:hash(verifier),codeChallengeMethod:'S256'}});assert.equal(result.status,200);return {...result.data,verifier};}
 async function approve(flow,user='a'){const page=await request('/api/auth/native/browser?flow='+flow.flowId,{user});assert.equal(page.status,200);const csrf=page.data.match(/csrf="([\w-]+)"/)[1];return request('/api/auth/native/approve',{user,headers:{Origin:origin},body:{flowId:flow.flowId,csrf}});}
 const exchange=flow=>request('/api/auth/native/exchange',{body:{flowId:flow.flowId,codeVerifier:flow.verifier}});
 async function login(){const f=await start();assert.equal((await approve(f)).status,200);const r=await exchange(f);assert.equal(r.status,200);return r.data;}
 return {store,request,start,approve,exchange,login,set:p=>current=p,sequence:values=>sequence=[...values],advance:n=>clock+=n,calls:()=>calls};
}
test('pilot policy validates exact origin, epoch, finite window and bounded existing account IDs',()=>{
 assert.ok(parsePilotPolicy(policy(),origin,1000));
 for(const change of [p=>p.accountIds=[],p=>p.accountIds=['a','a'],p=>p.accountIds=['a','b','c','d','e','f'],p=>p.expiresAt=1000,p=>p.expiresAt=86400001,p=>p.issuedAt=2000,p=>p.epoch=0,p=>p.accessMode=null,p=>p.accessMode='unknown',p=>p.origin='https://evil.test',p=>p.unknown=true]){const p=policy();change(p);assert.equal(parsePilotPolicy(p,origin,1000),null);}
});
test('approval only permits approved existing Google-linked account, caps lifetime and does not expose policy identities',async t=>{
 const f=await fixture(t),flow=await f.start();assert.equal((await f.approve(flow,'b')).status,403);assert.equal((await f.exchange(flow)).status,202);assert.equal((await f.approve(flow)).status,200);
 const issued=await f.exchange(flow);assert.equal(issued.status,200);assert.equal(issued.data.expiresAt,policy().expiresAt);
 assert.equal((await f.request('/api/native/account',{token:issued.data.accessToken})).status,200);
 const config=await f.request('/api/auth/native/config');assert.equal(JSON.stringify(config.data).includes('accountIds'),false);
 await f.store.transact(d=>{d.users.a.googleSubject='changed-subject';});assert.equal((await f.request('/api/native/account',{token:issued.data.accessToken})).status,401);
});
test('replacement retires flows and sessions; removed/readded and reinstated epochs never revive observed credentials',async t=>{
 const f=await fixture(t),issued=await f.login(),pending=await f.start();
 f.set({...policy(2),accountIds:['b']});assert.equal((await f.request('/api/native/account',{token:issued.accessToken})).status,401);assert.equal((await f.exchange(pending)).status,401);
 f.set(policy(3));assert.equal((await f.request('/api/native/account',{token:issued.accessToken})).status,401);const newToken=await f.login();
 f.set(null);assert.equal((await f.request('/api/native/account',{token:newToken.accessToken})).status,401);
 f.set(policy(3));assert.equal((await f.request('/api/native/account',{token:newToken.accessToken})).status,401);await assert.rejects(f.start());
 f.set(policy(4));assert.equal((await f.login()).expiresAt,policy().expiresAt);
});
test('expired, disallowed and invalid native agent aliases fail before any provider call while guest/web remain available',async t=>{
 const f=await fixture(t),issued=await f.login();f.advance(3600000);
 for(const path of ['/api/agent','/API/AGENT/','/api/itineraries/','/API/ITINERARIES'])assert.ok((await f.request(path,{token:issued.accessToken,body:{message:'test'}})).status>=400);
 assert.equal(f.calls(),0);
 assert.equal((await f.request('/api/agent',{body:{message:'guest'}})).status,200);assert.equal(f.calls(),1);
 assert.equal((await f.request('/api/agent',{user:'a',headers:{Origin:origin},body:{message:'web'}})).status,200);assert.equal(f.calls(),2);
});
test('durable pilot high-water epoch survives restart and unknown IDs never create users',async t=>{
 const dir=await fs.mkdtemp(join(tmpdir(),'pilot-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=join(dir,'accounts.json');let current=policy(),store=createAccountStore({file});await store.transact(d=>{d.users.a={id:'a',googleSubject:'verified-a'};});
 let pilot=createNativePilot({store,origin,now:()=>1000,enabled:true,readPolicy:()=>current});await pilot.observe();current=null;await pilot.observe();
 store=createAccountStore({file});current=policy();pilot=createNativePilot({store,origin,now:()=>1000,enabled:true,readPolicy:()=>current});await pilot.observe();assert.equal(await store.read(d=>pilot.valid(d)),null);
 current={...policy(2),accountIds:['nonexistent']};await pilot.observe();assert.equal(await store.read(d=>Object.keys(d.users).join(',')),'a');assert.equal(await store.read(d=>pilot.valid(d)),null);
});
test('retirement commits once; repeated missing, malformed and expired policies never rewrite the durable account store',async t=>{
 const dir=await fs.mkdtemp(join(tmpdir(),'pilot-noop-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let renames=0,current=policy();const io={...fs,rename:async(...args)=>{renames++;return fs.rename(...args);}};
 const store=createAccountStore({file:join(dir,'accounts.json'),io});await store.transact(d=>{d.users.a={id:'a',googleSubject:'verified-a'};});
 const pilot=createNativePilot({store,origin,now:()=>1000,enabled:true,readPolicy:()=>current});await pilot.observe();current=null;const activeRenames=renames;await Promise.all(Array.from({length:8},()=>pilot.observe()));assert.equal(renames,activeRenames+1);const before=renames;
 for(const invalid of [null,{}, {...policy(2),expiresAt:999}]){current=invalid;for(let n=0;n<5;n++)await pilot.observe();}
 assert.equal(renames,before);assert.equal(await store.read(d=>d.nativePilot.active),false);
});
test('read-only is default and mode expansion requires higher epoch plus fresh device approval',async t=>{
 const f=await fixture(t),issued=await f.login();assert.equal((await f.request('/api/auth/native/config')).data.accessMode,'read-only');
 assert.equal((await f.request('/api/native/account',{token:issued.accessToken})).status,200);
 for(const path of ['/api/native/account/circles','/API/NATIVE/ACCOUNT/PLANS/p/INVITATIONS/','/api/agent','/API/AGENT/','/api/itineraries'])assert.equal((await f.request(path,{token:issued.accessToken,body:{message:'test'}})).status,403);
 assert.equal(f.calls(),0);
 f.set({...policy(),accessMode:'account-sync'});assert.equal((await f.request('/api/native/account',{token:issued.accessToken})).status,401);assert.equal((await f.request('/api/auth/native/config')).data.enabled,false);
 f.set({...policy(2),accessMode:'account-sync'});assert.equal((await f.request('/api/native/account',{token:issued.accessToken})).status,401);
 const full=await f.login();assert.equal((await f.request('/api/auth/native/config')).data.accessMode,'account-sync');assert.equal((await f.request('/API/AGENT/',{token:full.accessToken,body:{message:'test'}})).status,200);assert.equal(f.calls(),1);
 const pending=await f.start();assert.equal((await f.approve(pending)).status,200);f.set({...policy(3),accessMode:'read-only'});assert.equal((await f.exchange(pending)).status,401);
 const limited=await f.login();assert.equal((await f.request('/api/native/auth/logout',{token:limited.accessToken,body:{}})).status,200);assert.equal((await f.request('/api/native/account',{token:limited.accessToken})).status,401);
});
test('account-sync rejects non-allowlisted, unbound and invalid native sessions before agent provider work',async t=>{
 const f=await fixture(t);f.set({...policy(),accessMode:'account-sync'});const issued=await f.login(),other='ust_native_'+opaque(),unbound='ust_native_'+opaque();
 await f.store.transact(data=>{data.nativeSessions[hash(other)]={...data.nativeSessions[hash(issued.accessToken)],userId:'b'};data.nativeSessions[hash(unbound)]={kind:'native',userId:'a',expiresAt:3600000};});
 for(const token of [other,unbound,'ust_native_'+opaque()])for(const path of ['/api/agent','/API/AGENT/'])assert.equal((await f.request(path,{token,body:{message:'test'}})).status,401);
 assert.equal(f.calls(),0);
 assert.equal((await f.request('/api/agent',{token:issued.accessToken,body:{message:'test'}})).status,200);assert.equal(f.calls(),1);
});
test('transient policy read failure cannot bypass read-only or report retirement without persisting it',async t=>{
 const f=await fixture(t),issued=await f.login();f.sequence([policy(),null]);
 assert.equal((await f.request('/api/native/account/profile',{method:'PATCH',token:issued.accessToken,body:{name:'Race mutation'}})).status,403);
 assert.equal(await f.store.read(d=>d.users.a.profile.name),'a');
 f.sequence([policy(),null]);assert.equal((await f.request('/api/auth/native/config')).data.enabled,false);
 assert.equal(await f.store.read(d=>d.nativePilot.active),false);
 assert.equal((await f.request('/api/native/account',{token:issued.accessToken})).status,401);
});
test('native-return OAuth never creates or mutates unapproved accounts, while ordinary web signup remains unchanged',async()=>{
 let state,nonce,subject='unapproved-new';const store=createAccountStore({now:()=>1000}),readPolicy=()=>policy();
 await store.transact(d=>{d.users.a={id:'a',googleSubject:'approved-subject',email:'before@example.test',profile:{id:'a',name:'a',artists:[],vibes:[]}};});
 const oauthFactory=()=>({generateAuthUrl:o=>{state=o.state;nonce=o.nonce;return 'https://accounts.google.com/fake';},getToken:async()=>({tokens:{id_token:'fake'}}),verifyIdToken:async()=>({getPayload:()=>({sub:subject,email:'new@example.test',email_verified:true,nonce})})});
 const accounts=createAccounts({store,now:()=>1000,origin,clientId:'test',clientSecret:'test',nativeAuthEnabled:true,readNativePilotPolicy:readPolicy,oauthFactory});
 const native=createNativeAuth({store,now:()=>1000,origin,enabled:true,readPilotPolicy:readPolicy});
 const flow=await native.start({codeChallenge:hash(opaque()),codeChallengeMethod:'S256'}),returnTo='/api/auth/native/browser?flow='+flow.flowId;
 let start=await accounts.start({returnTo});await assert.rejects(accounts.complete({state,code:'fake'},start.binding),{status:403});
 assert.equal(await store.read(d=>Object.keys(d.users).length),1);assert.equal(await store.read(d=>Object.keys(d.sessions).length),0);assert.equal(await store.read(d=>d.users.a.email),'before@example.test');
 start=await accounts.start({returnTo:'/'});await accounts.complete({state,code:'fake'},start.binding);assert.equal(await store.read(d=>Object.keys(d.users).length),2);
 start=await accounts.start({returnTo});await assert.rejects(accounts.complete({state,code:'fake'},start.binding),{status:403});
 subject='approved-subject';start=await accounts.start({returnTo});assert.ok((await accounts.complete({state,code:'fake'},start.binding)).session);
});
test('denied native response flushes transient retirement before restore and disk-backed restart',async t=>{
 const dir=await fs.mkdtemp(join(tmpdir(),'pilot-response-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=join(dir,'accounts.json');
 const f=await fixture(t,{storeFactory:now=>createAccountStore({file,now})}),issued=await f.login();
 f.sequence([policy(),null]);assert.equal((await f.request('/api/native/account/profile',{method:'PATCH',token:issued.accessToken,body:{name:'Denied'}})).status,403);
 assert.equal(await f.store.read(d=>d.nativePilot.active),false);
 const reopened=createAccountStore({file}),pilot=createNativePilot({store:reopened,origin,now:()=>1000,enabled:true,readPolicy:()=>policy()});await pilot.observe();
 assert.equal(await reopened.read(d=>pilot.valid(d)),null);assert.equal(await reopened.read(d=>Object.keys(d.nativeSessions).length),0);
});
test('uncertain retirement commit replaces apparent denial with account_commit_unknown 503',async t=>{
 const dir=await fs.mkdtemp(join(tmpdir(),'pilot-response-unknown-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let fail=false;
 const io={...fs,rename:async(...args)=>{if(fail)throw Error('synthetic rename uncertainty');return fs.rename(...args);}};
 const f=await fixture(t,{storeFactory:now=>createAccountStore({file:join(dir,'accounts.json'),io,now})}),issued=await f.login();fail=true;f.sequence([policy(),null]);
 const response=await f.request('/api/native/account/profile',{method:'PATCH',token:issued.accessToken,body:{name:'Denied'}});
 assert.equal(response.status,503);assert.equal(response.data.code,'account_commit_unknown');assert.ok(await fs.stat(join(dir,'accounts.json.intent')));
});
