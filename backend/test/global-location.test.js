import test from 'node:test';
import assert from 'node:assert/strict';
import {createQlooClient} from '../src/qloo.js';
import {parseRequest} from '../src/contract.js';
import {parseItinerary,buildItinerary} from '../src/itinerary.js';
import {createDiscovery,rankPlaces,relaxationOptions} from '../src/plan.js';
import {createAgent} from '../src/agent.js';
import {calendarTimestamp,itineraryCalendar,daybookHtml} from '../../frontend/src/daybook.js';
const london={entity_id:'london',name:'London',disambiguation:'London, England, United Kingdom',location:{lat:51.50,lon:-.12}};
const response=localities=>({query:{localities:{filter:localities}},results:{entities:[{entity_id:'london-meal',name:'A London restaurant',tags:[{id:'urn:tag:category:place:restaurant'}],properties:{address:'A street in Westminster'},location:{lat:51.50,lon:-.12}}]}});

test('global locality filtering supplies boundary evidence and destination time zone without adding Ghana',async()=>{
  let sent;
  const client=createQlooClient({getKey:()=> 'test',fetchImpl:async url=>{sent=url;return {ok:true,json:async()=>response([london])};}});
  const plan=await buildItinerary(createDiscovery({provider:client}),parseItinerary({date:'2099-10-24',area:'London, United Kingdom',activities:['dinner'],budget:25,currency:'GBP'}));
  assert.equal(sent.searchParams.get('filter.location.query'),'London, United Kingdom');assert.equal(sent.searchParams.get('filter.location.radius'),'0');
  assert.equal(plan.status,'complete');assert.equal(plan.timeZone,'Europe/London');assert.equal(plan.provenance.locality.id,'london');
  assert.equal(plan.stops[0].item.reasons.find(r=>r.code==='location_match').evidence[0].method,'qloo_locality_filter');
  assert.equal(plan.budget.currency,'GBP');assert.equal(plan.budget.total,25);
  assert.ok(daybookHtml(plan).includes('GBP 25'));assert.ok(!daybookHtml(plan).includes('GH₵'));
  assert.equal(relaxationOptions(parseRequest({area:'London'})).some(o=>o.code==='widen_area'),false);
});

test('ambiguous, mismatched and unresolved localities never silently become another city',async()=>{
  for(const [localities,area] of [[[london,london],'London'],[[london],'London, Canada']]){
    const provider=createQlooClient({getKey:()=> 'test',fetchImpl:async()=>({ok:true,json:async()=>response(localities)})});
    await assert.rejects(provider.discover({signalIds:[],area}),e=>e.code==='location_ambiguous'&&e.status===400);
  }
  const provider=createQlooClient({getKey:()=> 'test',fetchImpl:async()=>({ok:false,status:400,json:async()=>({error:'No locality found'})})});
  await assert.rejects(provider.discover({signalIds:[],area:'Unknown city'}),e=>e.code==='location_not_found');
  const request=parseRequest({area:'Tokyo, Japan',intent:'dinner'});
  assert.equal(rankPlaces(response([london]).results.entities,request).ranked.length,0);
  assert.equal(parseItinerary({area:'渋谷区, 東京都, 日本',currency:'JPY',budget:10000}).area,'渋谷区, 東京都, 日本');
  for(const input of [{area:''},{area:'x'.repeat(161)},{currency:'XYZ'},{budget:0},{budget:10000001}])assert.throws(()=>parseItinerary(input),e=>e.status===400);
});

test('moving the day preserves its money and participants unless currency is explicitly changed',async()=>{
  let args={area:'Tokyo, Japan'};
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'revise_day',arguments:JSON.stringify(args)}}]}}]})})});
  const context=parseItinerary({people:[{id:'sam',name:'Sam',artists:['SZA']}],activities:['dinner'],currency:'USD',budget:100});
  const moved=await agent.interpret({message:'Move it to Tokyo',context});assert.equal(moved.request.currency,'USD');assert.equal(moved.request.budget,100);assert.deepEqual(moved.request.people,context.people);
  args={area:'Tokyo, Japan',currency:'JPY',budget:10000};const changed=await agent.interpret({message:'Use ten thousand yen',context});assert.equal(changed.request.currency,'JPY');assert.equal(changed.request.budget,10000);
});

test('calendar exports honor destination daylight saving and reject ambiguous or missing zones',()=>{
  assert.equal(calendarTimestamp('2026-07-01','11:00','America/New_York'),'20260701T150000Z');
  assert.equal(calendarTimestamp('2026-01-01','11:00','America/New_York'),'20260101T160000Z');
  assert.equal(calendarTimestamp('2026-07-01','11:00','Asia/Tokyo'),'20260701T020000Z');
  assert.throws(()=>calendarTimestamp('2026-03-08','02:30','America/New_York'),/clock change/);
  assert.throws(()=>calendarTimestamp('2026-11-01','01:30','America/New_York'),/clock change/);
  assert.throws(()=>itineraryCalendar({request:{area:'Tokyo, Japan'}}),/time zone/);
});

const locationEntity={...london,entity_id:'4F18635D-75D6-43EC-B8B9-8DFAEB8C5A29',types:['urn:entity:locality'],properties:{place:'city',ancestors:[{place:'country',name:'United Kingdom'}]}};
test('location search returns real locality choices, infers local currency and reuses bounded results',async()=>{
  let calls=0;
  const client=createQlooClient({getKey:()=> 'test',fetchImpl:async url=>{calls++;assert.equal(url.searchParams.get('types'),'urn:entity:locality');return {ok:true,json:async()=>({results:[locationEntity,{...locationEntity,types:['urn:entity:artist']}]})};}});
  const choices=await client.searchLocations('London');assert.equal(choices.length,1);assert.equal(choices[0].currency,'GBP');assert.equal(choices[0].countryCode,'GB');
  assert.equal(choices[0].timeZone,'Europe/London');assert.deepEqual(await client.searchLocations('London'),choices);assert.deepEqual(await client.getLocation(choices[0].id),choices[0]);assert.equal(calls,1);
  await assert.rejects(client.getLocation('invented'),e=>e.status===400);
});

test('selected locality ID, local currency and custom currency reach planning without text rematching',async()=>{
  const urls=[];
  const client=createQlooClient({getKey:()=> 'test',fetchImpl:async url=>{urls.push(url);return {ok:true,json:async()=>url.pathname==='/entities'?{results:[locationEntity]}:response([])};}});
  const discovery=createDiscovery({provider:client});
  const request=parseItinerary({date:'2099-10-24',area:'Old area label',locationId:locationEntity.entity_id,currency:'GHS',currencyMode:'local',budget:100,activities:['dinner']});
  const plan=await buildItinerary(discovery,request);assert.equal(plan.request.area,locationEntity.disambiguation);assert.equal(plan.budget.currency,'GBP');assert.equal(plan.budget.total,100);assert.equal(plan.status,'complete');
  const insights=urls.find(u=>u.pathname==='/v2/insights');assert.equal(insights.searchParams.get('filter.location'),locationEntity.entity_id);assert.equal(insights.searchParams.has('filter.location.query'),false);
  const beforeBudgetChange=urls.length;
  const custom=await buildItinerary(discovery,{...request,currency:'USD',currencyMode:'custom'});assert.equal(custom.budget.currency,'USD');assert.equal(urls.length,beforeBudgetChange,'budget-only changes reuse locality results');
});

test('agent asks for planning area before discovery, retains the proposed brief and supports default intent',async()=>{
  let name='revise_day',args={activities:['dinner']};
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name,arguments:JSON.stringify(args)}}]}}]})})});
  const context={...parseItinerary({people:[{id:'sam',name:'Sam',artists:['SZA']}]}),area:''};
  const first=await agent.interpret({message:'Just one place please',context,locationContext:{confirmed:false}});assert.equal(first.action,'set_location');assert.equal(first.request.area,'');assert.deepEqual(first.request.activities,['dinner']);assert.deepEqual(first.request.people,context.people);
  name='set_location';args={query:'Kumasi',scope:'default'};
  const saved=await agent.interpret({message:'Always use Kumasi',context,locationContext:{confirmed:false}});assert.equal(saved.scope,'default');assert.equal(saved.query,'Kumasi');
  name='revise_day';args={area:'London'};
  const changed=await agent.interpret({message:'Move it to London',context:{...context,area:'Paris',currency:'EUR'},locationContext:{confirmed:true}});assert.equal(changed.action,'set_location');assert.equal(changed.request.currencyMode,'local');assert.equal(changed.scope,'plan');
});

test('locality country handling supports non-English names without guessing a currency on ambiguity',async()=>{
  const {locationOption}=await import('../src/locations.js');
  const japan=locationOption({...locationEntity,name:'渋谷',properties:{ancestors:[{place:'country',name:'日本'}]},location:{lat:35.66,lon:139.70},disambiguation:'渋谷, 日本'});
  assert.equal(japan.currency,'JPY');assert.equal(japan.countryCode,'JP');
  const unknown=locationOption({...locationEntity,properties:{},location:null});assert.equal(unknown.currency,null);
  const tokyo=locationOption({...locationEntity,name:'東京都',disambiguation:'東京都',location:{lat:29.9895,lon:140.7677},properties:{akas:[{language:'io',value:'Tokyo'}],boundaries:'POLYGON((139.70 35.66,139.71 35.67,139.70 35.66))'}});
  assert.equal(tokyo.timeZone,'Asia/Tokyo');assert.equal(tokyo.currency,'JPY');assert.equal(tokyo.countryCode,'JP');
  const sharedZone=locationOption({...locationEntity,name:'An unnamed island',properties:{},location:{lat:35.66,lon:139.70}});
  assert.equal(sharedZone.currency,null,'shared clock rules alone cannot establish country');
});

test('confirming a new area retains the entire single-stop request and explicit currency choice',async()=>{
  const args={query:'Kumasi',activities:['dinner'],budget:300,currency:'USD',date:'2026-10-25',startTime:'13:00',endTime:'15:00',party:{children:1}};
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'set_location',arguments:JSON.stringify(args)}}]}}]})})});
  const context=parseItinerary({people:[{id:'sam',name:'Sam',artists:['SZA']}],activities:['coffee','dinner'],pins:{coffee:'qloo:coffee',dinner:'qloo:meal'},excludeIds:['qloo:skip']});
  const result=await agent.interpret({message:'Just one meal in Kumasi for 300 US dollars tomorrow at 1 with a child',context,locationContext:{confirmed:false}});
  assert.equal(result.action,'set_location');assert.deepEqual(result.request.activities,['dinner']);assert.equal(result.request.budget,300);assert.equal(result.request.currency,'USD');assert.equal(result.request.currencyMode,'custom');
  assert.equal(result.request.date,args.date);assert.equal(result.request.startTime,'13:00');assert.deepEqual(result.request.party,{adults:2,children:1});assert.deepEqual(result.request.people,context.people);assert.deepEqual(result.request.pins,{dinner:'qloo:meal'});assert.deepEqual(result.request.excludeIds,['qloo:skip']);
});

