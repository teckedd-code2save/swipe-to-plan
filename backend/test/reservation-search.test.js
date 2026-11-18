import test from 'node:test';
import assert from 'node:assert/strict';
import {createReservationForms,browserSession} from '../src/reservation-form.js';
const id='12345678-1234-1234-1234-123456789ABC';
function fixture(){
 let navigationError=null,status=200;let url='',pixels='frame',target='https://venue.example/',blocked=false,offset=0,closed=0,clock=1000,configs=[],visits=[];
 const page={goto:async value=>{if(navigationError)throw navigationError;url=value;visits.push(value);return {status:()=>status};},url:()=>url,title:async()=>url.includes('google')?'Google Search':'Venue',screenshot:async()=>Buffer.from(pixels),evaluate:async(fn,args)=>{const rect=target?{href:target,left:offset,top:0,right:500+offset,bottom:400}:null;if(fn.name==='searchTargets')return rect?[rect]:[];if(fn.name==='searchTargetAt')return rect;if(typeof args==='number'){pixels+='scroll';return;}return blocked;}};
 const api=createReservationForms({places:{details:async()=>({entityId:id,name:'Republic Bar',address:'Osu Accra Ghana',contact:{phone:{display:'+233123456789',source:{entityId:id,field:'properties.phone'}}}})},config:{},previewConfig:null,now:()=>clock,run:async(config,job)=>{configs.push(config);const result=await job(page);return {...result,page,release:async()=>{closed++;}};}});
 return {api,configs,visits,setStatus:v=>status=v,setNavigationError:error=>navigationError=error,closed:()=>closed,setPixels:v=>pixels=v,setTarget:v=>target=v,setOffset:v=>offset=v,setUrl:v=>url=v,setBlocked:v=>blocked=v,setClock:v=>clock=v};
}
test('search uses exact provider identity, returns intact screenshot, keeps private fields out',async()=>{
 const f=fixture(),r=await f.api.startSearch(id,{});assert.equal(r.venueName,'Republic Bar');assert.equal(r.venueAddress,'Osu Accra Ghana');assert.equal(r.canUse,false);assert.equal(r.sequence,1);assert.equal(r.width,1100);assert.match(r.imageDataUrl,/^data:image\/png;base64,/);assert.equal(r.page,undefined);assert.equal(r.release,undefined);assert.equal(r.submitted,false);assert.match(new URL(f.visits[0]).searchParams.get('q'),/Republic Bar Osu Accra Ghana/);assert.equal(f.configs[0].retainReadOnly,true);await f.api.closeSearch(r.searchId);assert.equal(f.closed(),1);
});
test('only current-frame user links navigate; selection mints bound expiring destination',async()=>{
 const f=fixture(),a=await f.api.startSearch(id,{}),b=await f.api.searchAction(id,{searchId:a.searchId,sequence:a.sequence,action:{type:'click',x:100,y:100}});assert.equal(b.canUse,true);assert.equal(b.url,'https://venue.example/');const chosen=await f.api.selectSearch(id,{searchId:b.searchId,sequence:b.sequence});assert.equal(typeof chosen.candidateId,'string');assert.equal(chosen.relationship,'user_selected_search');assert.equal(f.closed(),1);await assert.rejects(f.api.selectSearch(id,{searchId:b.searchId,sequence:b.sequence}),/expired/);await assert.rejects(f.api.inspectDestination('OTHER',{candidateId:chosen.candidateId}),/expired/);
});
test('changing pixels does not block stable links or reviewed selection; stale sequence still fails',async()=>{
 const f=fixture(),a=await f.api.startSearch(id,{});f.setPixels('animated');const b=await f.api.searchAction(id,{searchId:a.searchId,sequence:a.sequence,action:{type:'click',x:5,y:5}});assert.equal(f.visits.length,2);await assert.rejects(f.api.selectSearch(id,{searchId:a.searchId,sequence:a.sequence}),/search_changed/);f.setPixels('more animation');assert.ok((await f.api.selectSearch(id,{searchId:b.searchId,sequence:b.sequence})).candidateId);
});
test('moved or replaced links refresh without following old screenshot coordinates',async()=>{
 for(const change of [f=>f.setOffset(20),f=>f.setTarget('https://other.example/')]){const f=fixture(),a=await f.api.startSearch(id,{});change(f);const b=await f.api.searchAction(id,{searchId:a.searchId,sequence:a.sequence,action:{type:'click',x:100,y:100}});assert.match(b.notice,/link moved or changed/i);assert.equal(f.visits.length,1);assert.equal(b.targets,undefined);await f.api.closeSearch(a.searchId);}
});
test('pixel changes allow scroll and refresh; user can go back from a new challenge',async()=>{
 const f=fixture(),a=await f.api.startSearch(id,{});f.setPixels('animation');const b=await f.api.searchAction(id,{searchId:a.searchId,sequence:a.sequence,action:{type:'scroll',deltaY:300}});assert.equal(b.sequence,2);const c=await f.api.searchAction(id,{searchId:b.searchId,sequence:b.sequence,action:{type:'click',x:100,y:100}});f.setBlocked(true);await assert.rejects(f.api.selectSearch(id,{searchId:c.searchId,sequence:c.sequence}),/search_select/);const d=await f.api.searchAction(id,{searchId:c.searchId,sequence:c.sequence,action:{type:'back'}});assert.equal(d.canBack,false);assert.match(f.visits.at(-1),/^https:\/\/www.google.com\/search/);await f.api.closeSearch(a.searchId);
});
test('challenge and non-link clicks never activate page controls',async()=>{
 const f=fixture();f.setBlocked(true);const a=await f.api.startSearch(id,{});assert.equal(a.status,'challenge');const b=await f.api.searchAction(id,{searchId:a.searchId,sequence:a.sequence,action:{type:'click',x:5,y:5}});assert.equal(f.visits.length,1);assert.equal(b.canUse,false);await assert.rejects(f.api.selectSearch(id,{searchId:b.searchId,sequence:b.sequence}),/search_select/);await f.api.closeSearch(a.searchId);
 const g=fixture();g.setTarget(null);const c=await g.api.startSearch(id,{});const d=await g.api.searchAction(id,{searchId:c.searchId,sequence:c.sequence,action:{type:'click',x:10,y:10}});assert.match(d.notice,/Only website links/);assert.equal(g.visits.length,1);await g.api.closeSearch(c.searchId);
});
test('rejects injected URL, typing, out-of-bounds coordinates, private href and wrong identity',async()=>{
 const f=fixture();await assert.rejects(f.api.startSearch(id,{url:'https://evil.example'}),/Invalid/);const a=await f.api.startSearch(id,{});
 for(const action of [{type:'type',text:'secret'},{type:'click',x:1100,y:1},{type:'scroll',deltaY:5000}])await assert.rejects(f.api.searchAction(id,{searchId:a.searchId,sequence:a.sequence,action}));
 await assert.rejects(f.api.searchAction('87654321-1234-1234-1234-123456789ABC',{searchId:a.searchId,sequence:a.sequence,action:{type:'refresh'}}),/expired/);
 f.setTarget('https://127.0.0.1/');const fresh=await f.api.searchAction(id,{searchId:a.searchId,sequence:a.sequence,action:{type:'refresh'}});await assert.rejects(f.api.searchAction(id,{searchId:a.searchId,sequence:fresh.sequence,action:{type:'click',x:5,y:5}}));assert.equal(f.visits.length,1);await f.api.closeSearch(a.searchId);
});
test('caps retained searches, closes on expiry and aborted startup',async()=>{
 const f=fixture(),a=await f.api.startSearch(id,{}),b=await f.api.startSearch(id,{});await assert.rejects(f.api.startSearch(id,{}),/busy/);f.setClock(200000);await assert.rejects(f.api.searchAction(id,{searchId:a.searchId,sequence:a.sequence,action:{type:'refresh'}}),/expired/);await f.api.closeSearch(b.searchId);assert.equal(f.closed(),2);
 const c=new AbortController();c.abort();await assert.rejects(f.api.startSearch(id,{},{signal:c.signal}));
});
test('retained read-only browser session closes exactly once without live-view credentials',async()=>{
 let closes=0,pageCloses=0;const listeners=new Map();
 const page={setViewport:async()=>{},setRequestInterception:async()=>{},evaluateOnNewDocument:async()=>{},on:(name,fn)=>listeners.set(name,fn),close:async()=>pageCloses++};
 const browser={newPage:async()=>page,close:async()=>closes++};
 const result=await browserSession({retainReadOnly:true,connect:async config=>{assert.equal(config.retainReadOnly,undefined);return browser;}},async()=>({retainReadOnly:true}));
 assert.equal(result.page,page);assert.equal(closes,0);await result.release();await result.release();assert.equal(closes,1);assert.equal(pageCloses,1);
});
test('HTTP search routes enforce same origin, exact operation and no-store response',async t=>{
 const {createApp}=await import('../src/app.js'),{createDemoProvider}=await import('../src/demo-provider.js'),http=await import('node:http');
 const calls=[],reservationForms={enabled:true,startSearch:async(entity,body)=>{calls.push([entity,body]);return {searchId:'test',imageDataUrl:'data:image/png;base64,YQ=='};},closeSearch:async value=>calls.push(['close',value])};
 const server=createApp({provider:createDemoProvider(),rateLimit:false,reservationForms}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const call=(suffix,origin,body={})=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path:`/api/places/${id}/reservation-search${suffix}`,method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(text)}));});req.on('error',reject);req.end(JSON.stringify(body));});
 assert.equal((await call('','https://wrong.example')).status,403);assert.equal(calls.length,0);const result=await call('','http://127.0.0.1:5173');assert.equal(result.status,200);assert.equal(result.headers['cache-control'],'no-store');assert.equal(calls.length,1);assert.equal((await call('/close','http://127.0.0.1:5173',{searchId:'bad'})).status,400);
});

test('search startup and navigation failures have safe distinct codes',async()=>{
 const {ReservationFormError,reservationDiscoveryFailure}=await import('../src/reservation-form.js');
 const places={details:async()=>({entityId:id,name:'Republic Bar',address:'Osu Accra'})};
 for(const error of [new Error('provider secret'),new ReservationFormError('busy')]){
  const api=createReservationForms({places,config:{},run:async()=>{throw error;}});
  await assert.rejects(api.startSearch(id,{}),e=>{assert.equal(e.code,error.code||'browser_unavailable');assert.doesNotMatch(JSON.stringify(reservationDiscoveryFailure(e)),/provider secret/);return true;});
 }
 for(const [error,code] of [[Object.assign(new Error('private target'),{name:'TimeoutError'}),'page_timeout'],[new Error('navigation failed secret'),'page_unavailable'],[new ReservationFormError('page_http_error'),'page_http_error']]){
  const f=fixture();f.setNavigationError(error);
  await assert.rejects(f.api.startSearch(id,{}),e=>e.code===code);
  f.setNavigationError(null);const a=await f.api.startSearch(id,{});
  f.setNavigationError(error);
  await assert.rejects(f.api.searchAction(id,{searchId:a.searchId,sequence:a.sequence,action:{type:'click',x:100,y:100}}),e=>{assert.equal(e.code,code);assert.doesNotMatch(JSON.stringify(reservationDiscoveryFailure(e)),/private target|failed secret/);return true;});
  await f.api.closeSearch(a.searchId);
 }
});

test('HTTP challenge is classified separately from ordinary server error without retry',async()=>{for(const blocked of [false,true]){const f=fixture();f.setStatus(429);f.setBlocked(blocked);await assert.rejects(f.api.startSearch(id,{}),e=>e.code===(blocked?'search_challenge':'page_http_error'));assert.equal(f.visits.length,1);}});
