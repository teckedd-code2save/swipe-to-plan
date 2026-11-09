import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAccounts,createAccountStore} from '../../backend/src/accounts.js';
import {createApp} from '../../backend/src/app.js';
import {createDemoProvider} from '../../backend/src/demo-provider.js';
import {createAccountSession} from '../src/account-session.js';
import {createApi} from '../src/transport.js';

test('real native client and API agree through browser OAuth approval, saved plans, invitations, expiry and logout',async t=>{
  let clock=Date.now(),origin,authorization,holdPath=null,releaseRead,readArrived;const now=()=>clock;
  const mobileFetch=async (url,options)=>{const response=await fetch(url,options);if(holdPath&&new URL(url).pathname===holdPath){holdPath=null;readArrived();await new Promise(resolve=>{releaseRead=resolve;});}return response;};
  const directory=await mkdtemp(join(tmpdir(),'native-integration-')),file=join(directory,'accounts.json');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const store=createAccountStore({file,now});
  // Bind the actual port before constructing the account origin. No external requests.
  const {default:express}=await import('../../backend/node_modules/express/index.js');
  const outer=express(),server=outer.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));origin=`http://127.0.0.1:${server.address().port}`;
  const accounts=createAccounts({store,now,origin,clientId:'synthetic-client',clientSecret:'synthetic-secret',nativeAuthEnabled:true,
    invitationEpoch:'4de508f0-6a1e-4cba-82f4-e3e8be297179',oauthFactory:()=>({
      generateAuthUrl(args){authorization=args;return `https://accounts.google.com/authorize?state=${args.state}`;},
      async getToken({code,codeVerifier}){assert.ok(codeVerifier);return {tokens:{id_token:code}};},
      async verifyIdToken({idToken}){return {getPayload:()=>({sub:idToken,email:`${idToken}@example.test`,name:idToken,email_verified:true,nonce:authorization.nonce})};},
    })});
  outer.use(createApp({accounts,provider:createDemoProvider(),rateLimit:false,now}));
  async function browser(path,{cookie,body}={}){
    return fetch(origin+path,{method:body?'POST':'GET',redirect:'manual',headers:{...(cookie?{cookie}:{}),...(body?{origin,'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  }
  const webCookies=new Map();
  function client(name){let session;session=createAccountSession({origin,development:true,fetch:mobileFetch,now,randomBytes,
    sha256:async value=>createHash('sha256').update(value).digest('base64'),
    openBrowser:async url=>{
      assert.equal(new URL(url).origin,origin);
      const initial=await browser(new URL(url).pathname+new URL(url).search);assert.equal(initial.status,200);
      const start=await browser('/api/auth/google/start',{body:{returnTo:new URL(url).pathname+new URL(url).search}});
      assert.equal(start.status,200);const binding=start.headers.get('set-cookie').split(';')[0],{url:googleUrl}=await start.json();
      const callback=await browser(`/api/auth/google/callback?state=${new URL(googleUrl).searchParams.get('state')}&code=${name}`,{cookie:binding});
      assert.equal(callback.status,303);const cookie=callback.headers.getSetCookie().find(c=>c.startsWith('outing-session=')).split(';')[0];webCookies.set(name,cookie);
      const page=await browser(new URL(callback.headers.get('location')).pathname+new URL(callback.headers.get('location')).search,{cookie});
      const html=await page.text();assert.ok(html.includes(session.getSnapshot().userCode));
      const csrf=html.match(/csrf="([\w-]+)"/)[1];
      const approval=await browser('/api/auth/native/approve',{cookie,body:{flowId:new URL(url).searchParams.get('flow'),csrf}});assert.equal(approval.status,200);
    }});return session;
  }
  const a=client('Alice'),b=client('Bob');await a.signIn();await b.signIn();
  assert.equal(a.getSnapshot().signedIn,true);assert.equal((await a.account()).user.profile.name,'Alice');
  const api=createApi({origin,fetch,getAuthorization:a.getAuthorization,onUnauthorized:a.invalidateAuthorization});
  const body={date:'2099-01-01',area:'Osu',activities:['coffee']};
  const plan=await api.itinerary(body);assert.ok(plan.savedPlan);assert.deepEqual((await a.account(`/plans/${plan.savedPlan.id}`)).stops,plan.stops);
  await assert.rejects(b.account(`/plans/${plan.savedPlan.id}`),e=>e.status===404);
  const alice=(await a.account()).user,bob=(await b.account()).user;
  const circle=await a.account('/circles',{method:'POST',body:{name:'Friends',people:[alice.profile]}});
  await b.account(`/circles/${circle.id}/join`,{method:'POST',body:{inviteToken:circle.inviteToken}});
  const invite=await a.account(`/plans/${plan.savedPlan.id}/invitations`,{method:'POST',body:{recipientId:bob.id,revision:1}});
  assert.equal((await b.account('/invitations')).invitations[0].id,invite.id);
  await assert.rejects(b.account(`/invitations/${invite.id}/plan`),e=>e.status===404);
  await b.account(`/invitations/${invite.id}`,{method:'PATCH',body:{action:'going'}});
  const projection=await b.account(`/invitations/${invite.id}/plan`);assert.ok(projection.stops.length);assert.equal(projection.request,undefined);assert.equal(projection.people,undefined);
  await a.account(`/circles/${circle.id}/members/${bob.id}`,{method:'DELETE',body:{}});
  await assert.rejects(b.account(`/invitations/${invite.id}/plan`),e=>e.status===404);
  const bearer=a.getAuthorization();assert.equal((await readFile(file,'utf8')).includes(bearer.slice(7)),false);
  holdPath=`/api/native/account/plans/${plan.savedPlan.id}`;
  const readStarted=new Promise(resolve=>{readArrived=resolve;});
  const lateRead=a.account(`/plans/${plan.savedPlan.id}`);
  const lateRejected=assert.rejects(lateRead,/cancelled/);await readStarted;
  await a.logout();releaseRead();await lateRejected;assert.equal(a.getSnapshot().signedIn,false);
  assert.equal((await fetch(origin+'/api/native/account',{headers:{authorization:bearer}})).status,401);
  assert.ok((await (await browser('/api/account',{cookie:webCookies.get('Alice')})).json()).user);
  const expiredBearer=b.getAuthorization();clock+=8*3600000+1;
  assert.equal((await fetch(origin+'/api/itineraries',{method:'POST',headers:{authorization:expiredBearer,'content-type':'application/json'},body:JSON.stringify(body)})).status,401);
  assert.equal(b.getSnapshot().signedIn,false);await assert.rejects(b.account());
  const guest=await createApi({origin,fetch}).itinerary(body);assert.equal(guest.savedPlan,undefined);
});
