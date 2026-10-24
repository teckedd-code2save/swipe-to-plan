import test from 'node:test';
import assert from 'node:assert/strict';
import {approximatePoint,nearbyRequest,areaDistanceKm} from '../src/locations.js';
import {createQlooClient} from '../src/qloo.js';
import {currentAreaPoint} from '../../frontend/src/nearby-location.js';
import {createAgent} from '../src/agent.js';
import {parseItinerary} from '../src/itinerary.js';

test('device lookup is one-shot, rounds before transport and handles denied or inaccurate fixes',async()=>{
  let options;
  const point=await currentAreaPoint({getCurrentPosition(success,_failure,o){options=o;success({coords:{latitude:5.603715,longitude:-.186964,accuracy:80}});}});
  assert.deepEqual(point,{latitude:5.6,longitude:-.19});assert.equal(options.enableHighAccuracy,false);assert.equal(options.timeout,10000);
  await assert.rejects(currentAreaPoint(null),/Search for your area/);
  for(const [code,message] of [[1,/access is off/],[2,/couldn’t find/],[3,/too long/]])await assert.rejects(currentAreaPoint({getCurrentPosition(_success,failure){failure({code});}}),message);
  await assert.rejects(currentAreaPoint({getCurrentPosition(success){success({coords:{latitude:5.6,longitude:-.18,accuracy:50000}});}}),/too broad/);
});

test('nearby lookup validates and minimizes coordinates, returns only real locality options',async()=>{
  for(const point of [null,[],{}, {latitude:'5',longitude:0},{latitude:91,longitude:0},{latitude:0,longitude:181},{latitude:0,longitude:0,preciseAddress:'private'}])assert.throws(()=>approximatePoint(point));
  assert.deepEqual(approximatePoint({latitude:0,longitude:0}),{latitude:0,longitude:0});
  let calls=0;
  const entity={entity_id:'4F18635D-75D6-43EC-B8B9-8DFAEB8C5A29',name:'London',types:['urn:entity:locality'],location:{lat:51.5,lon:-.12},properties:{ancestors:[{place:'country',name:'United Kingdom'}]}};
  const client=createQlooClient({getKey:()=> 'test',fetchImpl:async url=>{
    calls++;assert.equal(url.pathname,'/search');assert.equal(url.searchParams.get('filter.location'),'51.51,-0.12');
    assert.equal(url.searchParams.get('types'),'urn:entity:locality');assert.equal(url.searchParams.get('sort_by'),'distance');
    return {ok:true,json:async()=>({results:[entity,{...entity,types:['urn:entity:place']} ]})};
  }});
  const point={latitude:51.5074,longitude:-.1248},areas=await client.nearbyLocations(point);
  assert.equal(areas.length,1);assert.equal(areas[0].currency,'GBP');assert.equal(areas[0].timeZone,'Europe/London');
  assert.equal(JSON.stringify(areas).includes('51.5074'),false);assert.equal(areas[0].latitude,undefined);
  await client.nearbyLocations(point);assert.equal(calls,2,'No device-location cache');
  const {distanceKm,broadArea,...publicArea}=areas[0];assert.equal(typeof distanceKm,'number');assert.equal(broadArea,false);assert.deepEqual(await client.getLocation(areas[0].id),publicArea);assert.equal(calls,2,'Public locality metadata is reusable');
});

test('near-me chat keeps requested constraints and requires device confirmation in both modes',async()=>{
  const context=parseItinerary({area:'London',people:[{id:'you',name:'You'}]});
  for(const mode of ['guided','autopilot']){
    const changes={activities:['coffee'],budget:200,party:{adults:2,children:0}};
    const args=mode==='autopilot'?{nearby:true,changes,message:'Let’s find an area close to you.'}:{nearby:true,...changes,message:'Let’s find an area close to you.'};
    const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:mode==='autopilot'?'autopilot_day':'set_location',arguments:JSON.stringify(args)}}]}}]})})});
    const result=await agent.interpret({message:'One coffee for two near me, 200 allowance',context,mode,locationContext:{confirmed:true}});
    assert.equal(result.nearby,true);assert.equal(result.request.budget,200);assert.deepEqual(result.request.activities,['coffee']);assert.equal(result.request.party.adults,2);
    assert.deepEqual(result.request.people,context.people);assert.equal(result.request.nearby,undefined);
    if(mode==='autopilot')assert.equal(result.needsLocation,true);else assert.equal(result.action,'set_location');
  }
});


test('rural searches expand only to the requested range and prefer towns over broad regions',async()=>{
  assert.equal(nearbyRequest({latitude:6.8,longitude:0.2}).radiusKm,20);
  for(const radiusKm of [0,200,'50',null])assert.throws(()=>nearbyRequest({latitude:6.8,longitude:0.2,radiusKm}));
  assert.throws(()=>nearbyRequest({latitude:6.8,longitude:0.2,secret:'no'}));
  assert.equal(areaDistanceKm({latitude:0,longitude:0},{lat:0,lon:1}),111);
  assert.equal(areaDistanceKm({latitude:0,longitude:0},{}),null);
  const row=(suffix,name,kind,lat)=>({entity_id:`4F18635D-75D6-43EC-B8B9-8DFAEB8C5A2${suffix}`,name,types:['urn:entity:locality'],location:{lat,lon:.2},properties:{place:kind,ancestors:[{place:'country',name:'Ghana'}]}});
  const ranges=[];
  const client=createQlooClient({getKey:()=> 'test',fetchImpl:async url=>{
    ranges.push(Number(url.searchParams.get('filter.radius')));
    return {ok:true,json:async()=>({results:[row('1','Region','State',6.8),row('2','Town','town',6.9),row('3','Village','village',6.81),row('4','Ghana','country',6.8)]})};
  }});
  const results=await client.nearbyLocations({latitude:6.8,longitude:.2},50);
  assert.equal(ranges.length,1,'Never widen the search silently');assert.ok(Math.abs(ranges[0]-50/1.609344)<.001);
  assert.deepEqual(results.map(r=>r.name),['Village','Town','Region']);assert.equal(results.at(-1).broadArea,true);
  assert.equal((await client.getLocation(results[0].id)).distanceKm,undefined,'No device-relative information in the shared cache');
});
