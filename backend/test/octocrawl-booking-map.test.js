import test from 'node:test';
import assert from 'node:assert/strict';
import {createOctocrawlBookingMap,configuredOctocrawlBookingMap} from '../src/octocrawl-booking-map.js';
import {createBookingWebsiteSearch} from '../src/booking-website-search.js';
import {createReservationForms} from '../src/reservation-form.js';

const id='12345678-1234-1234-1234-123456789ABC';
const origin='https://restaurant.example/';
const publicDns=async()=>[{address:'8.8.8.8'}];
const venue={entityId:id,name:'Test Restaurant',address:'Osu Accra',contact:{website:{url:origin+'?tracking=hidden',source:{entityId:id,field:'properties.website'}}}};
const envelope=(links,extra={})=>new Response(JSON.stringify({status:'completed',url:origin,sources:{startPage:{finalUrl:origin,status:'success'}},links,...extra}));
const href=(path,title)=>({url:new URL(path,origin).href,title,robots:'allowed'});

test('keyless site map sends only a Qloo-linked public origin and caches eligible links',async()=>{
 let calls=0;
 const map=createOctocrawlBookingMap({resolve:publicDns,fetchImpl:async(url,opts)=>{
  calls++;assert.equal(url,'https://api.octocrawl.dev/v1/map');assert.equal(opts.redirect,'error');assert.equal(opts.headers.authorization,undefined);
  assert.deepEqual(JSON.parse(opts.body),{url:origin,limit:24,timeout:3500});
  return envelope([href('/reservations','Reserve a table'),href('/reservations#duplicate'),href('/book?token=secret'),href('https://other.example/booking'),href('/photos'),{...href('/book'),robots:'disallowed'}]);
 }});
 assert.deepEqual((await map.find(venue,id)).map(r=>[r.url,r.source]),[[origin+'reservations','octocrawl']]);
 assert.equal((await map.find(venue,id)).length,1);
 assert.equal(calls,1);
 assert.deepEqual(await map.find({...venue,contact:{}},id),[]);
 assert.deepEqual(await map.find(venue,'OTHER'),[]);
 assert.equal(configuredOctocrawlBookingMap({OCTOCRAWL_BOOKING_ENABLED:'false'}),null);
});

test('rejects private DNS, cross-origin start redirect and provider expiry',async()=>{
 const request=()=>assert.fail('must not fetch');
 const local=createOctocrawlBookingMap({resolve:async()=>[{address:'8.8.8.8'},{address:'10.0.0.2'}],fetchImpl:request});
 assert.deepEqual(await local.find(venue,id),[]);
 const redirected=createOctocrawlBookingMap({resolve:publicDns,fetchImpl:async()=>envelope([href('/book')],{sources:{startPage:{finalUrl:'https://other.example/',status:'success'}}})});
 assert.deepEqual(await redirected.find(venue,id),[]);
 const abort=new AbortController();abort.abort();
 assert.deepEqual(await redirected.find(venue,id,{signal:abort.signal}),[]);
});

test('combines ContextFetch leads and mapped routes, and keeps map fallback on search quota',async()=>{
 for(const fails of [false,true]){
  const api=createBookingWebsiteSearch({places:{details:async()=>venue},registerDestination:(_id,url)=>url,
   contextfetch:{enabled:true,provider:'contextfetch',search:async()=>{if(fails)throw Object.assign(Error('quota'),{code:'search_rate_limited'});return [{url:'https://booking.example/reserve/',title:'Test Restaurant reservations',description:'Osu'}];}},
   siteMap:createOctocrawlBookingMap({resolve:publicDns,fetchImpl:async()=>envelope([href('/reservations','Reservations')])})});
  const result=await api.find(id,{});
  assert.equal(result.provider,fails?'octocrawl':'contextfetch');
  assert.equal(result.candidates.length,fails?1:2);
  const candidate=result.candidates.find(r=>r.source==='octocrawl');
  assert.equal(candidate.evidence.ownership,'unverified');
  assert.equal(result.submitted,false);
  assert.equal(await api.select(id,{candidateId:candidate.candidateId}),origin+'reservations');
 }
});

test('selected search lead can reach a form on its own site with existing guarded read-only discovery',async()=>{
 let current;const visited=[];
 const page={goto:async url=>{current=url;visited.push(url);return {status:()=>200};},url:()=>current,evaluate:async fn=>{
  if(fn.name==='inspectForms')return current===origin+'reservations'?[{index:0,action:current,method:'post',fields:[
   {elementIndex:0,name:'date',label:'Date',type:'date',visible:true},
   {elementIndex:1,name:'time',label:'Time',type:'time',visible:true}
  ]}]:[];
  if(fn.name==='inspectWixForms')return [];
  return current===origin?[{url:'https://unreviewed.example/booking',label:'Book elsewhere'},{url:origin+'reservations',label:'Reservations'}]:[];
 }};
 const api=createReservationForms({places:{details:async()=>venue},config:{},previewConfig:null,
  contextfetch:{enabled:true,provider:'contextfetch',search:async()=>[{url:origin,title:'Test Restaurant'}]},siteMap:null,
  run:async(_opts,job)=>job(page)});
 const result=await api.findWebsites(id,{});
 const selected=await api.selectWebsite(id,{candidateId:result.candidates[0].candidateId});
 assert.equal(visited.length,0);
 const inspected=await api.inspectDestination(id,{candidateId:selected.candidateId});
 assert.deepEqual(visited,[origin,origin+'reservations']);
 assert.equal(inspected.status,'forms_found');
 assert.equal(inspected.submitted,false);
});
