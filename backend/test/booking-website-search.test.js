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
test('search has no app daily or per-minute quota',async()=>{
 let calls=0;const api=createBraveSearch({apiKey:'x',fetchImpl:async()=>{calls++;return new Response('{}');}});
 for(let i=0;i<105;i++)await api.search('q');assert.equal(calls,105);
});
test('search result candidates are safe transient leads, explicit entity-bound selection only',async()=>{
 let clock=0,query,registered;const api=createBookingWebsiteSearch({places,now:()=>clock,registerDestination:(entityId,url)=>{registered={entityId,url};return registered;},search:{enabled:true,search:async q=>{query=q;return [{title:'<b>Republic</b>',description:'<i>Official</i> website',url:'https://venue.example/#foo'},{title:'private',url:'https://127.0.0.1/'},{title:'http',url:'http://venue.example/'},{title:'dup',url:'https://venue.example/'}];}}});
 const found=await api.find(id,{});assert.equal(query,'Republic Bar Osu, Accra reservations book a table');assert.equal(registered,undefined);assert.equal(found.candidates.length,1);assert.equal(found.candidates[0].title,'Republic');assert.equal(found.candidates[0].snippet,'Official website');assert.equal(found.submitted,false);
 const candidateId=found.candidates[0].candidateId;await assert.rejects(api.select('87654321-1234-1234-1234-123456789ABC',{candidateId}),/expired/);await api.select(id,{candidateId});assert.equal(registered.url,'https://venue.example/');await assert.rejects(api.select(id,{candidateId}),/expired/);
 const again=await api.find(id,{});clock=180001;await assert.rejects(api.select(id,{candidateId:again.candidates[0].candidateId}),/expired/);
});
test('caller cannot inject queries/URLs, spoof provider identity or select after abort',async()=>{
 const api=createBookingWebsiteSearch({places,search:{enabled:true,search:async()=>[]},registerDestination:()=>assert.fail()});await assert.rejects(api.find(id,{query:'anything'}));await assert.rejects(api.find(id,{url:'https://evil.example'}));
 const bad=createBookingWebsiteSearch({places:{details:async()=>({entityId:'other',name:'Republic',address:'Osu'})},search:{enabled:true,search:()=>assert.fail()}});await assert.rejects(bad.find(id,{}),/provider_unavailable/);
 const signal=AbortSignal.abort();await assert.rejects(api.find(id,{},{signal}),/expired/);
});
test('oversized API response is rejected',async()=>{await assert.rejects(createBraveSearch({apiKey:'x',fetchImpl:async()=>new Response('x'.repeat(500001))}).search('q'),e=>e.code==='search_failed');});
test('search has no app concurrency quota or cooldown and does not retry provider failures',async()=>{
 const releases=[];let calls=0;const api=createBraveSearch({apiKey:'x',fetchImpl:async()=>{calls++;await new Promise(resolve=>releases.push(resolve));return new Response('{}');}});
 const pending=Array.from({length:5},()=>api.search('q'));assert.equal(calls,5);releases.forEach(release=>release());await Promise.all(pending);
 let blockedCalls=0;const limited=createBraveSearch({apiKey:'x',fetchImpl:async()=>{blockedCalls++;return new Response('',{status:429});}});await assert.rejects(limited.search('q'));assert.equal(blockedCalls,1);await assert.rejects(limited.search('q'));assert.equal(blockedCalls,2);
});
test('Serper uses fixed POST endpoint and original organic results only',async()=>{
 const {createSerperSearch}=await import('../src/booking-website-search.js');let request;
 const api=createSerperSearch({apiKey:'private-test-key',fetchImpl:async(url,options)=>{request={url,options};return new Response(JSON.stringify({organic:[{title:'Republic',link:'https://venue.example/',snippet:'Osu'}],knowledgeGraph:{website:'https://unreviewed.example/'}}));}});
 assert.equal(api.provider,'serper');assert.deepEqual(await api.search('Republic Osu'),[{title:'Republic',url:'https://venue.example/',description:'Osu'}]);
 assert.equal(request.url.href,'https://google.serper.dev/search');assert.equal(request.options.method,'POST');assert.equal(request.options.headers['X-API-KEY'],'private-test-key');assert.equal(request.options.redirect,'error');assert.deepEqual(JSON.parse(request.options.body),{q:'Republic Osu',num:6});assert.ok(!request.url.href.includes('private-test-key'));
});
test('Serper remains off without explicit flag; enabled missing key never falls through to Brave',async()=>{
 const {configuredWebsiteSearch}=await import('../src/booking-website-search.js');assert.equal(configuredWebsiteSearch({SERPER_API_KEY:'x'}),null);
 const api=configuredWebsiteSearch({SERPER_SEARCH_ENABLED:'true',BRAVE_SEARCH_ENABLED:'true',BRAVE_SEARCH_API_KEY:'y'});assert.equal(api.provider,'serper');assert.equal(api.enabled,false);await assert.rejects(api.search('q'),e=>e.code==='search_unavailable');
});
test('Serper protects credentials on failures without local request caps',async()=>{
 const {createSerperSearch}=await import('../src/booking-website-search.js');
 for(const [status,code]of [[401,'search_unavailable'],[403,'search_unavailable'],[429,'search_rate_limited'],[500,'search_failed']])await assert.rejects(createSerperSearch({apiKey:'secret',fetchImpl:async()=>new Response('',{status})}).search('q'),e=>e.code===code);
 await assert.rejects(createSerperSearch({apiKey:'secret',fetchImpl:async()=>{throw Error('secret');}}).search('q'),e=>e.message==='search_failed');
 let calls=0;const api=createSerperSearch({apiKey:'x',fetchImpl:async()=>{calls++;return new Response('{}');}});for(let i=0;i<105;i++)await api.search('q');assert.equal(calls,105);
});
test('Serper candidate response identifies source without verifying ownership',async()=>{
 const api=createBookingWebsiteSearch({places,search:{provider:'serper',enabled:true,search:async()=>[{title:'Republic',url:'https://venue.example/',description:'Osu'}]},registerDestination:()=>assert.fail()});
 const data=await api.find(id,{});assert.equal(data.provider,'serper');assert.equal(data.submitted,false);assert.equal(data.candidates.length,1);assert.equal(data.candidates[0].verified,undefined);
});
test('website search endpoints have no local request quota while retaining origin checks',async t=>{
 const {createApp}=await import('../src/app.js'),{createDemoProvider}=await import('../src/demo-provider.js'),http=await import('node:http');
 let calls=0;const reservationForms={enabled:true,findWebsites:async()=>{calls++;return {candidates:[]};},selectWebsite:async()=>{calls++;return {candidateId:'reviewed'};}};
 const server=createApp({provider:createDemoProvider(),reservationForms}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const request=(suffix,origin='http://127.0.0.1:5173')=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path:`/api/places/${id}/booking-websites${suffix}`,method:'POST',headers:{origin,'content-type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end('{}');});
 for(const suffix of ['', '/select'])for(let i=0;i<6;i++)assert.equal(await request(suffix),200);
 assert.equal(calls,12);assert.equal(await request('','https://other.example'),403);assert.equal(calls,12);
});

test('booking intent uses provider name and address without preferring an official site',async()=>{
 let query;const api=createBookingWebsiteSearch({places:{details:async()=>({entityId:id,name:'A Venue / Branch',address:'12 First Lane Example City Country'})},search:{enabled:true,provider:'serper',search:async q=>{query=q;return [{title:'Venue reservations',url:'https://booking.example/venue/',description:'Book a table'}];}},registerDestination:()=>assert.fail('must review candidate')});
 const result=await api.find(id,{});assert.equal(query,'A Venue / Branch 12 First Lane Example City Country reservations book a table');assert.equal(result.candidates[0].url,'https://booking.example/venue/');assert.equal(result.submitted,false);
});
