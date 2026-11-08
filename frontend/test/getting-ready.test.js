import test,{before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {syntheticCapabilities,syntheticRoutePlan,syntheticRouteResult} from './fixtures/route-plan.js';
let GettingReady,ChatStudio,createRoot,bundleDir,dom,root,props,maps,capabilities,estimates,gps,applied,lookups;
const originalFetch=globalThis.fetch;
function setup(){
  dom=new JSDOM('<button id="outside">Outside</button><div id="root"></div>',{url:'http://localhost/#/plan/synthetic',pretendToBeVisual:true});
  for(const key of ['window','document','location','history','localStorage','sessionStorage','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLDialogElement','Element','Node','Event','MouseEvent','KeyboardEvent','navigator'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true,writable:true});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  window.matchMedia=query=>({matches:query.includes('max-width'),addEventListener(){},removeEventListener(){}});
  HTMLElement.prototype.scrollTo=HTMLElement.prototype.scrollIntoView=()=>{};
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(success,error){gps.push({success,error});}},configurable:true});
}
before(async()=>{
  setup();({createRoot}=await import('react-dom/client'));dom.window.close();
  const frontend=fileURLToPath(new URL('..',import.meta.url));bundleDir=await mkdtemp(join(frontend,'node_modules/.ready-test-'));
  const entry=join(bundleDir,'entry.jsx'),outfile=join(bundleDir,'ready.mjs');await writeFile(entry,`export {default} from '${join(frontend,'src/GettingReady.jsx')}'; export {default as ChatStudio} from '${join(frontend,'src/ChatStudio.jsx')}';`);
  await build({entryPoints:[entry],outfile,bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',loader:{'.css':'empty'}});const bundle=await import(pathToFileURL(outfile).href);GettingReady=bundle.default;ChatStudio=bundle.ChatStudio;
});
after(async()=>{globalThis.fetch=originalFetch;await rm(bundleDir,{recursive:true,force:true});});
beforeEach(()=>{
  maps=[];estimates=[];gps=[];applied=[];lookups=[];capabilities={...syntheticCapabilities,routeEstimates:false};setup();
  const plan=syntheticRoutePlan();
  props={plan,checks:{status:'ready',data:{stops:plan.stops.map((stop,index)=>({...stop,entityId:stop.item.entityId,place:{...stop.item,links:{website:'https://example.invalid/venue'}},hours:{status:index?'reported_closed':'fits_reported_hours',summary:index?'Synthetic second visit is reported closed.':'Synthetic first visit fits.'}}))}},routeScope:'guest:synthetic',bookingScope:{allowed:true,type:'guest'},onApplyTiming:async request=>applied.push(request),savedAreas:[{id:'synthetic-start',label:'Synthetic start',center:{latitude:5.55,longitude:-0.2}}],loadMapLibrary:async()=>({createJourneyMap:(_node,points,events)=>{const map={points,events,selected:null,destroyed:false,fit(){},select(id){this.selected=id;},destroy(){this.destroyed=true;}};maps.push(map);events.onTileReady();return map;}})};
  globalThis.fetch=async(input,options={})=>{
    if(input==='/api/actions/capabilities')return new Response(JSON.stringify(capabilities));
    if(input==='/api/actions/routes/estimate'){const body=JSON.parse(options.body);let resolve;const pending=new Promise(done=>resolve=done);estimates.push({body,resolve,signal:options.signal});await pending;return new Response(JSON.stringify(syntheticRouteResult(body)));}
    if(input.startsWith('/api/locations/')){lookups.push({input,signal:options.signal});return new Response(JSON.stringify({id:'synthetic-area',label:'Accra',center:{latitude:5.55,longitude:-0.2}}));}
    throw Error(`Unexpected request: ${input}`);
  };
});
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=null;dom.window.close();});
async function render(next={}){props={...props,...next};await act(async()=>{root??=createRoot(document.getElementById('root'));root.render(React.createElement(QueryClientProvider,{client:new QueryClient()},React.createElement(GettingReady,props)));});}
const button=name=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===name||node.getAttribute('aria-label')===name);
async function click(name){const node=button(name);assert.ok(node,`Missing ${name}`);node.focus();await act(async()=>node.click());}
async function flushBack(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});}
async function close(){await click('Close and return to map');await flushBack();}
async function stop(index=0){const node=document.querySelectorAll('.gr-stop')[index];node.focus();await act(async()=>node.click());}
async function input(selector,value){const node=document.querySelector(selector);await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));});}
async function start(){await click('Choose your starting point');await click('Use Synthetic start · approximate area');await close();}

test('entry automatically loads real pins, shows compact readiness and makes no GPS or estimate calls',async()=>{
  await render();assert.equal(maps.length,1);assert.equal(maps[0].points.length,3);assert.equal(gps.length,0);assert.equal(estimates.length,0);assert.equal(lookups.length,0);
  assert.ok(document.querySelector('.gr-readiness'));assert.equal(document.querySelectorAll('.gr-stop').length,2);assert.equal(document.querySelector('.pg-estimate-form'),null);assert.equal(document.querySelector('.journey-map-stops'),null);
  assert.ok(button('Choose your starting point'));assert.equal(button('Load map'),undefined);assert.equal(document.querySelector('.gr-next .pl-button').tagName,'BUTTON');
});
test('start sheet preserves map and selection; focus and scroll lock return on Close, Escape and browser Back',async()=>{
  await render();
  for(const method of ['close','escape','back']){
    await click('Choose your starting point');const trigger=button('Choose your starting point'),dialog=document.querySelector('dialog');assert.ok(dialog.open);assert.equal(document.activeElement,dialog.querySelector('h2'));assert.equal(document.body.style.overflow,'hidden');
    await click('Use Synthetic start · approximate area');assert.equal(gps.length,0);assert.equal(document.querySelectorAll('dialog').length,1);assert.match(document.querySelector('.gr-sheet').textContent,/approximate area centre|Approximate area centre/);
    if(method==='close')await close();else if(method==='escape'){await act(async()=>dialog.dispatchEvent(new Event('cancel',{cancelable:true})));await flushBack();}else{history.back();await flushBack();}
    assert.equal(document.querySelector('dialog'),null);assert.equal(document.body.style.overflow,'');assert.equal(document.activeElement,trigger);assert.equal(maps.at(-1).points[0].label,'Synthetic start');
    await click('StartSynthetic start');await click('Clear starting point');await close();
  }
});
test('marker taps show the exact visit evidence and nested decisions reuse one sheet',async()=>{
  await render();await act(async()=>maps[0].events.onSelectStop('second-drinks'));
  assert.match(document.querySelector('.gr-sheet-header').textContent,/Stop 2 · 20:00–21:00/);assert.match(document.querySelector('.gr-hours').textContent,/second visit is reported closed/);assert.doesNotMatch(document.querySelector('.gr-hours').textContent,/first visit fits/);
  await click('Contact & bookingVenue details, enquiry and your reports');assert.equal(document.querySelectorAll('dialog').length,1);assert.ok(document.querySelector('.gr-compact-contact'));
  await click('Prepare enquiry & track replyYou review the details and make contact.');assert.match(document.querySelector('textarea').value,/20:00/);assert.match(document.querySelector('.pg-enquiry').textContent,/Nothing sent or booked/);assert.equal(document.querySelectorAll('a[href^="tel:"]').length,0);
  await click('Back to previous sheet');await click('Back to previous sheet');assert.ok(document.querySelector('.gr-hours'));await close();assert.equal(maps.at(-1).selected,'second-drinks');
});
test('second-visit directions originate at the previous selected stop and disabled estimates stay absent',async()=>{
  await render();await stop(1);await click('Directions to this stop');
  const link=document.querySelector('.pg-estimate-form a[href*="maps/dir"]');assert.equal(new URL(link.href).searchParams.get('origin'),'5.56,-0.18');assert.equal(button('Estimate this journey'),undefined);assert.match(document.querySelector('.gr-sheet').textContent,/In-app estimates are unavailable/);assert.equal(estimates.length,0);
});
test('timing stays over the map, preserves the existing request and applies only on submit',async()=>{
  const plan=syntheticRoutePlan();plan.request.timing={dateConfirmed:false,timeConfirmed:false,mode:'flexible'};plan.stops=plan.stops.map(stop=>({...stop,start:null,end:null}));await render({plan});
  await click('Choose a time');assert.equal(applied.length,0);assert.ok(document.querySelector('.journey-map-canvas'));assert.equal(document.querySelector('.cs-tool-head'),null);await act(async()=>[...document.querySelectorAll('.cs-timing-choices button')].find(node=>node.querySelector('strong')?.textContent==='Tomorrow').click());await click('Evening');await click('Update outing');await flushBack();
  assert.equal(applied.length,1);assert.equal(applied[0].timing.window,'evening');assert.deepEqual(applied[0].pins,plan.request.pins);assert.equal(applied[0].locationId,plan.request.locationId);assert.equal(document.querySelector('dialog'),null);
});
test('explicit mock-enabled estimate works and dismissal rejects a delayed result',async()=>{
  capabilities=syntheticCapabilities;await render();await start();await click('Drive');await click('Estimate this journey');assert.equal(estimates.length,1);assert.deepEqual(estimates[0].body.origin,{coordinates:{lat:5.55,lng:-0.2}});
  await close();assert.equal(estimates[0].signal.aborted,true);await act(async()=>estimates[0].resolve());await click('Drive');assert.equal(document.querySelector('.pg-route-estimate'),null);
  await click('Estimate this journey');await act(async()=>estimates[1].resolve());assert.match(document.querySelector('.pg-route-estimate').textContent,/12 min travel/);assert.equal(maps.at(-1).points[0].label,'Synthetic start');
});
test('scope changes close sheets, clear origins and reject late GPS without storage',async()=>{
  await render();await click('Choose your starting point');await click('Use current location');assert.equal(gps.length,1);await render({routeScope:'different-account'});assert.equal(document.querySelector('dialog'),null);
  await act(async()=>gps[0].success({coords:{latitude:5.55,longitude:-0.2,accuracy:10}}));assert.ok(button('Choose your starting point'));assert.equal(localStorage.length,0);assert.equal(sessionStorage.length,0);assert.equal(estimates.length,0);
});
test('replacing a selected occurrence closes stale sheets even with the same route scope',async()=>{
  await render();await stop(1);const plan=structuredClone(props.plan);plan.stops[1].item={...plan.stops[1].item,id:'replacement',name:'Synthetic replacement'};await render({plan});assert.equal(document.querySelector('dialog'),null);
});
test('partial plans preserve unfilled visits and coordinate-free stops remain actionable',async()=>{
  const plan=syntheticRoutePlan();plan.stops[1].item.coordinates=null;plan.stops.push({id:'missing',item:null});await render({plan});assert.match(document.body.textContent,/1 stop still needs a place/);assert.equal(document.querySelectorAll('.gr-stop').length,2);assert.match(document.body.textContent,/1 stop has no map pin/);await stop(1);assert.ok(document.querySelector('.gr-sheet'));await close();await render({plan:{...plan,stops:[{id:'missing',item:null}]}});assert.match(document.body.textContent,/No stops to get ready for yet/);
});
test('shared non-owner can inspect timing/contact but cannot prepare a booking',async()=>{
  await render({onApplyTiming:undefined,bookingScope:{allowed:false,type:'shared'}});await click('Time'+document.querySelector('.gr-readiness strong').textContent);assert.match(document.querySelector('.gr-sheet').textContent,/Only the outing owner/);await close();await stop();await click('Contact & bookingVenue details, enquiry and your reports');await click('Prepare enquiry & track replyYou review the details and make contact.');assert.match(document.querySelector('.gr-sheet').textContent,/Only the day owner/);assert.equal(document.querySelector('textarea'),null);
});
test('sheet layout isolates scrolling, uses safe-area and keyboard viewport, and compact chrome is scoped',async()=>{
  const [css,sheet,studio]=await Promise.all(['getting-ready.css','ReadySheet.jsx','ChatStudio.jsx'].map(file=>readFile(new URL(`../src/${file}`,import.meta.url),'utf8')));
  assert.match(css,/max-height:85dvh/);assert.match(css,/safe-area-inset-bottom/);assert.match(css,/\.gr-sheet-scroll\{[^}]*overflow-y:auto[^}]*overscroll-behavior:contain/);assert.match(css,/\.getting-ready-panel \.cs-day-footer\{display:none/);assert.match(sheet,/element.showModal\(\)/);assert.match(sheet,/onKeyDown=\{event=>event.stopPropagation\(\)\}/);assert.match(studio,/planView==='checklist'\?'getting-ready-panel'/);
});

test('rapid Close and Escape traverse history once; Forward never reopens a stale sheet',async()=>{
  await render();const href=location.href,state=history.state;await click('Choose your starting point');let backs=0;const original=history.back.bind(history);history.back=()=>{backs++;original();};
  await act(async()=>{button('Close and return to map').click();button('Close and return to map').click();document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true}));});await flushBack();assert.equal(backs,1);assert.equal(location.href,href);assert.deepEqual(history.state,state);assert.equal(document.querySelector('dialog'),null);
  history.forward();await flushBack();assert.equal(document.querySelector('dialog'),null);assert.equal(estimates.length,0);assert.equal(gps.length,0);
});
test('timing apply removes its sheet entry before changing the outing',async()=>{
  await render();const state=history.state,href=location.href;const chip=document.querySelector('.gr-readiness button');await act(async()=>chip.click());await click('Update outing');await flushBack();assert.equal(applied.length,1);assert.deepEqual(history.state,state);assert.equal(location.href,href);assert.equal(document.querySelector('dialog'),null);
});
test('a removed map trigger returns focus to the map hub; account invalidation does not steal new focus',async()=>{
  await render();const marker=document.createElement('button');marker.textContent='Synthetic marker';document.body.append(marker);marker.focus();await act(async()=>maps[0].events.onSelectStart());marker.remove();await close();assert.equal(document.activeElement,document.querySelector('.gr-hub'));
  await click('Choose your starting point');const outside=document.querySelector('#outside');outside.focus();await render({routeScope:'new-account'});assert.equal(document.activeElement,outside);assert.equal(document.querySelector('dialog'),null);
});
test('partial map/list visit numbers retain unfilled gaps and correct preceding chosen origin',async()=>{
  const plan=syntheticRoutePlan();plan.stops.splice(1,0,{id:'unfilled-middle',item:null});await render({plan});assert.deepEqual(maps[0].points.filter(point=>!point.isOrigin).map(point=>point.badge),['1','3']);assert.equal(document.querySelectorAll('.gr-stops li').length,3);assert.equal(document.querySelector('.gr-unfilled .gr-stop-number').textContent,'2');
  await stop(1);assert.match(document.querySelector('.gr-sheet-header').textContent,/Stop 3/);await click('Directions to this stop');assert.match(document.querySelector('.gr-journey-path').textContent,/Stop 1/);assert.equal(new URL(document.querySelector('.pg-estimate-form a').href).searchParams.get('origin'),'5.56,-0.18');
});

test('a mobile map pan cannot dismiss the outing panel while its ordinary pull gesture still works',async()=>{
  let dismissed=0;const noop=()=>{};
  await act(async()=>{root=createRoot(document.querySelector('#root'));root.render(React.createElement(ChatStudio,{brief:props.plan.request,plan:props.plan,chat:[],message:'',owner:true,configured:true,planOpen:true,planView:'checklist',onClosePlan:()=>dismissed++,onPlanView:noop,onTool:noop,onNew:noop,onSaved:noop,onOpenPlan:noop,onMessage:noop,onSend:noop},React.createElement('section',{className:'journey-map'},React.createElement('div',{className:'journey-map-canvas leaflet-container'},React.createElement('img',{className:'leaflet-tile',alt:'Synthetic tile'})))));});
  const panel=document.querySelector('.cs-day-panel');assert.equal(panel.getAttribute('role'),'dialog');assert.ok(panel.classList.contains('getting-ready-panel'));
  const pan=async target=>{await act(async()=>{for(const [type,y] of [['touchstart',10],['touchmove',140],['touchend',140]]){const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'touches',{value:type==='touchend'?[]:[{clientX:100,clientY:y}]});target.dispatchEvent(event);}});};
  await pan(document.querySelector('.leaflet-tile'));assert.equal(dismissed,0);assert.equal(panel.style.translate,'');await pan(document.querySelector('.cs-day-header h2'));assert.equal(dismissed,1);
});
