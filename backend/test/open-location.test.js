import test from 'node:test';
import assert from 'node:assert/strict';
import {compareOpenAreas} from '../src/open-location.js';
const brief={people:[{artists:['Artist'],vibes:['v-art']}],activities:['activity'],experience:{searchTags:['v-art']},pins:{},currencyMode:'custom',currency:'GHS'};
const area=(id)=>({id,label:`${id}, Country`,name:id,currency:'USD'});
test('open discovery compares grounded places across areas without a home-area bias',async()=>{
  let query;const requests=[];
  const result=await compareOpenAreas({brief,findAreas:async args=>(query=args,[area('one'),area('two'),area('unavailable')]),build:async request=>{
    requests.push(request);if(request.locationId==='unavailable')throw Error('unavailable');
    const matches=request.locationId==='two'?2:0;
    return {stops:[{item:{id:'venue'}}],shortlist:Array.from({length:Math.max(matches,1)},(_,i)=>({item:{id:String(i),score:1,scoreComponents:{requestTopicBoost:i<matches?2:0}}}))};
  }});
  assert.equal(query.locationId,null);assert.equal(result.area.id,'two');assert.equal(result.areasCompared,2);assert.equal(result.areasUnavailable,1);
  assert.equal(requests.length,3);assert.ok(requests.every(x=>x.currency==='GHS'&&x.experience.searchTags[0]==='v-art'));
});
test('open discovery does not choose an empty area or move kept places',async()=>{
  const empty=await compareOpenAreas({brief,findAreas:async()=>[area('one')],build:async()=>({stops:[],shortlist:[]})});
  assert.equal(empty.area,null);assert.equal(empty.areasCompared,1);
  await assert.rejects(compareOpenAreas({brief:{...brief,pins:{activity:'venue'}},findAreas:async()=>[],build:async()=>{}}),/Release kept places/);
});
