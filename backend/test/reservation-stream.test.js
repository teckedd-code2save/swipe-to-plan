import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {startReservationScreencast,reservationTransport} from '../src/reservation-stream.js';
import {createReservationForms} from '../src/reservation-form.js';

test('screencast emits actual bounded JPEG frames, acknowledges dropped frames and stops cleanly',async()=>{
 const cdp=new EventEmitter(),calls=[];cdp.send=async(name,args)=>{calls.push([name,args]);};cdp.detach=async()=>calls.push(['detach']);
 let time=0;const events=[];const stop=await startReservationScreencast({createCDPSession:async()=>cdp},event=>events.push(event),{now:()=>time});
 cdp.emit('Page.screencastFrame',{data:'YWJj',sessionId:1});
 cdp.emit('Page.screencastFrame',{data:'ZGVm',sessionId:2});
 time=600;cdp.emit('Page.screencastFrame',{data:'bad<script>',sessionId:3});
 cdp.emit('Page.screencastFrame',{data:'A'.repeat(500001),sessionId:4});
 cdp.emit('Page.screencastFrame',{data:'ZGVm',sessionId:5});
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(events,[{type:'frame',imageDataUrl:'data:image/jpeg;base64,YWJj'},{type:'frame',imageDataUrl:'data:image/jpeg;base64,ZGVm'}]);
 assert.equal(calls.filter(([name])=>name==='Page.screencastFrameAck').length,5);
 await stop();await stop();assert.equal(cdp.listenerCount('Page.screencastFrame'),0);assert.equal(calls.filter(([name])=>name==='Page.stopScreencast').length,1);
});
function response(){const res=new EventEmitter();Object.assign(res,{lines:[],writableLength:0,status(code){this.statusCode=code;return this;},set(headers){this.headers=headers;return this;},flushHeaders(){},write(line){this.lines.push(JSON.parse(line));},end(){this.ended=true;},json(value){this.value=value;},destroy(){this.destroyed=true;this.emit('close');}});return res;}
test('NDJSON transport streams one result, no-store, abort signal, and late preview cleanup',async()=>{
 const res=response(),t=reservationTransport({get:()=> 'application/x-ndjson'},res);
 t.options.emit({type:'progress',stage:'loading',message:'Loading'});await t.result({status:'forms_found'});
 assert.deepEqual(res.lines.map(e=>e.type),['progress','result']);assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.ended,true);res.emit('close');assert.equal(t.options.signal.aborted,false);
 const closed=response(),u=reservationTransport({get:()=> 'application/x-ndjson'},closed);closed.destroy();assert.equal(u.options.signal.aborted,true);let released;await u.result({previewId:'lease'},async id=>{released=id;});assert.equal(released,'lease');assert.deepEqual(closed.lines,[]);
});
test('legacy JSON preserved and bounded backpressure aborts without leaking output',async()=>{
 const res=response(),t=reservationTransport({get:()=> 'application/json'},res);assert.equal(t.options.emit,undefined);await t.result({a:1});assert.deepEqual(res.value,{a:1});
 const full=response(),u=reservationTransport({get:()=> 'application/x-ndjson'},full);full.writableLength=2000001;u.options.emit({type:'progress'});assert.equal(u.options.signal.aborted,true);assert.equal(full.destroyed,true);assert.deepEqual(full.lines,[]);
});
test('streamed discovery uses Chromium read-only frames config, legacy discovery keeps Kitesurf',async()=>{
 const id='12345678-1234-1234-1234-123456789ABC',url='https://venue.example/book',configs=[],events=[];
 const config={browserWSEndpoint:'wss://api.cloudflare.com/client/v4/accounts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/browser-run/devtools/browser?browser=kitesurf'};
 const run=async(selected,job)=>{configs.push(selected);return job({goto:async()=>{},url:()=>url,evaluate:async()=>[]});};
 const api=createReservationForms({config,previewConfig:null,run,places:{details:async()=>({entityId:id,contact:{website:{url,source:{entityId:id,field:'properties.website'}}}})}});
 await api.discover(id,{emit:event=>events.push(event)});await api.discover(id);
 assert.equal(new URL(configs[0].browserWSEndpoint).searchParams.has('browser'),false);assert.equal(new URL(configs[1].browserWSEndpoint).searchParams.get('browser'),'kitesurf');
 assert.deepEqual(events.map(e=>e.stage),['connecting','loading','inspecting']);assert.equal(JSON.stringify(events).includes('liveViewUrl'),false);
});

test('browser abort closes page and disconnects, stopping real screencast before cleanup',async()=>{
 const {browserSession}=await import('../src/reservation-form.js');const abort=new AbortController(),calls=[];
 const cdp=new EventEmitter();cdp.send=async name=>calls.push(name);cdp.detach=async()=>calls.push('detach');
 const page=new EventEmitter();Object.assign(page,{setViewport:async()=>{},setRequestInterception:async()=>{},evaluateOnNewDocument:async()=>{},createCDPSession:async()=>cdp,close:async()=>calls.push('close')});
 const browser={newPage:async()=>page,disconnect:async()=>calls.push('disconnect')};
 await assert.rejects(browserSession({connect:async()=>browser,signal:abort.signal,emit:()=>{}},async()=>{abort.abort();throw Error('cancelled');}),/cancelled/);
 assert.ok(calls.includes('Page.stopScreencast'));assert.ok(calls.includes('close'));assert.ok(calls.includes('disconnect'));assert.equal(cdp.listenerCount('Page.screencastFrame'),0);
});
test('unsupported screencast fails explicitly, cleans browser and never starts job',async()=>{
 const {browserSession,reservationDiscoveryFailure}=await import('../src/reservation-form.js');const calls=[];
 const cdp=new EventEmitter();cdp.send=async()=>{throw Error('unknown protocol method internal secret');};cdp.detach=async()=>calls.push('detach');
 const page=new EventEmitter();Object.assign(page,{setViewport:async()=>{},setRequestInterception:async()=>{},evaluateOnNewDocument:async()=>{},createCDPSession:async()=>cdp,close:async()=>calls.push('close')});
 await assert.rejects(browserSession({connect:async()=>({newPage:async()=>page,disconnect:async()=>calls.push('disconnect')}),emit:()=>{}},async()=>{assert.fail('job must not start');}),error=>reservationDiscoveryFailure(error).code==='visual_unavailable');
 assert.deepEqual(calls,['detach','close','disconnect']);
});

test('undeliverable final result closes retained preview and JSON personal result is no-store',async()=>{
 const res=response(),t=reservationTransport({get:()=> 'application/x-ndjson'},res);let closed;
 await t.result({previewId:'retained',screenshotDataUrl:'a'.repeat(2000001)},async id=>{closed=id;});
 assert.equal(closed,'retained');assert.equal(t.options.signal.aborted,true);assert.deepEqual(res.lines,[]);
 const json=response(),u=reservationTransport({get:()=> 'application/json'},json);await u.result({screenshotDataUrl:'private'});assert.equal(json.headers['Cache-Control'],'no-store');
});

test('operation-owned browser is closed once after discovery, including abort cleanup',async()=>{
 const {browserSession}=await import('../src/reservation-form.js');
 for(const cancel of [false,true]){
  const calls=[],abort=new AbortController(),page=new EventEmitter();
  Object.assign(page,{setViewport:async()=>{},setRequestInterception:async()=>{},evaluateOnNewDocument:async()=>{},close:async()=>calls.push('page')});
  const browser={newPage:async()=>page,close:async()=>calls.push('browser'),disconnect:async()=>calls.push('disconnect')};
  const operation=browserSession({connect:async()=>browser,signal:abort.signal},async()=>{if(cancel){abort.abort();throw Error('cancelled');}return {};});
  if(cancel)await assert.rejects(operation,/cancelled/);else await operation;
  assert.deepEqual(calls,['page','browser']);
 }
});
test('retained live view owns browser until its idempotent release; close failure disconnects',async()=>{
 const {browserSession}=await import('../src/reservation-form.js');const calls=[],page=new EventEmitter();
 Object.assign(page,{setViewport:async()=>{},setRequestInterception:async()=>{},evaluateOnNewDocument:async()=>{},close:async()=>calls.push('page'),createCDPSession:async()=>({send:async()=>({devtoolsFrontendUrl:'https://live.browser.run/view'})})});
 const browser={newPage:async()=>page,close:async()=>{calls.push('browser');throw Error('engine closed');},disconnect:async()=>calls.push('disconnect')};
 const result=await browserSession({connect:async()=>browser,liveView:true},async()=>({networkDisconnected:true}));
 assert.deepEqual(calls,[]);await Promise.all([result.release(),result.release()]);
 assert.deepEqual(calls,['page','browser','disconnect']);
});

test('provider 429 waits once before reconnecting without repeating a job or leaking errors',async()=>{
 const {connectReservationBrowser}=await import('../src/reservation-form.js');let calls=0;const events=[],waits=[];
 const browser={};
 const result=await connectReservationBrowser(async()=>{calls++;if(calls===1)throw Error('Unexpected server response: 429 secret');return browser;},{},{emit:e=>events.push(e),wait:async ms=>waits.push(ms)});
 assert.equal(result,browser);assert.equal(calls,2);assert.deepEqual(waits,[21000]);assert.equal(events[0].stage,'waiting');assert.equal(JSON.stringify(events).includes('secret'),false);
});
test('provider quota, repeated limits and non-rate errors do not create retry loops',async()=>{
 const {connectReservationBrowser}=await import('../src/reservation-form.js');
 for(const [message,code,count]of [['Unexpected server response: 429','browser_rate_limited',2],['code: 429 Browser time limit exceeded for today','browser_quota_exceeded',1],['Unexpected server response: 403',undefined,1]]){
  let calls=0;await assert.rejects(connectReservationBrowser(async()=>{calls++;throw Error(message);},{},{wait:async()=>{}}),error=>code?error.code===code:error.message===message);assert.equal(calls,count);
 }
});
test('cancelled provider cooldown cannot start another browser',async()=>{
 const {connectReservationBrowser}=await import('../src/reservation-form.js');const abort=new AbortController();let calls=0;
 await assert.rejects(connectReservationBrowser(async()=>{calls++;throw Error('Unexpected server response: 429');},{},{signal:abort.signal,wait:async()=>{abort.abort();}}),{name:'AbortError'});assert.equal(calls,1);
});
