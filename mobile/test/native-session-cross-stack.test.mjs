import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import express from '../../backend/node_modules/express/index.js';
import {createAccounts,createAccountStore} from '../../backend/src/accounts.js';
import {createApp} from '../../backend/src/app.js';
import {createDemoProvider} from '../../backend/src/demo-provider.js';
import {createAccountSession} from '../src/account-session.js';
import {createApi} from '../src/transport.js';
const hash=value=>createHash('sha256').update(value).digest('base64url');
async function fixture(t){
 const now=Date.now,store=createAccountStore({now}); // In memory; no real accounts or credentials.
 const sessions={alice:randomBytes(32).toString('base64url'),bob:randomBytes(32).toString('base64url')};
 await store.transact(data=>{for(const [id,session] of Object.entries(sessions)){data.users[id]={id,email:`${id}@example.test`,profile:{id,name:id,artists:[],vibes:[]}};data.sessions[hash(session)]={userId:id,expiresAt:now()+86400000};}});
 const outer=express(),server=outer.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const accounts=createAccounts({store,now,origin,clientId:'synthetic-client',clientSecret:'synthetic-secret',nativeAuthEnabled:true});
 outer.use(createApp({accounts,provider:createDemoProvider(),rateLimit:true,now}));
 const browser=(path,{user,body}={})=>fetch(origin+path,{method:body?'POST':'GET',redirect:'error',headers:{...(user?{cookie:`outing-session=${sessions[user]}`} : {}),...(body?{origin,'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 function client(user,approvalHook){
  const calls=[];let session,flow,verifier,challenge;
  session=createAccountSession({origin,development:true,randomBytes,sha256:async value=>createHash('sha256').update(value).digest('base64'),
   fetch:async(url,options)=>{assert.equal(new URL(url).origin,origin,'No external request');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.headers.cookie,undefined);assert.equal(options.headers.origin,undefined);calls.push(new URL(url).pathname);if(url.endsWith('/start'))challenge=JSON.parse(options.body).codeChallenge;if(url.endsWith('/exchange')){verifier=JSON.parse(options.body).codeVerifier;assert.equal(hash(verifier),challenge);}return fetch(url,options);},
   openBrowser:async url=>{assert.equal(new URL(url).origin,origin);flow=new URL(url).searchParams.get('flow');if(approvalHook)return approvalHook({url,flow});
    const page=await browser(new URL(url).pathname+new URL(url).search,{user});assert.equal(page.status,200);const html=await page.text();assert.ok(html.includes(session.getSnapshot().userCode));const csrf=html.match(/csrf="([\w-]+)"/)[1];
    assert.equal((await browser('/api/auth/native/approve',{user:user==='alice'?'bob':'alice',body:{flowId:flow,csrf}})).status,403);
    assert.equal((await browser('/api/auth/native/approve',{user,body:{flowId:flow,csrf}})).status,200);
   }});return {session,calls,getProof:()=>({flow,verifier,challenge})};
 }
 return {origin,browser,store,client};
}
test('actual mobile PKCE with in-memory Express accounts: approval, authoritative save/read isolation and logout',async t=>{
 const f=await fixture(t),a=f.client('alice'),b=f.client('bob');assert.equal((await a.session.config()).enabled,true);
 await a.session.signIn();await b.session.signIn();assert.equal(a.session.getSnapshot().userId,'alice');assert.equal((await a.session.account()).user.email,'alice@example.test');
 assert.match(a.getProof().verifier,/^[a-f0-9]{64}$/);assert.equal(hash(a.getProof().verifier),a.getProof().challenge);
 const replay=await fetch(f.origin+'/api/auth/native/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({flowId:a.getProof().flow,codeVerifier:a.getProof().verifier})});assert.equal(replay.status,401);
 const api=createApi({origin:f.origin,fetch,getAuthorization:a.session.getAuthorization,onUnauthorized:a.session.invalidateAuthorization});
 const body={date:'2099-01-01',area:'Osu',activities:['coffee']},plan=await api.itinerary(body);assert.ok(plan.savedPlan?.id);assert.equal(plan.savedPlan.revision,1);
 assert.deepEqual((await a.session.account(`/plans/${plan.savedPlan.id}`)).stops,plan.stops);await assert.rejects(b.session.account(`/plans/${plan.savedPlan.id}`),error=>error.status===404);
 await assert.rejects(a.session.account('/plans',{method:'POST',body:{plan}}),error=>error.status===404);
 const bearer=a.session.getAuthorization();assert.equal((await fetch(f.origin+'/api/account',{headers:{authorization:bearer}}).then(r=>r.json())).user,null);
 assert.equal((await f.browser('/api/native/account',{user:'alice'})).status,403);assert.equal(JSON.stringify(await f.store.read(data=>data)).includes(bearer.slice(7)),false);
 await a.session.logout();assert.equal(a.session.getSnapshot().signedIn,false);assert.equal(a.session.getAuthorization(),null);
 assert.equal((await fetch(f.origin+'/api/native/account',{headers:{authorization:bearer}})).status,401);assert.equal((await f.browser('/api/account',{user:'alice'}).then(r=>r.json())).user.id,'alice');
 assert.equal((await createApi({origin:f.origin,fetch}).itinerary(body)).savedPlan,undefined);
});
test('actual mobile cancellation removes pending Express flow and cannot create a session',async t=>{
 const f=await fixture(t);let browserOpened,releaseBrowser,flow;const opened=new Promise(resolve=>{browserOpened=resolve;});
 const a=f.client('alice',async details=>{flow=details.flow;browserOpened();await new Promise(resolve=>{releaseBrowser=resolve;});});
 const signIn=a.session.signIn(),rejected=assert.rejects(signIn,/cancelled/);await opened;assert.equal(await f.store.read(data=>Object.keys(data.nativeFlows).length),1);
 await a.session.cancelSignIn();releaseBrowser();await rejected;assert.equal(a.session.getSnapshot().signedIn,false);assert.equal(a.session.getSnapshot().signingIn,false);
 assert.equal(await f.store.read(data=>Object.keys(data.nativeFlows).length),0);assert.equal(await f.store.read(data=>Object.keys(data.nativeSessions).length),0);
 assert.equal((await f.browser(`/api/auth/native/browser?flow=${flow}`,{user:'alice'})).status,401);assert.ok(a.calls.includes('/api/auth/native/cancel'));assert.ok(!a.calls.includes('/api/auth/native/exchange'));
});
test('AccountScreen renders nonempty retry status in an accessible live region while signing in',async()=>{
 // Source wiring regression only; does not replace native screen-reader acceptance.
 const source=await readFile(new URL('../src/components/AccountScreen.tsx',import.meta.url),'utf8');
 assert.match(source,/auth\.signingIn && !!auth\.signInStatus && <Text accessibilityLiveRegion="polite"[^>]*>\{auth\.signInStatus\}<\/Text>/);
});
