import test from 'node:test';
import {once} from 'node:events';
import {createApp} from '../src/app.js';
import {createDemoProvider} from '../src/demo-provider.js';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,rename,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAccounts,createAccountStore} from '../src/accounts.js';
import {createExecutionProtocol,executionSnapshot,executionHash,executionBlockers,executionCapabilities,invalidateExecution} from '../src/execution-ledger.js';
const start=Date.parse('2026-01-01T00:00:00Z'),now=()=>start;
const plan=()=>({request:{title:'Day',date:'2026-12-01',timing:{dateConfirmed:true,timeConfirmed:true,mode:'fixed'},area:'Accra',party:{adults:2,children:0},pins:{}},timeZone:'Africa/Accra',stops:[{id:'stop-0',start:'18:00',item:{id:'venue-a',entityId:'entity-a',name:'Venue A',links:{website:'https://venue.example/',phone:'tel:+233123456789'}}}],privateTastes:'NEVER SHARE THIS'});
const entry=()=>({id:'p',revision:1,plan:plan()});
const snapshot=()=>({stopId:'stop-0',itemId:'venue-a',entityId:'entity-a',operation:'reservation',channel:'phone',message:'Please reserve a table for two.',personalData:{name:'Alex'},cost:{limitMinor:100,currency:'USD',evidence:'Test quote includes all transport and provider fees',effectiveAt:start-1,expiresAt:start+600000,includesAllFees:true},terms:'Test terms: no cancellation fee.',expiresAt:start+600000});
const command=(r,key,extra={})=>({key,version:r.version,hash:r.hash,...extra});
function protocol(options={}){
 let time=start;const apply=createExecutionProtocol({now:()=>time,simulation:true,verifyEvidence:()=>true,...options}),e=entry();
 const prepare=(key='prepare',overrides={})=>apply(e,'owner','prepare',{key,snapshot:{...snapshot(),...overrides}});
 const step=(r,op,key=op,extra={})=>apply(e,'owner',op,command(r,key,extra),r.id);
 const reserve=()=>{let r=prepare();r=step(r,'review');r=step(r,'approve');return step(r,'reserve');};
 return {apply,e,prepare,step,reserve,time:v=>time=v};
}
const evidence=(r,extra={})=>({eventId:'event-1',actionId:r.id,idempotencyKey:r.outbox.key,snapshotHash:r.hash,outcome:'confirmed',venue:r.snapshot.venue,date:r.snapshot.date,localTime:r.snapshot.localTime,timeZone:r.snapshot.timeZone,party:r.snapshot.party,provider:'fake',reference:'FAKE-ONLY',occurredAt:start,...extra});
async function fixture(file){const store=createAccountStore({file,now});await store.transact(data=>{for(const id of ['a','b']){data.users[id]={id,profile:{},savedPlans:{p:entry()}};data.sessions[createHash('sha256').update(id).digest('base64url')]={userId:id,expiresAt:start+86400000};}});return {store,accounts:createAccounts({store,now})};}

test('capabilities explicitly disable calls, messages, reservations, payments and approval',()=>{
 for(const capability of Object.values(executionCapabilities())){assert.equal(capability.enabled,false);assert.ok(capability.reason);}
});

test('snapshot is exact, source-bound, isolated, minimal and immutable to caller changes',()=>{
 const p=protocol(),input=snapshot(),r=p.apply(p.e,'owner','prepare',{key:'x',snapshot:input});
 input.personalData.name='Changed';r.snapshot.message='Changed';
 const stored=p.apply(p.e,'owner','list')[0];assert.equal(stored.snapshot.personalData.name,'Alex');assert.equal(stored.snapshot.message,snapshot().message);
 assert.equal(stored.hash,executionHash(stored.snapshot));assert.equal(JSON.stringify(stored).includes('NEVER SHARE THIS'),false);
 for(const mutate of [s=>s.venue.entityId='x',s=>s.venue.stopId='x',s=>s.contact.destination='tel:+123456789',s=>s.date='2027-01-01',s=>s.localTime='19:00',s=>s.party.adults=3,s=>s.message+='!',s=>s.personalData.name='Other',s=>s.cost.limitMinor=101,s=>s.terms+='!',s=>s.expiresAt++]){const s=structuredClone(stored.snapshot);mutate(s);assert.notEqual(executionHash(s),stored.hash);}
});

test('unknown price, recipient, policy, permission and message policy remain explicit blockers',()=>{
 const s=executionSnapshot(entry(),{...snapshot(),cost:null,terms:null,channel:'whatsapp'}),reasons=executionBlockers(s,{now:start});
 for(const reason of ['live_execution_disabled','cost_unknown','terms_unreviewed','recipient_not_verified','provider_policy_unknown','recipient_permission_unknown','total_price_unverified','message_policy_unknown'])assert.ok(reasons.includes(reason));
 const p=protocol();let r=p.prepare('unknown',{cost:null});assert.throws(()=>p.step(r,'review'),/need review/);
 assert.throws(()=>p.prepare('bad-zero',{cost:{limitMinor:0,currency:'USD'}}),/total cost/);
 r=p.prepare('explicit-zero',{cost:{...snapshot().cost,limitMinor:0}});assert.equal(p.step(r,'review','zero-review').status,'awaiting_review');
});

test('recipient consent is bound to recipient, sender and channel, separate from customer mandate',()=>{
 const s=executionSnapshot(entry(),snapshot());
 const descriptor={id:'fake',sender:'business-1',channels:['phone'],operations:['reservation'],policy:{status:'eligible',evidence:'verified policy',expiresAt:start+1000},recipientPermission:{status:'granted',destination:s.contact.destination,channel:'phone',sender:'business-1',evidence:'venue granted calls',expiresAt:start+1000,callPermission:true},pricing:{status:'verified',snapshotCostHash:executionHash(s.cost),evidence:'total quote verified',expiresAt:start+1000}};
 assert.deepEqual(executionBlockers(s,{now:start,descriptor}),['live_execution_disabled','recipient_not_verified']);
 for(const [field,value] of [['destination','tel:+99999999'],['sender','other-business'],['channel','whatsapp'],['expiresAt',start]]){const d=structuredClone(descriptor);d.recipientPermission[field]=value;assert.ok(executionBlockers(s,{now:start,descriptor:d}).includes('recipient_permission_unknown'));}
 const d=structuredClone(descriptor);d.recipientPermission.callPermission=false;assert.ok(executionBlockers(s,{now:start,descriptor:d}).includes('call_permission_unknown'));
 d.pricing.snapshotCostHash='different';assert.ok(executionBlockers(s,{now:start,descriptor:d}).includes('total_price_unverified'));
});

test('unsupported data/payment input cannot enter the snapshot',()=>{
 for(const overrides of [{operation:'payment'},{personalData:{tastes:'private'}},{channel:'email'},{message:''},{cost:{...snapshot().cost,limitMinor:-1}},{cost:{...snapshot().cost,includesAllFees:false}}])assert.throws(()=>executionSnapshot(entry(),{...snapshot(),...overrides}));
});

test('production protocol cannot approve or reserve; no adapter is invoked',()=>{
 let calls=0;const p=protocol({simulation:false,adapter:()=>calls++});const r=p.prepare();assert.equal(r.authorityScope,'disabled');
 for(const op of ['review','approve','reserve'])assert.throws(()=>p.step(r,op),/disabled/);assert.equal(calls,0);assert.equal(r.outbox,null);
});

test('fake lifecycle binds owner/version/hash and creates only a simulation outbox',()=>{
 const p=protocol();let r=p.prepare();assert.equal(r.status,'prepared');assert.throws(()=>p.step(r,'approve'),/transition/);
 r=p.step(r,'review');assert.equal(r.status,'awaiting_review');r=p.step(r,'approve');assert.equal(r.approval.version,r.version);assert.equal(r.approval.hash,r.hash);
 assert.throws(()=>p.apply(p.e,'other','reserve',command(r,'steal'),r.id),/not found/);
 assert.throws(()=>p.apply(p.e,'owner','reserve',{...command(r,'wrong'),hash:'bad'},r.id),/version and hash/);
 r=p.step(r,'reserve');assert.equal(r.status,'submission_pending');assert.equal(r.outbox.scope,'simulation_only');assert.equal(r.outbox.snapshotHash,r.hash);
 assert.equal(JSON.stringify(r.outbox).includes('NEVER SHARE THIS'),false);
});

test('revocation/expiry/stale versions prevent authority restoration or request replay',()=>{
 const p=protocol();let r=p.prepare();r=p.step(r,'review');const old=r;r=p.step(r,'approve');
 assert.deepEqual(p.step(old,'approve'),r);
 r=p.step(r,'revoke');assert.throws(()=>p.step(old,'approve'),/replay conflicts/);assert.equal(r.status,'cancelled');assert.equal(r.approval,null);assert.throws(()=>p.step(r,'reserve'),/changed or expired/);
 const q=protocol();r=q.prepare();r=q.step(r,'review');r=q.step(r,'approve');q.time(start+600000);assert.throws(()=>q.step(r,'reserve'),/expired/);
});

test('plan/source edits and undo cannot restore authority even with identical details',()=>{
 for(const mutate of [e=>e.revision++,e=>e.plan.stops[0].start='19:00',e=>e.plan.stops[0].item.links.phone='tel:+233999999999',e=>e.plan.request.party.adults=3]){
  const p=protocol();let r=p.prepare();r=p.step(r,'review');r=p.step(r,'approve');mutate(p.e);assert.throws(()=>p.step(r,'reserve'),/changed/);
 }
 const p=protocol();let r=p.prepare();r=p.step(r,'review');r=p.step(r,'approve');invalidateExecution(p.e);p.e.plan=plan();r=p.apply(p.e,'owner','list')[0];assert.throws(()=>p.step(r,'reserve'),/changed/);assert.equal(r.approval,null);
});

test('invalid local times, missing timezone, ambiguous DST and stale cost block review',()=>{
 for(const change of [e=>e.plan.request.date='2026-02-30',e=>e.plan.timeZone=null,e=>{e.plan.timeZone='America/New_York';e.plan.request.date='2026-11-01';e.plan.stops[0].start='01:30';}]){const p=protocol();change(p.e);const r=p.prepare();assert.throws(()=>p.step(r,'review'),/need review/);}
 const p=protocol(),r=p.prepare('expired-cost',{cost:{...snapshot().cost,expiresAt:start}});assert.throws(()=>p.step(r,'review'),/need review/);
});

test('pending/unknown blocks duplicate and cross-channel actions, cancellation and auto retry',()=>{
 const p=protocol();let r=p.reserve(),key=r.outbox.key;
 assert.throws(()=>p.prepare('other-channel',{channel:'whatsapp'}),/Reconcile/);
 assert.throws(()=>p.step(r,'revoke'),/may already/);
 r=p.step(r,'recover');assert.equal(r.status,'submission_unknown');assert.equal(r.outbox.key,key);assert.equal(r.approval,null);
 assert.throws(()=>p.step(r,'reserve','retry'),/transition/);assert.throws(()=>p.prepare('retry-create'),/Reconcile/);
});

test('parallel prepared channels cannot both reserve the same occurrence',()=>{
 const p=protocol();let a=p.prepare('a'),b=p.prepare('b',{channel:'whatsapp'});
 a=p.step(a,'review','ar');b=p.step(b,'review','br');a=p.step(a,'approve','aa');b=p.step(b,'approve','ba');
 p.step(a,'reserve','as');assert.throws(()=>p.step(b,'reserve','bs'),/Another action/);
});

test('trusted evidence required; matching explicit provider confirmation only',()=>{
 const p=protocol({verifyEvidence:()=>false});let r=p.reserve();assert.throws(()=>p.step(r,'reconcile','event',{event:evidence(r)}),/authenticated/);
 for(const change of [{actionId:'wrong'},{snapshotHash:'wrong'},{idempotencyKey:'wrong'},{date:'2027-01-01'},{localTime:'19:00'},{timeZone:'UTC'},{party:{adults:3,children:0}},{venue:{entityId:'other'}},{occurredAt:start-1},{occurredAt:start+1},{reference:''}]){const q=protocol(),a=q.reserve();assert.throws(()=>q.step(a,'reconcile','bad',{event:evidence(a,change)}));}
 const q=protocol();r=q.reserve();r=q.step(r,'reconcile','accept',{event:evidence(r,{outcome:'accepted'})});assert.equal(r.status,'submitted_awaiting_response');assert.equal(r.approval,null);
 r=q.step(r,'reconcile','confirm',{event:evidence(r,{eventId:'event-2'})});assert.equal(r.status,'provider_confirmed');assert.equal(r.evidence.length,2);assert.equal(r.userReport,null);
});

test('replay, duplicate callbacks and out-of-order evidence do not change state',()=>{
 const p=protocol();let r=p.reserve();const body=command(r,'event',{event:evidence(r,{outcome:'accepted'})});r=p.apply(p.e,'owner','reconcile',body,r.id);
 assert.deepEqual(p.apply(p.e,'owner','reconcile',body,r.id),r);
 assert.throws(()=>p.step(r,'reconcile','duplicate',{event:evidence(r,{outcome:'accepted'})}),/already reconciled/);
 p.time(start+100);r=p.step(r,'reconcile','later',{event:evidence(r,{eventId:'later',outcome:'accepted',occurredAt:start+100})});
 r=p.step(r,'reconcile','old',{event:evidence(r,{eventId:'old',outcome:'confirmed',occurredAt:start+50})});assert.equal(r.status,'submission_unknown');assert.equal(r.evidence.at(-1).outcome,'confirmed');assert.ok(r.reconciliationRequired);
});

test('late/stale confirmation is preserved as external evidence without confirming current plan',()=>{
 for(const change of [p=>{p.e.revision++;invalidateExecution(p.e);},p=>p.time(start+600000)]){
  const p=protocol();let r=p.reserve();change(p);r=p.apply(p.e,'owner','list')[0];r=p.step(r,'reconcile','late',{event:evidence(r)});assert.equal(r.status,'submission_unknown');assert.equal(r.evidence[0].outcome,'confirmed');assert.ok(r.reconciliationRequired);assert.equal(r.approval,null);assert.throws(()=>p.prepare('replacement',{expiresAt:start+1200000}),/Reconcile/);
 }
});

test('owner account isolation, handoff separation, private exports and unsupported live methods',async()=>{
 const {accounts,store}=await fixture();const r=await accounts.executions('a','p','prepare',{key:'a',snapshot:snapshot()});
 assert.equal((await accounts.executions('b','p')).length,0);
 await assert.rejects(accounts.executions('b','p','revoke',command(r,'steal'),r.id),/not found/);
 await assert.rejects(accounts.executions('bearer-token','p'),/not found/);
 for(const op of ['approve','reserve','reconcile','report'])await assert.rejects(accounts.executions('a','p',op,command(r,op),r.id),/disabled/);
 assert.equal(JSON.stringify(await accounts.getPlan('a','p')).includes('Please reserve'),false);
 assert.equal((await accounts.bookings('a','p')).bookings.length,0);
 await store.transact(data=>{data.circles.c={id:'c',name:'Circle',members:[{userId:'a'},{userId:'b'}]};data.users.a.savedPlans.p.circleIds=['c'];});
 assert.equal(JSON.stringify(await accounts.getCirclePlan('b','a','p')).includes('Please reserve'),false);
});

test('plan changes atomically revoke private authority; undo/forks do not restore or copy it',async()=>{
 const {accounts,store}=await fixture();await accounts.executions('a','p','prepare',{key:'a',snapshot:snapshot()});
 await accounts.keepPlan({session:'a',id:'p',revision:2},plan());let r=(await accounts.executions('a','p'))[0];assert.equal(r.stale,true);assert.equal(r.status,'cancelled');
 await accounts.editSavedPlan('a','p',{revision:2,restoreRevision:1});assert.equal((await accounts.executions('a','p'))[0].stale,true);
 await store.transact(data=>data.users.a.savedPlans.p.sourceDayId='shared');
 const fork=await accounts.editSavedPlan('a','p',{revision:3,pins:{}});assert.notEqual(fork.savedPlan.id,'p');assert.deepEqual(await accounts.executions('a',fork.savedPlan.id),[]);
});

test('serialized transaction races reserve once or invalidate before reservation',async()=>{
 const {store,accounts}=await fixture(),apply=createExecutionProtocol({now,simulation:true});
 const transact=(op,body,id)=>store.transact(data=>apply(data.users.a.savedPlans.p,'a',op,body,id));
 let r=await transact('prepare',{key:'p',snapshot:snapshot()});r=await transact('review',command(r,'r'),r.id);r=await transact('approve',command(r,'a'),r.id);
 const results=await Promise.allSettled([transact('reserve',command(r,'one'),r.id),transact('reserve',command(r,'two'),r.id)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 await assert.rejects(accounts.removePlan('a','p'),/Reconcile/);
 const f=await fixture();let a;await f.store.transact(data=>{const e=data.users.a.savedPlans.p;a=apply(e,'a','prepare',{key:'p',snapshot:snapshot()});a=apply(e,'a','review',command(a,'r'),a.id);a=apply(e,'a','approve',command(a,'a'),a.id);});
 await f.accounts.keepPlan({session:'a',id:'p',revision:2},plan());await assert.rejects(f.store.transact(data=>apply(data.users.a.savedPlans.p,'a','reserve',command(a,'dispatch'),a.id)),/version and hash/);
});

test('durable outbox survives restart; ambiguous fake write requires reconciliation, never automatic retry',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'execution-ledger-'));try{
  const file=join(dir,'accounts.json'),{store}=await fixture(file),apply=createExecutionProtocol({now,simulation:true});
  let r;await store.transact(data=>{const e=data.users.a.savedPlans.p;r=apply(e,'a','prepare',{key:'p',snapshot:snapshot()});r=apply(e,'a','review',command(r,'r'),r.id);r=apply(e,'a','approve',command(r,'a'),r.id);r=apply(e,'a','reserve',command(r,'s'),r.id);});
  let calls=0;const fakeAdapter={async send(outbox){assert.equal(outbox.scope,'simulation_only');calls++;throw Error('ambiguous fake write');}};
  await assert.rejects(fakeAdapter.send(r.outbox));const restart=createAccountStore({file,now});
  const persisted=await restart.read(data=>data.users.a.savedPlans.p.executionLedger.records[0]);assert.equal(persisted.status,'submission_pending');assert.equal(persisted.outbox.key,r.outbox.key);
  r=await restart.transact(data=>apply(data.users.a.savedPlans.p,'a','recover',command(persisted,'recover'),persisted.id));
  await assert.rejects(restart.transact(data=>apply(data.users.a.savedPlans.p,'a','reserve',command(r,'retry'),r.id)));assert.equal(calls,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('write failure rolls back outbox and key; no fake side effect runs before durable commit',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'execution-failure-'));try{
  const file=join(dir,'accounts.json'),backup=join(dir,'backup.json'),{store}=await fixture(file),apply=createExecutionProtocol({now,simulation:true});let r,calls=0;
  await store.transact(data=>{const e=data.users.a.savedPlans.p;r=apply(e,'a','prepare',{key:'p',snapshot:snapshot()});r=apply(e,'a','review',command(r,'r'),r.id);r=apply(e,'a','approve',command(r,'a'),r.id);});
  await rename(file,backup);await mkdir(file);
  const dispatch=async()=>{const committed=await store.transact(data=>apply(data.users.a.savedPlans.p,'a','reserve',command(r,'reserve'),r.id));calls++;return committed;};
  await assert.rejects(dispatch());assert.equal(calls,0);assert.equal((await store.read(data=>data.users.a.savedPlans.p.executionLedger.records[0])).status,'approved');
  await rm(file,{recursive:true});await rename(backup,file);const committed=await dispatch();assert.equal(committed.status,'submission_pending');assert.equal(calls,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});


test('public capability route is read-only and offers no approval, dispatch or webhook route',async t=>{
 const server=createApp({rateLimit:false,provider:createDemoProvider()}).listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const root=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(`${root}/api/actions/execution-capabilities`);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),executionCapabilities());
 for(const path of ['/api/actions/execution-capabilities','/api/actions/executions','/api/actions/executions/approve','/api/actions/executions/dispatch','/api/actions/executions/webhook'])assert.equal((await fetch(root+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404);
});

test('missing contact and venue identity cannot acquire even simulated authority',()=>{
 const p=protocol();p.e.plan.stops[0].item.links={};const r=p.prepare();assert.throws(()=>p.step(r,'review'),/need review/);
 assert.throws(()=>executionSnapshot(entry(),{...snapshot(),entityId:undefined}),/exact venue/);
});


test('provider rejection and cancellation require evidence and remain separate from reports/payment',()=>{
 for(const outcome of ['rejected','cancelled']){
  const p=protocol();let r=p.reserve();r=p.step(r,'reconcile',outcome,{event:evidence(r,{outcome})});assert.equal(r.status,outcome);assert.equal(r.approval,null);assert.equal(r.userReport,null);assert.equal(r.payment,undefined);assert.equal(p.prepare('replacement').status,'prepared');
 }
});


test('moving an unresolved venue to another occurrence or saved day cannot bypass duplicate guard',async()=>{
 const p=protocol();p.reserve();p.e.plan.stops[0].id='new-stop';assert.throws(()=>p.prepare('move',{stopId:'new-stop'}),/Reconcile/);
 const {store,accounts}=await fixture(),apply=createExecutionProtocol({now,simulation:true});
 await store.transact(data=>{const e=data.users.a.savedPlans.p;let r=apply(e,'a','prepare',{key:'p',snapshot:snapshot()});r=apply(e,'a','review',command(r,'r'),r.id);r=apply(e,'a','approve',command(r,'a'),r.id);apply(e,'a','reserve',command(r,'s'),r.id);data.users.a.savedPlans.fork={...entry(),id:'fork'};});
 await assert.rejects(accounts.executions('a','fork','prepare',{key:'new',snapshot:snapshot()}),/Reconcile/);
});


test('authenticated cancellation resolves confirmed and stale historical bookings; deletion waits for resolution',async()=>{
 const p=protocol();let r=p.reserve();r=p.step(r,'reconcile','confirmed',{event:evidence(r)});
 assert.throws(()=>p.step(r,'reconcile','regress',{event:evidence(r,{eventId:'regress',outcome:'accepted'})}),/Out-of-order/);
 r=p.step(r,'reconcile','cancelled',{event:evidence(r,{eventId:'cancel',outcome:'cancelled'})});assert.equal(r.status,'cancelled');assert.equal(r.evidence.length,2);assert.equal(p.prepare('replacement').status,'prepared');
 const {accounts,store}=await fixture(),apply=createExecutionProtocol({now,simulation:true,verifyEvidence:()=>true});
 await store.transact(data=>{const e=data.users.a.savedPlans.p;let a=apply(e,'a','prepare',{key:'p',snapshot:snapshot()});a=apply(e,'a','review',command(a,'r'),a.id);a=apply(e,'a','approve',command(a,'a'),a.id);a=apply(e,'a','reserve',command(a,'s'),a.id);apply(e,'a','reconcile',command(a,'confirm',{event:evidence(a)}),a.id);});
 await assert.rejects(accounts.removePlan('a','p'),/Reconcile/);
 await accounts.keepPlan({session:'a',id:'p',revision:2},plan());let a=(await accounts.executions('a','p'))[0];assert.equal(a.status,'submission_unknown');assert.ok(a.reconciliationRequired);assert.equal(a.evidence[0].outcome,'confirmed');await assert.rejects(accounts.removePlan('a','p'),/Reconcile/);
 await store.transact(data=>apply(data.users.a.savedPlans.p,'a','reconcile',command(a,'cancel',{event:evidence(a,{eventId:'cancel',outcome:'cancelled'})}),a.id));
 await accounts.removePlan('a','p');await assert.rejects(accounts.getPlan('a','p'),/not in your account/);
});

test('history capacity never blocks revocation, recovery or terminal reconciliation',()=>{
 const fill=p=>{while(p.e.executionLedger.requests.length<500)p.e.executionLedger.requests.push({key:`padding-${p.e.executionLedger.requests.length}`});};
 const p=protocol();let r=p.prepare();r=p.step(r,'review');r=p.step(r,'approve');fill(p);assert.equal(p.step(r,'revoke').status,'cancelled');assert.throws(()=>p.prepare('over-cap'),/limit/);
 for(const outcome of ['confirmed','rejected','cancelled']){const q=protocol();let a=q.reserve();fill(q);a=q.step(a,'recover');assert.equal(a.status,'submission_unknown');assert.throws(()=>q.step(a,'reconcile','accepted',{event:evidence(a,{outcome:'accepted'})}),/limit/);a=q.step(a,'reconcile','terminal',{event:evidence(a,{outcome})});assert.equal(a.status,outcome==='confirmed'?'provider_confirmed':outcome);}
});


test('delayed confirmation after a terminal event remains historical or requires explicit reconciliation',()=>{
 const p=protocol();let r=p.reserve();p.time(start+100);r=p.step(r,'reconcile','cancel',{event:evidence(r,{eventId:'cancel',outcome:'cancelled',occurredAt:start+100})});
 r=p.step(r,'reconcile','old-confirm',{event:evidence(r,{eventId:'old-confirm',occurredAt:start+50})});assert.equal(r.status,'cancelled');assert.equal(r.evidence.length,2);
 p.time(start+200);r=p.step(r,'reconcile','new-confirm',{event:evidence(r,{eventId:'new-confirm',occurredAt:start+200})});assert.equal(r.status,'submission_unknown');assert.ok(r.reconciliationRequired);assert.throws(()=>p.prepare('duplicate'),/Reconcile/);
 const q=protocol();let a=q.reserve();a=q.step(a,'reconcile','reject',{event:evidence(a,{outcome:'rejected'})});a=q.step(a,'reconcile','inconsistent',{event:evidence(a,{eventId:'contradiction'})});assert.equal(a.status,'submission_unknown');assert.equal(a.evidence.length,2);
});
