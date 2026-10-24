import test from 'node:test';
import assert from 'node:assert/strict';
import {approximatePoint} from '../src/locations.js';
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
  assert.deepEqual(await client.getLocation(areas[0].id),areas[0]);assert.equal(calls,2,'Public locality metadata is reusable');
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
