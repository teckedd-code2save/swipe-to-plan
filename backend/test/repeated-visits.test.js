import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgent,CHAT_TOOLS} from '../src/agent.js';
import {parseItinerary,buildItinerary} from '../src/itinerary.js';
import {createDiscovery} from '../src/plan.js';
import {editSelectedStops} from '../src/stop-edits.js';
import {agentPlanContext} from '../../frontend/src/agent-plan-context.js';
import {routeFromStops,routeFromChoices} from '../../frontend/src/shortlist.js';
import {reviseStops} from '../../shared/stop-intents.js';
import {resultRouteSummary} from '../../frontend/src/result-receipt.js';
import {bookingSnapshot,invalidateBookings,bookingOperation} from '../src/booking-actions.js';
import {routeLocation,routeEstimateFingerprint} from '../../frontend/src/route-estimates.js';

// Synthetic provider-shaped evidence. No model, provider or paid network calls.
const places=[['baker','Cafe A','cafe'],['pan','Cafe Alternative','cafe'],['dinner',"Dinner B",'restaurant']];
const discovery=(extra={})=>createDiscovery({provider:{name:'qloo',resolveArtist:async()=>null,discover:async()=>places.map(([id,name,tag])=>({entity_id:id,name,tags:[{id:`urn:tag:category:qloo:${tag}`,name:tag}],properties:{address:'Osu, Accra, Ghana',price_level:2}})),...extra}});
const request=(extra={})=>parseItinerary({area:'Osu',date:'2099-01-01',activities:['coffee','dinner'],party:{adults:2,children:0},people:[{id:'you',name:'You',artists:[],vibes:[]}],budget:300,currency:'GHS',timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'},experience:{notes:'Keep the first two stops.',searchTags:[]},excludeIds:['qloo:excluded'],...extra});
const initial=()=>buildItinerary(discovery(),request({pins:{coffee:'qloo:baker',dinner:'qloo:dinner'}}));
const expected=['qloo:baker','qloo:dinner','qloo:baker'];
const insert={operation:'insert',placeId:'qloo:baker',afterStopId:'stop-1'};

test('exact return-visit journey preserves both existing occurrences and grounded evidence through agent, UI and planner',async()=>{
 const current=await initial();current.request.pins={}; // The rendered suggestions need not already have manual keep pins.
 const planContext=agentPlanContext(current),before=JSON.stringify(current);let payload;
 const agent=createAgent({getKey:()=> 'synthetic',fetchImpl:async(_,options)=>{payload=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'edit_stops',arguments:JSON.stringify({...insert,message:'Cafe A is now added again.'})}}]}}]})};}});
 const action=await agent.interpret({message:'Add Cafe A again after dinner as a third stop, keeping the first two stops.',mode:'autopilot',context:current.request,planContext,locationContext:{confirmed:true}});
 assert.equal(action.action,'select_places');assert.equal(action.assistantMessage,undefined);
 assert.ok(payload.tools.some(t=>t.function.name==='edit_stops'));
 const next=parseItinerary(routeFromStops(current,action.route));
 assert.deepEqual(next.route.map(s=>s.placeId),expected);assert.deepEqual(next.stopIntents,['coffee','dinner','coffee']);
 for(const key of ['party','people','budget','currency','timing','date','experience','excludeIds','area'])assert.deepEqual(next[key],current.request[key],key);
 const result=await buildItinerary(discovery(),next);
 assert.equal(result.status,'complete');assert.deepEqual(result.stops.map(s=>s.item.id),expected);assert.deepEqual(result.stops.map(s=>s.id),['stop-0','stop-1','stop-2']);
 assert.ok(result.stops.every(s=>s.item.reasons.some(r=>r.code==='intent_match')));
 assert.equal(result.budget.allocations.reduce((n,a)=>n+a.amount,result.budget.reserve+result.budget.transport),300);
 assert.deepEqual(result.tasteMap.nodes.filter(n=>n.kind==='stop').map(n=>n.id),['stop-0','stop-1','stop-2']);
 assert.equal(JSON.stringify(current),before);
 assert.match(resultRouteSummary(result),/1\. Cafe A → 2\. Dinner B → 3\. Cafe A/);
 assert.equal(result.checks[0].label,'Requested repeat visits');
 const context=agentPlanContext(result);assert.deepEqual(context.stops.map(s=>s.id),expected);assert.deepEqual(context.stops.map(s=>s.stopId),['stop-0','stop-1','stop-2']);assert.equal(context.options.filter(p=>p.id==='qloo:baker').length,1);
 const revised=parseItinerary({...result.request,...reviseStops(result.request,{date:'2099-02-01'}),date:'2099-02-01'});assert.deepEqual(revised.route,next.route);
});

test('explicit repeats remain eligible in scheduled, reviewed, pinned and timing-fallback paths',async()=>{
 const current=await initial(),base=routeFromStops(current,editSelectedStops(agentPlanContext(current),insert));
 for(const mode of ['scheduled','reviewed','pins','past','closed']){
  const engine=discovery();let changes={};
  if(mode==='reviewed')engine.reviewCandidates=async({candidates})=>candidates.map(c=>({index:c.index,ids:[]}));
  if(mode==='pins')changes={route:undefined,pins:{'stop-0':'qloo:baker',dinner:'qloo:dinner','stop-2':'qloo:baker'}};
  if(['scheduled','past','closed'].includes(mode))changes={date:mode==='past'?'2000-01-01':'2099-01-01',timing:{dateConfirmed:true,timeConfirmed:true,mode:'fixed'},startTime:'12:00',endTime:'18:00'};
  if(mode==='closed')engine.placeDetails=async()=>({isClosed:true});
  const plan=await buildItinerary(engine,parseItinerary({...base,...changes}));assert.deepEqual(plan.stops.map(s=>s.item?.id),expected,mode);
  if(mode==='scheduled'){assert.ok(plan.stops[0].end<plan.stops[1].start&&plan.stops[1].end<plan.stops[2].start);assert.notEqual(plan.stops[0].start,plan.stops[2].start);}
  if(['past','closed'].includes(mode)){assert.equal(plan.phase,'needs_timing');assert.ok(plan.stops.every(s=>!s.start));}
 }
});

test('automatic discovery remains distinct, while unavailable or excluded explicit repeats remain unfilled',async()=>{
 const auto=await buildItinerary(discovery(),request({stopIntents:['coffee','dinner','coffee'],pins:{'stop-2':'qloo:baker'}}));
 assert.deepEqual(auto.stops.map(s=>s.item.id),['qloo:pan','qloo:dinner','qloo:baker']); // Former bad result if first visit was not carried over.
 const current=await initial(),base=routeFromStops(current,editSelectedStops(agentPlanContext(current),insert));
 for(const changes of [{excludeIds:['qloo:baker']},{maxPriceLevel:1}]){
  const result=await buildItinerary(discovery(),parseItinerary({...base,...changes}));assert.equal(result.stops[0].item,null);assert.equal(result.stops[2].item,null);assert.ok(!result.stops.some(s=>s.item?.id==='qloo:pan'));assert.equal(result.status,'partial');assert.match(resultRouteSummary(result),/Still to find/);
 }
 const unavailable=await buildItinerary(discovery({discover:async()=>[]}),parseItinerary(base));assert.ok(unavailable.stops.every(s=>!s.item));
});

test('one-occurrence edits preserve untouched route entries, bounded size and exact provider references',async()=>{
 const current=await initial(),ctx=agentPlanContext(current),route=editSelectedStops(ctx,insert);
 const plan=await buildItinerary(discovery(),parseItinerary(routeFromStops(current,route))),repeated=agentPlanContext(plan);
 assert.deepEqual(editSelectedStops(repeated,{operation:'remove',stopId:'stop-2'}).map(s=>s.placeId),expected.slice(0,2));
 assert.deepEqual(editSelectedStops(repeated,{operation:'replace',stopId:'stop-2',placeId:'qloo:pan'}).map(s=>s.placeId),['qloo:baker','qloo:dinner','qloo:pan']);
 assert.deepEqual(editSelectedStops(repeated,{operation:'move',stopId:'stop-2',afterStopId:null}).map(s=>s.placeId),['qloo:baker','qloo:baker','qloo:dinner']);
 for(const args of [insert,{operation:'toString'},{operation:'remove',stopId:'qloo:baker'},{operation:'replace',stopId:'stop-0',placeId:'invented'},{operation:'move',stopId:'stop-0',afterStopId:'stop-0'},{operation:'insert',placeId:'qloo:baker'}])assert.throws(()=>editSelectedStops(repeated,args),e=>e.status===400);
 assert.throws(()=>editSelectedStops({...ctx,requestedStopCount:3},insert),/unfilled/);
 assert.equal(CHAT_TOOLS.find(t=>t.function.name==='select_places').function.parameters.properties.placeIds.uniqueItems,undefined);
 assert.deepEqual(routeFromChoices(current,expected).route.map(s=>s.placeId),expected);
});

test('return visits have separate booking snapshots and travel identities; route edits stale existing approvals',async()=>{
 const current=await initial(),route=editSelectedStops(agentPlanContext(current),insert),plan=await buildItinerary(discovery(),parseItinerary(routeFromStops(current,route)));
 const select=index=>({stopId:plan.stops[index].id,itemId:plan.stops[index].item.id,entityId:plan.stops[index].item.entityId});
 const first=bookingSnapshot(plan,select(0)),last=bookingSnapshot(plan,select(2));assert.equal(first.entityId,last.entityId);assert.notEqual(first.stopId,last.stopId);assert.equal(last.orderedStops.length,3);
 const entry={revision:1,plan};const record=bookingOperation(entry,'create',{...select(2),kind:'enquiry',planRevision:1,idempotencyKey:'synthetic-only'}).booking;
 assert.equal(record.snapshot.stopId,'stop-2');assert.equal(record.submission.status,'not_submitted');
 assert.notEqual(routeLocation(plan.stops[0]).id,routeLocation(plan.stops[2]).id);
 assert.notEqual(routeEstimateFingerprint(plan,'test',{stop:plan.stops[0]},'walking',null),routeEstimateFingerprint(plan,'test',{stop:plan.stops[2]},'walking',null));
 invalidateBookings(entry,{...plan,stops:plan.stops.slice(0,2)});assert.equal(entry.bookingActions.records[0].stale,true);
});

import {createDays,createDayStore} from '../src/days.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('shared day persists exact repeated visits, member tastes and hard constraints across revisions and restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'synthetic-return-visits-'));
 try{
  const file=join(dir,'days.json'),days=createDays({store:createDayStore({file}),discovery:discovery()}),day=await days.create({request:request({pins:{coffee:'qloo:baker',dinner:'qloo:dinner'}})});
  await days.settled(day.id);const ready=await days.get(day.id,day.token),current=ready.plan;
  const revision=routeFromStops(current,editSelectedStops(agentPlanContext(current),insert));
  await days.updateBrief(day.id,day.token,{request:revision,revision:ready.revision});await days.settled(day.id);
  let saved=await days.get(day.id,day.token);assert.deepEqual(saved.plan.stops.map(s=>s.item.id),expected);assert.equal(saved.planRevision,saved.revision);
  await days.updatePerson(day.id,day.token,saved.request.people[0].id,{...saved.request.people[0],spending:{style:'mindful',priority:'coffee'}});await days.settled(day.id);
  const restored=createDays({store:createDayStore({file}),discovery:discovery()});saved=await restored.get(day.id,day.token);
  assert.deepEqual(saved.request.route.map(s=>s.placeId),expected);assert.deepEqual(saved.plan.stops.map(s=>s.item.id),expected);assert.equal(saved.request.budget,300);assert.deepEqual(saved.request.excludeIds,['qloo:excluded']);assert.equal(saved.request.people[0].spending.style,'mindful');
  await assert.rejects(restored.updateBrief(day.id,day.inviteToken,{request:revision,revision:saved.revision}),e=>e.status===403);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('comparison sees the actual ordered occurrences, not earlier proposed actions or filtered venue options',async()=>{
 const actual=await buildItinerary(discovery(),request({stopIntents:['coffee','dinner','coffee'],pins:{'stop-2':'qloo:baker'}}));
 const context=agentPlanContext(actual,{},[],new Map(),new Map(),['qloo:baker']);let sent;
 const agent=createAgent({getKey:()=> 'synthetic',fetchImpl:async(_,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'reply',arguments:JSON.stringify({text:'Cafe A is a café option; prices and availability need confirmation.'})}}]}}]})};}});
 await agent.interpret({message:'Compare the inspected venue.',context:actual.request,planContext:context,task:'compare',history:[{role:'user',text:'Keep the bakery and return to it after dinner.'},{role:'assistant',text:'Synthetic stale claim: the same venue is selected twice.'}]});
 const supplied=JSON.parse(sent.messages[1].content);
 assert.deepEqual(supplied.planContext.stops.map(s=>s.id),['qloo:pan','qloo:dinner','qloo:baker']);assert.deepEqual(supplied.planContext.options.map(s=>s.id),['qloo:baker']);
 assert.deepEqual(supplied.history,[]);assert.ok(!JSON.stringify(sent.messages).includes('Synthetic stale claim'));assert.equal(sent.messages.length,3);
});
