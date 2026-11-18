import test from 'node:test';
import assert from 'node:assert/strict';
import {createBraveSearch,createBookingWebsiteSearch} from '../src/booking-website-search.js';
const id='12345678-1234-1234-1234-123456789ABC';
const places={details:async()=>({entityId:id,name:'Republic Bar',address:'Osu, Accra'})};
test('API uses fixed endpoint and safe auth, original web results, bounded request config',async()=>{
 let request;const api=createBraveSearch({apiKey:'secret',fetchImpl:async(url,options)=>{request={url,options};return new Response(JSON.stringify({web:{results:[{title:'Republic',url:'https://example.com'}]}}));}});
 assert.equal((await api.search('Republic Osu')).length,1);assert.equal(request.url.origin,'https://api.search.brave.com');assert.equal(request.url.searchParams.get('count'),'6');assert.equal(request.options.redirect,'error');assert.equal(request.options.headers['X-Subscription-Token'],'secret');
});
test('no key, raw errors and HTTP errors produce safe distinct codes',async()=>{
 await assert.rejects(createBraveSearch({apiKey:''}).search('q'),e=>e.code==='search_unavailable');
 for(const [status,code]of [[401,'search_unavailable'],[429,'search_rate_limited'],[500,'search_failed']])await assert.rejects(createBraveSearch({apiKey:'x',fetchImpl:async()=>new Response('',{status})}).search('q'),e=>e.code===code);
 await assert.rejects(createBraveSearch({apiKey:'x',fetchImpl:async()=>{throw Error('secret');}}).search('q'),e=>e.message==='search_failed');
 await assert.rejects(createBraveSearch({apiKey:'x',fetchImpl:async()=>{throw Object.assign(Error('secret'),{name:'TimeoutError'});}}).search('q'),e=>e.code==='search_timeout');
});
test('request budget enforces minute and daily caps without remote calls',async()=>{
 let clock=0,calls=0;const api=createBraveSearch({apiKey:'x',now:()=>clock,fetchImpl:async()=>{calls++;return new Response('{}');}});
 for(let daybatch=0;daybatch<10;daybatch++){for(let i=0;i<10;i++)await api.search('q');await assert.rejects(api.search('q'),e=>e.code==='search_rate_limited');clock+=60001;}
 await assert.rejects(api.search('q'),e=>e.code==='search_rate_limited');assert.equal(calls,100);
});
test('search result candidates are safe transient leads, explicit entity-bound selection only',async()=>{
 let clock=0,query,registered;const api=createBookingWebsiteSearch({places,now:()=>clock,registerDestination:(entityId,url)=>{registered={entityId,url};return registered;},search:{enabled:true,search:async q=>{query=q;return [{title:'<b>Republic</b>',description:'<i>Official</i> website',url:'https://venue.example/#foo'},{title:'private',url:'https://127.0.0.1/'},{title:'http',url:'http://venue.example/'},{title:'dup',url:'https://venue.example/'}];}}});
 const found=await api.find(id,{});assert.equal(query,'Republic Bar Osu, Accra official website reservations');assert.equal(registered,undefined);assert.equal(found.candidates.length,1);assert.equal(found.candidates[0].title,'Republic');assert.equal(found.candidates[0].snippet,'Official website');assert.equal(found.submitted,false);
 const candidateId=found.candidates[0].candidateId;await assert.rejects(api.select('87654321-1234-1234-1234-123456789ABC',{candidateId}),/expired/);await api.select(id,{candidateId});assert.equal(registered.url,'https://venue.example/');await assert.rejects(api.select(id,{candidateId}),/expired/);
 const again=await api.find(id,{});clock=180001;await assert.rejects(api.select(id,{candidateId:again.candidates[0].candidateId}),/expired/);
});
test('caller cannot inject queries/URLs, spoof provider identity or select after abort',async()=>{
 const api=createBookingWebsiteSearch({places,search:{enabled:true,search:async()=>[]},registerDestination:()=>assert.fail()});await assert.rejects(api.find(id,{query:'anything'}));await assert.rejects(api.find(id,{url:'https://evil.example'}));
 const bad=createBookingWebsiteSearch({places:{details:async()=>({entityId:'other',name:'Republic',address:'Osu'})},search:{enabled:true,search:()=>assert.fail()}});await assert.rejects(bad.find(id,{}),/provider_unavailable/);
 const signal=AbortSignal.abort();await assert.rejects(api.find(id,{},{signal}),/expired/);
});
test('oversized API response is rejected',async()=>{await assert.rejects(createBraveSearch({apiKey:'x',fetchImpl:async()=>new Response('x'.repeat(500001))}).search('q'),e=>e.code==='search_failed');});
test('concurrency and provider rate-limit cooldown cap outbound calls',async()=>{
 const releases=[];let calls=0;const api=createBraveSearch({apiKey:'x',fetchImpl:async()=>{calls++;await new Promise(resolve=>releases.push(resolve));return new Response('{}');}});
 const first=api.search('q'),second=api.search('q');await assert.rejects(api.search('q'),e=>e.code==='search_rate_limited');assert.equal(calls,2);releases.forEach(release=>release());await Promise.all([first,second]);
 let blockedCalls=0;const limited=createBraveSearch({apiKey:'x',fetchImpl:async()=>{blockedCalls++;return new Response('',{status:429});}});await assert.rejects(limited.search('q'));await assert.rejects(limited.search('q'));assert.equal(blockedCalls,1);
});
