import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {shapeProviderContact} from '../../shared/venue-contact.js';
import {createDayDetailsApi, dayMapsUrl, dayRouteLegs, detailMoney, detailScopeKey, enquiryDraft, normalizeVenueReport, readinessData, reservationEligible, venueDetailsData, visitDetailsData} from '../src/day-details.js';

const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const stamp = '2026-11-09T10:00:00.000Z';
const place = () => ({id:`qloo:${id}`, entityId:id, name:'The Garden', address:'Oxford Street, Accra', description:'A leafy restaurant.', facts:{price:{level:2,status:'provider_reported'}}, links:{menu:'https://venue.example/menu'}, provenance:{provider:'qloo',entityId:id,retrievedAt:stamp}, contact:shapeProviderContact({entity_id:id,properties:{phone:'+233 20 123 4567',website:'https://venue.example'}}, 'qloo', stamp)});
const stop = () => ({id:'visit-one', intent:'dinner', item:place(), alternatives:[], start:'18:00', end:'19:00', connections:[{personId:'you',kind:'search_signal',label:'Discovery signal'}]});
const plan = () => ({phase:'scheduled', request:{date:'2026-11-12', timing:{dateConfirmed:true,timeConfirmed:true}, party:{adults:2,children:1}, budget:600,currency:'GHS',people:[{id:'you',name:'You'}]}, stops:[stop()], budget:{total:600,allocations:[{stopId:'visit-one',intent:'dinner',amount:300}],transport:100,reserve:200}, provenance:{retrievedAt:stamp},timeZone:'Africa/Accra'});
const result = () => ({date:'2026-11-12', checkedAt:stamp, stops:[{entityId:id,start:'18:00',end:'19:00',place:place(),hours:{status:'fits_reported_hours',summary:'Your stop fits reported weekly hours.',intervals:[{opens:'10:00',closes:'22:00',overnight:false}]}}]});

test('richer optional evidence is bounded and safe for JSX', () => {
  const data = venueDetailsData({...place(),description:{malicious:true},tagNames:['Leafy',{x:1},'Leafy'], highlights:['Stew'], practicalTags:['Outdoor seating'], hours:{monday:[{opens:'10:00',closes:'22:00',overnight:false}],tuesday:[],wednesday:[{opens:{},closes:'bad',overnight:false}]}});
  assert.equal(data.description, ''); assert.equal(venueDetailsData({...place(),image:'https://cdn.example/venue.jpg'}).imageUrl,'https://cdn.example/venue.jpg'); assert.equal(venueDetailsData({...place(),image:'javascript:bad()'}).imageUrl,null); assert.deepEqual(data.tags,['Leafy']); assert.deepEqual(data.highlights,['Stew']); assert.equal(data.hours.length,2); assert.equal(data.hours[1].label,'Reported closed');
  assert.equal(data.price,'Mid price band'); assert.equal(data.dialUrl,'tel:+233201234567'); assert.equal(data.websiteUrl,'https://venue.example/'); assert.equal(data.refreshable,true);
  for (const value of [null, {}, {facts:{price:{level:Infinity}}}, {name:12}, {contact:{phone:[]}}, {hours:{monday:'unverified'}}]) assert.doesNotThrow(() => venueDetailsData(value));
});
test('contact identity conflicts disable destinations instead of falling back to old links', () => {
  const value = place(); value.contact.phone.source.entityId=otherId; value.links.website='https://wrong.example'; value.links.phone='tel:+233201234567';
  const data=venueDetailsData(value); assert.equal(data.conflicting,true); assert.equal(data.websiteUrl,null); assert.equal(data.dialUrl,null);
  assert.equal(venueDetailsData({...place(),contact:{identityStatus:'conflicting'}}).conflicting,true);
});
test('local-only phone never gets a guessed country prefix or dialer link', () => {
  const value=place(); value.contact=shapeProviderContact({entity_id:id,properties:{phone:'020 123 4567',website:'javascript:evil()'}}, 'qloo', stamp);
  const data=venueDetailsData(value); assert.equal(data.phoneNeedsCountry,true); assert.equal(data.dialUrl,null); assert.equal(data.websiteUrl,null);
  assert.equal(venueDetailsData({...place(),links:{menu:'https://user:password@example.com/menu'}}).menuUrl,null);
});
test('exact visit identity gates allowances and individual connections for alternatives', () => {
  const value=plan(), current=value.stops[0];
  assert.equal(visitDetailsData(current,value).connections[0].evidence[0].label,'Used to discover this place; not a confirmed individual match.');
  assert.ok(visitDetailsData(current,value).allowance);
  const alternative={...current,item:{...place(),id:`qloo:${otherId}`,entityId:otherId}};
  assert.equal(visitDetailsData(alternative,value).selected,false); assert.equal(visitDetailsData(alternative,value).allowance,null); assert.deepEqual(visitDetailsData(alternative,value).connections,[]);
});
test('repeated intent allowances use occurrence IDs, not first category match', () => {
  const value=plan(); value.stops.push({...stop(),id:'visit-two',start:'20:00',end:'21:00'}); value.budget.allocations=[{intent:'dinner',amount:300}];
  assert.equal(visitDetailsData(value.stops[1],value).allowance,null);
  value.budget.allocations.push({stopId:'visit-two',intent:'dinner',amount:120});
  assert.match(visitDetailsData(value.stops[1],value).allowance,/120/);
});
test('routes preserve ordered visits and never include a current-location origin', () => {
  const value=plan(); value.stops.push({...stop(),id:'second',item:{...place(),name:'Other cafe',address:'Other Street'}}); value.stops.push({...stop(),id:'third'});
  const url=new URL(dayMapsUrl(value,'walking'));
  assert.equal(url.origin,'https://www.google.com'); assert.equal(url.searchParams.get('travelmode'),'walking'); assert.equal(url.searchParams.get('origin'),'The Garden, Oxford Street, Accra'); assert.equal(url.searchParams.get('waypoints'),'Other cafe, Other Street'); assert.equal(url.searchParams.get('destination'),url.searchParams.get('origin'));
  assert.equal(dayMapsUrl(value,'taxi'),null); assert.equal(dayMapsUrl({stops:[{item:{id:'demo:a',name:'Demo'}}]}),null);
  assert.equal(dayMapsUrl({stops:[]}),null);
});
test('invalid venue coordinates fall back to actual name and address', () => {
  const value=plan(); value.stops[0].item.coordinates={lat:91,lng:0}; assert.match(decodeURIComponent(dayMapsUrl(value)),/The Garden/);
  value.stops[0].item.coordinates={lat:5.6,lng:-0.2}; assert.equal(new URL(dayMapsUrl(value)).searchParams.get('query'),'5.6,-0.2');
});
test('bad money, optional warnings and malformed dates do not render as objects', () => {
  assert.equal(detailMoney(Infinity,'GHS'),null); assert.equal(detailMoney(1,{}),null); assert.equal(detailMoney(-2,'GHS'),null);
  const value=plan(); value.request.date='2026-02-30'; value.warnings=['Check prices',{x:1}]; value.timingNotes=['No rush']; value.budget.note={x:1};
  const data=readinessData(value); assert.equal(data.date,'Date to choose'); assert.deepEqual(data.warnings,['Check prices']); assert.equal(data.note,'');
});
test('venue checks require same date, visit occurrence and returned provider entity', () => {
  const value=plan(), current=value.stops[0]; assert.equal(normalizeVenueReport(result(),value,current,true).hours.status,'fits_reported_hours');
  const wrongDate=result(); wrongDate.date='2026-11-13'; assert.throws(() => normalizeVenueReport(wrongDate,value,current,true));
  const wrongVisit=result(); wrongVisit.stops[0].start='20:00'; assert.throws(() => normalizeVenueReport(wrongVisit,value,current,true));
  const wrongPlace=result(); wrongPlace.stops[0].place.entityId=otherId; assert.throws(() => normalizeVenueReport(wrongPlace,value,current,true));
  const missingProvenance=result(); delete missingProvenance.stops[0].place.provenance.entityId; assert.throws(() => normalizeVenueReport(missingProvenance,value,current,true));
  const malformed=result(); malformed.stops[0].hours={status:{fake:true},summary:{fake:true},intervals:{fake:true}};
  assert.equal(normalizeVenueReport(malformed,value,current,true).hours.status,'unknown');
});
test('request scope changes for date, timing, occurrence or provider refresh', () => {
  const value=plan(), initial=detailScopeKey(value,value.stops[0]); value.request.date='2026-11-13'; assert.notEqual(detailScopeKey(value,value.stops[0]),initial);
  value.request.date='2026-11-12'; value.stops[0].start='17:00'; assert.notEqual(detailScopeKey(value,value.stops[0]),initial);
});
test('refresh is explicit and uses guest-only endpoint and exact selected visit', async () => {
  const calls=[]; const api=createDayDetailsApi({origin:'https://unstressed.example',fetch:async (...args) => {calls.push(args);return {ok:true,json:async()=>result()};}});
  assert.equal(calls.length,0); const value=plan(); await api.load(value,value.stops[0]);
  assert.equal(calls.length,1); const [url,options]=calls[0]; assert.equal(url,'https://unstressed.example/api/place-checks'); assert.equal(options.credentials,'omit'); assert.equal(options.redirect,'error'); assert.equal(options.method,'POST'); assert.equal(options.headers.authorization,undefined); assert.deepEqual(JSON.parse(options.body),{date:'2026-11-12',stops:[{entityId:id,start:'18:00',end:'19:00'}]});
});
test('unconfirmed timing reads venue details without making a visit availability claim', async () => {
  const calls=[]; const api=createDayDetailsApi({origin:'https://unstressed.example',fetch:async (...args)=>{calls.push(args);return {ok:true,json:async()=>place()};}});
  const value=plan(); value.request.timing.timeConfirmed=false; const report=await api.load(value,value.stops[0]); assert.equal(calls[0][0],`https://unstressed.example/api/places/${id}`); assert.equal(calls[0][1].method,'GET'); assert.equal(report.hours.status,'unknown'); assert.match(report.hours.summary,/Choose a date/);
});
test('failed and aborted checks remain retryable and never accept stale destinations', async () => {
  const value=plan(); const failed=createDayDetailsApi({origin:'https://unstressed.example',fetch:async()=>({ok:false,json:async()=>({})})}); await assert.rejects(failed.load(value,value.stops[0]),/could not be checked/);
  const controller=new AbortController(); controller.abort(); const aborted=createDayDetailsApi({origin:'https://unstressed.example',fetch:async (url,options)=>{assert.equal(options.signal.aborted,true);throw new Error('aborted');}}); await assert.rejects(aborted.load(value,value.stops[0],controller.signal),/aborted/);
  const invalid=plan(); invalid.stops[0].item.entityId='not-a-provider-id'; await assert.rejects(failed.load(invalid,invalid.stops[0]),/not available/);
});
test('enquiry uses confirmed future timing but never asserts availability or a booking', () => {
  const value=plan(), now=Date.parse('2026-11-09T12:00:00Z'); const text=enquiryDraft(value,value.stops[0],now); assert.match(text,/2 adults and 1 child/); assert.match(text,/Could you share/); assert.match(text,/2026-11-12 at 18:00 \(Africa\/Accra\)/); assert.doesNotMatch(text,/confirmed|booked|reservation is/);
  value.request.timing.timeConfirmed=false; assert.doesNotMatch(enquiryDraft(value,value.stops[0],now),/2026-11-12|18:00/);
  value.request.timing.timeConfirmed=true; assert.doesNotMatch(enquiryDraft(value,value.stops[0],Date.parse('2026-11-13T12:00:00Z')),/2026-11-12|18:00/);
  value.timeZone='invalid'; assert.doesNotMatch(enquiryDraft(value,value.stops[0],now),/2026-11-12|18:00/);
});
test('multi-stop transit always exposes separate exact legs so waypoints cannot be silently dropped', () => {
  const value=plan(); value.stops.push({...stop(),id:'second',item:{...place(),name:'Second cafe'}}); value.stops.push({...stop(),id:'third',item:{...place(),name:'Third cafe'}});
  assert.equal(dayMapsUrl(value,'transit'),null);
  const legs=dayRouteLegs(value,'transit'); assert.equal(legs.length,2);
  for (const leg of legs) {const url=new URL(leg.url); assert.equal(url.searchParams.get('travelmode'),'transit'); assert.equal(url.searchParams.has('waypoints'),false);}
  assert.equal(new URL(legs[0].url).searchParams.get('destination'),new URL(legs[1].url).searchParams.get('origin'));
});
test('native component exposes only user-pressed refresh and handoffs, accessible 48px controls', async () => {
  const source=await readFile(new URL('../src/components/DayDetails.tsx',import.meta.url),'utf8');
  assert.match(source,/onPress=\{evidence.refresh\}/); assert.match(source,/minHeight:48/); assert.match(source,/Text selectable/); assert.match(source,/controller.signal.aborted.*currentKey.current === key/); assert.doesNotMatch(source,/Share\.|setInterval|setTimeout|Linking\.openURL\(.*tel:/);
});


test('venue detail transport keeps release HTTPS strict and rejects impossible reported intervals', () => {
  assert.throws(() => createDayDetailsApi({origin:'http://localhost:8080',fetch:()=>{}}),/HTTPS/);
  assert.doesNotThrow(() => createDayDetailsApi({origin:'http://localhost:8080',development:true,fetch:()=>{}}));
  const value=venueDetailsData({...place(),hours:{monday:[{opens:'12:00',closes:'10:00',overnight:false}],tuesday:[{opens:'12:00',closes:'12:00',overnight:false}],wednesday:[{opens:'22:00',closes:'02:00',overnight:true}]}});
  assert.deepEqual(value.hours,[{day:'Wednesday',label:'22:00–02:00 (+1 day)'}]);
});


test('native reservation timing rejects daylight-saving gaps and repeated clock times', () => {
  const now=Date.parse('2026-01-01T00:00:00Z'), party={adults:1,children:0};
  assert.equal(reservationEligible({date:'2026-03-08',localTime:'02:30',timeZone:'America/New_York',party},now),false);
  assert.equal(reservationEligible({date:'2026-11-01',localTime:'01:30',timeZone:'America/New_York',party},now),false);
  assert.equal(reservationEligible({date:'2026-11-01',localTime:'03:30',timeZone:'America/New_York',party},now),true);
  assert.equal(reservationEligible({date:'2026-11-12',localTime:'18:00',timeZone:'Asia/Kathmandu',party},now),true);
  assert.equal(reservationEligible({date:'2026-02-30',localTime:'18:00',timeZone:'UTC',party},now),false);
});
test('native details runtime imports only native and shared sources', async () => {
  const source=await readFile(new URL('../src/day-details.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/from\s+['"][^'"]*(?:frontend|backend)/);
});
