import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {resolveReservationHost,reservationGuardFailure,recordReservationGuardFailure} from '../src/reservation-dns.js';
import {browserSession,createReservationForms,reservationDiscoveryFailure} from '../src/reservation-form.js';
const transient=()=>Object.assign(Error('internal DNS details'),{code:'EAI_AGAIN'});
test('transient DNS failure retries same resolver once, nontransient does not',async()=>{
 let calls=0;const waits=[];const addresses=[{address:'93.184.216.34'}];
 assert.equal(await resolveReservationHost('example.com',{resolve:async host=>{assert.equal(host,'example.com');if(++calls===1)throw transient();return addresses;},wait:async ms=>waits.push(ms)}),addresses);
 assert.equal(calls,2);assert.deepEqual(waits,[300]);
 for(const code of ['EAI_AGAIN','ENOTFOUND']){
  calls=0;await assert.rejects(resolveReservationHost('example.com',{resolve:async()=>{calls++;throw Object.assign(Error(),{code});},wait:async()=>{}}),{code});assert.equal(calls,code==='EAI_AGAIN'?2:1);
 }
});
test('DNS deadline and cancellation remain bounded',async()=>{
 await assert.rejects(resolveReservationHost('example.com',{resolve:()=>new Promise(()=>{}),timeoutMs:5}),{code:'DNS_TIMEOUT'});
 const abort=new AbortController();abort.abort();
 await assert.rejects(resolveReservationHost('example.com',{signal:abort.signal,resolve:()=>assert.fail('cancelled lookup')}),{name:'AbortError'});
});
test('DNS failure aborts main request and private resolution is still blocked',async()=>{
 for(const mode of ['dns','private','literal','public']){
  const page=new EventEmitter(),calls=[];const frame={};
  Object.assign(page,{setViewport:async()=>{},setRequestInterception:async()=>{},evaluateOnNewDocument:async()=>{},mainFrame:()=>frame,close:async()=>{}});
  const browser={newPage:async()=>page,close:async()=>{}};
  await browserSession({connect:async()=>browser,resolve:async()=>{if(mode==='dns')throw Object.assign(Error(),{code:'ENOTFOUND'});return [{address:mode==='private'?'127.0.0.1':'93.184.216.34'}];}},async()=>{
   await page.listeners('request')[0]({url:()=> mode==='literal'?'https://127.0.0.1/':'https://example.com/',method:()=> 'GET',resourceType:()=> 'document',isNavigationRequest:()=>true,frame:()=>frame,abort:async()=>calls.push('abort'),continue:async()=>calls.push('continue')});
   assert.equal(reservationGuardFailure(page),mode==='dns'?'page_dns_failed':['private','literal'].includes(mode)?'page_unsafe_destination':undefined);return {};
  });
  assert.deepEqual(calls,[mode==='public'?'continue':'abort']);
 }
});
test('DNS main-navigation failure becomes truthful discovery error without raw resolver details',async()=>{
 const id='12345678-1234-1234-1234-123456789abc';
 const api=createReservationForms({config:{},places:{details:async()=>({entityId:id,contact:{website:{url:'https://example.com',source:{entityId:id,field:'properties.website'}}}})},run:async(_,job)=>{
  const page={goto:async()=>{recordReservationGuardFailure(page,'page_dns_failed');throw Error('net::ERR_FAILED resolver internal');}};return job(page);
 }});
 await assert.rejects(api.discover(id),error=>{const failure=reservationDiscoveryFailure(error);assert.equal(failure.code,'page_dns_failed');assert.match(failure.error,/resolve/);assert.doesNotMatch(failure.error,/internal|TLS|certificate/);return true;});
});

test('deadline expiring during retry wait does not start another DNS lookup',async()=>{
 let calls=0,finishWait;
 const pending=resolveReservationHost('example.com',{resolve:async()=>{calls++;throw transient();},timeoutMs:5,wait:()=>new Promise(r=>{finishWait=r;})});
 await assert.rejects(pending,{code:'DNS_TIMEOUT'});finishWait();await new Promise(r=>setImmediate(r));assert.equal(calls,1);
});
