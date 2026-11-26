import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createApp} from '../src/app.js';
import {createDemoProvider} from '../src/demo-provider.js';
import {createAccounts,createAccountStore} from '../src/accounts.js';
import {createSyntheticReservationDriver} from '../src/synthetic-reservation-driver.js';

const instant=Date.parse('2026-11-26T09:00:00Z');
const now=()=>instant;
const entry=(id='plan-a',website='https://tables.example/book')=>({id,revision:1,plan:{
  request:{title:'Test visit',date:'2026-12-01',timing:{dateConfirmed:true,timeConfirmed:true,mode:'fixed'},area:'Accra',party:{adults:2,children:0},pins:{}},
  timeZone:'Africa/Accra',stops:[{id:'stop-a',start:'18:00',item:{id:'item-a',entityId:'entity-a',name:'Synthetic Venue',address:'Test Address',links:{website}}}],
}});
const input=()=>({stopId:'stop-a',itemId:'item-a',entityId:'entity-a',operation:'reservation',channel:'website',message:'Synthetic table request for two',personalData:{name:'Test Guest',email:'test@guest.example'},
  cost:{limitMinor:0,currency:'GHS',evidence:'Synthetic total covers all test fees',effectiveAt:instant-1,expiresAt:instant+600000,includesAllFees:true},terms:'Synthetic; do not send.',expiresAt:instant+600000,
});
async function fixture(t,{outcome='accepted',durable=false,clock=now,website}={}){
  const dir=durable?await mkdtemp(join(tmpdir(),'unstressed-synthetic-')):null;
  if(dir)t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=dir?join(dir,'accounts.json'):null,store=createAccountStore({file,now:clock});
  await store.transact(data=>{for(const ownerId of ['alice','bob']){
    data.users[ownerId]={id:ownerId,email:ownerId+'@example.test',profile:{},savedPlans:{'plan-a':entry('plan-a',website),'plan-b':entry('plan-b',website)}};
    data.sessions[createHash('sha256').update(ownerId).digest('base64url')]={userId:ownerId,expiresAt:instant+86400000};
  }});
  return {store,file,driver:createSyntheticReservationDriver({store,outcome,now:clock})};
}
const command=(r,key)=>({key,version:r.version,hash:r.hash});
async function approved(driver,planId='plan-a'){
  const change=(op,body,id)=>driver.change('alice',planId,op,body,id);
  let r=await change('prepare',{key:'prepare',snapshot:input()});
  r=await change('review',command(r,'review'),r.id);
  return change('approve',command(r,'approve'),r.id);
}

test('explicit review, durable one-shot dispatch, then distinct authenticated synthetic confirmation',async t=>{
  const {driver}=await fixture(t,{durable:true}),r=await approved(driver);
  assert.equal(r.approval.hash,r.hash);
  assert.equal(r.snapshot.contact.destination,'https://tables.example/book');
  assert.equal(r.snapshot.venue.entityId,'entity-a');
  assert.equal(r.snapshot.localTime,'18:00');
  await assert.rejects(driver.dispatch('bob','plan-a',r.id,command(r,'dispatch-bob')),/not found/);
  await assert.rejects(driver.dispatch('alice','plan-a',r.id,{...command(r,'wrong'),hash:'different'}),/current action/);
  const batch=await Promise.allSettled([
    driver.dispatch('alice','plan-a',r.id,command(r,'dispatch')),
    driver.dispatch('alice','plan-a',r.id,command(r,'dispatch')),
    driver.dispatch('alice','plan-a',r.id,command(r,'different-key'))
  ]);
  assert.equal(batch.filter(i=>i.status==='fulfilled').length,1);
  const result=batch.find(i=>i.status==='fulfilled').value;
  assert.equal(result.simulationOnly,true);
  const accepted=result.record;
  assert.equal(accepted.status,'submitted_awaiting_response');
  assert.equal(accepted.approval,null);
  assert.equal(accepted.evidence.length,1);
  assert.match(accepted.evidence[0].reference,/^SIMULATION-/);
  assert.equal(accepted.evidence[0].idempotencyKey,accepted.outbox.key);
  await assert.rejects(driver.applyReceipt('alice','plan-a',r.id,{event:{...accepted.evidence[0],outcome:'confirmed'},signature:'0'.repeat(64)}),/Unauthenticated/);
  const {record:confirmed}=await driver.confirmAccepted('alice','plan-a',r.id);
  assert.equal(confirmed.status,'provider_confirmed');
  assert.deepEqual(confirmed.evidence.map(e=>e.outcome),['accepted','confirmed']);
  assert.equal(confirmed.evidence[1].reference,accepted.evidence[0].reference);
  await assert.rejects(driver.dispatch('alice','plan-a',r.id,command(confirmed,'retry')),/transition/);
});
test('ambiguous adapter outcome survives restart and blocks fresh submit or alternate saved day',async t=>{
  const {driver,file}=await fixture(t,{outcome:'ambiguous',durable:true});
  const [r,other]=await Promise.all([approved(driver),approved(driver,'plan-b')]);
  const {record}=await driver.dispatch('alice','plan-a',r.id,command(r,'dispatch'));
  assert.equal(record.status,'submission_unknown');assert.equal(record.evidence.length,0);assert.ok(record.outbox.claim);
  const restart=createSyntheticReservationDriver({store:createAccountStore({file,now}),now});
  assert.deepEqual(await restart.read('alice','plan-a',r.id),record);
  await assert.rejects(restart.dispatch('alice','plan-a',r.id,command(record,'retry')),/transition/);
  await assert.rejects(restart.dispatch('alice','plan-b',other.id,command(other,'retry-other')),/Reconcile/);
  await assert.rejects(restart.confirmAccepted('alice','plan-a',r.id),/No accepted/);
});
test('stale, expired, or real destinations cannot dispatch; unrelated manual booking records remain empty',async t=>{
  let time=instant;const {driver,store}=await fixture(t,{clock:()=>time});
  const r=await approved(driver);time=instant+600000;
  await assert.rejects(driver.dispatch('alice','plan-a',r.id,command(r,'expired')),/expired/);
  time=instant;
  await store.transact(data=>{data.users.alice.savedPlans['plan-a'].plan.stops[0].item.links.website='https://other.example/book';});
  await assert.rejects(driver.dispatch('alice','plan-a',r.id,command(r,'changed-venue')),/changed/);
  const other=await fixture(t,{website:'https://production.test/book'});
  await assert.rejects(approved(other.driver),/isolated synthetic reservation/);
  assert.deepEqual((await createAccounts({store,now}).bookings('alice','plan-a')).bookings,[]);
});
test('the product HTTP entry point exposes no synthetic approval or submission and capability stays off',async t=>{
  const {store}=await fixture(t);
  const server=createApp({provider:createDemoProvider(),accounts:createAccounts({store,now}),rateLimit:false}).listen(0,'127.0.0.1');
  await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin='http://127.0.0.1:5173',base='http://127.0.0.1:'+server.address().port;
  const res=await fetch(base+'/api/actions/execution-capabilities');
  assert.equal(res.status,200);assert.equal((await res.json()).reservations.enabled,false);
  for(const path of ['/api/account/plans/plan-a/executions','/api/account/plans/plan-a/bookings/synthetic/approve','/api/actions/executions/dispatch']){
    const denied=await fetch(base+path,{method:'POST',headers:{Origin:origin,Cookie:'outing-session=alice','Content-Type':'application/json'},body:'{}'});
    assert.equal(denied.status,404);
  }
});
