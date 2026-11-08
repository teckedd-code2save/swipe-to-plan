import test,{after,before,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {syntheticCapabilities,syntheticRoutePlan,syntheticRouteResult} from './fixtures/route-plan.js';
import {routeEstimateError,routeEstimateFingerprint,routeEstimateRequest,routeLocation} from '../src/route-estimates.js';
import {routeLegs,routeLink} from '../src/route-links.js';

let RouteGuide,PlaceDetails,createRoot,bundleDir,dom,root,requests,props,capabilities,fail,overrides;
const originalFetch=globalThis.fetch;
function setupDom(){
  dom?.window.close();dom=new JSDOM('<button id="trigger">Open place</button><div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true});
  for(const key of ['window','document','location','history','localStorage','sessionStorage','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLDialogElement','Element','Node','Event','MouseEvent','navigator'])Object.defineProperty(globalThis,key,{value:dom.window[key],writable:true,configurable:true});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
}
before(async()=>{
  setupDom();({createRoot}=await import('react-dom/client'));
  const frontend=fileURLToPath(new URL('..',import.meta.url));bundleDir=await mkdtemp(join(frontend,'node_modules/.route-test-'));
  const entry=join(bundleDir,'entry.jsx'),outfile=join(bundleDir,'route.mjs');
  await writeFile(entry,`export {default as RouteGuide} from '${join(frontend,'src/RouteGuide.jsx')}'; export {PlaceDetails} from '${join(frontend,'src/PlaceGuide.jsx')}';`);
  await build({entryPoints:[entry],outfile,bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',plugins:[{name:'synthetic-map-tiles',setup(build){build.onResolve({filter:/journey-map-leaflet\.js$/},()=>({path:'map-fixture',namespace:'test-map'}));build.onLoad({filter:/.*/,namespace:'test-map'},()=>({contents:'export function createJourneyMap(_node,_points,events){events.onTileReady();return {fit(){},select(){},clearRoute(){},destroy(){}};}'}));}}]});
  ({RouteGuide,PlaceDetails}=await import(pathToFileURL(outfile).href));
});
after(async()=>{globalThis.fetch=originalFetch;await rm(bundleDir,{recursive:true,force:true});});
beforeEach(()=>{
  setupDom();requests=[];capabilities=syntheticCapabilities;fail=false;overrides={};props={plan:syntheticRoutePlan(),checks:{status:'ready'},routeScope:'guest:day-1:revision-1'};
  globalThis.fetch=async(input,options={})=>{
    if(input==='/api/actions/capabilities')return new Response(JSON.stringify(capabilities),{status:capabilities?200:503});
    if(input.startsWith('/api/locations/'))return new Response(JSON.stringify({}),{status:404});
    assert.equal(input,'/api/actions/routes/estimate','Only the mocked route API may be called');
    const payload=JSON.parse(options.body);let resolve;const pending=new Promise(done=>resolve=done);
    requests.push({payload,signal:options.signal,resolve});await pending; // Intentionally ignores abort.
    return new Response(JSON.stringify(fail?{error:'Synthetic provider failure'}:syntheticRouteResult(payload,overrides)),{status:fail?502:200});
  };
});
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=null;dom.window.close();});
async function render(next={}){props={...props,...next};await act(async()=>{if(!root)root=createRoot(document.getElementById('root'));root.render(React.createElement(RouteGuide,props));});}
const button=name=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===name||node.getAttribute('aria-label')===name);
async function click(name){assert.ok(button(name),`Missing ${name}`);await act(async()=>button(name).click());}
async function input(value){const node=document.querySelector('.pg-estimate-form input');assert.ok(node);await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));});}
async function select(value){await act(async()=>{const node=document.querySelector('.pg-route-guide select');node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));});}
async function resolve(index=requests.length-1){await act(async()=>{requests[index].resolve();});}
async function chooseStart(){await render({savedAreas:[{id:'synthetic-start',label:'Synthetic start',center:{latitude:5.55,longitude:-0.2}}]});await click('Use Synthetic start · approximate area');}
async function start(){await render();await click('Drive');await chooseStart();await click('Estimate this journey');}
const result=()=>document.querySelector('.pg-route-estimate');

test('render, typing, mode and leg changes never automatically estimate; Compare is Maps only',async()=>{
  await render();assert.equal(requests.length,0);assert.equal(button('Estimate this journey').disabled,true);
  await input('Synthetic starting address');await click('Drive');await click('Walk');await select('second-drinks');assert.equal(requests.length,0);
  await click('Compare');assert.equal(button('Estimate this journey'),undefined);assert.ok(document.querySelector('a[href*="google.com/maps/dir/"]'));
});
test('explicit first-leg action requires origin, never infers area or asks for GPS',async()=>{
  await render();await click('Drive');await act(async()=>document.querySelector('.pg-estimate-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(requests.length,0);
  assert.match(document.querySelector('[role="alert"]').textContent,/Choose your starting point/);assert.equal(document.activeElement,document.querySelector('input'));
  await chooseStart();await click('Estimate this journey');assert.deepEqual(requests[0].payload.origin,{coordinates:{lat:5.55,lng:-0.2}});
  assert.equal(requests[0].payload.departureAt,undefined);assert.equal(requests[0].payload.stops[0].id,'first-drinks');assert.equal(requests[0].payload.stops[0].entityId,'synthetic-venue');
  assert.match(document.querySelector('.pg-estimate-form').textContent,/leaving now, not your scheduled outing/);assert.match(document.body.textContent,/Sends.*Mapbox Directions/);
});
test('success reports source, measured time and travel-only limits without changing plan or persisting origin',async()=>{
  const before=structuredClone(props.plan);await start();await resolve();
  assert.match(result().textContent,/12 min travel · 4.2 km/);assert.match(result().textContent,/Mapbox Directions/);assert.equal(result().querySelector('time').dateTime,'2026-11-08T12:34:00Z');
  assert.match(result().textContent,/Travel only/);assert.match(result().textContent,/Schedule feasibility has not been checked/);assert.deepEqual(props.plan,before);
  for(const storage of [localStorage,sessionStorage])for(const key of Object.keys(storage))assert.doesNotMatch(storage.getItem(key),/Synthetic starting address|durationSeconds|distanceMeters/);
});
test('repeated venue slots retain unique slot IDs, item ID and entity ID and use preceding selected venue',async()=>{
  await render();await select('second-drinks');await click('Walk');await click('Estimate this journey');
  assert.equal(document.querySelectorAll('.pg-route-guide option').length,2);assert.equal(requests[0].payload.origin.id,'first-drinks');assert.equal(requests[0].payload.stops[0].id,'second-drinks');assert.equal(requests[0].payload.stops[0].entityId,'synthetic-venue');
  assert.equal(props.plan.stops[1].item.id,'catalog-item');assert.equal(requests[0].payload.mode,'WALK');assert.equal(document.querySelector('input'),null);await resolve();assert.ok(result());
});
for(const change of ['mode','origin','leg','date','time','timezone','venue','order','plan revision','account','shared revision','restored day'])test(`${change} invalidates pending and resolved evidence even when transport ignores abort`,async()=>{
  await start();const old=requests[0];
  if(change==='mode')await click('Walk');else if(change==='origin')await input('Changed synthetic origin');else if(change==='leg')await select('second-drinks');
  else if(change==='date')await render({plan:{...props.plan,request:{...props.plan.request,date:'2027-02-01'}}});
  else if(change==='time')await render({plan:{...props.plan,request:{...props.plan.request,startTime:'19:00'}}});
  else if(change==='timezone')await render({plan:{...props.plan,timeZone:'Europe/London'}});
  else if(change==='venue'){const plan=structuredClone(props.plan);plan.stops[1].item.name='Changed synthetic venue';await render({plan});}
  else if(change==='order')await render({plan:{...props.plan,stops:[...props.plan.stops].reverse()}});
  else await render({routeScope:`new scope: ${change}`});
  assert.equal(old.signal.aborted,true);await resolve(0);assert.equal(result(),null);assert.equal(requests.length,1);
});
test('a completed result is cleared on changes and cannot reappear when a prior scope returns',async()=>{
  await start();await resolve();assert.ok(result());const old=props.routeScope;
  await render({routeScope:'account:second'});assert.equal(result(),null);assert.equal(document.querySelector('input').value,'');
  await render({routeScope:old});assert.equal(result(),null);assert.equal(document.querySelector('input').value,'');
});
test('a newer explicit request wins over an older out-of-order response',async()=>{
  await start();await render({savedAreas:[{id:'new-start',label:'New start',center:{latitude:5.56,longitude:-0.18}}]});await click('Use New start · approximate area');await click('Estimate this journey');assert.equal(requests.length,2);await resolve(1);assert.ok(result());
  const shown=result().textContent;overrides={distanceMeters:999999};await resolve(0);assert.equal(result().textContent,shown);
});
test('unmount cancels requests; a late response cannot affect a newly mounted guide',async()=>{
  await start();await act(async()=>root.unmount());root=null;assert.equal(requests[0].signal.aborted,true);await render();await resolve(0);assert.equal(result(),null);assert.equal(document.querySelector('input').value,'');
});
test('provider failure keeps venues, pins, schedules and Maps fallback unchanged',async()=>{
  const before=structuredClone(props.plan);await start();const map=document.querySelector('a[href*="google.com/maps/dir/"]').href;fail=true;await resolve();
  assert.equal(result(),null);assert.match(document.querySelector('[role="alert"]').textContent,/Try again or use Maps/);assert.equal(document.querySelector('a[href*="google.com/maps/dir/"]').href,map);assert.deepEqual(props.plan,before);
});
for(const supplied of [null,{...syntheticCapabilities,routeEstimates:false}])test(`disabled or missing capability offers Maps without provider calls (${!!supplied})`,async()=>{
  capabilities=supplied;await render();await click('Drive');await input('Synthetic address');assert.equal(button('Estimate this journey'),undefined);assert.equal(requests.length,0);assert.match(document.body.textContent,/In-app estimates are unavailable/);assert.ok(document.querySelector('a[href*="google.com/maps/dir/"]'));
});
for(const bad of [{geometry:{type:'LineString',coordinates:[[50,50],[60,60]]}},{geometry:null},{trafficBasis:'guaranteed_live'},{requestId:'wrong'},{itineraryRevision:-1},{mode:'WALK'},{source:'unknown'},{trafficAware:false},{departureAt:'2027-01-01T12:00:00Z'},{distanceMeters:null},{selectedStops:[{id:'other-slot'}]},{legs:[]},{legs:[{from:{address:'wrong'},to:{id:'wrong'}}]}])test(`mismatched or malformed result is not displayed: ${Object.keys(bad)[0]}`,async()=>{
  await start();overrides=bad;await resolve();assert.equal(result(),null);assert.ok(document.querySelector('[role="alert"]'));
});
test('input and controls have accessible names; Close and Escape restore focus and reject late results',async()=>{
  for(const dismiss of ['close','escape']){
    if(root){await act(async()=>root.unmount());root=null;}
    const trigger=document.querySelector('#trigger');trigger.focus();
    function Harness(){const [open,setOpen]=React.useState(true);return open?React.createElement(PlaceDetails,{...props,stop:props.plan.stops[1],initialView:'route',onClose:()=>setOpen(false)}):React.createElement('p',null,'Closed');}
    await act(async()=>{root=createRoot(document.getElementById('root'));root.render(React.createElement(QueryClientProvider,{client:new QueryClient()},React.createElement(Harness)));});
    assert.equal(document.querySelector('select[aria-label="Place to review"]').value,'second-drinks');
    await click('Drive');await click('Estimate this journey');const pending=requests.length-1;
    if(dismiss==='close')await click('Close place details');else await act(async()=>document.querySelector('dialog').dispatchEvent(new Event('cancel',{bubbles:true})));
    assert.equal(document.activeElement,trigger);assert.equal(requests[pending].signal.aborted,true);await resolve(pending);assert.equal(result(),null);assert.equal(document.querySelector('dialog'),null);
  }
});
test('pure request identity includes every selected slot; address/coordinate validation and Maps remain independent',()=>{
  const plan=syntheticRoutePlan(),leg=routeLegs(plan)[1];assert.deepEqual(routeEstimateRequest(leg,'walking','ignored').stops[0],routeLocation(plan.stops[1]));
  const key=routeEstimateFingerprint(plan,'account-a',leg,'walking','');const other=structuredClone(plan);other.stops[1].item.id='different-item';assert.notEqual(key,routeEstimateFingerprint(other,'account-a',leg,'walking',''));
  assert.match(routeLink(leg,'walking'),/origin=5.56%2C-0.18/);assert.throws(()=>routeEstimateRequest(leg,'',''),/Choose Drive/);
  assert.equal(routeLocation({id:'missing',item:{name:'No address'}}),null);assert.equal(routeLocation({id:'bad',item:{coordinates:{lat:500,lng:0},address:'Synthetic address'}}).address,'Synthetic address');
});

test('valid zero travel time and distance are shown truthfully and measurements are time-qualified',async()=>{
  await start();const payload=requests[0].payload;overrides={distanceMeters:0,durationSeconds:0,legs:[{...syntheticRouteResult(payload).legs[0],distanceMeters:0,durationSeconds:0}]};await resolve();
  assert.match(result().textContent,/Less than 1 min travel · 0 m/);assert.match(result().textContent,/departure at the measured time/);assert.match(result().textContent,/Estimate again before leaving/);
});

for(const [code,message] of [['provider_not_configured','unavailable'],['routes_rate_limited','request limit'],['rate_limited','Too many requests'],['routes_timeout','timed out'],['routes_traffic_unavailable','traffic-aware driving estimate is unavailable'],['route_not_found','No route was found']])test(`controlled provider fallback for ${code} excludes arbitrary upstream text`,()=>{
  const text=routeEstimateError({code,message:'Do not display synthetic upstream secret'});assert.match(text,new RegExp(message));assert.match(text,/unchanged/);assert.doesNotMatch(text,/secret/);
});
test('repeated submit while a request is pending does not make another provider request',async()=>{
  await start();await act(async()=>{const form=document.querySelector('.pg-estimate-form');for(let i=0;i<3;i++)form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});assert.equal(requests.length,1);
});

test('walking and transit copy does not claim road-traffic evidence',async()=>{
  await render();await click('Walk');assert.match(document.querySelector('.pg-estimate-form').textContent,/Estimate for leaving now/);assert.doesNotMatch(document.querySelector('.pg-estimate-form').textContent,/current traffic/);
  await click('Transit');assert.match(document.querySelector('.pg-estimate-form').textContent,/does not support transit/);assert.doesNotMatch(document.querySelector('.pg-estimate-form').textContent,/current traffic/);
});

function mockLocation(){const calls=[];Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success,error,options){calls.push({success,error,options});}}});return calls;}
const coordinates={latitude:5.561234567,longitude:-0.182345678,accuracy:24};
const mapsOrigin=()=>new URL(document.querySelector('a[href*="google.com/maps/dir/"]').href).searchParams.get('origin');
test('current location is gesture-only, retains device precision and accuracy, and is never saved',async()=>{
  const calls=mockLocation(),before=structuredClone(props.plan);await render();assert.equal(calls.length,0);assert.equal(mapsOrigin(),null);
  await click('Drive');await click('Use current location');assert.equal(calls.length,1);assert.equal(calls[0].options.maximumAge,0);
  await act(async()=>calls[0].success({coords:coordinates}));assert.match(document.body.textContent,/reported accuracy about 24 m/);
  assert.equal(mapsOrigin(),'5.561234567,-0.182345678');await click('Estimate this journey');assert.deepEqual(requests[0].payload.origin,{coordinates:{lat:coordinates.latitude,lng:coordinates.longitude}});
  await resolve();assert.deepEqual(props.plan,before);assert.equal(localStorage.length,0);assert.equal(sessionStorage.length,0);
  await click('Clear starting point');assert.equal(mapsOrigin(),null);assert.equal(result(),null);
});
for(const transition of ['account','day','stop','mode','typed choice','saved area','unmount'])test(`late permission result ignored after ${transition}`,async()=>{
  const calls=mockLocation();await render({savedAreas:[{id:'saved',label:'Saved town'}]});await click('Use current location');
  if(transition==='account'||transition==='day')await render({routeScope:transition+':changed'});
  else if(transition==='stop')await select('second-drinks');
  else if(transition==='mode')await click('Walk');
  else if(transition==='saved area')await click('Use Saved town · approximate area');
  else if(transition==='typed choice')await input('Chosen landmark, Accra');
  else {await act(async()=>root.unmount());root=null;await render();}
  await act(async()=>calls[0].success({coords:coordinates}));assert.doesNotMatch(document.body.textContent,/reported accuracy/);
  if(transition==='stop'){assert.equal(mapsOrigin(),'5.56,-0.18');await select('first-drinks');assert.equal(mapsOrigin(),null);}
  else assert.equal(mapsOrigin(),transition==='typed choice'?'Chosen landmark, Accra':transition==='saved area'?'Saved town':null);
});
for(const failure of ['denied','unavailable','too broad','invalid'])test(`location ${failure} preserves manual and Maps fallback`,async()=>{
  const calls=mockLocation();await render();await input('My landmark, Accra');await click('Use current location');
  await act(async()=>{if(failure==='denied'||failure==='unavailable')calls[0].error({code:failure==='denied'?1:2});else calls[0].success({coords:{...coordinates,...(failure==='too broad'?{accuracy:25001}:{latitude:NaN})}});});
  assert.match(document.querySelector('[role="alert"]').textContent,/place name/);assert.equal(mapsOrigin(),'My landmark, Accra');assert.equal(requests.length,0);
});
test('saved areas are explicit approximate origins and never change saved/planning state',async()=>{
  const areas=[{id:'test-area',label:'Synthetic area, Accra',center:{latitude:5.6,longitude:-0.2}}],before=structuredClone(props.plan);await render({savedAreas:areas});assert.equal(mapsOrigin(),null);
  await click('Use Synthetic area, Accra · approximate area');assert.equal(mapsOrigin(),'5.6,-0.2');assert.match(document.body.textContent,/approximate area centre, not your exact position/);
  await click('Drive');await click('Estimate this journey');assert.deepEqual(requests[0].payload.origin,{coordinates:{lat:5.6,lng:-0.2}});await resolve();assert.match(result().textContent,/Approximate route/);assert.deepEqual(props.plan,before);assert.deepEqual(areas,[{id:'test-area',label:'Synthetic area, Accra',center:{latitude:5.6,longitude:-0.2}}]);
  await render({routeScope:'other-account',savedAreas:[]});assert.equal(mapsOrigin(),null);assert.equal(button('Use Synthetic area, Accra · approximate area'),undefined);
});
test('area chooser reuses area search and supports no-coordinate areas without saving',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async(url,options)=>url.startsWith('/api/locations?')?new Response(JSON.stringify({locations:[{id:'chosen-area',label:'Chosen town'}]})):original(url,options);
  await render();await click('Choose another area');const node=document.querySelector('[aria-label="Search starting areas"]');
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'Chosen');node.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,450));});await click('Chosen town · approximate area');assert.equal(mapsOrigin(),'Chosen town');assert.equal(localStorage.length,0);
});

test('current location remains useful in Maps when route provider is disabled',async()=>{
  capabilities={...syntheticCapabilities,routeEstimates:false};const calls=mockLocation();await render();await click('Use current location');await act(async()=>calls[0].success({coords:coordinates}));
  assert.equal(button('Estimate this journey'),undefined);assert.match(document.querySelector('a[href*="google.com/maps/dir/"]').textContent,/Open in Maps/);assert.equal(mapsOrigin(),'5.561234567,-0.182345678');assert.equal(requests.length,0);
});
test('Maps encodes untrusted origin text only as a parameter on the fixed Google host',()=>{
  const url=new URL(routeLink(routeLegs(syntheticRoutePlan())[0],'driving','javascript:alert(1)&destination=https://example.invalid'));
  assert.equal(url.origin,'https://www.google.com');assert.equal(url.searchParams.get('origin'),'javascript:alert(1)&destination=https://example.invalid');assert.notEqual(url.searchParams.get('destination'),'https://example.invalid');
});

test('malformed device result fails safely instead of leaving location pending',async()=>{
  const calls=mockLocation();await render();await click('Use current location');await act(async()=>calls[0].success({}));assert.match(document.querySelector('[role="alert"]').textContent,/too broad/);assert.equal(button('Use current location').disabled,false);
});
test('malformed area search results are ignored and cancelling a short query clears loading',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async(url,options)=>url.startsWith('/api/locations?')?new Response(JSON.stringify({locations:[null,{}, {id:'missing'}, {id:'ok',label:'Valid town'}]})):original(url,options);
  await render();await click('Choose another area');const node=document.querySelector('[aria-label="Search starting areas"]');
  async function type(value){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));});}
  await type('Town');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,450));});assert.ok(button('Valid town · approximate area'));
  await type('Other');assert.match(document.body.textContent,/Finding areas/);await type('');assert.doesNotMatch(document.body.textContent,/Finding areas/);assert.equal(button('Valid town · approximate area'),undefined);
});

test('coarse location finds areas with rounded coordinates; explicit area default never saves GPS or changes route',async()=>{
  const original=globalThis.fetch,calls=mockLocation(),nearby=[],saved=[];
  globalThis.fetch=async(url,options)=>{if(url==='/api/locations/nearby'){nearby.push(JSON.parse(options.body));return new Response(JSON.stringify({locations:[{id:'near-town',name:'Near town',label:'Near town',currency:'GHS',center:{latitude:5.6,longitude:-0.2}}]}));}return original(url,options);};
  const before=structuredClone(props.plan);await render({onSaveArea:async area=>saved.push(area),signedIn:false});
  await click('Use current location');await act(async()=>calls[0].success({coords:{...coordinates,accuracy:2000},timestamp:Date.now()}));
  assert.deepEqual(nearby,[{latitude:5.56,longitude:-0.18,radiusKm:20}]);assert.equal(mapsOrigin(),null);assert.equal(saved.length,0);
  await click('Near town · approximate area');assert.equal(mapsOrigin(),'5.6,-0.2');assert.match(document.body.textContent,/on this device/);
  await click('Save area as default');assert.equal(saved[0].id,'near-town');assert.equal(saved[0].coordinates,undefined);assert.equal(mapsOrigin(),'5.6,-0.2');assert.deepEqual(props.plan,before);assert.equal(requests.length,0);
});
test('searched area can explicitly become an account default and save failures remain actionable',async()=>{
  const original=globalThis.fetch,saved=[];globalThis.fetch=async(url,options)=>url.startsWith('/api/locations?')?new Response(JSON.stringify({locations:[{id:'town',label:'Town',currency:'GHS'}]})):original(url,options);
  await render({signedIn:true,onSaveArea:async area=>{saved.push(area);throw Error('Synthetic save unavailable');}});await click('Choose another area');
  await act(async()=>{const node=document.querySelector('[aria-label="Search starting areas"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'Town');node.dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>{await new Promise(resolve=>setTimeout(resolve,450));});
  await click('Town · approximate area');assert.equal(saved.length,0);assert.match(document.body.textContent,/to your account/);await click('Save area as default');assert.equal(saved.length,1);assert.match(document.querySelector('[role="alert"]').textContent,/Synthetic save unavailable/);assert.equal(mapsOrigin(),'Town');
});
test('late rounded nearby lookup is ignored after a different origin is chosen',async()=>{
  const original=globalThis.fetch,calls=mockLocation();let finish;globalThis.fetch=async(url,options)=>url==='/api/locations/nearby'?new Promise(resolve=>{finish=()=>resolve(new Response(JSON.stringify({locations:[{id:'stale',label:'Stale town'}]})));}):original(url,options);
  await render();await click('Use current location');await act(async()=>calls[0].success({coords:{...coordinates,accuracy:2000}}));await input('Chosen landmark');await act(async()=>finish());assert.equal(button('Stale town · approximate area'),undefined);assert.equal(mapsOrigin(),'Chosen landmark');
});

test('Drive is an unsaved view default and choosing a start enables configured estimates without another mode step',async()=>{
  await render();assert.equal(button('Drive').getAttribute('aria-pressed'),'true');assert.equal(button('Estimate this journey').disabled,true);await input('Chosen landmark');assert.equal(button('Estimate this journey').disabled,false);assert.equal(requests.length,0);
  await click('Walk');await input('Another landmark');assert.equal(button('Walk').getAttribute('aria-pressed'),'true');assert.equal(localStorage.length,0);
});

test('map-led journey automatically offers the map without making route estimates',async()=>{
  capabilities={...syntheticCapabilities,routeEstimates:false};await render();
  assert.ok(document.querySelector('[aria-label="Journey map"]'));
  assert.equal(button('Load map'),undefined);
  assert.ok(document.querySelector('.journey-map-canvas'));
  assert.equal(button('Estimate this journey'),undefined);
  assert.match(document.querySelector('a[href*="google.com/maps/dir/"]').textContent,/Open in Maps/);
  assert.equal(requests.length,0);
});

test('map stop key selects repeated occurrences and preserves the explicit journey origin',async()=>{
  await render();await input('Chosen public landmark');
  const keys=()=>[...document.querySelectorAll('.journey-map-stops button')];
  assert.equal(keys().length,2);
  await act(async()=>keys()[1].click());
  assert.equal(document.querySelector('.pg-route-guide select').value,'second-drinks');
  assert.equal(keys()[1].getAttribute('aria-pressed'),'true');
  await act(async()=>keys()[0].click());
  assert.equal(document.querySelector('.pg-route-guide select').value,'first-drinks');
  assert.equal(document.querySelector('.pg-estimate-form input').value,'Chosen public landmark');
  assert.equal(requests.length,0);
});

for(const supplied of [null,{...syntheticCapabilities,routeEstimates:false},{...syntheticCapabilities,routeProvider:'unknown'}])test(`unavailable provider has one fallback and no claim of estimates or Mapbox Directions submission (${JSON.stringify(supplied)})`,async()=>{
  capabilities=supplied;const gps=mockLocation();await render();
  for(const mode of ['Drive','Walk','Transit','Compare']){
    await click(mode);
    assert.equal(button('Estimate this journey'),undefined);
    assert.doesNotMatch(document.body.textContent,/current traffic|leaving now|departure now|Mapbox Directions|choose a mode to estimate/i);
    assert.equal(document.querySelectorAll('.pg-estimate-availability').length,1);
    assert.match(document.querySelector('.pg-estimate-availability').textContent,/In-app estimates are unavailable/);
    assert.ok(document.querySelector('.pg-journey-actions a[href*="google.com/maps/dir/"]'));
    await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  }
  assert.equal(requests.length,0);assert.equal(gps.length,0);
});
test('loading capabilities keep Maps usable without premature estimate or transmission claims',async()=>{
  const original=globalThis.fetch;let ready;
  globalThis.fetch=(url,options)=>url==='/api/actions/capabilities'?new Promise(resolve=>{ready=()=>resolve(new Response(JSON.stringify(syntheticCapabilities)));}):original(url,options);
  await render();await input('Chosen landmark');
  assert.equal(button('Estimate this journey'),undefined);
  assert.match(document.querySelector('.pg-estimate-availability[role="status"]').textContent,/Checking estimates/);
  assert.doesNotMatch(document.body.textContent,/current traffic|leaving now|Mapbox Directions/);
  assert.equal(mapsOrigin(),'Chosen landmark');
  await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(requests.length,0);
  await act(async()=>ready());
  assert.equal(button('Estimate this journey').disabled,false);
  assert.match(document.querySelector('.pg-estimate-availability').textContent,/Sends your start and destination to Mapbox Directions/);
  assert.equal(requests.length,0);
});
for(const modes of [['WALK'],[],null,'DRIVE'])test(`unsupported or malformed mode capability offers Maps without a dead estimate control (${JSON.stringify(modes)})`,async()=>{
  capabilities={...syntheticCapabilities,modes};await render();await input('Chosen landmark');
  assert.equal(button('Estimate this journey'),undefined);
  assert.match(document.querySelector('.pg-estimate-availability').textContent,/No in-app estimate for this mode/);
  assert.doesNotMatch(document.body.textContent,/current traffic|leaving now|Mapbox Directions/);
  assert.equal(mapsOrigin(),'Chosen landmark');
  await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(requests.length,0);
});
test('supported modes disclose submission before an explicit request, and Compare removes that disclosure',async()=>{
  await render();await input('Chosen landmark');
  for(const [label,mode] of [['Drive','driving'],['Walk','walking']]){
    await click(label);const submit=button('Estimate this journey');
    assert.equal(submit.disabled,false);
    const note=document.getElementById(submit.getAttribute('aria-describedby'));
    assert.match(note.textContent,/leaving now, not your scheduled outing/);
    assert.match(note.textContent,/Sends your start and destination to Mapbox Directions/);
    assert.doesNotMatch(document.body.textContent,/current traffic estimates|estimate requested now/);
    assert.equal(new URL(document.querySelector('.pg-journey-actions a').href).searchParams.get('travelmode'),mode);
  }
  await click('Compare');assert.equal(button('Estimate this journey'),undefined);
  assert.match(document.querySelector('.pg-estimate-availability').textContent,/Compare routes in Maps/);
  assert.doesNotMatch(document.body.textContent,/Mapbox Directions|leaving now/);assert.equal(requests.length,0);
});
test('transit help is optional and retains origin, selected mode, focus, and safety details',async()=>{
  await render();await input('Chosen landmark');await click('Transit');
  assert.equal(document.querySelector('.pg-route-options'),null);
  const toggle=button('More route options');toggle.focus();await click('More route options');
  assert.equal(document.activeElement,toggle);assert.equal(toggle.getAttribute('aria-expanded'),'true');
  const options=document.getElementById(toggle.getAttribute('aria-controls'));
  assert.match(options.textContent,/Local services may be unlisted/);
  assert.match(options.textContent,/road conditions/);assert.match(options.textContent,/don’t confirm taxi availability or fares/);
  assert.equal(new URL(options.querySelector('a').href).searchParams.get('origin'),'Chosen landmark');
  await click('More route options');assert.equal(document.querySelector('.pg-route-options'),null);
  assert.equal(document.activeElement,toggle);assert.equal(toggle.getAttribute('aria-expanded'),'false');
  assert.equal(button('Transit').getAttribute('aria-pressed'),'true');assert.equal(mapsOrigin(),'Chosen landmark');assert.equal(requests.length,0);
});
test('compact copy retains visible location permission, unsaved precision, Maps sharing, and map provenance',async()=>{
  capabilities={...syntheticCapabilities,routeEstimates:false};const calls=mockLocation();await render();
  assert.match(document.body.textContent,/Location permission only on tap/);
  assert.match(document.body.textContent,/Nearby search sends a rounded location/);
  assert.match(document.body.textContent,/No tracking/);
  assert.match(document.body.textContent,/OpenStreetMap receives your IP, browser and viewed area/);
  assert.match(document.body.textContent,/Pins show places, not a calculated route/);
  assert.match(document.querySelector('.pg-maps-note').textContent,/Maps receives your selected start and destination/);
  await click('Use current location');await act(async()=>calls[0].success({coords:coordinates}));
  assert.match(document.body.textContent,/reported accuracy about 24 m.*Not saved/);
  assert.doesNotMatch(document.body.textContent,/Mapbox Directions/);
});

for(const signedIn of [false,true])test(`default-save copy is prospective until persistence succeeds (${signedIn?'account':'device'})`,async()=>{
  let finish;const savedAreas=[{id:'saved',label:'Saved town'}];
  await render({signedIn,savedAreas,onSaveArea:()=>new Promise(resolve=>{finish=resolve;})});
  await click('Use Saved town · approximate area');
  const target=signedIn?'to your account':'on this device';
  assert.ok(document.querySelector('.pg-route-start').textContent.includes(`Save this area ${target} for new outings.`));
  assert.doesNotMatch(document.body.textContent,/Area saved as your default/);
  await click('Save area as default');
  assert.ok(button('Saving area…').disabled);assert.doesNotMatch(document.body.textContent,/Area saved as your default/);
  await act(async()=>finish());
  assert.match(document.querySelector('.pg-route-start [role="status"]').textContent,/Area saved as your default/);
  assert.equal(requests.length,0);
});


test('typed start and unpinned venue use clear area/Maps fallback without geocoding or provider calls',async()=>{
  await render();await input('Chosen public address');assert.match(document.body.textContent,/Choose a starting area with a map pin/);
  await click('Estimate this journey');assert.equal(requests.length,0);assert.match(document.querySelector('[role="alert"]').textContent,/Typed addresses still work in Maps/);assert.equal(mapsOrigin(),'Chosen public address');
  await chooseStart();const plan=structuredClone(props.plan);delete plan.stops[0].item.coordinates;await render({plan});
  await click('Estimate this journey');assert.equal(requests.length,0);assert.match(document.querySelector('[role="alert"]').textContent,/no verified map pin/);assert.ok(document.querySelector('.pg-journey-actions a'));
});
test('Mapbox transit keeps Maps and useful help without a provider request',async()=>{
  await render();await chooseStart();await click('Transit');assert.equal(button('Estimate this journey'),undefined);assert.match(document.body.textContent,/Mapbox does not support transit/);
  await act(async()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(requests.length,0);assert.equal(new URL(document.querySelector('.pg-journey-actions a').href).searchParams.get('travelmode'),'transit');
});
for(const bad of [{requestLimitConfigured:false},{routeProvider:'google_routes'},{displayContext:'google_map'},{displayCompatible:false},{displayCompatible:undefined}])test(`display compatibility gate refuses unsafe capability ${JSON.stringify(bad)}`,async()=>{
  capabilities={...syntheticCapabilities,...bad};await render();await chooseStart();assert.equal(button('Estimate this journey'),undefined);assert.equal(requests.length,0);assert.match(document.body.textContent,/In-app estimates are unavailable/);assert.doesNotMatch(document.body.textContent,/Sends your start and destination/);
});
test('resolved geometry is selected-journey only and is removed with stale evidence',async()=>{
  await start();await resolve();assert.match(document.querySelector('.journey-map').textContent,/Line shows the estimated route for the selected journey only/);assert.ok(document.querySelector('.journey-map .route-attribution svg[aria-label="Mapbox"]'));
  assert.ok(document.querySelector('.journey-map-canvas'),'Map display is automatic and independent of route estimates');
  await click('Walk');assert.equal(result(),null);assert.doesNotMatch(document.querySelector('.journey-map').textContent,/Line shows/);assert.equal(document.querySelector('.journey-map .route-attribution'),null);
});

for(const choice of ['planning area','legacy saved area','search result'])test(`${choice} resolves only a chosen catalog ID into a real estimate-ready approximate point`,async()=>{
  const base=globalThis.fetch,lookups=[],id=choice==='planning area'?'synthetic-area':'catalog-area';
  globalThis.fetch=async(url,options)=>{
    if(url===`/api/locations/${id}`){lookups.push({url,signal:options.signal});return new Response(JSON.stringify({id,label:'Catalog area',center:{latitude:5.55,longitude:-0.2}}));}
    if(url.startsWith('/api/locations?'))return new Response(JSON.stringify({locations:[{id,label:'Catalog area'}]}));
    return base(url,options);
  };
  await render({savedAreas:choice==='legacy saved area'?[{id,label:'Catalog area'}]:[]});assert.equal(lookups.length,0);
  if(choice==='planning area')await click('Use Accra · approximate area');
  else if(choice==='legacy saved area')await click('Use Catalog area · approximate area');
  else {await click('Choose another area');await act(async()=>{const node=document.querySelector('[aria-label="Search starting areas"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'Catalog');node.dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>{await new Promise(resolve=>setTimeout(resolve,450));});await click('Catalog area · approximate area');}
  assert.equal(lookups.length,1);assert.equal(mapsOrigin(),'5.55,-0.2');assert.equal(requests.length,0);
  await click('Estimate this journey');assert.deepEqual(requests[0].payload.origin,{coordinates:{lat:5.55,lng:-0.2}});await resolve();assert.ok(result());assert.match(result().textContent,/Approximate route/);assert.equal(localStorage.length,0);
});
for(const transition of ['typed choice','current location','account','day','mode','stop','unmount'])test(`late area metadata is ignored after ${transition}`,async()=>{
  const base=globalThis.fetch,gps=mockLocation();let finish,signal;globalThis.fetch=async(url,options)=>url==='/api/locations/synthetic-area'?new Promise(resolve=>{signal=options.signal;finish=()=>resolve(new Response(JSON.stringify({id:'synthetic-area',center:{latitude:5.6,longitude:-0.2}})));}):base(url,options);
  await render();await click('Use Accra · approximate area');assert.match(document.body.textContent,/Finding the selected area/);
  if(transition==='typed choice')await input('New start');
  else if(transition==='current location'){await click('Use current location');await act(async()=>gps[0].success({coords:coordinates}));}
  else if(transition==='mode')await click('Walk');else if(transition==='stop')await select('second-drinks');
  else if(transition==='unmount'){await act(async()=>root.unmount());root=null;await render();}
  else await render({routeScope:transition+':new'});
  assert.equal(signal.aborted,true);await act(async()=>finish());assert.notEqual(mapsOrigin(),'5.6,-0.2');assert.equal(requests.length,0);assert.doesNotMatch(document.body.textContent,/Finding the selected area/);
});
test('area metadata must match its chosen ID and carry a genuine valid center',async()=>{
  for(const payload of [{id:'wrong',center:{latitude:5.6,longitude:-0.2}},{id:'synthetic-area'},{id:'synthetic-area',center:{latitude:91,longitude:0}}]){
    const base=globalThis.fetch;globalThis.fetch=async(url,options)=>url==='/api/locations/synthetic-area'?new Response(JSON.stringify(payload)):base(url,options);
    await render();await click('Use Accra · approximate area');assert.equal(mapsOrigin(),'Accra');assert.match(document.querySelector('.pg-route-start [role="alert"]').textContent,/no verified map centre/);await click('Estimate this journey');assert.equal(requests.length,0);
    globalThis.fetch=base;
  }
});

test('malformed catalog labels never replace a known label or crash the route view',async()=>{
  const base=globalThis.fetch;globalThis.fetch=async(url,options)=>url==='/api/locations/synthetic-area'?new Response(JSON.stringify({id:'synthetic-area',label:{secret:'unsafe'},name:[],center:{latitude:5.55,longitude:-0.2}})):base(url,options);
  await render();await click('Use Accra · approximate area');assert.match(document.body.textContent,/Near Accra/);assert.equal(mapsOrigin(),'5.55,-0.2');assert.doesNotMatch(document.body.textContent,/unsafe/);
});
