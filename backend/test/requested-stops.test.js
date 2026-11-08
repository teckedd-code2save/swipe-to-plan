import test from 'node:test';
import assert from 'node:assert/strict';
import {parseItinerary,buildItinerary} from '../src/itinerary.js';
import {createDiscovery} from '../src/plan.js';
const brief=(extra={})=>parseItinerary({area:'Osu',activities:['drinks'],stopIntents:['drinks','drinks'],timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'},...extra});
const engine=(count=3)=>createDiscovery({provider:{name:'qloo',resolveArtist:async()=>null,discover:async()=>Array.from({length:count},(_,i)=>({entity_id:`bar-${i}`,name:`Bar ${i}`,tags:[{id:'urn:tag:category:qloo:bar',name:'bar'}],properties:{address:'Osu, Accra, Ghana'}}))}});
test('requested repeated stops select distinct grounded venues without adding a meal',async()=>{
 for(const count of [1,2,3]){const plan=await buildItinerary(engine(),brief({stopIntents:Array(count).fill('drinks')}));assert.equal(plan.stops.length,count);assert.equal(plan.status,'complete');assert.equal(new Set(plan.stops.map(s=>s.item.id)).size,count);assert.ok(plan.stops.every(s=>s.intent==='drinks'));}
});
test('insufficient candidates preserve unfilled requested slots and independent allowances',async()=>{
 const plan=await buildItinerary(engine(1),brief({budget:101}));assert.equal(plan.status,'partial');assert.equal(plan.stops.length,2);assert.equal(plan.stops.filter(s=>s.item).length,1);assert.deepEqual(plan.budget.allocations.map(a=>a.assigned),plan.stops.map(s=>!!s.item));assert.equal(plan.budget.allocations.reduce((n,a)=>n+a.amount,plan.budget.reserve+plan.budget.transport),101);
});
test('stop pins keep only their individual slot, including legacy category pins',async()=>{
 for(const pins of [{'stop-1':'qloo:bar-0'},{drinks:'qloo:bar-0'}]){const plan=await buildItinerary(engine(),brief({pins}));assert.equal(plan.status,'complete');assert.equal(plan.stops[pins.drinks?0:1].item.id,'qloo:bar-0');}
});
test('ordered intent contract rejects invalid counts, types and category mismatches',()=>{
 for(const stopIntents of [[],Array(4).fill('drinks'),2,['bar'],['dinner'],[null]])assert.throws(()=>brief({stopIntents}),e=>e.status===400);
 assert.throws(()=>brief({pins:{'stop-2':'qloo:bar-0'}}),e=>e.status===400);
 assert.throws(()=>brief({stopIntents:['drinks','drinks'],startTime:'11:00',endTime:'12:00',timing:{dateConfirmed:true,timeConfirmed:true,mode:'fixed'}}),/not enough time/);
});

import {createAgent,PLAN_TOOL,AUTOPILOT_TOOL} from '../src/agent.js';
import {reviseStops} from '../../shared/stop-intents.js';
import {suggestBudget} from '../../shared/budget-suggestion.js';
const interpret=(name,args,context=brief(),extra={})=>createAgent({getKey:()=> 'test',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name,arguments:JSON.stringify(args)}}]}}]})})}).interpret({message:'Revise this outing.',context,mode:name==='autopilot_day'?'autopilot':'guided',locationContext:{confirmed:true},...extra});
test('model tools expose an ordered repeated sequence separately from unique retrieval categories',()=>{
 assert.ok(PLAN_TOOL.function.parameters.properties.pins.properties['stop-1']);
 for(const properties of [PLAN_TOOL.function.parameters.properties,AUTOPILOT_TOOL.function.parameters.properties.changes.properties]){assert.equal(properties.activities.uniqueItems,true);assert.equal(properties.stopIntents.maxItems,3);assert.notEqual(properties.stopIntents.uniqueItems,true);assert.doesNotMatch(properties.activities.description,/sequence in experience.notes/);}
});
test('agent preserves ordered requests and exclusions through date, area, taste and full brief revisions',async()=>{
 const context=brief({pins:{'stop-1':'qloo:bar-0'},experience:{notes:'No meal.',searchTags:[]}});
 for(const [name,args] of [['autopilot_day',{changes:{date:'2099-01-02'}}],['revise_day',{date:'2099-01-02'}],['set_location',{area:'London, UK'}],['show_ui',{panel:'tastes',changes:{title:'An evening out'}}],['plan_day',{...context,date:'2099-01-02',stopIntents:undefined}]]){
  const result=await interpret(name,args,context);assert.deepEqual(result.request.stopIntents,['drinks','drinks'],name);assert.equal(result.request.experience.notes,'No meal.',name);assert.equal(result.request.pins['stop-1'],'qloo:bar-0',name);
 }
 const initial=await interpret('autopilot_day',{changes:{activities:['drinks'],stopIntents:['drinks','drinks'],experience:{notes:'No meal.',searchTags:[]}}},parseItinerary({area:'Osu'}));assert.deepEqual(initial.request.stopIntents,['drinks','drinks']);
 const reduced=await interpret('autopilot_day',{changes:{stopIntents:['drinks']}},context);assert.deepEqual(reduced.request.stopIntents,['drinks']);assert.deepEqual(reduced.request.activities,['drinks']);
});
test('sequence edits remap explicit kept venues by category occurrence, not the old slot number',()=>{
 const original=brief({stopIntents:['drinks','drinks'],pins:{'stop-1':'qloo:second'}});
 const moved=reviseStops(original,{activities:['coffee','drinks'],stopIntents:['coffee','drinks','drinks']});assert.deepEqual(moved.pins,{'stop-2':'qloo:second'});
 const kept=reviseStops(parseItinerary({activities:['drinks'],pins:{drinks:'qloo:first'}}),{stopIntents:['drinks','drinks']});assert.deepEqual(kept.pins,{'stop-0':'qloo:first'});
 assert.throws(()=>parseItinerary({...original,...reviseStops(original,{stopIntents:'two'})}),e=>e.status===400);
});
test('mixed repeated sequence preserves order, evidence, scheduling and distinct identities',async()=>{
 const discovery=createDiscovery({provider:{name:'qloo',resolveArtist:async()=>null,discover:async()=>['cafe','bar','bar'].map((tag,i)=>({entity_id:`venue-${i}`,name:`Venue ${i}`,tags:[{id:`urn:tag:category:qloo:${tag}`,name:tag}],properties:{address:'Osu, Accra, Ghana'}}))}});
 const request=brief({activities:['coffee','drinks'],stopIntents:['drinks','coffee','drinks'],date:'2099-01-01',startTime:'12:00',endTime:'17:00',timing:{dateConfirmed:true,timeConfirmed:true,mode:'fixed'}});
 const plan=await buildItinerary(discovery,request);assert.equal(plan.status,'complete');assert.deepEqual(plan.stops.map(s=>s.intent),request.stopIntents);assert.equal(new Set(plan.stops.map(s=>s.item.id)).size,3);assert.ok(plan.stops.every(s=>s.start&&s.item.reasons.some(r=>r.code==='intent_match')));assert.equal(new URL(plan.links.directions).searchParams.has('waypoints'),true);
 assert.ok(suggestBudget(brief())>suggestBudget(brief({stopIntents:['drinks']})));
});
test('candidate relevance review cannot remove an independently pinned repeated slot',async()=>{
 const discovery=engine();discovery.reviewCandidates=async({candidates})=>candidates.map(({index})=>({index,ids:[]}));
 const plan=await buildItinerary(discovery,brief({pins:{'stop-1':'qloo:bar-0'},experience:{notes:'No meal.'}}));assert.equal(plan.stops[1].item.id,'qloo:bar-0');assert.equal(plan.stops[0].item,null);assert.equal(plan.status,'partial');
});
test('adding a category retains repeated slots and selected route identities without hiding the addition',()=>{
 for(const source of [brief(),brief({route:[{intent:'drinks',placeId:'qloo:first'},{intent:'drinks',placeId:'qloo:second'}]})]){
  const changed=reviseStops(source,{activities:['drinks','coffee']});assert.deepEqual(changed.stopIntents,['drinks','drinks','coffee']);assert.equal(changed.route,undefined);assert.doesNotThrow(()=>parseItinerary({...source,...changed}));
  if(source.route)assert.deepEqual(changed.pins,{'stop-0':'qloo:first','stop-1':'qloo:second'});
  const removed=reviseStops({...source,...changed},{activities:['drinks']});assert.deepEqual(removed.stopIntents,['drinks','drinks']);
 }
 const legacy=brief({stopIntents:undefined,route:[{intent:'drinks',placeId:'qloo:first'},{intent:'drinks',placeId:'qloo:second'}]});assert.deepEqual(reviseStops(legacy,{date:'2099-01-02'}).stopIntents,['drinks','drinks']);
 const full=brief({stopIntents:['drinks','drinks','drinks']});assert.throws(()=>parseItinerary({...full,...reviseStops(full,{activities:['drinks','coffee']})}),e=>e.status===400);
});
