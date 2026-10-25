import test from 'node:test';
import assert from 'node:assert/strict';
import {weeklyHours,checkHours,suggestedVisitSlots,parsePlaceCheck,createPlaceGuide} from '../src/place-guide.js';
import {createQlooClient} from '../src/qloo.js';
const id='AB662328-C415-495E-B21E-390E20FC08F9';
const other='AB662328-C415-495E-B21E-390E20FC08F8';
const input={date:'2026-10-25',stops:[{entityId:id,start:'17:00',end:'18:00'}]};
const range=(opens,closes)=>({closed:false,opens:`T${opens}:00`,closes:`T${closes}:00`});
test('hours checks compare the whole stop, preserve gaps and flag closures without claiming live verification',()=>{
 const hours=weeklyHours({sunday:[range('11:00','14:00'),range('17:00','22:30')],saturday:[{closed:true}]});
 assert.equal(checkHours(hours,input.date,'17:00','18:00').status,'fits_reported_hours');
 assert.equal(checkHours(hours,input.date,'13:00','18:00').status,'outside_reported_hours');
 assert.equal(checkHours(hours,input.date,'22:00','23:00').status,'outside_reported_hours');
 assert.equal(checkHours(hours,input.date,'17:00','18:00',true).status,'reported_closed');
 assert.equal(checkHours(weeklyHours({}),input.date,'17:00','18:00').status,'unknown');
 assert.equal(checkHours(weeklyHours({sunday:[{closed:true}],saturday:[{closed:true}]}),input.date,'17:00','18:00').status,'outside_reported_hours');
});
test('overnight opening from the previous weekday and midnight boundaries are handled',()=>{
 const hours=weeklyHours({saturday:[range('20:00','02:00')],sunday:[{closed:true}]});
 assert.equal(checkHours(hours,input.date,'00:30','01:45').status,'fits_reported_hours');
 assert.equal(checkHours(hours,input.date,'01:30','03:00').status,'outside_reported_hours');
 const allDay=weeklyHours({sunday:[range('00:00','24:00')]});
 assert.equal(checkHours(allDay,input.date,'00:00','23:59').status,'fits_reported_hours');
 assert.equal(weeklyHours({sunday:[range('00:00','00:00')]}).sunday,null);
 assert.equal(weeklyHours({sunday:[range('25:00','26:00')]}).sunday,null);
 assert.equal(weeklyHours({sunday:[]}).sunday,null);
});
test('place check input rejects invalid dates, arbitrary URLs, excess stops and backwards windows',()=>{
 assert.deepEqual(parsePlaceCheck(input),input);
 for(const value of [{...input,date:'2026-02-30'},{...input,date:'2026-25-25'},{...input,stops:[]},{...input,stops:Array(4).fill(input.stops[0])},{...input,url:'http://localhost'},{...input,stops:[{...input.stops[0],entityId:'http://localhost'}]},{...input,stops:[{...input.stops[0],end:'16:00'}]},{...input,stops:[{...input.stops[0],start:'24:00'}]},{...input,stops:[{...input.stops[0],start:['17:00']}]}]) assert.throws(()=>parsePlaceCheck(value));
});
test('fresh details use Qloo identity, sanitize links, normalize tags and cache bounded provider reads',async()=>{
 let calls=0,now=0;
 const guide=createPlaceGuide({now:()=>now,provider:{name:'qloo',getPlace:async()=>{calls++;return {entity_id:id,name:'Glassblower',types:['urn:entity:place'],location:{lat:51.51,lon:-0.13},tags:[{tag_id:'urn:tag:menu_highlight:qloo:sunday_roast',name:'Sunday roast'}],properties:{address:'London',website:'javascript:alert(1)',phone:'+442077348547',hours:{sunday:[range('11:00','22:30')]},external:{google_place:{place_id:'real-map-id'}}}};}}});
 const [a,b]=await Promise.all([guide.check(input),guide.details(id)]);
 assert.equal(calls,1);assert.equal(a.stops[0].hours.status,'fits_reported_hours');
 assert.equal(b.links.website,null);assert.equal(b.links.phone,'tel:+442077348547');
 assert.match(b.links.map,/query_place_id=real-map-id/);assert.deepEqual(b.highlights,['Sunday roast']);
 now=300001;await guide.check(input);assert.equal(calls,2);
});
test('one unavailable venue does not discard other checks and failed reads can retry',async()=>{
 let failures=0;const guide=createPlaceGuide({provider:{name:'qloo',getPlace:async entityId=>{if(entityId===other){failures++;throw Error('private provider error');}return {entity_id:id,name:'Known',properties:{},tags:[]};}}});
 const result=await guide.check({...input,stops:[...input.stops,{...input.stops[0],entityId:other}]});
 assert.equal(result.stops[0].hours.status,'unknown');assert.ok(result.stops[1].error);assert.doesNotMatch(result.stops[1].error,/private provider/);
 await guide.check({...input,stops:[{...input.stops[0],entityId:other}]});assert.equal(failures,2);
});
test('place endpoint uses an exact provider entity and rejects non-place entities',async()=>{
 const calls=[];const client=createQlooClient({getKey:()=> 'test-only',fetchImpl:async url=>{calls.push(new URL(url));return {ok:true,status:200,json:async()=>({results:[{entity_id:id,types:['urn:entity:artist']}]})};}});
 await assert.rejects(client.getPlace(id));assert.equal(calls[0].pathname,'/entities');assert.equal(calls[0].searchParams.get('entity_ids'),id);
 await assert.rejects(client.getPlace('https://example.com'));assert.equal(calls.length,1);
});

test('suggested visit slots come from reported opening hours, not inferred kitchen times',()=>{
  const hours=weeklyHours({sunday:[range('12:00','15:00'),range('18:00','22:00')]});
  const slots=suggestedVisitSlots(hours,'2026-10-25',60);
  assert.equal(slots.length,2);
  assert.equal(slots[0].start,'12:30');
  assert.equal(slots[0].basis,'reported opening hours only');
  assert.deepEqual(suggestedVisitSlots(weeklyHours({}),'2026-10-25',60),[]);
});
