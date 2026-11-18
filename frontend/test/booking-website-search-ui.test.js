import test,{before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
let Component,root,createRoot,dom,dir,requests,selected,response;
const originalFetch=globalThis.fetch;
function setup(){dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});for(const key of ['window','document','navigator','localStorage','sessionStorage','HTMLElement','Event'])Object.defineProperty(globalThis,key,{value:dom.window[key],writable:true,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;}
before(async()=>{setup();({createRoot}=await import('react-dom/client'));const frontend=fileURLToPath(new URL('..',import.meta.url));dir=await mkdtemp(join(frontend,'node_modules/.website-test-'));const outfile=join(dir,'search.mjs');await build({entryPoints:[join(frontend,'src/BookingWebsiteSearch.jsx')],outfile,bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external'});({default:Component}=await import(pathToFileURL(outfile).href));dom.window.close();});
after(async()=>{globalThis.fetch=originalFetch;await rm(dir,{recursive:true,force:true});});
beforeEach(()=>{setup();requests=[];selected=null;response={venueName:'Venue',venueAddress:'Osu, Accra',expiresAt:new Date(Date.now()+180000).toISOString(),candidates:[{candidateId:'candidate',title:'Venue site',url:'https://venue.example/',snippet:'Restaurant in Osu'}]};globalThis.fetch=async(url,options={})=>{requests.push({url,body:JSON.parse(options.body||'{}')});return new Response(JSON.stringify(url.endsWith('/select')?{candidateId:'bound-destination'}:response));};});
afterEach(async()=>{await act(async()=>root?.unmount());root=null;dom.window.close();});
async function render(){root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(Component,{snapshot:{entityId:'venue',name:'Venue'},onSelected:async value=>{selected=value;},onCancel:()=>{}})));}
test('candidate requires explicit selection and location review before scoped destination',async()=>{await render();assert.equal(requests.length,1);assert.equal(document.querySelector('a[target="_blank"]'),null);await act(async()=>document.querySelector('input[type=radio]').click());let button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Open selected'));assert.equal(button.disabled,true);await act(async()=>document.querySelector('input[type=checkbox]').click());await act(async()=>button.click());assert.deepEqual(requests[1].body,{candidateId:'candidate'});assert.deepEqual(selected,{candidateId:'bound-destination'});});
test('unconfigured search is honest and makes no browser or automatic retry requests',async()=>{globalThis.fetch=async(url)=>{requests.push({url});return new Response(JSON.stringify({code:'search_unavailable',error:'In-app search is not configured.'}),{status:422});};await render();assert.match(document.body.textContent,/not configured/);assert.equal(requests.length,1);assert.equal([...document.querySelectorAll('button')].some(b=>b.textContent==='Search again'),false);assert.ok(document.querySelector('a[target="_blank"]'));});
test('expired candidate results leave no selectable stale links',async()=>{response.expiresAt=new Date(Date.now()-1000).toISOString();await render();await act(async()=>new Promise(r=>setTimeout(r,5)));assert.equal(document.querySelector('input[type=radio]'),null);assert.match(document.body.textContent,/results expired/);});
