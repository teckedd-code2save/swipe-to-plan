import test from 'node:test';import assert from 'node:assert/strict';
import {armTarget,allowFixtureRequest,acknowledgeOffline,dispatchRequest,targetFilter} from './guard-core.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const origin='http://127.0.0.1:9999',request={method:'GET',url:origin+'/immediate'};
test('MOCK: first execution is not resumed before Fetch acknowledgement',async()=>{
 const fetch=deferred(),calls=[],state={id:'worker1',type:'worker',paused:true};
 const send=async(method)=>{calls.push(method);if(method==='Fetch.enable')await fetch.promise;};
 const job=armTarget(send,state,()=>false);await Promise.resolve();await Promise.resolve();
 assert.deepEqual(calls,['Target.setAutoAttach','Fetch.enable']);assert.notEqual(state.ready,true);
 fetch.resolve();await job;assert.equal(calls.at(-1),'Runtime.runIfWaitingForDebugger');assert.equal(state.ready,true);
});
test('MOCK: unsupported worker Fetch never resumes worker',async()=>{
 const calls=[],state={id:'worker1',type:'worker',paused:true};
 await assert.rejects(armTarget(async method=>{calls.push(method);if(method==='Fetch.enable')throw Error('Method not found');},state,()=>false),/Method not found/);
 assert.ok(!calls.includes('Runtime.runIfWaitingForDebugger'));assert.notEqual(state.ready,true);
});
test('MOCK: target created or waiting during freeze never resumes',async()=>{
 let frozen=false;const fetch=deferred(),calls=[],state={id:'nested',type:'worker',paused:true};
 const job=armTarget(async m=>{calls.push(m);if(m==='Fetch.enable')await fetch.promise;},state,()=>frozen);
 await Promise.resolve();frozen=true;fetch.resolve();await assert.rejects(job,/after freeze/);assert.ok(!calls.includes('Runtime.runIfWaitingForDebugger'));
});
test('MOCK: positive worker GET and negative POST/nonfixture controls',async()=>{
 const state={ready:true};assert.equal(await allowFixtureRequest(request,state,()=>false,origin),true);
 for(const r of [{...request,method:'POST'},{...request,url:'http://127.0.0.1:9988/private'},{...request,url:'https://external.example/'}])assert.equal(await allowFixtureRequest(r,state,()=>false,origin),false);
});
test('MOCK: pending async policy cannot continue after freeze',async()=>{
 const check=deferred();let frozen=false;
 const job=allowFixtureRequest(request,{ready:true},()=>frozen,origin,()=>check.promise);
 frozen=true;check.resolve(true);assert.equal(await job,false);
});
test('MOCK: target revoked during async policy fails closed',async()=>{
 const check=deferred(),state={ready:true};const job=allowFixtureRequest(request,state,()=>false,origin,()=>check.promise);state.ready=false;check.resolve(true);assert.equal(await job,false);
});
test('MOCK: offline barrier rejects any target command failure',async()=>{
 await assert.rejects(acknowledgeOffline(async(method,params,id)=>{if(id==='nested'&&method==='Network.emulateNetworkConditions')throw Error('unsupported offline');},[{id:'page',ready:true},{id:'nested',ready:true}]),/unsupported offline/);
});
test('MOCK: unknown/unpaused target is rejected before any protocol command',async()=>{
 for(const state of [{id:'shared',type:'shared_worker',paused:true},{id:'worker',type:'worker',paused:false}]){let calls=0;await assert.rejects(armTarget(async()=>{calls++;},state,()=>false));assert.equal(calls,0);}
});

test('MOCK: freeze between policy resolution and actual dispatch denies request',async()=>{
 let frozen=false;const calls=[],state={ready:true,epoch:0};const proposed=await allowFixtureRequest(request,state,()=>frozen,origin);assert.equal(proposed,true);frozen=true;
 await dispatchRequest(async method=>calls.push(method),'req','worker',proposed,state,0,()=>frozen);assert.deepEqual(calls,['Fetch.failRequest']);
});
test('MOCK: revoked then rearmed target epoch cannot reuse old approval',async()=>{
 const calls=[],state={ready:true,epoch:0};const proposed=await allowFixtureRequest(request,state,()=>false,origin);state.epoch++;
 await dispatchRequest(async method=>calls.push(method),'req','worker',proposed,state,0,()=>false);assert.deepEqual(calls,['Fetch.failRequest']);
});

test('MOCK: root and recursive filters exclude only browser containers/internal UI',async()=>{
 assert.deepEqual(targetFilter,[{type:'browser',exclude:true},{type:'tab',exclude:true},{type:'browser_ui',exclude:true},{}]);
 for(const type of ['page','iframe','worker','shared_worker','service_worker','unknown_executable']){
  const rule=targetFilter.find(r=>!r.type||r.type===type);assert.notEqual(rule.exclude,true);
 }
 const calls=[];await armTarget(async(method,params)=>calls.push({method,params}),{id:'worker',type:'worker',paused:true},()=>false);
 assert.deepEqual(calls[0].params.filter,targetFilter);
});
