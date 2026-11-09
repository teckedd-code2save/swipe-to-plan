import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {createAccounts,createAccountStore} from '../src/accounts.js';
import {createApp} from '../src/app.js';
import {createDemoProvider} from '../src/demo-provider.js';
const hash=s=>createHash('sha256').update(s).digest('base64url');
const opaque=()=>randomBytes(32).toString('base64url');
async function fixture(t,{enabled=true,rateLimit=false,storeFactory}={}){
 let clock=1000;const now=()=>clock,store=storeFactory?storeFactory(now):createAccountStore({now});const sessions={a:opaque(),b:opaque()};
 await store.transact(data=>{for(const id of ['a','b']){data.users[id]={id,googleSubject:`verified-${id}`,email:`${id}@example.test`,profile:{id,name:id,artists:[],vibes:[]}};data.sessions[hash(sessions[id])]={userId:id,expiresAt:clock+86400000};}});
 const accounts=createAccounts({store,now,origin:'http://localhost:5173',clientId:'test',clientSecret:'test',nativeAuthEnabled:enabled,readNativePilotPolicy:()=>({version:1,epoch:1,origin:'http://localhost:5173',issuedAt:0,expiresAt:86400000,accountIds:['a','b'],accessMode:'account-sync'}),invitationEpoch:'4de508f0-6a1e-4cba-82f4-e3e8be297179'});
 const app=createApp({accounts,provider:createDemoProvider(),agent:{interpret:async()=>({status:'reply',message:'Test reply'})},rateLimit,now}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
 async function request(path,{method='GET',body,token,user,origin,headers={}}={}){const response=await fetch(base+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`} : {}),...(user?{Cookie:`outing-session=${sessions[user]}`} : {}),...(origin?{Origin:origin}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data,headers:response.headers};}
 async function start(){const verifier=opaque(),result=await request('/api/auth/native/start',{method:'POST',body:{codeChallenge:hash(verifier),codeChallengeMethod:'S256'}});assert.equal(result.status,200);return {...result.data,verifier};}
 async function approve(flow,user='a'){const page=await request(`/api/auth/native/browser?flow=${flow.flowId}`,{user});assert.equal(page.status,200);const csrf=page.data.match(/csrf="([\w-]+)"/)[1];const result=await request('/api/auth/native/approve',{method:'POST',body:{flowId:flow.flowId,csrf},user,origin:'http://localhost:5173'});assert.equal(result.status,200);return csrf;}
 const exchange=(flow,verifier=flow.verifier)=>request('/api/auth/native/exchange',{method:'POST',body:{flowId:flow.flowId,codeVerifier:verifier}});
 async function login(user='a'){const flow=await start();await approve(flow,user);return (await exchange(flow)).data.accessToken;}
 return {store,accounts,request,start,approve,exchange,login,sessions,advance:ms=>clock+=ms};
}

test('native approval requires PKCE, explicit browser approval, CSRF and matching session; exchange is single use',async t=>{
 const f=await fixture(t),flow=await f.start();assert.match(flow.userCode,/^[A-F0-9]{8}$/);assert.equal((await f.exchange(flow)).status,202);
 const page=await f.request(`/api/auth/native/browser?flow=${flow.flowId}`,{user:'a'});assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(page.headers.get('referrer-policy'),'no-referrer');assert.ok(page.data.includes(flow.userCode));const csrf=page.data.match(/csrf="([\w-]+)"/)[1];
 const body={flowId:flow.flowId,csrf};
 for(const options of [{user:'a'},{user:'a',origin:'https://evil.test'},{user:'b',origin:'http://localhost:5173'},{origin:'http://localhost:5173'}])assert.ok((await f.request('/api/auth/native/approve',{method:'POST',body,...options})).status>=400);
 assert.equal((await f.exchange(flow,opaque())).status,401);await f.approve(flow);const result=await f.exchange(flow);assert.match(result.data.accessToken,/^ust_native_/);assert.equal((await f.exchange(flow)).status,401);
 const stored=await f.store.read(data=>data);assert.equal(JSON.stringify(stored).includes(result.data.accessToken),false);assert.equal(Object.keys(stored.nativeSessions).length,1);
 assert.equal((await f.request('/api/native/account',{token:result.data.accessToken})).data.user.id,'a');
});

test('native bearer is isolated from cookies, browser routes, forged Origin and non-native credentials',async t=>{
 const f=await fixture(t),token=await f.login();
 for(const options of [{user:'a'},{token:f.sessions.a},{token,origin:'http://localhost:5173'},{token,user:'a'},{token:'ust_native_'+opaque()}])assert.ok((await f.request('/api/native/account',options)).status>=400);
 assert.equal((await f.request('/api/account',{token})).data.user,null);
 assert.equal((await f.request('/api/account',{headers:{Cookie:`outing-session=${token}`}})).data.user,null);
 assert.equal((await f.request('/api/account/profile',{method:'PATCH',body:{name:'Wrong'},token,origin:'http://localhost:5173'})).status,401);
 assert.equal((await f.request('/api/native/account/profile',{method:'PATCH',body:{name:'Native',artists:[],vibes:[]},token})).status,200);
 assert.equal((await f.request('/api/account',{user:'a'})).data.user.profile.name,'Native');
 assert.equal((await f.request('/api/account/profile',{method:'PATCH',body:{name:'Bad'},user:'a'})).status,403);
 for(const path of ['/api/native/account/plans/p/bookings','/api/native/account/circles/c/email-invites'])assert.equal((await f.request(path,{method:'POST',body:{},token})).status,404);
});

test('native cancellation, flow expiry, bearer expiry, revocation and feature gate fail closed',async t=>{
 const f=await fixture(t),cancel=await f.start();assert.equal((await f.request('/api/auth/native/cancel',{method:'POST',body:{flowId:cancel.flowId,codeVerifier:cancel.verifier}})).status,200);assert.equal((await f.exchange(cancel)).status,401);
 const expired=await f.start();f.advance(600001);assert.equal((await f.exchange(expired)).status,401);
 const token=await f.login();await f.request('/api/native/auth/logout',{method:'POST',body:{},token});assert.equal((await f.request('/api/native/account',{token})).status,401);assert.ok((await f.request('/api/account',{user:'a'})).data.user);
 const old=await f.login();f.advance(8*3600000+1);assert.equal((await f.request('/api/native/account',{token:old})).status,401);
 assert.equal((await f.request('/api/itineraries',{method:'POST',body:{},token:old})).status,401);
 const disabled=await fixture(t,{enabled:false});assert.equal((await disabled.request('/api/auth/native/config')).data.enabled,false);assert.equal((await disabled.request('/api/auth/native/start',{method:'POST',body:{codeChallenge:hash(opaque()),codeChallengeMethod:'S256'}})).status,503);
});

test('native uses authoritative saved plans, revision checks and live circle membership',async t=>{
 const f=await fixture(t),a=await f.login(),b=await f.login('b');const circle=await f.accounts.createCircle(f.sessions.a,{name:'Friends',people:[{id:'a',name:'a',artists:[],vibes:[]}]});await f.accounts.joinCircle(f.sessions.b,circle.id,{inviteToken:circle.inviteToken});
 const id='4de508f0-6a1e-4cba-82f4-e3e8be297179';const plan={request:{title:'Server plan',date:'2026-11-09',area:'Accra',activities:[],party:{adults:1},people:[],pins:{}},stops:[]};
 await f.accounts.keepPlan({session:{nativeToken:a},id,revision:1,circleId:circle.id},plan);
 assert.equal((await f.request(`/api/native/account/plans/${id}`,{token:b})).status,404);
 assert.equal((await f.request(`/api/native/account/circle-plans/a/${id}`,{token:b})).status,200);
 assert.equal((await f.request(`/api/native/account/plans/${id}`,{method:'PATCH',body:{revision:0,pins:{}},token:a})).status,409);
 assert.equal((await f.request('/api/native/account/plans',{method:'POST',body:{plan},token:a})).status,404);
 const invited=await f.request(`/api/native/account/plans/${id}/invitations`,{method:'POST',body:{recipientId:'b',revision:1},token:a});assert.equal(invited.status,200);const invitationId=invited.data.id;assert.equal((await f.request(`/api/native/account/invitations/${invitationId}`,{method:'PATCH',body:{action:'going'},token:b})).status,200);assert.equal((await f.request(`/api/native/account/invitations/${invitationId}/plan`,{token:a})).status,404);assert.equal((await f.request(`/api/native/account/invitations/${invitationId}/plan`,{token:b})).status,200);
 await f.accounts.removeCircleMember(f.sessions.a,circle.id,'b');assert.equal((await f.request(`/api/native/account/invitations/${invitationId}/plan`,{token:b})).status,404);assert.equal((await f.request('/api/native/account/invitations',{token:b})).data.invitations.length,0);assert.equal((await f.request(`/api/native/account/circle-plans/a/${id}`,{token:b})).status,404);
 assert.equal((await f.request('/api/native/account/circle-plans',{token:b})).data.plans.length,0);
});


test('native planning autosaves server output and uses live account context without accepting uploaded plans',async t=>{
 const f=await fixture(t),token=await f.login(),body={date:'2099-01-01',area:'Osu',activities:['coffee']};
 const planned=await f.request('/api/itineraries',{method:'POST',body,token});assert.equal(planned.status,200);assert.ok(planned.data.savedPlan);assert.equal(planned.data.saveError,undefined);
 const saved=await f.request(`/api/native/account/plans/${planned.data.savedPlan.id}`,{token});assert.deepEqual(saved.data.stops,planned.data.stops);
 assert.equal((await f.request('/api/native/account/plans',{token})).data.plans.length,1);
 const guest=await f.request('/api/itineraries',{method:'POST',body});assert.equal(guest.status,200);assert.equal(guest.data.savedPlan,undefined);
 const req={headers:{},path:'/api/agent',get:name=>name==='authorization'?`Bearer ${token}`:undefined};assert.equal((await f.accounts.planningPeople(req)).peopleMode,'connected');
 const flow=await f.start();await f.approve(flow);const results=await Promise.all([f.exchange(flow),f.exchange(flow)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);
 await assert.rejects(f.accounts.start({returnTo:`/api/auth/native/browser?flow=${flow.flowId}`}));
 const fresh=await f.start();const signed=await f.accounts.start({returnTo:`/api/auth/native/browser?flow=${fresh.flowId}`});assert.match(signed.url,/accounts.google.com/);
 await assert.rejects(f.accounts.start({returnTo:'/api/auth/native/browser?flow='+flow.flowId+'&next=https://evil.test'}));
});

test('Express case and trailing-slash route variants preserve native, browser and guest auth boundaries',async t=>{
 const f=await fixture(t,{rateLimit:true}),token=await f.login(),body={date:'2099-01-01',area:'Osu',activities:['coffee']};
 for(const path of ['/api/itineraries','/api/itineraries/','/API/itineraries','/API/ITINERARIES/']){
  assert.equal((await f.request(path,{method:'POST',body,token:'ust_native_'+opaque()})).status,401,path);
  assert.equal((await f.request(path,{method:'POST',body,token,user:'a'})).status,403,path);
  assert.equal((await f.request(path,{method:'POST',body,token,origin:'http://localhost:5173'})).status,403,path);
  const native=await f.request(path,{method:'POST',body,token});assert.equal(native.status,200,path);assert.ok(native.data.savedPlan,path);
  const guest=await f.request(path,{method:'POST',body});assert.equal(guest.status,200,path);assert.equal(guest.data.savedPlan,undefined,path);
  const web=await f.request(path,{method:'POST',body,user:'a',origin:'http://localhost:5173'});assert.equal(web.status,200,path);assert.ok(web.data.savedPlan,path);
  assert.equal((await f.request(path,{method:'POST',body,user:'a'})).status,403,path);
  const cookie=await f.request(path,{method:'POST',body,headers:{Cookie:`outing-session=${token}`}});assert.equal(cookie.status,200,path);assert.equal(cookie.data.savedPlan,undefined,path);
 }
 for(const path of ['/api/agent','/api/agent/','/API/AGENT/']){
  const body={message:'Coffee please'};
  assert.equal((await f.request(path,{method:'POST',body,token:'ust_native_'+opaque()})).status,401,path);
  assert.equal((await f.request(path,{method:'POST',body,token,user:'a'})).status,403,path);
  assert.equal((await f.request(path,{method:'POST',body,token,origin:'http://localhost:5173'})).status,403,path);
  assert.equal((await f.request(path,{method:'POST',body,token})).status,200,path);
  assert.equal((await f.request(path,{method:'POST',body})).status,200,path);
  assert.equal((await f.request(path,{method:'POST',body,user:'a',origin:'http://localhost:5173'})).status,200,path);
 }
 f.advance(8*3600000+1);
 for(const path of ['/api/agent/','/API/AGENT/'])assert.equal((await f.request(path,{method:'POST',body:{message:'Coffee'},token})).status,401,path);
 for(const path of ['/api/itineraries/','/API/ITINERARIES/'])assert.equal((await f.request(path,{method:'POST',body,token})).status,401,path);
});

test('proof-scoped polling supports concurrent devices and cancellation has an independent budget',async t=>{
 const f=await fixture(t,{rateLimit:true}),flows=await Promise.all([f.start(),f.start(),f.start()]);
 // Three devices polling every two seconds produce 90 successful polls/minute.
 for(let poll=0;poll<30;poll++){for(const flow of flows)assert.equal((await f.exchange(flow)).status,202);f.advance(2000);}
 // Invalid proofs never charge a known flow. Unknown IDs allocate no state.
 const flow=await f.start();for(let i=0;i<45;i++)assert.equal((await f.exchange(flow,opaque())).status,401);
 const before=await f.store.read(data=>Object.keys(data.nativeFlows).length);
 for(let i=0;i<10;i++)assert.equal((await f.exchange({...flow,flowId:opaque()})).status,401);
 assert.equal(await f.store.read(data=>Object.keys(data.nativeFlows).length),before);
 for(let i=0;i<40;i++)assert.equal((await f.exchange(flow)).status,202);
 const limited=await f.exchange(flow);assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');
 assert.equal((await f.exchange(flows[0])).status,202);
 assert.equal((await f.request('/api/auth/native/cancel',{method:'POST',body:{flowId:flow.flowId,codeVerifier:flow.verifier}})).status,200);
 f.advance(60000);assert.equal((await f.exchange(flow)).status,401);
});

test('rotating malformed flow IDs cannot bypass the IP abuse guard, and cancellation remains available',async t=>{
 const f=await fixture(t,{rateLimit:true}),flow=await f.start();
 for(let i=0;i<4000;i++)assert.equal((await f.exchange({...flow,flowId:`invalid-${i}`})).status,401);
 const blocked=await f.exchange(flow);assert.equal(blocked.status,429);assert.equal(blocked.headers.get('retry-after'),'60');
 assert.equal(await f.store.read(data=>Object.keys(data.nativeFlows).length),1);
 assert.equal((await f.request('/api/auth/native/cancel',{method:'POST',body:{flowId:flow.flowId,codeVerifier:flow.verifier}})).status,200);
 f.advance(60000);assert.equal((await f.exchange(flow)).status,401);
});


test('durable pending polls are read-only and approval/exchange retain atomic single consumption',async t=>{
 const directory=await fs.mkdtemp(join(tmpdir(),'native-poll-store-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let renames=0,syncs=0;
 const io={...fs,async open(...args){const handle=await fs.open(...args),sync=handle.sync.bind(handle);handle.sync=async()=>{syncs++;return sync();};return handle;},async rename(...args){renames++;return fs.rename(...args);}};
 const f=await fixture(t,{rateLimit:true,storeFactory:now=>createAccountStore({now,file:join(directory,'accounts.json'),io})});
 const flow=await f.start(),before=renames,syncBefore=syncs;
 for(let i=0;i<8;i++)assert.equal((await f.exchange(flow)).status,202);
 assert.equal((await f.exchange(flow,opaque())).status,401);assert.equal((await f.exchange({...flow,flowId:opaque()})).status,401);assert.equal(syncs,syncBefore,'Pending and rejected proofs must not fsync.');
 assert.equal(renames,before,'Pending polls must not rewrite the durable account store.');
 await f.approve(flow);assert.equal(renames,before+2,'Browser CSRF binding and explicit approval each commit once.');
 const results=await Promise.all([f.exchange(flow),f.exchange(flow)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);assert.equal(renames,before+3,'Exactly one successful exchange commits.');assert.equal(await f.store.read(data=>Object.keys(data.nativeSessions).length),1);
 const token=results.find(r=>r.status===200).data.accessToken;assert.equal((await f.request('/api/native/account',{token})).data.user.id,'a');
});

test('disabling native auth suspends rather than permanently revokes unexpired sessions',async t=>{
 const f=await fixture(t),token=await f.login();
 const off=await fixture(t,{enabled:false,storeFactory:()=>f.store});assert.equal((await off.request('/api/native/account',{token})).status,503);
 const on=await fixture(t,{enabled:true,storeFactory:()=>f.store});assert.equal((await on.request('/api/native/account',{token})).status,200);
 await on.request('/api/native/auth/logout',{method:'POST',body:{},token});assert.equal((await f.request('/api/native/account',{token})).status,401);
});

test('approved exchange rate rejection never consumes approval or creates an unseen token',async t=>{
 const f=await fixture(t,{rateLimit:true}),flow=await f.start();
 for(let i=0;i<40;i++)assert.equal((await f.exchange(flow)).status,202);
 await f.approve(flow);const limited=await f.exchange(flow);assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');
 assert.equal(await f.store.read(data=>Object.keys(data.nativeSessions).length),0);
 assert.equal(await f.store.read(data=>data.nativeFlows[hash(flow.flowId)].userId),'a');
 f.advance(60000);const exchanged=await f.exchange(flow);assert.equal(exchanged.status,200);assert.ok(exchanged.data.accessToken);
 assert.equal((await f.exchange(flow)).status,401);
});
