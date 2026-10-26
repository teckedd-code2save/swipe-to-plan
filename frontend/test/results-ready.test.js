import test from 'node:test';import assert from 'node:assert/strict';import {resultsReady} from '../src/results-ready.js';
const plan={request:{area:'East Legon',date:'2026-10-30',budget:null,timing:{dateConfirmed:true}},stops:[{item:{id:'one'}},{item:null}]};
test('first usable results become visible before the background review finishes',()=>{
 const result=resultsReady({...plan,qualityReview:{status:'pending'}},null);assert.equal(result.label,'1 place ready');assert.ok(result.key);
 assert.equal(result.key,resultsReady({...plan,qualityReview:{status:'complete'}},null).key);
});
test('new places generate a new notification and empty searches never claim places are ready',()=>{
 assert.notEqual(resultsReady(plan,null).key,resultsReady({...plan,stops:[{item:{id:'two'}}]},null).key);
 assert.equal(resultsReady({...plan,stops:[]},null).label,'Search complete');assert.equal(resultsReady(null,null).key,'');
});
test('fallback discovery also announces its real places',()=>{
 const result=resultsReady(null,{brief:plan.request,items:[{id:'one'},{id:'two'}]});assert.equal(result.label,'2 places ready');assert.equal(result.count,2);
});
