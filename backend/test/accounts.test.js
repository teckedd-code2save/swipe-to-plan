import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAccounts,createAccountStore} from '../src/accounts.js';
import {createApp} from '../src/app.js';

// Only Google's network response is substituted. Real route/session/store code runs.
function fixture(options={}){
  let authorization,claimsOverride={},exchange=0;
  const accounts=createAccounts({clientId:'test-client',clientSecret:'private-test-secret',origin:'http://localhost:5173',...options,oauthFactory:()=>({
    generateAuthUrl(args){authorization=args;return `https://accounts.google.com/o/oauth2/v2/auth?state=${args.state}`;},
    async getToken({code,codeVerifier}){exchange++;assert.ok(codeVerifier);return {tokens:{id_token:code}};},
    async verifyIdToken({idToken,audience}){assert.equal(audience,'test-client');return {getPayload:()=>({sub:idToken,email:'same@example.test',email_verified:true,name:idToken,nonce:authorization.nonce,...claimsOverride})};},
  })});
  async function start(){const flow=await accounts.start({returnTo:'/'});return {...flow,state:authorization.state};}
  async function login(name,previous){const flow=await start();return accounts.complete({state:flow.state,code:name},flow.binding,previous);}
  return {accounts,login,start,authorization:()=>authorization,override:value=>{claimsOverride=value;},exchanges:()=>exchange};
}

test('Google login binds browser, PKCE and nonce; successful states cannot replay',async()=>{
  const f=fixture(),flow=await f.start();
  assert.deepEqual(f.authorization().scope,['openid','email','profile']);assert.equal(f.authorization().code_challenge_method,'S256');assert.equal(f.authorization().prompt,'select_account');
  await assert.rejects(f.accounts.complete({state:flow.state,code:'Alex'},'x'.repeat(43)),e=>e.status===401);assert.equal(f.exchanges(),0);
  const signed=await f.accounts.complete({state:flow.state,code:'Alex'},flow.binding);assert.ok(signed.session);
  assert.equal((await f.accounts.current(signed.session)).user.profile.name,'Alex');
  await assert.rejects(f.accounts.complete({state:flow.state,code:'Alex'},flow.binding),e=>e.status===401);
  const bad=await f.start();f.override({nonce:'wrong'});await assert.rejects(f.accounts.complete({state:bad.state,code:'Alex'},bad.binding),e=>e.status===401);
  assert.ok((await f.accounts.current(signed.session)).user);
});

test('unverified identity, expired state and external returns are rejected; cancel keeps the existing session',async()=>{
  let now=1000;const f=fixture({now:()=>now,store:createAccountStore({now:()=>now})}),signed=await f.login('Alex');
  const expired=await f.start();now+=600001;await assert.rejects(f.accounts.complete({state:expired.state,code:'Alex'},expired.binding),e=>e.status===401);
  const cancel=await f.start();assert.equal((await f.accounts.complete({state:cancel.state,error:'access_denied'},cancel.binding,signed.session)).cancelled,true);assert.ok((await f.accounts.current(signed.session)).user);
  f.override({email_verified:false});await assert.rejects(f.login('Other'),e=>e.status===401);
  for(const returnTo of ['https://evil.test/','//evil.test','/admin','/\\evil.test'])await assert.rejects(f.accounts.start({returnTo}),e=>e.status===400);
});

test('accounts with the same email remain distinct; sessions rotate, expire and log out',async()=>{
  let now=1000;const f=fixture({now:()=>now,store:createAccountStore({now:()=>now})});
  const a=await f.login('google-sub-a'),b=await f.login('google-sub-b');
  const au=(await f.accounts.current(a.session)).user,bu=(await f.accounts.current(b.session)).user;
  assert.notEqual(au.id,bu.id);assert.equal(au.email,bu.email);assert.equal(au.googleSubject,undefined);
  const again=await f.login('google-sub-a',a.session);assert.equal((await f.accounts.current(again.session)).user.id,au.id);assert.equal((await f.accounts.current(a.session)).user,null);
  await f.accounts.logout(again.session);assert.equal((await f.accounts.current(again.session)).user,null);
  now+=31*86400000;assert.equal((await f.accounts.current(b.session)).user,null);
});

test('circle invites connect real accounts, isolate private circles and always resolve latest member tastes',async()=>{
  const f=fixture(),a=await f.login('Alex'),b=await f.login('Sam'),c=await f.login('Ama');
  const alice=(await f.accounts.current(a.session)).user;
  const circle=await f.accounts.createCircle(a.session,{name:'Sunday people',people:[alice.profile,{id:'manual-sam',name:'Sam',artists:['Tems'],vibes:[]}]});
  assert.equal((await f.accounts.current(b.session)).circles.length,0);
  await assert.rejects(f.accounts.invite(circle.id,'bad'),e=>e.status===404);
  const invite=await f.accounts.invite(circle.id,circle.inviteToken);assert.equal(invite.members[1].claimable,true);assert.equal(invite.members[1].artists,undefined);
  await assert.rejects(f.accounts.joinCircle(b.session,circle.id,{inviteToken:'bad'}),e=>e.status===404);
  const joined=await f.accounts.joinCircle(b.session,circle.id,{inviteToken:circle.inviteToken,replaceId:invite.members[1].id});assert.equal(joined.people.length,2);assert.equal(joined.inviteToken,undefined);
  assert.equal((await f.accounts.joinCircle(b.session,circle.id,{inviteToken:circle.inviteToken})).people.length,2);
  await assert.rejects(f.accounts.joinCircle(c.session,circle.id,{inviteToken:circle.inviteToken,replaceId:invite.members[1].id}),e=>e.status===409);
  await f.accounts.updateProfile(b.session,{name:'Sam',artists:['Sarkodie'],vibes:['v-cafe'],spending:{style:'mindful',priority:'dinner'}});
  const latest=(await f.accounts.current(a.session)).circles[0];assert.deepEqual(latest.people[1].artists,['Sarkodie']);assert.equal(latest.people[1].spending.style,'mindful');
  await assert.rejects(f.accounts.updateProfile(b.session,{id:alice.id,name:'Stolen'}),e=>e.status===400);
  await assert.rejects(f.accounts.removeCircle(c.session,circle.id),e=>e.status===404);
  await f.accounts.removeCircle(b.session,circle.id);assert.equal((await f.accounts.current(b.session)).circles.length,0);assert.equal((await f.accounts.current(a.session)).circles[0].people.length,1);
  await assert.rejects(f.accounts.createCircle(null,{name:'No auth',people:[alice.profile]}),e=>e.status===401);
});

test('organizers can update invited tastes without duplicating people or editing joined accounts',async()=>{
  const f=fixture(),a=await f.login('Alex'),b=await f.login('Sam');
  const alice=(await f.accounts.current(a.session)).user;
  const circle=await f.accounts.createCircle(a.session,{name:'Weekend crew',people:[alice.profile,{id:'manual-sam',name:'Sam',artists:[],vibes:[]}]});
  assert.deepEqual(circle.people.map(p=>p.id),[alice.id,'manual-sam']);
  const preferences={name:'Sam',artists:['Sarkodie'],vibes:['v-ghanaian','v-history'],spending:{style:'mindful',priority:'dinner'}};
  await assert.rejects(f.accounts.updateCirclePerson(b.session,circle.id,'manual-sam',preferences),e=>e.status===403);
  await f.accounts.updateCirclePerson(a.session,circle.id,'manual-sam',preferences);
  const saved=(await f.accounts.current(a.session)).circles[0];
  assert.deepEqual(saved.people[1],{id:'manual-sam',...preferences});
  await assert.rejects(f.accounts.updateCirclePerson(a.session,circle.id,alice.id,preferences),e=>e.status===403);
  const joined=await f.accounts.joinCircle(b.session,circle.id,{inviteToken:circle.inviteToken,replaceId:'manual-sam'});
  await assert.rejects(f.accounts.updateCirclePerson(a.session,circle.id,joined.people[1].id,preferences),e=>e.status===403);
  assert.equal(joined.people.length,2);
});

test('persistent accounts and circles survive restart without storing raw session credentials',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'outing-accounts-')),file=join(directory,'accounts.json');
  try{const store=createAccountStore({file}),f=fixture({store});const a=await f.login('Alex');const user=(await f.accounts.current(a.session)).user;await f.accounts.createCircle(a.session,{name:'Family',people:[user.profile]});
    const restarted=fixture({store:createAccountStore({file})});const result=await restarted.accounts.current(a.session);assert.equal(result.user.id,user.id);assert.equal(result.circles[0].name,'Family');
    assert.ok(!(await readFile(file,'utf8')).includes(a.session));assert.equal((await stat(file)).mode&0o777,0o600);
    const b=await restarted.login('Sam');assert.equal((await restarted.accounts.current(b.session)).circles.length,0);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('HTTP account mutations reject cross-origin requests and issue HttpOnly cookies',async t=>{
  const f=fixture(),app=createApp({provider:{name:'demo'},accounts:f.accounts,rateLimit:false}),server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,body,origin='http://localhost:5173')=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)});
  assert.equal((await request('/api/auth/google/start',{},'https://evil.test')).status,403);
  const start=await request('/api/auth/google/start',{}),setCookie=start.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Lax/);
  const {url}=await start.json(),state=new URL(url).searchParams.get('state');
  const callback=await fetch(`${base}/api/auth/google/callback?state=${state}&code=Alex`,{redirect:'manual',headers:{cookie:setCookie.split(';')[0]}});
  assert.equal(callback.status,303);assert.equal(callback.headers.get('referrer-policy'),'no-referrer');assert.match(callback.headers.get('set-cookie'),/outing-session=/);assert.doesNotMatch(callback.headers.get('location'),/code=|session=|token=/);
});

test('a saved planning area is account-private, survives reload and can be forgotten independently of tastes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'unstressed-area-')),file=join(dir,'accounts.json');
  try{
    const f=fixture({store:createAccountStore({file})}),a=await f.login('Alex'),b=await f.login('Sam');
    const selected={id:'4F18635D-75D6-43EC-B8B9-8DFAEB8C5A29',name:'London',label:'London, United Kingdom',currency:'GBP',countryCode:'GB',source:'qloo'};
    let calls=0;const resolve=async id=>{calls++;assert.equal(id,selected.id);return selected;};
    await assert.rejects(f.accounts.updatePlanningLocation(null,{locationId:selected.id},resolve),e=>e.status===401);assert.equal(calls,0);
    const user=await f.accounts.updatePlanningLocation(a.session,{locationId:selected.id},resolve);assert.deepEqual(user.planningLocation,selected);
    assert.equal((await f.accounts.current(b.session)).user.planningLocation,null);
    const reloaded=fixture({store:createAccountStore({file})});assert.deepEqual((await reloaded.accounts.current(a.session)).user.planningLocation,selected);
    await f.accounts.updateProfile(a.session,{name:'Alex',artists:['SZA'],vibes:[]});assert.deepEqual((await f.accounts.current(a.session)).user.planningLocation,selected);
    await f.accounts.updatePlanningLocation(a.session,{locationId:null},resolve);assert.equal((await f.accounts.current(a.session)).user.planningLocation,null);assert.equal((await f.accounts.current(a.session)).user.profile.artists[0],'SZA');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('planning people are private accepted connections; names, emails and unclaimed placeholders never discover accounts',async()=>{
  const f=fixture(),a=await f.login('Alex'),b=await f.login('Sam'),stranger=await f.login('Someone else');
  const alice=(await f.accounts.current(a.session)).user,sam=(await f.accounts.current(b.session)).user;
  await f.accounts.updateProfile(b.session,{name:'Sam',artists:['Sade'],vibes:['v-seafood']});
  const circle=await f.accounts.createCircle(a.session,{name:'Friends',people:[alice.profile,{id:'guest-sam',name:'Sam',artists:[],vibes:[]}]});
  const request={headers:{cookie:`outing-session=${a.session}`}};
  const before=await f.accounts.planningPeople(request);
  assert.equal(before.peopleMode,'connected');assert.deepEqual(before.contacts.map(p=>p.id),[alice.id]);assert.equal(before.circles[0].people.length,1);assert.doesNotMatch(JSON.stringify(before),/same@example|Sade|googleSubject|inviteToken/);
  await f.accounts.joinCircle(b.session,circle.id,{inviteToken:circle.inviteToken,replaceId:'guest-sam'});
  const after=await f.accounts.planningPeople(request);assert.deepEqual(after.contacts.map(p=>p.id),[alice.id,sam.id]);assert.deepEqual(after.contacts[1].artists,['Sade']);
  assert.equal((await f.accounts.planningPeople({headers:{cookie:`outing-session=${stranger.session}`}})).contacts.length,1);
  await f.accounts.removeCircle(b.session,circle.id);assert.equal((await f.accounts.planningPeople(request)).contacts.length,1);
  assert.deepEqual(await f.accounts.planningPeople({headers:{}}),{peopleMode:'guest'});
});
