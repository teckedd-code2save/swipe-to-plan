import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {historyTraversal} from '../test-support/history-navigation.js';

test('history synchronization waits for popstate, not the former 25 ms delay',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  const target=new EventTarget();let settled=false,started=0;
  const pending=historyTraversal(()=>started++,{target}).then(()=>{settled=true;});
  assert.equal(started,1);assert.equal(getEventListeners(target,'popstate').length,1);
  context.mock.timers.tick(25);await Promise.resolve();assert.equal(settled,false);
  context.mock.timers.tick(500);await Promise.resolve();assert.equal(settled,false);
  target.dispatchEvent(new Event('popstate'));await pending;assert.equal(settled,true);
  assert.equal(getEventListeners(target,'popstate').length,0);
  context.mock.timers.runAll();
});
test('history synchronization registers before action and catches immediate events',async()=>{
  const target=new EventTarget(),event=new Event('popstate');
  assert.equal(await historyTraversal(()=>target.dispatchEvent(event),{target}),event);
  assert.equal(getEventListeners(target,'popstate').length,0);
});
test('missing history completion fails within the bound instead of passing or hanging',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});const target=new EventTarget();
  const result=assert.rejects(historyTraversal(()=>{},{target,timeoutMs:2000}),/Expected popstate was not received within 2000 ms/);
  context.mock.timers.tick(2000);await result;assert.equal(getEventListeners(target,'popstate').length,0);
});
test('action errors propagate unchanged and remove the history listener',async()=>{
  const target=new EventTarget(),failure=new Error('Synthetic action failure');
  await assert.rejects(historyTraversal(()=>{throw failure;},{target}),error=>error===failure);
  assert.equal(getEventListeners(target,'popstate').length,0);
});
