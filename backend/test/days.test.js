import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDays,createDayStore} from '../src/days.js';
import {createDiscovery} from '../src/plan.js';
import {createDemoProvider} from '../src/demo-provider.js';
const person=(id,name=id,vibes=[])=>({id,name,artists:[],vibes});
const engine=()=>createDiscovery({provider:createDemoProvider()});
const fixture=async(options={})=>{const days=createDays({discovery:engine(),...options});const day=await days.create({request:{people:[person('host','Alex')],party:{adults:1}}});await days.settled(day.id);return {days,day};};

test('shared-day capabilities restrict every mutation and never disclose other edit tokens',async()=>{
  const {days,day}=await fixture();
  await assert.rejects(days.get(day.id,''),e=>e.status===403);
  const guest=await days.get(day.id,day.inviteToken);
  assert.equal(guest.access.role,'guest');assert.equal(guest.participantLinks,undefined);assert.equal(guest.inviteToken,undefined);
  assert.ok(guest.members.every(p=>!p.editToken));
  const member=await days.join(day.id,day.inviteToken,{name:'Sam',artists:['Tems'],vibes:[]});
  assert.equal(member.access.role,'member');assert.equal(member.participantLinks,undefined);
  await assert.rejects(days.updatePerson(day.id,member.token,'host',{name:'Hacked'}),e=>e.status===403);
  await assert.rejects(days.updatePerson(day.id,day.inviteToken,'host',{name:'Hacked'}),e=>e.status===403);
  await assert.rejects(days.add(day.id,member.token,{name:'Extra'}),e=>e.status===403);
  await assert.rejects(days.remove(day.id,member.token,'host'),e=>e.status===403);
  await assert.rejects(days.updateBrief(day.id,member.token,{request:member.request,revision:member.revision}),e=>e.status===403);
  const updated=await days.updatePerson(day.id,member.token,member.access.memberId,{name:'Sam',artists:['Tems'],vibes:['v-cafe']});
  assert.deepEqual(updated.request.people[1].vibes,['v-cafe']);
  await days.settled(day.id);const complete=await days.get(day.id,day.token);
  assert.equal(complete.planRevision,complete.revision);assert.equal(complete.request.people.length,2);assert.equal(complete.request.party.adults,2);
  assert.equal(complete.plan.people[1].id,member.access.memberId);
});
test('circles merge atomically, deduplicate IDs and keep a participant’s newer tastes',async()=>{
  const {days,day}=await fixture();
  const circle={name:'Sunday people',people:[person('host','Alex',['v-cafe']),person('sam','Sam',['v-african'])]};
  const result=await days.circle(day.id,day.token,circle);
  assert.equal(result.revision,2);assert.deepEqual(result.request.people.map(p=>p.id),['host','sam']);
  assert.deepEqual(result.request.people[0].vibes,[]); // a saved circle cannot overwrite today's preferences
  assert.equal((await days.circle(day.id,day.token,circle)).revision,2);
  await assert.rejects(days.circle(day.id,day.inviteToken,circle),e=>e.status===403);
  await assert.rejects(days.circle(day.id,day.token,{name:'Too many',people:['a','b','c','d','e'].map(x=>person(x))}),e=>e.status===400);
  assert.equal((await days.get(day.id,day.token)).request.people.length,2);
  await days.settled(day.id);
});
test('a spending-only change rebuilds the day and reaches its budget influences',async()=>{
  const {days,day}=await fixture();
  const updated=await days.updatePerson(day.id,day.token,'host',{name:'Alex',artists:[],vibes:[],spending:{style:'mindful',priority:'dinner'}});
  assert.equal(updated.revision,day.revision+1);
  await days.settled(day.id);const complete=await days.get(day.id,day.token);
  assert.equal(complete.planRevision,updated.revision);
  assert.equal(complete.plan.budget.influences[0].priority,'dinner');
  assert.equal(complete.plan.budget.influences[0].style,'mindful');
});

test('a shared day can shrink to one place without losing participants',async()=>{
  const {days,day}=await fixture();
  await days.updateBrief(day.id,day.token,{request:{...day.request,activities:['dinner']},revision:day.revision});
  await days.settled(day.id);const result=await days.get(day.id,day.token);
  assert.equal(result.planRevision,result.revision);assert.equal(result.plan.stops.length,1);assert.deepEqual(result.request.people,day.request.people);
});

test('stale trip details conflict and a current brief cannot overwrite participant tastes',async()=>{
  const {days,day}=await fixture();
  const latest=await days.updatePerson(day.id,day.token,'host',{name:'Alex',artists:['Tems'],vibes:[]});
  await assert.rejects(days.updateBrief(day.id,day.token,{request:{...day.request,budget:500},revision:day.revision}),e=>e.status===409);
  const changed=await days.updateBrief(day.id,day.token,{request:{...day.request,budget:500},revision:latest.revision});
  assert.deepEqual(changed.request.people[0].artists,['Tems']);assert.equal(changed.request.budget,500);
  await days.settled(day.id);
});
test('preferences arriving during discovery discard the older result and rebuild the latest revision',async()=>{
  let release,started;const entered=new Promise(r=>started=r),gate=new Promise(r=>release=r);let first=true;
  const provider=createDemoProvider();const discover=provider.discover;
  provider.discover=async args=>{if(first){first=false;started();await gate;}return discover(args);};
  const days=createDays({discovery:createDiscovery({provider})});
  const day=await days.create({request:{people:[person('host','Alex')],party:{adults:1}}});
  await entered;
  const latest=await days.updatePerson(day.id,day.token,'host',{name:'Alex',artists:[],vibes:['v-cafe']});
  release();await days.settled(day.id);
  const result=await days.get(day.id,day.token);
  assert.equal(result.planRevision,latest.revision);assert.deepEqual(result.plan.request.people[0].vibes,['v-cafe']);
});
test('provider errors retain the last complete day and support retry',async()=>{
  let failed=false;const provider=createDemoProvider(),discover=provider.discover;
  provider.discover=async args=>{if(failed)throw Error('secret provider response');return discover(args);};
  const {days,day}=await fixture({discovery:createDiscovery({provider,cacheTtlMs:0})});
  const before=await days.get(day.id,day.token);failed=true;
  await days.updatePerson(day.id,day.token,'host',{name:'Alex',artists:['Tems'],vibes:[]});await days.settled(day.id);
  const error=await days.get(day.id,day.token);assert.equal(error.status,'error');assert.deepEqual(error.plan,before.plan);assert.doesNotMatch(JSON.stringify(error),/secret provider response/);
  failed=false;await days.retry(day.id,day.token);await days.settled(day.id);assert.equal((await days.get(day.id,day.token)).status,'ready');
});
test('shared days survive storage reload, initialize once under concurrency, and expire',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'outing-days-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const file=join(directory,'days.json');let clock=100000;
  const store=createDayStore({file,now:()=>clock});
  await Promise.all([store.read('missing'),store.transact(records=>{records.seed={expiresAt:clock+1000};})]);
  assert.ok(await store.read('seed'));
  const {days,day}=await fixture({store,now:()=>clock});
  assert.equal((await stat(file)).mode&0o777,0o600);
  const loaded=createDays({discovery:engine(),store:createDayStore({file,now:()=>clock}),now:()=>clock});
  assert.equal((await loaded.get(day.id,day.token)).request.people[0].name,'Alex');
  clock+=7*86400000+1;await assert.rejects(loaded.get(day.id,day.token),e=>e.status===404);
  await days.settled(day.id);
});

test('Autopilot applies group and trip changes once, preserves personal links and rejects stale or non-owner writes',async()=>{
  const {days,day}=await fixture();
  const request={...day.request,budget:500,party:{adults:2,children:0},activities:['dinner'],people:[{...day.request.people[0],vibes:['v-cafe']},person('sam','Sam',['v-seafood'])]};
  await assert.rejects(days.autopilot(day.id,day.inviteToken,{request,revision:day.revision}),e=>e.status===403);
  const updated=await days.autopilot(day.id,day.token,{request,revision:day.revision});
  assert.equal(updated.revision,day.revision+1);assert.equal(updated.request.budget,500);assert.equal(updated.request.people.length,2);
  assert.equal(updated.participantLinks.find(p=>p.id==='host').token,day.participantLinks.find(p=>p.id==='host').token);
  await assert.rejects(days.autopilot(day.id,day.token,{request,revision:day.revision}),e=>e.status===409);
  await assert.rejects(days.autopilot(day.id,day.token,{request:{...request,people:[request.people[1]]},revision:updated.revision}),e=>e.status===400);
  await days.settled(day.id);const ready=await days.get(day.id,day.token);
  assert.equal(ready.planRevision,updated.revision);assert.deepEqual(ready.plan.request.people,request.people);assert.equal(ready.plan.stops.length,1);
});
