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
  await build({entryPoints:[entry],outfile,bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external'});
  ({RouteGuide,PlaceDetails}=await import(pathToFileURL(outfile).href));
});
after(async()=>{globalThis.fetch=originalFetch;await rm(bundleDir,{recursive:true,force:true});});
beforeEach(()=>{
  setupDom();requests=[];capabilities=syntheticCapabilities;fail=false;overrides={};props={plan:syntheticRoutePlan(),checks:{status:'ready'},routeScope:'guest:day-1:revision-1'};
  globalThis.fetch=async(input,options={})=>{
    if(input==='/api/actions/capabilities')return new Response(JSON.stringify(capabilities),{status:capabilities?200:503});
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
async function start(){await render();await click('Drive');await input('Synthetic starting address, Accra');await click('Estimate this journey');}
const result=()=>document.querySelector('.pg-route-estimate');

test('render, typing, mode and leg changes never automatically estimate; Compare is Maps only',async()=>{
  await render();assert.equal(requests.length,0);assert.equal(button('Estimate this journey').disabled,true);
  await input('Synthetic starting address');await click('Drive');await click('Walk');await select('second-drinks');assert.equal(requests.length,0);
  await click('Compare');assert.equal(button('Estimate this journey').disabled,true);assert.ok(document.querySelector('a[href*="google.com/maps/dir/"]'));
});
test('explicit first-leg action requires origin, never infers area or asks for GPS',async()=>{
  await render();await click('Drive');await click('Estimate this journey');assert.equal(requests.length,0);
  assert.match(document.querySelector('[role="alert"]').textContent,/Enter your starting address/);assert.equal(document.activeElement,document.querySelector('input'));
  await input('Synthetic starting address');await click('Estimate this journey');assert.deepEqual(requests[0].payload.origin,{address:'Synthetic starting address'});
  assert.equal(requests[0].payload.departureAt,undefined);assert.equal(requests[0].payload.stops[0].id,'first-drinks');assert.equal(requests[0].payload.stops[0].entityId,'synthetic-venue');
  assert.match(document.querySelector('.pg-estimate-form').textContent,/not an estimate for your scheduled outing/);assert.match(document.body.textContent,/sent|sends.*Google Routes/);
});
test('success reports source, measured time and travel-only limits without changing plan or persisting origin',async()=>{
  const before=structuredClone(props.plan);await start();await resolve();
  assert.match(result().textContent,/12 min travel · 4.2 km/);assert.match(result().textContent,/Google Routes/);assert.equal(result().querySelector('time').dateTime,'2026-11-08T12:34:00Z');
  assert.match(result().textContent,/Travel only/);assert.match(result().textContent,/Schedule feasibility has not been checked/);assert.deepEqual(props.plan,before);
  for(const storage of [localStorage,sessionStorage])for(const key of Object.keys(storage))assert.doesNotMatch(storage.getItem(key),/Synthetic starting address|durationSeconds|distanceMeters/);
});
test('repeated venue slots retain unique slot IDs, item ID and entity ID and use preceding selected venue',async()=>{
  await render();await select('second-drinks');await click('Transit');await click('Estimate this journey');
  assert.equal(document.querySelectorAll('.pg-route-guide option').length,2);assert.equal(requests[0].payload.origin.id,'first-drinks');assert.equal(requests[0].payload.stops[0].id,'second-drinks');assert.equal(requests[0].payload.stops[0].entityId,'synthetic-venue');
  assert.equal(props.plan.stops[1].item.id,'catalog-item');assert.equal(requests[0].payload.mode,'TRANSIT');assert.equal(document.querySelector('input'),null);await resolve();assert.ok(result());
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
  await start();await input('Changed synthetic origin');await click('Estimate this journey');assert.equal(requests.length,2);await resolve(1);assert.ok(result());
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
  capabilities=supplied;await render();await click('Drive');await input('Synthetic address');await click('Estimate this journey');assert.equal(requests.length,0);assert.match(document.body.textContent,/Route estimates are unavailable/);assert.ok(document.querySelector('a[href*="google.com/maps/dir/"]'));
});
for(const bad of [{requestId:'wrong'},{itineraryRevision:-1},{mode:'WALK'},{source:'unknown'},{trafficAware:false},{departureAt:'2027-01-01T12:00:00Z'},{distanceMeters:null},{selectedStops:[{id:'other-slot'}]},{legs:[]},{legs:[{from:{address:'wrong'},to:{id:'wrong'}}]}])test(`mismatched or malformed result is not displayed: ${Object.keys(bad)[0]}`,async()=>{
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
  await render();await click('Walk');assert.match(document.querySelector('.pg-estimate-form').textContent,/Walking estimate requested now/);assert.doesNotMatch(document.querySelector('.pg-estimate-form').textContent,/current traffic/);
  await click('Transit');assert.match(document.querySelector('.pg-estimate-form').textContent,/Transit estimate for departure now/);assert.doesNotMatch(document.querySelector('.pg-estimate-form').textContent,/current traffic/);
});
