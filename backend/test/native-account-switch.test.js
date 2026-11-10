import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {createAccounts,createAccountStore} from '../src/accounts.js';
import {createApp} from '../src/app.js';
import {createDemoProvider} from '../src/demo-provider.js';

const origin='https://unstressed.example.test';
const opaque=()=>randomBytes(32).toString('base64url');
const hash=value=>createHash('sha256').update(value).digest('base64url');
const csrf=html=>html.match(/csrf="([\w-]+)"/)[1];
async function fixture(t,{accessMode='read-only'}={}){
  let clock=1000,authorization;
  const now=()=>clock,store=createAccountStore({now}),web={a:opaque(),b:opaque(),c:opaque()};
  await store.transact(data=>{for(const id of Object.keys(web)){
    data.users[id]={id,googleSubject:'verified-'+id,email:id+'@example.test',profile:{id,name:id,artists:[],vibes:[]}};
    data.sessions[hash(web[id])]={userId:id,expiresAt:10000000};
  }});
  let policy={version:1,epoch:1,origin,issuedAt:0,expiresAt:3600000,accountIds:['a','c'],accessMode};
  const oauthFactory=()=>({
    generateAuthUrl(args){authorization=args;return 'https://accounts.google.com/synthetic?state='+args.state;},
    async getToken({code,codeVerifier}){assert.ok(codeVerifier);return {tokens:{id_token:code}};},
    async verifyIdToken({idToken}){return {getPayload:()=>({sub:idToken,email:idToken+'@example.test',email_verified:true,nonce:authorization.nonce})};},
  });
  const accounts=createAccounts({store,now,origin,clientId:'synthetic',clientSecret:'synthetic',nativeAuthEnabled:true,readNativePilotPolicy:()=>policy,oauthFactory});
  const server=createApp({accounts,provider:createDemoProvider(),rateLimit:false,now}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  async function request(path,{body,session,headers={}}={}){
    const response=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method:body?'POST':'GET',redirect:'manual',headers:{...(body?{'content-type':'application/json',origin}:{}),...(session?{cookie:'__Host-outing-session='+session}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data,headers:response.headers};
  }
  async function start(){const verifier=opaque(),result=await request('/api/auth/native/start',{body:{codeChallenge:hash(verifier),codeChallengeMethod:'S256'},headers:{origin:''}});assert.equal(result.status,200);return {...result.data,verifier};}
  const page=(flow,session)=>request('/api/auth/native/browser?flow='+flow.flowId,{session});
  const exchange=flow=>request('/api/auth/native/exchange',{body:{flowId:flow.flowId,codeVerifier:flow.verifier},headers:{origin:''}});
  const cancel=flow=>request('/api/auth/native/cancel',{body:{flowId:flow.flowId,codeVerifier:flow.verifier},headers:{origin:''}});
  const begin=flow=>accounts.start({returnTo:'/api/auth/native/browser?flow='+flow.flowId});
  const complete=(start,subject='verified-a',previous=web.b)=>accounts.complete({state:authorization.state,code:subject},start.binding,previous);
  const approve=(flow,session,token)=>request('/api/auth/native/approve',{body:{flowId:flow.flowId,csrf:token},session});
  return {store,accounts,web,start,page,exchange,cancel,begin,complete,approve,request,authorization:()=>authorization,advance:ms=>clock+=ms,replacePolicy:()=>{policy={...policy,epoch:policy.epoch+1};}};
}

// Exercise the exact server-rendered handler with a synthetic DOM. No Google
// navigation, real account, browser session or provider is used by these tests.
function browser(html,fetch){
  const elements={approve:{disabled:false},cancel:{},status:{textContent:''}},destinations=[];
  runInNewContext(html.match(/<script nonce="[^"]+">([\s\S]+)<\/script>/)[1],{document:{getElementById:id=>elements[id]},fetch,location:{assign:url=>destinations.push(url)}});
  return {elements,destinations,click:async id=>{if(!elements[id].disabled)await elements[id].onclick();}};
}

test('nonallowlisted browser account offers deliberate Google account choice without disclosing approved identities',async t=>{
  const f=await fixture(t),flow=await f.start(),page=await f.page(flow,f.web.b);
  assert.equal(page.status,200);assert.match(page.data,/Choose another Google account/);assert.match(page.data,/signed-in account is not approved/);
  assert.doesNotMatch(page.data,/a@example\.test|c@example\.test|accountIds|Approve this device/);
  assert.ok(page.data.includes(flow.userCode));assert.equal(page.headers.get('cache-control'),'no-store');
  assert.equal(page.headers.get('referrer-policy'),'no-referrer');assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const before=await f.store.read(data=>({users:data.users,sessions:data.sessions}));
  const calls=[],view=browser(page.data,async(url,options)=>{calls.push({url,options});const result=await f.request(url,{session:f.web.b,body:JSON.parse(options.body)});return {ok:result.status===200,json:async()=>result.data};});
  assert.equal(calls.length,0);assert.deepEqual(view.destinations,[]);assert.equal((await f.exchange(flow)).status,202);
  assert.equal(await f.store.read(data=>data.nativeFlows[hash(flow.flowId)].browser),undefined);
  assert.equal((await f.approve(flow,f.web.b,csrf(page.data))).status,403);
  await view.click('approve');assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/auth/google/start');
  assert.deepEqual(JSON.parse(calls[0].options.body),{returnTo:'/api/auth/native/browser?flow='+flow.flowId});
  assert.equal(f.authorization().prompt,'select_account');assert.equal(view.destinations.length,1);
  assert.match(view.destinations[0],/^https:\/\/accounts\.google\.com\/synthetic\?/);
  assert.deepEqual(await f.store.read(data=>({users:data.users,sessions:data.sessions})),before);
});

test('successful synthetic account choice returns to the same code and requires fresh CSRF-bound approval',async t=>{
  const f=await fixture(t),flow=await f.start(),wrong=await f.page(flow,f.web.b),login=await f.begin(flow),result=await f.complete(login);
  assert.equal(result.returnTo,'/api/auth/native/browser?flow='+flow.flowId);
  assert.equal((await f.accounts.current(f.web.b)).user,null);assert.equal((await f.accounts.current(result.session)).user.id,'a');
  assert.equal((await f.exchange(flow)).status,202);
  assert.equal((await f.approve(flow,result.session,csrf(wrong.data))).status,403);
  const page=await f.page(flow,result.session);assert.equal(page.status,200);assert.match(page.data,/Approve this device/);assert.ok(page.data.includes(flow.userCode));
  assert.doesNotMatch(page.data,/Choose another Google account|send\('\/api\/auth\/google\/start'/);
  assert.equal((await f.approve(flow,f.web.b,csrf(page.data))).status,401);
  const requestBody={flowId:flow.flowId,csrf:csrf(page.data)};
  assert.equal((await f.request('/api/auth/native/approve',{body:requestBody,session:result.session,headers:{origin:'https://evil.example.test'}})).status,403);
  assert.equal((await f.exchange(flow)).status,202);
  const view=browser(page.data,async(url,options)=>{assert.equal(url,'/api/auth/native/approve');const response=await f.request(url,{session:result.session,body:JSON.parse(options.body)});return {ok:response.status===200,json:async()=>response.data};});
  await view.click('approve');assert.equal(view.elements.approve.disabled,true);assert.match(view.elements.status.textContent,/Approved/);
  const issued=await f.exchange(flow);assert.equal(issued.status,200);assert.equal(issued.data.accessMode,'read-only');assert.equal(issued.data.expiresAt,3600000);
  assert.equal((await f.exchange(flow)).status,401);assert.deepEqual(view.destinations,[]);
});

test('signed-out page still offers sign-in; changed Google linkage is not treated as eligible',async t=>{
  const f=await fixture(t),flow=await f.start(),guest=await f.page(flow);
  assert.equal(guest.status,200);assert.match(guest.data,/>Sign in with Google</);assert.doesNotMatch(guest.data,/Choose another Google account|a@example\.test/);
  const eligible=await f.page(flow,f.web.a);assert.match(eligible.data,/Continue as a@example\.test/);
  await f.store.transact(data=>{data.users.a.googleSubject='changed-subject';});
  const changed=await f.page(flow,f.web.a);assert.equal(changed.status,200);assert.match(changed.data,/Choose another Google account/);
  assert.equal((await f.approve(flow,f.web.a,csrf(eligible.data))).status,403);
  assert.equal(await f.store.read(data=>data.nativeFlows[hash(flow.flowId)].csrf),undefined);
});

test('unapproved existing or new Google identities cannot change accounts or sessions during native account choice',async t=>{
  const f=await fixture(t),flow=await f.start(),before=await f.store.read(data=>({users:data.users,sessions:data.sessions}));
  for(const subject of ['verified-b','new-google-subject']){
    const login=await f.begin(flow);await assert.rejects(f.complete(login,subject),{status:403});
    assert.deepEqual(await f.store.read(data=>({users:data.users,sessions:data.sessions})),before);
    assert.equal((await f.exchange(flow)).status,202);
  }
  const ordinary=await f.accounts.start({returnTo:'/'}),result=await f.complete(ordinary,'new-google-subject');
  assert.equal(result.returnTo,'/');assert.equal((await f.accounts.current(result.session)).user.email,'new-google-subject@example.test');
  assert.equal(await f.store.read(data=>Object.keys(data.users).length),4);
});

test('approved flows cannot render account choice or begin another native-return OAuth flow',async t=>{
  const f=await fixture(t),flow=await f.start(),page=await f.page(flow,f.web.a);
  assert.equal((await f.approve(flow,f.web.a,csrf(page.data))).status,200);
  const before=await f.store.read(data=>data);
  for(const session of [undefined,f.web.a,f.web.b])assert.equal((await f.page(flow,session)).status,401);
  await assert.rejects(f.begin(flow),/already been approved/);
  assert.deepEqual(await f.store.read(data=>data),before);
  const issued=await f.exchange(flow);assert.equal(issued.status,200);assert.equal((await f.exchange(flow)).status,401);
});

test('OAuth begun before another browser approves cannot change sessions or the approved account on return',async t=>{
  const f=await fixture(t),flow=await f.start(),login=await f.begin(flow),page=await f.page(flow,f.web.a);
  assert.equal((await f.approve(flow,f.web.a,csrf(page.data))).status,200);
  const before=await f.store.read(data=>({users:data.users,sessions:data.sessions,nativeFlows:data.nativeFlows}));
  await assert.rejects(f.complete(login,'verified-c'),/already been approved/);
  assert.deepEqual(await f.store.read(data=>({users:data.users,sessions:data.sessions,nativeFlows:data.nativeFlows})),before);
  const issued=await f.exchange(flow);assert.equal(issued.status,200);
  assert.equal(await f.store.read(data=>data.nativeSessions[hash(issued.data.accessToken)].userId),'a');
});

test('reloading after account choice rejects stale approval without consuming the pending flow',async t=>{
  const f=await fixture(t),flow=await f.start(),login=await f.begin(flow),result=await f.complete(login);
  const first=await f.page(flow,result.session),reloaded=await f.page(flow,result.session);
  assert.notEqual(csrf(first.data),csrf(reloaded.data));assert.ok(reloaded.data.includes(flow.userCode));
  assert.equal((await f.approve(flow,result.session,csrf(first.data))).status,403);
  assert.equal((await f.exchange(flow)).status,202);
  assert.equal((await f.approve(flow,result.session,csrf(reloaded.data))).status,200);
  assert.equal((await f.approve(flow,result.session,csrf(reloaded.data))).status,403);
  assert.equal((await f.exchange(flow)).status,200);
});

for(const interruption of ['cancel','expire','retire','consume'])test('native account choice fails closed when its flow is '+interruption,async t=>{
  const f=await fixture(t),flow=await f.start(),login=await f.begin(flow);
  if(interruption==='cancel')assert.equal((await f.cancel(flow)).status,200);
  if(interruption==='expire')f.advance(600001);
  if(interruption==='retire')f.replacePolicy();
  if(interruption==='consume'){const page=await f.page(flow,f.web.a);assert.equal((await f.approve(flow,f.web.a,csrf(page.data))).status,200);assert.equal((await f.exchange(flow)).status,200);}
  const before=await f.store.read(data=>({users:data.users,sessions:data.sessions}));
  await assert.rejects(f.complete(login));
  assert.deepEqual(await f.store.read(data=>({users:data.users,sessions:data.sessions})),before);
  assert.equal((await f.page(flow,f.web.b)).status,401);assert.equal((await f.exchange(flow)).status,401);
});

test('cancelled or failed account choice leaves a pending flow and existing web identity unchanged',async t=>{
  const f=await fixture(t),flow=await f.start(),page=await f.page(flow,f.web.b),before=await f.store.read(data=>({users:data.users,sessions:data.sessions}));
  let calls=0;const view=browser(page.data,async()=>{calls++;return {ok:false,json:async()=>({error:'Synthetic sign-in unavailable'})};});
  await view.click('approve');assert.match(view.elements.status.textContent,/Synthetic sign-in unavailable/);assert.deepEqual(view.destinations,[]);
  await view.click('cancel');await view.click('approve');assert.equal(calls,1);assert.equal(view.elements.approve.disabled,true);
  const login=await f.begin(flow);const result=await f.accounts.complete({state:f.authorization().state,error:'access_denied'},login.binding,f.web.b);
  assert.equal(result.cancelled,true);assert.equal(result.session,undefined);assert.equal(result.returnTo,'/api/auth/native/browser?flow='+flow.flowId);
  assert.equal((await f.exchange(flow)).status,202);assert.deepEqual(await f.store.read(data=>({users:data.users,sessions:data.sessions})),before);
  assert.match((await f.page(flow,f.web.b)).data,/Choose another Google account/);
});

test('account choice keeps existing same-origin and exact native-return constraints',async t=>{
  const f=await fixture(t),flow=await f.start(),body={returnTo:'/api/auth/native/browser?flow='+flow.flowId};
  for(const badOrigin of ['', 'https://evil.example.test'])assert.equal((await f.request('/api/auth/google/start',{body,session:f.web.b,headers:{origin:badOrigin}})).status,403);
  for(const returnTo of [origin+body.returnTo,'//evil.example.test'+body.returnTo,body.returnTo+'&next=https://evil.example.test']){
    assert.equal((await f.request('/api/auth/google/start',{body:{returnTo},session:f.web.b})).status,400);
  }
  assert.equal(await f.store.read(data=>Object.keys(data.flows).length),0);assert.equal((await f.exchange(flow)).status,202);
});
