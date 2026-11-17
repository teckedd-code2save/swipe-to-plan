import test,{before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
let Preview,root,createRoot,dom,dir,requests,props,hold,interactive;
const originalFetch=globalThis.fetch;
function setup(){dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});for(const key of ['window','document','navigator','localStorage','sessionStorage','HTMLElement','HTMLInputElement','Event'])Object.defineProperty(globalThis,key,{value:dom.window[key],writable:true,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;}
before(async()=>{setup();({createRoot}=await import('react-dom/client'));const frontend=fileURLToPath(new URL('..',import.meta.url));dir=await mkdtemp(join(frontend,'node_modules/.form-test-'));const outfile=join(dir,'form.mjs');await build({entryPoints:[join(frontend,'src/ReservationFormPreview.jsx')],outfile,bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external'});({default:Preview}=await import(pathToFileURL(outfile).href));dom.window.close();});
after(async()=>{globalThis.fetch=originalFetch;await rm(dir,{recursive:true,force:true});});
beforeEach(()=>{setup();requests=[];hold=false;interactive=false;props={enabled:true,snapshot:{entityId:'test-venue',name:'Test venue',date:'2026-12-01',localTime:'19:00',party:{adults:2,children:0}},message:'Our real edited request'};globalThis.fetch=async(url,options={})=>{const request={url,options,body:options.body?JSON.parse(options.body):null};requests.push(request);if(hold&&url.includes('/preview'))await new Promise(resolve=>{request.resolve=resolve;});return new Response(JSON.stringify(url.endsWith('/capabilities')?{reservationFormPreview:true}:url.endsWith('/preview')?{...(interactive?{liveViewUrl:'https://live.browser.run/session?token=private',previewId:'e81234ab-4123-4123-8123-123456789abc',expiresAt:new Date(Date.now()+60000).toISOString()}:{}),status:'filled',submitted:false,sourceUrl:'https://example.com/book',fields:[{label:'Visit date',value:request.body.fields.date,status:'filled'}]}:{status:'found',sourceUrl:'https://example.com/book',previewAvailable:true,forms:[{id:'form-1',fields:[{id:'date',label:'Visit date',type:'date',semantic:'date'},{id:'name',label:'Name',type:'text',semantic:'name'}]}]}));};});
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=null;dom.window.close();});
async function render(next={}){props={...props,...next};await act(async()=>{if(!root)root=createRoot(document.getElementById('root'));root.render(React.createElement(Preview,props));});}
const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent===text);
async function click(text){assert.ok(button(text),text);await act(async()=>button(text).click());}
test('feature off makes no request; capability off hides preview',async()=>{await render({enabled:false});assert.equal(requests.length,0);assert.equal(document.body.textContent,'');globalThis.fetch=async()=>new Response('{}');await render({enabled:true});assert.equal(document.body.textContent,'');});
test('discovery uses no personal details; filling requires consent and sends only displayed values',async()=>{await render();await click('Find booking form');assert.equal(requests[1].body,null);assert.equal(document.querySelector('input[type=date]').value,'2026-12-01');assert.equal(button('Fill form without submitting').disabled,true);await act(async()=>document.querySelector('input[type=checkbox]').click());await click('Fill form without submitting');assert.deepEqual(requests.at(-1).body,{formId:'form-1',fields:{date:'2026-12-01',name:''},consent:true});assert.match(document.body.textContent,/Prepared for review · not submitted/);assert.equal(button('Submit'),undefined);});
test('close aborts pending preview and ignores a late completion',async()=>{await render();await click('Find booking form');await act(async()=>document.querySelector('input[type=checkbox]').click());hold=true;await click('Fill form without submitting');const pending=requests.at(-1);await click('Close form preview');assert.equal(pending.options.signal.aborted,true);await act(async()=>pending.resolve());assert.doesNotMatch(document.body.textContent,/Prepared for review/);assert.equal(document.querySelector('input[type=date]'),null);});
test('changed visit details discard consent and the old form',async()=>{await render();await click('Find booking form');await act(async()=>document.querySelector('input[type=checkbox]').click());await render({snapshot:{...props.snapshot,date:'2026-12-02'}});assert.equal(document.querySelector('input[type=checkbox]'),null);assert.equal(button('Fill form without submitting'),undefined);});

test('interactive preview shows a secure handoff and closes its lease when dismissed',async()=>{
 interactive=true;await render();await click('Find booking form');await act(async()=>document.querySelector('input[type=checkbox]').click());await click('Fill form without submitting');
 const link=[...document.querySelectorAll('a')].find(a=>a.textContent==='Open filled form');assert.ok(link);assert.equal(link.rel,'noopener noreferrer');assert.equal(link.target,'_blank');assert.equal(localStorage.length,0);
 await click('Close form preview');const close=requests.find(r=>r.url.endsWith('/close'));assert.deepEqual(close.body,{previewId:'e81234ab-4123-4123-8123-123456789abc'});assert.equal(close.options.keepalive,true);assert.equal(document.querySelector('a[href^="https://live.browser.run"]'),null);
});
test('interactive preview closes on replacement and unmount',async()=>{
 interactive=true;await render();await click('Find booking form');await act(async()=>document.querySelector('input[type=checkbox]').click());await click('Fill form without submitting');await click('Find booking form');assert.equal(requests.filter(r=>r.url.endsWith('/close')).length,1);
 await act(async()=>document.querySelector('input[type=checkbox]').click());await click('Fill form without submitting');await act(async()=>root.unmount());root=null;assert.equal(requests.filter(r=>r.url.endsWith('/close')).length,2);
});
test('a late cancelled fill result closes any returned interactive lease',async()=>{
 interactive=true;await render();await click('Find booking form');await act(async()=>document.querySelector('input[type=checkbox]').click());hold=true;await click('Fill form without submitting');const pending=requests.at(-1);await click('Close form preview');await act(async()=>pending.resolve());assert.equal(requests.filter(r=>r.url.endsWith('/close')).length,1);assert.equal(document.querySelector('a[href^="https://live.browser.run"]'),null);
});
test('editing actual form values closes the prior interactive preview and clears consent',async()=>{
 interactive=true;await render();await click('Find booking form');await act(async()=>document.querySelector('input[type=checkbox]').click());await click('Fill form without submitting');
 await act(async()=>{const input=document.querySelector('input[type=date]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2026-12-02');input.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(requests.filter(r=>r.url.endsWith('/close')).length,1);assert.equal(document.querySelector('input[type=checkbox]').checked,false);assert.equal(document.querySelector('a[href^="https://live.browser.run"]'),null);
});
test('published partner can be inspected with no native form and without sending personal fields',async()=>{
 const normal=globalThis.fetch;globalThis.fetch=async(url,options={})=>{
  if(url.endsWith('/reservation-form')){requests.push({url,options,body:null});return new Response(JSON.stringify({status:'no_supported_form',forms:[],sourceUrl:'https://example.com',unsupported:['embedded_forms'],candidates:[{id:'e81234ab-4123-4123-8123-123456789abc',url:'https://booking.example.com/venue',label:'Book a table',relationship:'booking_partner'}]}));}
  return normal(url,options);
 };
 await render();await click('Find booking form');assert.match(document.body.textContent,/External booking provider/);assert.match(document.body.textContent,/booking form is embedded/);assert.equal(button('Fill form without submitting'),undefined);
 await click('Inspect this booking page');const destination=requests.find(r=>r.url.endsWith('/destination'));assert.deepEqual(destination.body,{candidateId:'e81234ab-4123-4123-8123-123456789abc'});assert.equal(document.querySelector('input[type=checkbox]').checked,false);assert.equal(button('Fill form without submitting').disabled,true);assert.equal(document.querySelector('input[type=date]').value,'2026-12-01');
});
test('untimed enquiry can discover forms but cannot fill and offers timing action',async()=>{
 let timing=0;await render({fillAllowed:false,onTiming:()=>{timing++;},snapshot:{...props.snapshot,date:null,localTime:null}});
 assert.ok(button('Find booking form'));assert.ok(button('Set visit time'));await click('Find booking form');assert.equal(document.querySelector('input[type=checkbox]').disabled,true);assert.equal(button('Fill form without submitting').disabled,true);assert.match(document.body.textContent,/You can find the form now/);
 await click('Set visit time');assert.equal(timing,1);assert.equal(requests.some(r=>r.url.endsWith('/preview')),false);
 await render({fillAllowed:true,snapshot:{...props.snapshot,date:'2026-12-01',localTime:'19:00'}});await click('Find booking form');assert.equal(document.querySelector('input[type=checkbox]').disabled,false);assert.equal(document.querySelector('input[type=checkbox]').checked,false);
});
test('discovery renders actual streamed frames read-only and clears them on close',async()=>{
 const normal=globalThis.fetch;let streamController;globalThis.fetch=async(url,options={})=>{
  if(!url.endsWith('/reservation-form'))return normal(url,options);
  requests.push({url,options});return new Response(new ReadableStream({start(c){streamController=c;}}),{headers:{'content-type':'application/x-ndjson'}});
 };
 await render();await click('Find booking form');assert.equal(requests.at(-1).options.headers.accept,'application/x-ndjson');
 await act(async()=>{streamController.enqueue(new TextEncoder().encode('{"type":"progress","stage":"loading"}\n{"type":"frame","imageDataUrl":"data:image/jpeg;base64,YQ=="}\n'));});
 const panel=document.querySelector('[aria-label="Read-only browser view"]');assert.match(panel.textContent,/Opening the venue website/);assert.ok(panel.querySelector('img'));assert.equal(panel.querySelector('iframe'),null);
 await click('Close form preview');assert.equal(document.querySelector('[aria-label="Read-only browser view"]'),null);
 await act(async()=>{streamController.enqueue(new TextEncoder().encode('{"type":"result","result":{"status":"no_supported_form","forms":[]}}\n'));streamController.close();});
 assert.equal(document.querySelector('[aria-label="Read-only browser view"]'),null);
});

test('capability failure keeps discovery visible but gated and retry recovers',async()=>{
 const normal=globalThis.fetch;let attempts=0;globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/capabilities')&&attempts++===0)throw new Error('Temporary network failure');
  return normal(url,options);
 };
 await render();assert.equal(button('Find booking form').disabled,true);assert.match(document.body.textContent,/Could not check/);
 await click('Find booking form');assert.equal(requests.length,0);
 await click('Retry availability check');assert.equal(button('Find booking form').disabled,false);assert.equal(button('Retry availability check'),undefined);
 await click('Find booking form');assert.ok(requests.some(r=>r.url.endsWith('/reservation-form')));
});
test('capability loading is visible and disabled; retry respects disabled capability',async()=>{
 let resolve;globalThis.fetch=async()=>new Promise(done=>{resolve=done;});
 await render();assert.match(document.body.textContent,/Checking whether/);assert.equal(button('Find booking form').disabled,true);
 await act(async()=>resolve(new Response('{}')));assert.equal(document.body.textContent,'');
});
test('failed capability retry can resolve disabled without enabling discovery',async()=>{
 let attempts=0;globalThis.fetch=async()=>{if(attempts++===0)throw new Error('offline');return new Response('{"reservationFormPreview":false}');};
 await render();await click('Retry availability check');assert.equal(document.body.textContent,'');assert.equal(attempts,2);
});
test('unmount aborts capability lookup and ignores late availability',async()=>{
 let resolve,signal;globalThis.fetch=async(url,options)=>{signal=options.signal;return new Promise(done=>{resolve=done;});};
 await render();await act(async()=>root.unmount());root=null;assert.equal(signal.aborted,true);
 await act(async()=>resolve(new Response('{"reservationFormPreview":true}')));assert.equal(document.body.textContent,'');
});
