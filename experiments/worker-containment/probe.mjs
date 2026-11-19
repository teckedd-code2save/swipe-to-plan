// Isolated experiment. No production imports or provider navigation.
import {armTarget,allowFixtureRequest,acknowledgeOffline,dispatchRequest,targetFilter} from './guard-core.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hits=[],events=[],pending=new Map(),sessions=new Map();let id=0,frozen=false,chrome,ws,profile,chromeErrors='';
const server=createServer((req,res)=>{
 hits.push({url:req.url,method:req.method,frozen});
 res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':'text/html');
 if(req.url==='/'){res.end(`<form action="/submit" method="post"><input name="value" value="fixture"><button>submit</button></form><script>window.fixtureWorker=new Worker('/worker.js');</script>`);return;}
 if(req.url==='/worker.js'){res.end(`fetch('/immediate').catch(()=>{});fetch('/unsafe-worker-post',{method:'POST',body:'fixture'}).catch(()=>{});new Worker('/nested.js');setInterval(()=>fetch('/tick').catch(()=>{}),40);onmessage=e=>{if(e.data==='freeze')fetch('/after-message').catch(()=>{})};`);return;}
 if(req.url==='/nested.js'){res.end(`fetch('/nested-immediate').catch(()=>{});setInterval(()=>fetch('/nested-tick').catch(()=>{}),40);`);return;}
 if(req.url==='/late.js'){res.end(`fetch('/late-escape').catch(()=>{});`);return;}
 res.end('ok');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
function send(method,params={},sessionId){const key=++id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(key);reject(Error(`${method} timed out`));},2000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params,...(sessionId?{sessionId}:{})}));});}
async function attach(event){
 const {sessionId,targetInfo,waitingForDebugger}=event;
 const state={id:sessionId,targetId:targetInfo.targetId,type:targetInfo.type,paused:waitingForDebugger,ready:false,epoch:0};sessions.set(sessionId,state);events.push({event:'attached',...state});
 try{
  await armTarget(send,state,()=>frozen);events.push({event:'guard-ready',sessionId,type:state.type});
 }catch(e){state.error=e.message;events.push({event:'setup-failed',sessionId,type:state.type,error:e.message});/* Keep paused; never resume unguarded. */}
}
async function request(event,sessionId){
 const state=sessions.get(sessionId),epoch=state?.epoch||0;const u=new URL(event.request.url);
 // Explicit TEST-ONLY exception. Only this process's loopback server is allowed.
 const allow=await allowFixtureRequest(event.request,state,()=>frozen,origin,async()=>{if(u.pathname==='/delayed-check')await sleep(600);return true;});
 events.push({event:'request',sessionId,type:state?.type,url:u.pathname,method:event.request.method,allow,frozen});
 try{await dispatchRequest(send,event.requestId,sessionId,allow,state,epoch,()=>frozen);}catch(e){events.push({event:'request-error',error:e.message});}
}
let result;
try{
 profile=await mkdtemp(join(tmpdir(),'worker-containment-'));
 chrome=spawn('/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--no-first-run',`--user-data-dir=${profile}`,'--remote-debugging-port=0','--no-startup-window'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((resolve,reject)=>{let stderr='';const t=setTimeout(()=>reject(Error('browser startup timeout')),10000);chrome.stderr.on('data',b=>{stderr+=b;chromeErrors+=b;const match=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(t);resolve(match[1]);}});chrome.once('exit',code=>{clearTimeout(t);reject(Error(`chromium exited ${code}`));});});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',({data:raw})=>{const msg=JSON.parse(raw);if(msg.id){const item=pending.get(msg.id);if(item){pending.delete(msg.id);clearTimeout(item.timer);msg.error?item.reject(Error(`${msg.error.code}: ${msg.error.message}`)):item.resolve(msg.result);}return;}if(msg.method==='Target.attachedToTarget')void attach(msg.params);if(msg.method==='Target.detachedFromTarget'){const state=sessions.get(msg.params.sessionId);if(state){state.ready=false;state.epoch++;}}if(msg.method==='Fetch.requestPaused')void request(msg.params,msg.sessionId);});
 await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:targetFilter});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});
 let page;for(let n=0;n<50;n++){page=[...sessions.values()].find(s=>s.targetId===targetId&&s.ready&&!s.paused);if(page)break;await sleep(50);}if(!page)throw Error('guarded page unavailable');
 await send('Page.navigate',{url:origin+'/'},page.id);await sleep(3000);
 assert.equal(events.some(e=>e.event==='setup-failed'),false,'all targets must initialize guards');
 const before=hits.map(h=>h.url);
 assert.ok(before.includes('/immediate'),'positive dedicated worker fetch must execute');
 assert.ok(before.includes('/nested-immediate'),'positive nested worker fetch must execute');
 assert.equal(before.includes('/unsafe-worker-post'),false,'worker POST must not reach server');
 assert.ok(events.some(e=>e.event==='request'&&e.url==='/unsafe-worker-post'&&!e.allow),'worker POST interception must be observed');
 await send('Runtime.evaluate',{expression:`fetch('/delayed-check').catch(()=>{});`},page.id);await sleep(30);
 frozen=true;events.push({event:'freeze-start'});
 // The raw session owns all target resume decisions. Keep Fetch denial active.
 await acknowledgeOffline(send,[...sessions.values()]);
 await send('Runtime.evaluate',{expression:`window.fixtureWorker?.postMessage('freeze');new Worker('/late.js');document.querySelector('form').submit();`},page.id).catch(e=>events.push({event:'postfreeze-eval-error',error:e.message}));
 await sleep(1000);
 assert.equal(hits.some(h=>h.frozen),false,'network hit after freeze');
 assert.equal(hits.some(h=>h.url==='/delayed-check'),false,'pending policy continuation must recheck freeze');
 assert.equal(events.some(e=>e.event==='freeze-command-error'),false,'freeze must be acknowledged');
 assert.equal(events.some(e=>e.event==='request-error'||e.event==='postfreeze-eval-error'),false,'all probe actions and request decisions must finish');
 result={passed:true,origin,before,hits,events,targets:[...sessions.values()],frozenHits:hits.filter(h=>h.frozen)};
}catch(e){result={error:e.message,chromeErrors,hits,events,targets:[...sessions.values()]};}
finally{
 if(ws?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch(e){events.push({event:'close-error',error:e.message});}}
 if(chrome&&chrome.exitCode===null&&chrome.signalCode===null){await Promise.race([new Promise(r=>chrome.once('exit',r)),sleep(2000)]);if(chrome.exitCode===null&&chrome.signalCode===null){chrome.kill('SIGKILL');await new Promise(r=>chrome.once('exit',r));}}
 ws?.close();for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('experiment ended'));}pending.clear();
 server.closeAllConnections();await new Promise(r=>server.close(r));if(profile)await rm(profile,{recursive:true,force:true,maxRetries:3});
 result.cleanup={browserExited:!chrome||chrome.exitCode!==null||chrome.signalCode!==null,fixtureClosed:!server.listening};
}
await writeFile(process.env.REPORT_PATH||new URL('./report.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify({error:result.error,chromeErrors:result.chromeErrors,before:result.before,targets:result.targets,failed:events.filter(e=>e.event.endsWith('failed')||e.event.includes('error')),frozenHits:result.frozenHits},null,2));

console.log('REPORT_JSON:'+JSON.stringify(result));
if(!result.passed)process.exitCode=1;
