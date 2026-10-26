import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionStops,spendingSummary,reportedPrice,reportedHours} from '../src/decision-evidence.js';
const plan={request:{budget:null,currency:'GHS',party:{adults:10,children:0}},allowance:{amount:400},stops:[{id:'dinner',item:{id:'one'},intent:'dinner'}],shortlist:[{item:{id:'one'},intent:'dinner'},{item:{id:'two'},intent:'dinner'}]};
test('comparison includes alternatives even when the outing has only one stop',()=>{assert.deepEqual(decisionStops(plan).map(s=>s.item.id),['one','two']);});
test('suggested spending cannot be represented as a user limit or a venue price',()=>{assert.deepEqual(spendingSummary(plan),{suggested:true,amount:400,currency:'GHS',people:10});assert.equal(reportedPrice({}), 'Prices unavailable');assert.equal(spendingSummary({...plan,request:{...plan.request,budget:250}}).amount,250);assert.equal(spendingSummary({...plan,request:{...plan.request,budget:250}}).suggested,false);});
test('missing hours remain unknown while closed and overnight hours retain their meaning',()=>{assert.deepEqual(reportedHours({hours:{monday:null,tuesday:[]}}),[{day:'tue',label:'Closed'}]);assert.deepEqual(reportedHours({hours:{friday:[{opens:'18:00',closes:'02:00',overnight:true}]}}),[{day:'fri',label:'18:00–02:00 (+1 day)'}]);});
