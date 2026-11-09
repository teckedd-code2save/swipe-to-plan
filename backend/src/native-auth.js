import {createHash,randomBytes} from 'node:crypto';
const hash=v=>createHash('sha256').update(String(v||'')).digest('base64url');
const userCode=id=>createHash('sha256').update(id).digest('hex').slice(0,8).toUpperCase();
const opaque=()=>randomBytes(32).toString('base64url');
const error=(message,status=401)=>Object.assign(new Error(message),{status,code:'native_auth_error'});
const valid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const fields=(body,keys)=>{if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k)))throw error('Invalid native sign-in request.',400);};
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createNativeAuth({store,now,origin,enabled}){
  const lifetime=8*3600000;
  // Transient quotas, never account-file writes. Only existing proof-verified
  // flows allocate entries; consumption/cancel and expiry remove them.
  const polling=new Map();
  function chargePoll(id,expiresAt){
    for(const [key,value] of polling)if(value.expiresAt<=now())polling.delete(key);
    const key=hash(id),record=polling.get(key);
    if(!record&&polling.size>=1000)throw Object.assign(error('Please try sign-in later.',429),{retryAfter:60});
    const polls=(record?.polls||[]).filter(at=>at>now()-60000);
    if(polls.length>=40)throw Object.assign(error('Please wait before checking this sign-in again.',429),{retryAfter:Math.max(1,Math.ceil((polls[0]+60000-now())/1000))});
    polling.set(key,{expiresAt,polls:[...polls,now()]});
  }
  const assertEnabled=()=>{if(!enabled)throw error('Native account sign-in is not enabled.',503);};
  const getFlow=(data,id)=>{const flow=data.nativeFlows?.[hash(id)];if(!valid(id)||!flow||flow.expiresAt<=now())throw error('Sign-in expired or already used.');return flow;};
  const credential=req=>{assertEnabled();if(req.get('origin')||req.headers.cookie)throw error('Native requests must not use browser credentials.',403);const auth=req.get('authorization');if(!/^Bearer ust_native_[A-Za-z0-9_-]{43}$/.test(auth||''))throw error('Sign in on this device.');return {nativeToken:auth.slice(7)};};
  return {
    enabled,credential,
    resolve(data,session){if(!enabled||!session||typeof session!=='object'||!/^ust_native_[A-Za-z0-9_-]{43}$/.test(session.nativeToken||''))return null;const record=data.nativeSessions?.[hash(session.nativeToken)];return record?.kind==='native'&&record.expiresAt>now()?data.users[record.userId]:null;},
    async start(body){assertEnabled();fields(body,['codeChallenge','codeChallengeMethod']);if(!valid(body.codeChallenge)||body.codeChallengeMethod!=='S256')throw error('Use an S256 challenge.',400);const flowId=opaque(),expiresAt=now()+600000;await store.transact(data=>{data.nativeFlows??={};if(Object.keys(data.nativeFlows).length>=1000)throw error('Please try sign-in later.',429);data.nativeFlows[hash(flowId)]={challenge:body.codeChallenge,expiresAt};});return {flowId,userCode:userCode(flowId),browserUrl:`${origin}/api/auth/native/browser?flow=${flowId}`,expiresAt,pollInterval:2};},
    async exchange(body,cancel=false){
      assertEnabled();fields(body,['flowId','codeVerifier']);
      if(typeof body.codeVerifier!=='string'||!/^[-._~A-Za-z0-9]{43,128}$/.test(body.codeVerifier))throw error('Invalid sign-in verifier.',400);
      const verified=data=>{const flow=getFlow(data,body.flowId);if(hash(body.codeVerifier)!==flow.challenge)throw error('Invalid sign-in verifier.');return flow;};
      if(!cancel){
        const flow=await store.read(verified);
        chargePoll(body.flowId,flow.expiresAt);
        // No durable write/fsync for the normal polling path. Approval racing
        // this read is observed by the next poll; it cannot issue a token here.
        if(!flow.userId)return {status:'pending'};
      }
      const result=await store.transact(data=>{
        // Revalidate proof, lifetime and approval under the serialized writer.
        // Concurrent approved exchanges still have exactly one winner.
        const flow=verified(data);
        if(cancel){delete data.nativeFlows[hash(body.flowId)];return {status:'cancelled'};}
        if(!flow.userId)throw error('Sign-in approval is no longer available.');
        if(!data.users[flow.userId])throw error('Account unavailable.');
        const accessToken=`ust_native_${opaque()}`,expiresAt=now()+lifetime;
        data.nativeSessions??={};data.nativeSessions[hash(accessToken)]={kind:'native',userId:flow.userId,expiresAt};
        delete data.nativeFlows[hash(body.flowId)];return {accessToken,tokenType:'Bearer',expiresAt};
      });
      polling.delete(hash(body.flowId));return result;
    },
    async logout(session){await store.transact(data=>{delete data.nativeSessions?.[hash(session.nativeToken)];});},
    mount(app,{route,limit,accounts,browserSession,checkOrigin}){
      const nativeLimit=(max,bucket)=>(req,res,next)=>{res.set('Retry-After','60');limit(max,bucket)(req,res,()=>{res.removeHeader('Retry-After');next();});};
      const noBrowser=req=>{if(req.get('origin')||req.headers.cookie||!req.is('application/json'))throw error('Use the native app for this request.',403);};
      app.get('/api/auth/native/config',(_req,res)=>res.json({enabled,sessionLifetimeSeconds:lifetime/1000,pollInterval:2}));
      app.post('/api/auth/native/start',limit(10,'native-start'),route(async(req,res)=>{noBrowser(req);res.json(await this.start(req.body));}));
      // Ten starts/minute and a ten-minute lifetime permit at most 100 active
      // flows per IP. 4,000 polls/minute covers each flow's 40/minute quota.
      // Cancellation has its own budget and never consumes polling capacity.
      for(const action of ['exchange','cancel'])app.post(`/api/auth/native/${action}`,nativeLimit(action==='cancel'?120:4000,`native-${action}`),route(async(req,res)=>{noBrowser(req);try{const result=await this.exchange(req.body,action==='cancel');res.status(result.status==='pending'?202:200).json(result);}catch(e){if(e.status===429){res.set('Retry-After',String(e.retryAfter||60));return res.status(429).json({code:'rate_limited',error:e.message});}throw e;}}));
      app.post('/api/native/auth/logout',limit(20,'native-logout'),route(async(req,res)=>{if(!req.is('application/json'))throw error('Use JSON.',403);fields(req.body,[]);const session=credential(req);await this.logout(session);res.json({ok:true});}));
      app.get('/api/auth/native/browser',limit(30,'native-page'),route(async(req,res)=>{
        assertEnabled();const flowId=req.query.flow;await store.read(data=>getFlow(data,flowId));const session=browserSession(req),current=await accounts.current(session),csrf=opaque(),nonce=opaque();
        if(current.user)await store.transact(data=>{const flow=getFlow(data,flowId);if(flow.userId)throw error('This sign-in has already been approved.');flow.csrf=hash(csrf);flow.browser=hash(session);});
        res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`});
        const signed=!!current.user;
        res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unstressed device sign-in</title><style>html{color-scheme:light}body{margin:0;background:#f5f2e9;color:#203d32;font-family:Manrope,system-ui,sans-serif;line-height:1.65}main{box-sizing:border-box;max-width:560px;margin:8vh auto;padding:32px 24px}svg{width:44px;height:52px}h1{font-size:clamp(28px,7vw,38px);line-height:1.15;letter-spacing:-1px}p{color:#485d52}strong{display:inline-block;background:#e5e9df;border-radius:8px;padding:4px 10px;letter-spacing:3px;color:#203d32}button{font:inherit;font-weight:650;border:1px solid #203d32;border-radius:28px;padding:12px 22px;cursor:pointer;background:#203d32;color:#f5f2e9;margin:8px 8px 8px 0}#cancel{background:transparent;color:#203d32}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:3px solid #b78048;outline-offset:4px}#status{min-height:3em}</style></head><body><main><svg viewBox="0 0 44 52" aria-label="Unstressed" role="img"><path d="M7 5v25c0 21 30 21 30 0V5" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/></svg><h1>Sign in on your device</h1><p>Check that your app shows code <strong>${escape(userCode(flowId))}</strong>.</p><p>Only approve if you just started sign-in in the Unstressed app on your own device. This grants access to your saved days, tastes, circles and invitations for eight hours.</p>${signed?`<p>Continue as ${escape(current.user.email)}?</p>`:'<p>First sign in with Google, then approve this device.</p>'}<button id="approve">${signed?'Approve this device':'Sign in with Google'}</button><button id="cancel">Cancel</button><p id="status" role="status"></p></main><script nonce="${nonce}">const flowId=${JSON.stringify(flowId)},csrf=${JSON.stringify(csrf)};async function send(url,body){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(data.error||'Please restart sign-in.');return data;}document.getElementById('approve').onclick=async()=>{try{${signed?`await send('/api/auth/native/approve',{flowId,csrf});document.getElementById('status').textContent='Approved. Return to the Unstressed app.';document.getElementById('approve').disabled=true;`:`const data=await send('/api/auth/google/start',{returnTo:'/api/auth/native/browser?flow='+flowId});location.assign(data.url);`}}catch(e){document.getElementById('status').textContent=e.message;}};document.getElementById('cancel').onclick=()=>{document.getElementById('status').textContent='Close this page and cancel sign-in in the app. No new approval was given.';document.getElementById('approve').disabled=true;};</script></body></html>`);
      }));
      app.post('/api/auth/native/approve',limit(20,'native-approve'),route(async(req,res)=>{
        assertEnabled();checkOrigin(req);fields(req.body,['flowId','csrf']);const session=browserSession(req),current=await accounts.current(session);if(!current.user)throw error('Sign in with Google first.');await store.transact(data=>{const flow=getFlow(data,req.body.flowId);if(flow.userId||!valid(req.body.csrf)||flow.csrf!==hash(req.body.csrf)||flow.browser!==hash(session))throw error('Reload the sign-in page and approve from your browser.',403);const browserRecord=data.sessions[hash(session)];if(!browserRecord||browserRecord.expiresAt<=now()||browserRecord.userId!==current.user.id)throw error('Browser sign-in expired.');flow.userId=current.user.id;delete flow.csrf;delete flow.browser;});res.json({ok:true});
      }));
    },
  };
}
