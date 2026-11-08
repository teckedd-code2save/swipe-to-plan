import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberStops,toggleStopPin,isStopPinned,menuChoicePins} from '../src/stop-controls.js';
import {routeFromChoices} from '../src/shortlist.js';
import {planChanges} from '../src/day-state.js';
import {reviseStops} from '../../shared/stop-intents.js';
const make=()=>({request:{activities:['drinks'],stopIntents:['drinks','drinks'],pins:{}},stops:[{id:'stop-0',intent:'drinks',item:{id:'a',name:'A'}},{id:'stop-1',intent:'drinks',item:{id:'b',name:'B'}}]});
test('keep and unkeep either repeated slot independently, including legacy pins',()=>{
 const plan=make();plan.request.pins={drinks:'a'};
 assert.equal(isStopPinned(plan,plan.stops[0]),true);assert.equal(isStopPinned(plan,plan.stops[1]),false);
 plan.request.pins=toggleStopPin(plan,plan.stops[1]);assert.deepEqual(plan.request.pins,{'stop-0':'a','stop-1':'b'});
 plan.request.pins=toggleStopPin(plan,plan.stops[0]);assert.deepEqual(plan.request.pins,{'stop-1':'b'});
 assert.deepEqual(rememberStops(plan),{'stop-0':'a','stop-1':'b'});
});
test('menu choices pin selected repeated slots without arbitrarily assigning alternatives',()=>{
 const plan=make();plan.request.pins={drinks:'a'};assert.deepEqual(menuChoicePins(plan,[{intent:'drinks',placeId:'a'},{intent:'drinks',placeId:'b'},{intent:'drinks',placeId:'c'}]),{'stop-0':'a','stop-1':'b'});
});
test('selected route has a matching sequence and survives unrelated edits',()=>{
 const plan=make(),request=routeFromChoices(plan,['b','a']);
 assert.deepEqual(request.stopIntents,['drinks','drinks']);assert.deepEqual(request.route.map(s=>s.placeId),['b','a']);
 assert.deepEqual(reviseStops(request,{date:'2026-12-01'}).route,request.route);
 assert.deepEqual(reviseStops(request,{budget:200}).stopIntents,['drinks','drinks']);
 assert.deepEqual(reviseStops(request,{activities:['coffee']}).stopIntents,['coffee']);
 assert.deepEqual(reviseStops(request,{stopIntents:['drinks']}).pins,{drinks:'b'});
});
test('revision comparison matches slots rather than the first equal category',()=>{
 const before=make(),after=make();assert.deepEqual(planChanges(before,after),[]);
 after.stops[1].item={id:'c',name:'C'};assert.deepEqual(planChanges(before,after),[{intent:'drinks',label:'Updated',from:'B',to:'C'}]);
});
test('a slot-keyed pin for a unique category can be released',()=>{
 const plan=make();plan.request.stopIntents=['coffee','drinks'];plan.request.activities=['coffee','drinks'];plan.stops[0].intent='coffee';plan.request.pins={'stop-1':'b'};
 assert.deepEqual(toggleStopPin(plan,plan.stops[1]),{});
});
test('partial plan pin identity uses original slots, not only filled stops',()=>{
 const plan=make();plan.stops[0].item=null;
 assert.deepEqual(rememberStops(plan),{'stop-1':'b'});
 assert.deepEqual(toggleStopPin(plan,plan.stops[1]),{'stop-1':'b'});
 assert.deepEqual(menuChoicePins(plan,[{intent:'drinks',placeId:'b'}]),{'stop-1':'b'});
});
