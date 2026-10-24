import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgent} from '../src/agent.js';
import {parseItinerary as parseBrief} from '../src/itinerary.js';
const parseItinerary=(body={})=>parseBrief({activities:['coffee','dinner'],...body});
import {nextPlanSteps} from '../../frontend/src/plan-assistance.js';
const profile=(id,artists=[])=>({id,name:id,artists,vibes:[]});
const context=parseItinerary({area:'London, UK',party:{adults:1},people:[{...profile('Alex',['SZA']),spending:{style:'mindful',priority:'dinner'}}],budget:100,currency:'GBP',pins:{coffee:'qloo:keep'},excludeIds:['qloo:skip']});
const circles=[{id:'weekend',name:'Weekend people',people:[profile('Alex',['Outdated']),profile('Sam',['Tems'])]}];
function invoke(args,extra={},name='autopilot_day',capture=()=>{}){
  return createAgent({getKey:()=> 'test',fetchImpl:async(_,options)=>{capture(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name,arguments:JSON.stringify(args)}}]}}]})};}}).interpret({message:'Bring Weekend people for one meal under £80. Sam prefers seafood today.',context,circles,contacts:[profile('Maya',['Sade'])],mode:'autopilot',locationContext:{confirmed:true},...extra});
}
test('Autopilot composes a named circle, saved person, explicit tastes and trip changes without replacing current tastes',async()=>{
  let payload;
  const result=await invoke({circleId:'weekend',personIds:['Maya'],changes:{budget:80,activities:['dinner']},tasteUpdates:[{id:'Sam',vibes:['v-seafood']}]},{},'autopilot_day',p=>payload=p);
  assert.equal(result.status,'autopilot');assert.equal(result.needsLocation,false);assert.equal(result.circleId,'weekend');
  assert.deepEqual(result.request.people.map(p=>p.id),['Alex','Sam','Maya']);
  assert.deepEqual(result.request.people[0],context.people[0]);assert.deepEqual(result.request.people[1].artists,['Tems']);assert.deepEqual(result.request.people[1].vibes,['v-seafood']);
  assert.equal(result.request.party.adults,3);assert.equal(result.request.budget,80);assert.equal(result.request.currency,'GBP');assert.equal(result.request.date,context.date);
  assert.deepEqual(result.request.activities,['dinner']);assert.deepEqual(result.request.pins,{});assert.deepEqual(result.request.excludeIds,['qloo:skip']);
  assert.equal(payload.tools[0].function.name,'autopilot_day');assert.match(payload.messages[0].content,/AUTOPILOT IS ON/);
});
test('Autopilot preserves all omitted constraints and pauses for unknown or changed locations',async()=>{
  const result=await invoke({changes:{}});assert.deepEqual(result.request,context);
  for(const extra of [{locationContext:{confirmed:false}},{locationContext:undefined}])assert.equal((await invoke({changes:{}},extra)).needsLocation,true);
  const changed=await invoke({changes:{area:'Tokyo, Japan'}});assert.equal(changed.needsLocation,true);assert.equal(changed.request.currencyMode,'local');assert.equal(changed.request.budget,context.budget);
});
test('Autopilot rejects invented people, unsafe fields, duplicate edits, impossible party size and use outside the mode',async()=>{
  for(const args of [
    {circleId:'made-up',changes:{}},{personIds:['stranger'],changes:{}},{personIds:['Maya','Maya'],changes:{}},
    {changes:{budget:0}},{changes:{book:true}},{changes:{people:[]}},{changes:{party:{adults:1}},circleId:'weekend'},
    {changes:{},tasteUpdates:[{id:'stranger',artists:['Sade']}]},{changes:{},tasteUpdates:[{id:'Alex'},{id:'Alex'}]},
    {changes:{},tasteUpdates:[{id:'Alex',isAllergySafe:true}]},
  ])await assert.rejects(invoke(args),e=>e.status===400);
  await assert.rejects(invoke({changes:{}},{mode:'guided'}),e=>e.status===400);
  const full={...context,party:{adults:6},people:Array.from({length:6},(_,i)=>profile(`p${i}`))};
  await assert.rejects(invoke({changes:{},circleId:'weekend'},{context:full}),e=>e.status===400);
});
test('Autopilot retains child constraints and can ask one clarification without running discovery',async()=>{
  await assert.rejects(invoke({changes:{activities:['drinks']}},{context:{...context,party:{adults:1,children:1}}}),e=>e.status===400);
  const result=await invoke({question:'Which Sunday circle do you mean?'},{},'ask_question');assert.equal(result.status,'needs_input');
});
test('post-plan suggestions prioritize real timing issues, missing tastes, retries and sharing',()=>{
  const plan={request:context,stops:[{item:{id:'place'}}]};
  const fits={status:'ready',data:{stops:[{hours:{status:'fits_reported_hours'}}]}};
  assert.match(nextPlanSteps(plan,fits).note,/fit reported weekly/);assert.equal(nextPlanSteps(plan,fits).actions[1].id,'share');
  const closed={status:'ready',data:{stops:[{hours:{status:'reported_closed'}}]}};
  assert.equal(nextPlanSteps(plan,closed).attention,true);assert.match(nextPlanSteps(plan,closed).actions[0].label,/Review hours/);
  assert.match(nextPlanSteps(plan,{status:'error'}).actions[0].label,/Retry/);
  const missing={...plan,request:{...context,people:[profile('Sam')]}};assert.equal(nextPlanSteps(missing,fits).actions[1].personId,'Sam');
  assert.equal(nextPlanSteps({...plan,stops:[{item:null}]},{}).actions[0].id,'review');
  const sparse=nextPlanSteps({...plan,stops:[{item:null,reason:'no_eligible_places'}]},{});
  assert.match(sparse.note,/don’t cover yet/);assert.equal(sparse.actions[1].id,'location');
});


test('Autopilot delegates an open choice without inventing a coffee preference',async()=>{
  const result=await invoke({changes:{}},{context:parseBrief({people:[profile('Alex')]}),message:'Plan something for me'});
  assert.equal(result.status,'autopilot');
  assert.deepEqual(result.request.activities,['activity']);
});


test('Autopilot chooses from the combined circle tastes without requiring manual activities',async()=>{
  const base=parseBrief({party:{adults:1},people:[{...profile('Alex'),vibes:['v-nature']}]});
  const result=await invoke({changes:{},circleId:'foodies'},{context:base,circles:[{id:'foodies',name:'Foodies',people:[{...profile('Sam'),vibes:['v-italian']}]}]});
  assert.deepEqual(result.request.activities,['activity','dinner']);
  assert.equal(result.request.budget,base.budget);
  assert.deepEqual(result.request.people[0].vibes,['v-nature']);
  const solo=await invoke({changes:{activities:['dinner']}},{context:base});
  assert.deepEqual(solo.request.activities,['dinner']);
});
test('automatic activity choices respect children, short windows and latest taste edits',async()=>{
  const base=parseBrief({party:{adults:1,children:1},people:[{...profile('Alex'),vibes:['v-bar','v-nature','v-italian']}],startTime:'14:00',endTime:'15:00'});
  const short=await invoke({changes:{}},{context:base});
  assert.deepEqual(short.request.activities,['activity']);
  const edited=await invoke({changes:{},tasteUpdates:[{id:'Alex',vibes:['v-cafe']}]},{context:base});
  assert.deepEqual(edited.request.activities,['coffee']);
});
