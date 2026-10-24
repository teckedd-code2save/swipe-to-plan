import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createMetrics} from '../src/metrics.js';
import {createAccounts,createAccountStore} from '../src/accounts.js';
import {createApp} from '../src/app.js';
const time=Date.parse('2026-10-24T10:00Z');
test('usage counts known feature events and separates accounts from anonymous sessions',async()=>{
  const metrics=createMetrics({now:()=>time});await metrics.record('visit',{visitor:'guest-session'});await metrics.record('plan_created',{userId:'u1',visitor:'signed-session'});await metrics.record('calendar_opened',{userId:'u1',visitor:'signed-session'});
  const report=await metrics.report([{id:'u1',name:'Alex',email:'alex@example.test',createdAt:new Date(time-86400000).toISOString()}],7);
  assert.equal(report.activeAccounts,1);assert.equal(report.guestSessions,1);assert.equal(report.sessions,2);assert.equal(report.features.plan_created,1);assert.equal(report.users[0].plans,1);assert.equal(report.daily.at(-1).plans,1);assert.equal(report.startedAt,new Date(time).toISOString());assert.equal(report.events,undefined);await assert.rejects(metrics.record('chat_text'),/Unknown/);
});
test('event retention expires old data and empty history is not fabricated',async()=>{
  let now=time;const metrics=createMetrics({now:()=>now});assert.equal((await metrics.report([],7)).startedAt,null);await metrics.record('visit',{visitor:'one'});now+=91*86400000;await metrics.record('visit',{visitor:'two'});const report=await metrics.report([],90);assert.equal(report.sessions,1);assert.equal(report.features.visit,1);
});
test('owner dashboard authenticates on the server and never exposes secrets or tastes',async t=>{
  const store=createAccountStore(),hash=value=>createHash('sha256').update(value).digest('base64url');
  await store.transact(data=>{for(const [id,email] of [['owner','owner@example.test'],['member','member@example.test']]){data.users[id]={id,email,googleSubject:`secret-${id}`,profile:{id,name:id,artists:['Private taste'],vibes:[]},createdAt:new Date(time).toISOString()};data.sessions[hash(id+'-session')]={userId:id,expiresAt:time+86400000};}data.circles.c={id:'c',inviteToken:'private-invite',members:[{userId:'member'}]};});
  const accounts=createAccounts({store,now:()=>time,origin:'http://localhost:5173',adminEmails:['owner@example.test']}),metrics=createMetrics({now:()=>time});
  const app=createApp({provider:{name:'demo'},accounts,metrics,rateLimit:false,now:()=>time});const server=app.listen(0);await new Promise(r=>server.once('listening',r));t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/admin/usage')).status,401);assert.equal((await fetch(base+'/api/admin/usage',{headers:{cookie:'outing-session=member-session'}})).status,403);
  const report=await (await fetch(base+'/api/admin/usage',{headers:{cookie:'outing-session=owner-session'}})).json();assert.equal(report.totalAccounts,2);const raw=JSON.stringify(report);for(const secret of ['secret-owner','Private taste','private-invite','owner-session'])assert.equal(raw.includes(secret),false);
  const post=body=>fetch(base+'/api/usage',{method:'POST',headers:{origin:'http://localhost:5173','content-type':'application/json','x-unstressed-session':'browser-session-12345',cookie:'outing-session=member-session'},body:JSON.stringify(body)});
  assert.equal((await post({event:'visit',userId:'owner'})).status,400);assert.equal((await post({event:'visit'})).status,200);const after=await metrics.report(await accounts.adminUsers({headers:{cookie:'outing-session=owner-session'}}),7);assert.equal(after.users.find(u=>u.id==='member').lastActiveAt,new Date(time).toISOString());assert.equal(after.users.find(u=>u.id==='owner').lastActiveAt,null);
  assert.equal((await fetch(base+'/api/usage',{method:'POST',headers:{origin:'https://wrong.test','content-type':'application/json'},body:'{"event":"visit"}'})).status,403);
});
