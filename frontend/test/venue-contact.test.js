import test,{before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {shapeProviderContact} from '../../shared/venue-contact.js';
let VenueContact,DialerLink,root,createRoot,dom,dir,requests;
const originalFetch=globalThis.fetch;
function setup(){dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});for(const key of ['window','document','navigator','HTMLElement','Event'])Object.defineProperty(globalThis,key,{value:dom.window[key],writable:true,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;}
before(async()=>{setup();({createRoot}=await import('react-dom/client'));const frontend=fileURLToPath(new URL('..',import.meta.url));dir=await mkdtemp(join(frontend,'node_modules/.contact-test-'));const outfile=join(dir,'contact.mjs');await build({entryPoints:[join(frontend,'src/VenueContact.jsx')],outfile,bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external'});({default:VenueContact,DialerLink}=await import(pathToFileURL(outfile).href));dom.window.close();});
after(async()=>{globalThis.fetch=originalFetch;await rm(dir,{recursive:true,force:true});});
beforeEach(()=>{setup();requests=[];globalThis.fetch=async(...args)=>{requests.push(args);throw Error('No network expected');};});
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=null;dom.window.close();});
const place=(phone,website='https://example.com')=>({entityId:'synthetic-venue',name:'Synthetic Venue',contact:shapeProviderContact({entity_id:'synthetic-venue',properties:{phone,website}},'qloo','2025-01-02T03:04:05Z')});
async function render(props,Component=VenueContact){await act(async()=>{if(!root)root=createRoot(document.getElementById('root'));root.render(React.createElement(Component,props));});}
test('reported international phone exposes exact venue and destination with dated evidence, never call execution',async()=>{await render({place:place('+233 (20) 123-4567')});const link=document.querySelector('a[href^="tel:"]');assert.equal(link.getAttribute('href'),'tel:+233201234567');assert.match(link.textContent,/Open dialer · Synthetic Venue · \+233201234567/);assert.match(document.body.textContent,/Source: Qloo · properties.phone/);assert.equal(document.querySelector('time').dateTime,'2025-01-02T03:04:05.000Z');assert.match(document.body.textContent,/Provider update time unknown/);assert.match(document.body.textContent,/Ownership and reachability unverified/);assert.match(document.body.textContent,/outdated/);assert.match(document.body.textContent,/WhatsApp support unknown/);link.addEventListener('click',event=>event.preventDefault());await act(async()=>link.click());assert.equal(requests.length,0);assert.match(document.body.textContent,/Nothing is called or booked/);assert.equal(document.querySelector('a[href*="wa.me"]'),null);});
for(const phone of [null,'0201234567','+233201234567;ext=1','tel:javascript:alert(1)'])test(`missing or unsafe number ${phone} has website/manual fallback only`,async()=>{await render({place:place(phone)});assert.equal(document.querySelector('a[href^="tel:"]'),null);assert.equal(document.querySelector('a').href,'https://example.com/');if(phone==='0201234567')assert.match(document.body.textContent,/Country context is missing/);assert.equal(requests.length,0);});
test('missing legacy provenance stays unknown and unsafe website is not linked',async()=>{await render({place:{name:'Legacy',links:{phone:'tel:+233201234567',website:'javascript:alert(1)'}}});assert.match(document.body.textContent,/Retrieval time unknown/);assert.doesNotMatch(document.body.textContent,/Source: Qloo/);assert.equal(document.querySelectorAll('a').length,1);});
test('reviewed contact cannot be silently replaced by newer destination or enabled before review',async()=>{await render({place:place('+233201234567'),contacts:{phone:'tel:+233209999999',website:null}});assert.equal(document.querySelector('a'),null);await render({place:place('+233201234567'),allowDial:false});assert.equal(document.querySelector('a[href^="tel:"]'),null);});
for(const direct of [false,true])test(`mismatched ${direct?'direct':'item'} contact cannot expose retained destinations`,async()=>{const item=place('+233201234567');const wrong={...item,entityId:'another-venue',links:{phone:'tel:+233201234567',website:'https://example.com'}};await render({place:direct?{...wrong,contact:undefined}:wrong,...(direct?{contact:item.contact}:{}),contacts:{phone:'tel:+233201234567',website:'https://example.com'}});assert.match(document.body.textContent,/Contact details do not match this venue/);assert.doesNotMatch(document.body.textContent,/No website or phone was supplied|233201234567|example.com/);assert.equal(document.querySelector('a'),null);assert.equal(requests.length,0);});
test('standalone dialer blocks direct mismatched evidence and an already-conflicting snapshot',async()=>{const item=place('+233201234567');await render({place:{...item,entityId:'another-venue'},contact:item.contact},DialerLink);assert.equal(document.querySelector('a'),null);await render({place:{...item,links:{phone:'tel:+233201234567'}},contact:{identityStatus:'conflicting'}},DialerLink);assert.equal(document.querySelector('a'),null);});

const checked=(overrides={})=>({entityId:'synthetic-venue',status:'match',sourceUrl:'https://example.com/contact',checkedAt:'2026-11-08T10:00:00Z',providerPhone:'+233201234567',candidates:[{kind:'phone',value:'+233201234567',url:'tel:+233201234567',sourceUrl:'https://example.com/contact',assignment:'venue',identityCue:'Synthetic Venue',comparison:'match',basis:'Published in contact text.'}],pages:[{url:'https://example.com/contact',status:'ok'}],ownershipVerified:false,reachabilityVerified:false,whatsappOptIn:false,...overrides});
const checkButton=()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Check website contacts');
async function checkWebsite(){await act(async()=>checkButton().click());}
test('guest website check is explicit, read-only and does not replace the dialer',async()=>{
  globalThis.fetch=async(...args)=>{requests.push(args);return new Response(JSON.stringify(checked({status:'conflict',candidates:[{...checked().candidates[0],value:'+233209999999',comparison:'conflict'}]})));};
  await render({place:place('+233201234567'),scope:{allowed:true,type:'guest'}});
  assert.equal(requests.length,0);await checkWebsite();assert.equal(requests.length,1);
  assert.equal(requests[0][0],'/api/places/synthetic-venue/contact-evidence');assert.equal(requests[0][1].method,undefined);assert.equal(requests[0][1].body,undefined);
  assert.match(document.body.textContent,/Website lists a different number; needs review/);assert.match(document.body.textContent,/233209999999/);
  assert.equal(document.querySelector('a[href^="tel:"]').getAttribute('href'),'tel:+233201234567');
  assert.match(document.body.textContent,/Publication does not verify ownership, reachability, availability or WhatsApp consent/);
  assert.ok([...document.querySelectorAll('time')].some(time=>time.dateTime==='2026-11-08T10:00:00.000Z'));
});
test('ambiguous contacts require manual review and unsafe URLs are never actionable',async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify(checked({status:'manual_review',sourceUrl:'javascript:alert(1)',candidates:[{...checked().candidates[0],kind:'whatsapp',url:'https://wa.me/233209999999',sourceUrl:'javascript:alert(2)',assignment:'manual_review'}],pages:[{url:'data:text/html,unsafe',status:'blocked'}]})));
  await render({place:place(null)});await checkWebsite();
  assert.match(document.body.textContent,/Venue identity is ambiguous/);assert.match(document.body.textContent,/Manual review required/);
  assert.equal(document.querySelector('a[href^="javascript:"],a[href^="data:"],a[href*="wa.me"],a[href^="tel:"]'),null);
});
for(const change of ['account','day','entity'])test(`late website evidence is discarded after ${change} changes`,async()=>{
  let resolve;
  globalThis.fetch=(...args)=>{requests.push(args);return new Promise(done=>{resolve=()=>done(new Response(JSON.stringify(checked())));});};
  const props={place:place(null),scope:{allowed:false,type:'day',id:'day-one'},context:'account-one'};
  await render(props);await checkWebsite();assert.equal(requests.length,1);
  const next=change==='account'?{...props,context:'account-two'}:change==='day'?{...props,scope:{...props.scope,id:'day-two'}}:{...props,place:{name:'Another Venue',entityId:'another-venue'}};
  await render(next);assert.equal(requests[0][1].signal.aborted,true);
  await act(async()=>resolve());assert.doesNotMatch(document.body.textContent,/Published phone matches|Published in contact text/);assert.equal(checkButton().disabled,false);assert.equal(requests.length,1);
});
test('read-only shared viewer can check and retry failures without changing booking permissions',async()=>{
  let fail=true;globalThis.fetch=async(...args)=>{requests.push(args);if(fail)throw Error('offline');return new Response(JSON.stringify(checked()));};
  await render({place:place(null),scope:{allowed:false,type:'day',id:'shared-day'}});await checkWebsite();
  assert.match(document.querySelector('[role="alert"]').textContent,/could not be checked/);assert.equal(checkButton().disabled,false);
  fail=false;await checkWebsite();assert.match(document.body.textContent,/Published phone matches/);assert.equal(document.querySelector('[role="alert"]'),null);assert.equal(requests.length,2);
});
test('response for another entity is rejected',async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify(checked({entityId:'different-venue'})));
  await render({place:place(null)});await checkWebsite();assert.match(document.body.textContent,/could not be checked/);assert.doesNotMatch(document.body.textContent,/Published phone matches/);
});
for(const status of ['missing','unavailable','website_only'])test(`website ${status} response remains qualified and never creates dialer actions`,async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify(checked({status,candidates:[],providerPhone:null})));
  await render({place:place(null)});await checkWebsite();
  assert.match(document.body.textContent,status==='missing'?/No usable contact information found/:status==='unavailable'?/Website contacts could not be checked/:/Contact information found on the website only/);
  assert.equal(document.querySelector('a[href^="tel:"],a[href*="wa.me"]'),null);assert.equal(checkButton().disabled,false);
});
test('closing the panel cancels a pending contact check',async()=>{
  let resolve;globalThis.fetch=(...args)=>{requests.push(args);return new Promise(done=>{resolve=()=>done(new Response(JSON.stringify(checked())));});};
  await render({place:place(null)});await checkWebsite();await act(async()=>root.unmount());root=null;
  assert.equal(requests[0][1].signal.aborted,true);await act(async()=>resolve());assert.equal(document.body.textContent,'');
});
test('normalized entity IDs are accepted and published booking destinations are review-only text',async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify(checked({entityId:'SYNTHETIC-VENUE',status:'website_only',candidates:[{kind:'booking',value:'Reservations',url:'https://reservations.example.com/book',sourceUrl:'https://example.com/contact',assignment:'manual_review',comparison:'not_comparable',basis:'Published link'}]})));
  await render({place:place(null)});await checkWebsite();
  assert.match(document.body.textContent,/Published destination \(review only\): https:\/\/reservations.example.com\/book/);assert.equal(document.querySelector('a[href*="reservations.example.com"]'),null);assert.equal(document.querySelector('[role="alert"]'),null);
});
for(const [name,malformed] of Object.entries({
  'null candidate':{candidates:[null]},
  'object pages':{pages:{length:1}},
  'null page':{pages:[null]},
  'object provider phone':{providerPhone:{text:'unsafe'}},
  'object candidate value':{candidates:[{...checked().candidates[0],value:{text:'unsafe'}}]},
  'object candidate basis':{candidates:[{...checked().candidates[0],basis:{text:'unsafe'}}]},
  'unknown candidate kind':{candidates:[{...checked().candidates[0],kind:'email'}]},
  'unknown assignment':{candidates:[{...checked().candidates[0],assignment:'verified'}]},
  'unknown comparison':{candidates:[{...checked().candidates[0],comparison:'verified'}]},
  'object page status':{pages:[{url:'https://example.com',status:{text:'unsafe'}}]},
  'excessive candidates':{candidates:Array.from({length:61},()=>checked().candidates[0])},
  'excessive pages':{pages:Array.from({length:11},()=>({url:'https://example.com',status:'read'}))},
  'excessive candidate text':{candidates:[{...checked().candidates[0],value:'x'.repeat(2049)}]},
}))test(`malformed website evidence (${name}) fails safely without rendering claims`,async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify(checked(malformed)));
  await render({place:place(null)});await checkWebsite();
  assert.match(document.querySelector('[role="alert"]').textContent,/could not be checked/);
  assert.doesNotMatch(document.body.textContent,/Published phone matches|Published in contact text/);
  assert.equal(checkButton().disabled,false);
});
