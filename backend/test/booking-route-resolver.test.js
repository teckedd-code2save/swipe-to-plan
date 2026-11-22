import test from 'node:test';
import assert from 'node:assert/strict';
import {rankBookingCandidates,createBookingRouteResolver} from '../src/booking-route-resolver.js';
import {createContextFetchBookingSearch,configuredContextFetchBookingSearch} from '../src/contextfetch-booking-search.js';
import {createBookingWebsiteSearch} from '../src/booking-website-search.js';

const venue={name:'Front Back Accra',address:'Osu, Accra, Ghana'};
const id='12345678-1234-1234-1234-123456789ABC';
test('public ContextFetch defaults to keyless, can be disabled and uses a bounded REST contract',async()=>{
  assert.equal(configuredContextFetchBookingSearch({}).enabled,true);
  assert.equal(configuredContextFetchBookingSearch({CONTEXTFETCH_BOOKING_ENABLED:'false'}),null);
  let request;
  const search=createContextFetchBookingSearch({fetchImpl:async(url,options)=>{request={url,options};return new Response(JSON.stringify({results:[{title:'Front Back Accra booking',url:'https://tableagent.com/accra/front-back/',prunedContext:'Book a table in Osu'}]}));}});
  const rows=await search.search('Front Back Accra reservations');
  assert.equal(request.url,'https://api.contextfetch.dev/v1/search');
  assert.equal(request.options.headers.authorization,'Bearer keyless');
  assert.equal(request.options.redirect,'error');
  assert.deepEqual(JSON.parse(request.options.body),{query:'Front Back Accra reservations',numResults:10,userLocation:'GH',language:'en',contents:{text:false,highlights:true,pruned_context:true}});
  assert.equal(rows.length,1);
  assert.equal(rows[0].url,'https://tableagent.com/accra/front-back/');
});
test('ContextFetch quota, malformed responses and transport failures do not retry or leak internals',async()=>{
  let calls=0;
  for(const status of [402,429,500]){
    const api=createContextFetchBookingSearch({fetchImpl:async()=>{calls++;return new Response('',{status});}});
    await assert.rejects(api.search('booking'),e=>e.code===(status===402||status===429?'search_rate_limited':'search_failed'));
  }
  assert.equal(calls,3);
  await assert.rejects(createContextFetchBookingSearch({fetchImpl:async()=>new Response('{}')}).search('booking'),e=>e.code==='search_failed');
});
test('booking-page clues rank ahead of generic results without granting identity or availability',()=>{
  const ranked=rankBookingCandidates([
    {title:'Visit our city',url:'https://city.example/',description:'travel information'},
    {title:'Front Back Accra reservations',url:'https://tableagent.com/accra/front-back/',description:'Book a table in Osu'},
    {title:'Front Back Accra reservations',url:'https://tableagent.com/accra/front-back/#fragment',description:'duplicate'},
    {title:'Unsafe',url:'javascript:alert(1)',description:'book'}
  ],venue);
  assert.equal(ranked.length,2);
  assert.match(ranked[0].url,/tableagent/);
  assert.equal(ranked[0].evidence.ownership,'unverified');
  assert.equal(ranked[0].evidence.availability,'unknown');
});
test('inspection cache never crosses venue identity, ignores tokenized URLs, expires and rechecks form',()=>{
  let now=1000;
  const resolver=createBookingRouteResolver({now:()=>now,ttlMs:1000});
  assert.equal(resolver.remember(id,venue,'https://tableagent.com/accra/front-back/?auth=secret'),false);
  assert.deepEqual(resolver.reuse(id,venue),[]);
  assert.equal(resolver.remember(id,venue,'https://tableagent.com/accra/front-back/'),true);
  assert.equal(resolver.reuse(id,venue)[0].source,'previous_inspection');
  assert.deepEqual(resolver.reuse('other',venue),[]);
  assert.deepEqual(resolver.reuse(id,{...venue,address:'Kumasi, Ghana'}),[]);
  now=2000;
  assert.deepEqual(resolver.reuse(id,venue),[]);
});
test('resolver returns previously inspected lead without external search; selection remains explicit and venue-bound',async()=>{
  let calls=0,selected;
  const resolver=createBookingRouteResolver();
  resolver.remember(id,venue,'https://tableagent.com/accra/front-back/');
  const api=createBookingWebsiteSearch({
    places:{details:async()=>({entityId:id,...venue})}, routeResolver:resolver,
    search:{enabled:true,provider:'serper',search:async()=>{calls++;return [];}},
    registerDestination:(entityId,url)=>{selected={entityId,url};return {entityId,url};}
  });
  const found=await api.find(id,{});
  assert.equal(found.provider,'inspection_cache');
  assert.equal(calls,0);
  assert.equal(found.candidates.length,1);
  assert.equal(selected,undefined);
  assert.equal(found.candidates[0].evidence.ownership,'unverified');
  await assert.rejects(api.select('87654321-1234-1234-1234-123456789ABC',{candidateId:found.candidates[0].candidateId}),/expired/);
  await api.select(id,{candidateId:found.candidates[0].candidateId});
  assert.equal(selected.url,'https://tableagent.com/accra/front-back/');
});
test('ContextFetch is an explicitly selected provider and does not silently spend on another provider',async()=>{
  let other=0,used=0;
  const api=createBookingWebsiteSearch({
    places:{details:async()=>({entityId:id,...venue})},
    search:{enabled:true,provider:'serper',search:async()=>{other++;return [];}},
    contextfetch:{enabled:true,provider:'contextfetch',search:async()=>{used++;return [{title:'Front Back Accra book',url:'https://venue.example/book',description:'Osu reservations'}];}},
    registerDestination:()=>null
  });
  const found=await api.find(id,{});
  assert.equal(found.provider,'contextfetch');
  assert.equal(used,1);
  assert.equal(other,0);
  assert.equal(found.candidates.length,1);
});


test('form discovery follows two same-site booking hops but no additional unknown destinations',async()=>{
  const {createReservationForms}=await import('../src/reservation-form.js');
  const origin='https://venue.example/';
  const first=origin,second=origin+'reservations/',third=origin+'reservations/book/';
  let current='',visits=[];
  const form=[{index:0,action:third,method:'post',fields:[
    {elementIndex:0,name:'date',label:'Date',type:'date',required:true,visible:true,readOnly:false},
    {elementIndex:1,name:'time',label:'Time',type:'time',required:true,visible:true,readOnly:false}
  ]}];
  const page={
    goto:async target=>{current=target;visits.push(target);return {status:()=>200};},
    url:()=>current,
    evaluate:async fn=>{
      if(fn.name==='inspectForms')return current===third?structuredClone(form):[];
      if(fn.name==='inspectWixForms')return [];
      return current===first?[{url:second,label:'Reservations'}]:current===second?[{url:third,label:'Book a table'}]:[];
    }
  };
  const places={details:async()=>({entityId:id,...venue,contact:{website:{url:origin,source:{entityId:id,field:'properties.website'}}}})};
  const api=createReservationForms({places,config:{},previewConfig:null,run:async(_,job)=>job(page)});
  const found=await api.discover(id);
  assert.equal(found.status,'forms_found');
  assert.deepEqual(visits,[first,second,third]);
  assert.equal(found.submitted,false);
});
