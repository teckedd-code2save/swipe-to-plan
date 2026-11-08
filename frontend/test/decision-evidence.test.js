import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionStops,comparisonKey,spendingSummary,reportedPrice,reportedHours} from '../src/decision-evidence.js';
const plan={request:{budget:null,currency:'GHS',party:{adults:10,children:0}},allowance:{amount:400},stops:[{id:'dinner',item:{id:'one'},intent:'dinner'}],shortlist:[{item:{id:'one'},intent:'dinner'},{item:{id:'two'},intent:'dinner'}]};
test('comparison includes alternatives even when the outing has only one stop',()=>{assert.deepEqual(decisionStops(plan).map(s=>s.item.id),['one','two']);});
test('suggested spending cannot be represented as a user limit or a venue price',()=>{assert.deepEqual(spendingSummary(plan),{suggested:true,amount:400,currency:'GHS',people:10});assert.equal(reportedPrice({}), 'Prices unavailable');assert.equal(spendingSummary({...plan,request:{...plan.request,budget:250}}).amount,250);assert.equal(spendingSummary({...plan,request:{...plan.request,budget:250}}).suggested,false);});
test('missing hours remain unknown while closed and overnight hours retain their meaning',()=>{assert.deepEqual(reportedHours({hours:{monday:null,tuesday:[]}}),[{day:'tue',label:'Closed'}]);assert.deepEqual(reportedHours({hours:{friday:[{opens:'18:00',closes:'02:00',overnight:true}]}}),[{day:'fri',label:'18:00–02:00 (+1 day)'}]);});
test('comparison lists a repeated venue once without changing ordered visit occurrences',()=>{
 const repeated={...plan,stops:[...plan.stops,{...plan.stops[0],id:'return-visit'}]};
 assert.deepEqual(decisionStops(repeated).map(s=>s.item.id),['one','two']);assert.equal(repeated.stops.length,2);
});

test('comparison identity changes for repeated occurrence additions, order, category and visit-time edits',()=>{
 const a={id:'stop-0',intent:'coffee',item:{id:'a',entityId:'qa'},start:'12:00',end:'13:00'},b={id:'stop-1',intent:'dinner',item:{id:'b',entityId:'qb'},start:'14:00',end:'15:00'};
 const original={...plan,request:{...plan.request,activities:['coffee','dinner']},stops:[a,b]},key=value=>comparisonKey(value,decisionStops(value));
 const added={...original,stops:[a,b,{...a,id:'stop-2',start:'16:00',end:'17:00'}]},reordered={...added,stops:[a,{...a,id:'stop-1'},b]};
 assert.deepEqual(decisionStops(original).map(s=>s.item.id),decisionStops(added).map(s=>s.item.id));
 assert.notEqual(key(original),key(added));assert.notEqual(key(added),key(reordered));
 assert.notEqual(key(added),key({...added,stops:added.stops.map((s,i)=>i===2?{...s,start:'18:00',end:'19:00'}:s)}));
 assert.notEqual(key(added),key({...added,request:{...added.request,pins:{'stop-2':'a'}}}));
 assert.notEqual(key(added),key({...added,stops:added.stops.map((s,i)=>i===2?{...s,intent:'dinner'}:s)}));
});
