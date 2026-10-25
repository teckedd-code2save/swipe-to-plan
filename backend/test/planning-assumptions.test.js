import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgent} from '../src/agent.js';
import {parseItinerary,allocateBudget} from '../src/itinerary.js';
const draft=()=>parseItinerary({area:'Kasoa, Ghana',party:{adults:1,children:0},people:[{id:'you',name:'You',artists:[],vibes:[]}],budget:null,activities:[],date:'2099-01-01',timing:{dateConfirmed:true,timeConfirmed:true,mode:'flexible'},startTime:'17:00',endTime:'22:00'});
const response=(name,args)=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name,arguments:JSON.stringify(args)}}]}}]})});
test('explicit coffee and saved cafe tastes are supported without inventing a budget or another participant',async()=>{
 for(const [message,vibes] of [['One coffee after work tomorrow',[]],['Choose a spot from my tastes',['v-cafe']]]){
  const context=draft();context.people[0].vibes=vibes;
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('autopilot_day',{changes:{activities:['coffee']},message:'I’ll look for a cafe.'})});
  const result=await agent.interpret({message,context,mode:'autopilot',locationContext:{confirmed:true}});
  assert.deepEqual(result.request.activities,['coffee']);assert.equal(result.request.budget,null);assert.equal(result.request.party.adults,1);assert.equal(result.request.people.length,1);
 }
});
test('unknown budgets survive repeated parsing, activity changes and currencies without synthetic envelopes',()=>{
 for(const currency of ['GHS','GBP','JPY'])for(const activities of [['coffee'],['dinner'],['activity']]){
  const request=parseItinerary({...draft(),currency,activities});
  assert.equal(parseItinerary(request).budget,null);
  const allocation=allocateBudget(request,activities);
  assert.equal(allocation.total,null);assert.equal(allocation.reserve,null);assert.equal(allocation.transport,null);assert.ok(allocation.allocations.every(a=>a.amount===null));
 }
});

test('an unspecified evening outing never defaults to a meal or invented spend',async()=>{
 const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('autopilot_day',{changes:{},message:'I’ll look for a change of scene.'})});
 const result=await agent.interpret({message:'Somewhere to unwind after work',context:draft(),mode:'autopilot',locationContext:{confirmed:true}});
 assert.deepEqual(result.request.activities,['activity']);assert.equal(result.request.budget,null);assert.equal(result.request.party.adults,1);
});
