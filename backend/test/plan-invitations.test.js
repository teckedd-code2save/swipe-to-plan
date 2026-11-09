import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAccounts,createAccountStore} from '../src/accounts.js';
import {createApp} from '../src/app.js';
const hash=value=>createHash('sha256').update(value).digest('base64url');
const planId='00000000-0000-4000-8000-000000000001';
const invitationEpoch='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const privateMarker='PRIVATE-OTHER-CIRCLE-TASTES-BOOKING-CONTACT';
function plan(title='Friday coffee') {return {request:{title,date:'2099-01-02',timing:{dateConfirmed:true,timeConfirmed:true},area:'Osu',people:[{id:'other',name:privateMarker,artists:[privateMarker],spending:{style:privateMarker}}],budget:9999},timeZone:'Africa/Accra',people:[{name:privateMarker}],tasteMap:{nodes:[privateMarker]},stops:[{id:'stop-0',intent:'coffee',start:'10:00',end:'11:00',connections:[privateMarker],item:{id:'venue-1',name:'Cafe',address:'High Street',reasons:[privateMarker],contact:privateMarker}}],bookingActions:{records:[privateMarker]},previous:{privateMarker},circleIds:['other-circle'],warnings:[privateMarker],agentText:privateMarker};}
async function fixture(options={}) {
 let time=Date.now();const now=()=>time;
 const store=options.store||createAccountStore({now});
 await store.transact(data=>{for(const id of ['owner','sam','third','stranger']){data.users[id]={id,email:`${id}@example.test`,profile:{id,name:id==='owner'?'Alex':id,artists:[],vibes:[]},savedPlans:{}};data.sessions[hash(id)]={userId:id,expiresAt:time+31*86400000};}data.circles.friends={id:'friends',name:'Friends',ownerId:'owner',members:[{userId:'owner'},{userId:'sam'},{userId:'third'}]};});
 const accounts=createAccounts({invitationEpoch,store,now,origin:'http://localhost:5173'});
 await accounts.keepPlan({session:'owner',id:planId,revision:1},plan());
 return {accounts,store,now,advance:()=>{time+=61000;},invite:(recipientId='sam',revision=1)=>accounts.inviteToPlan('owner',planId,{recipientId,revision})};
}
const denied=(promise,status=404)=>assert.rejects(promise,e=>e.status===status);

test('recipient-specific invite is durable, minimal, idempotent and never expands circle access',async()=>{
 const f=await fixture(),first=await f.invite();assert.equal(first.status,'pending');assert.equal(first.revision,1);
 assert.deepEqual(await f.invite(),first);const inbox=await f.accounts.invitationInbox('sam');assert.equal(inbox.invitations.length,1);assert.equal(inbox.invitations[0].organizerName,'Alex');assert.equal(inbox.invitations[0].viewedAt,null);assert.equal(inbox.invitations[0].unread,true);
 assert.equal((await f.accounts.current('sam')).invitationUnreadCount,1);
 assert.deepEqual((await f.accounts.invitationInbox('third')).invitations,[]);assert.deepEqual(await f.accounts.listCirclePlans('sam'),[]);assert.deepEqual(await f.accounts.listPlans('sam'),[]);
 await denied(f.accounts.getPlan('sam',planId));await denied(f.accounts.getCirclePlan('sam','owner',planId));await denied(f.accounts.invitedPlan('sam',first.id));
 assert.doesNotMatch(JSON.stringify(inbox),new RegExp(`${privateMarker}|9999|High Street|venue-1|Africa/Accra|other-circle|people|budget|email`));
 assert.equal(await f.store.read(d=>d.users.owner.savedPlans[planId].circleIds),undefined);
});

test('every owner and recipient operation rejects unrelated, forged, guest and invalid identities',async()=>{
 const f=await fixture(),invitation=await f.invite();
 for(const recipientId of ['stranger','missing','manual-sam','__proto__','owner'])await denied(f.invite(recipientId));
 await denied(f.accounts.inviteToPlan('sam',planId,{recipientId:'third',revision:1}));await denied(f.accounts.listPlanInvitations('sam',planId));await denied(f.accounts.withdrawPlanInvitation('sam',planId,invitation.id));
 for(const action of ['view','going','interested','decline','leave','read','unread','mute','unmute'])await denied(f.accounts.updateInvitation('third',invitation.id,{action}));
 await denied(f.accounts.invitedPlan('third',invitation.id));await denied(f.accounts.invitationInbox(null),401);await denied(f.accounts.inviteToPlan(null,planId,{recipientId:'sam',revision:1}),401);
 await denied(f.invite('sam',2),409);await denied(f.accounts.inviteToPlan('owner',planId,{recipientId:'sam',revision:1,profile:{id:'third'}}),400);await denied(f.accounts.updateInvitation('sam',invitation.id,{action:'going',recipientId:'third'}),400);
});

test('opening preview and RSVP are distinct; accepted view is an allowlisted exact snapshot',async()=>{
 const f=await fixture(),invitation=await f.invite();
 await f.accounts.updateInvitation('sam',invitation.id,{action:'view'});assert.equal((await f.accounts.current('sam')).invitationUnreadCount,0);assert.ok((await f.accounts.listPlanInvitations('owner',planId)).invitations[0].viewedAt);
 await denied(f.accounts.invitedPlan('sam',invitation.id));
 const accepted=await f.accounts.updateInvitation('sam',invitation.id,{action:'interested'});assert.equal(accepted.status,'interested');
 assert.deepEqual(await f.accounts.invitedPlan('sam',invitation.id),{title:'Friday coffee',date:'2099-01-02',area:'Osu',timeZone:'Africa/Accra',revision:1,stops:[{id:'stop-0',intent:'coffee',start:'10:00',end:'11:00',name:'Cafe',address:'High Street'}]});
 await denied(f.accounts.bookings('sam',planId));await denied(f.accounts.executions('sam',planId));
 await f.accounts.updateInvitation('sam',invitation.id,{action:'going'});assert.equal((await f.accounts.listPlanInvitations('owner',planId)).invitations[0].status,'going');
 await f.accounts.keepPlan({session:'owner',id:planId,revision:2},plan('PRIVATE NEW VERSION'));
 assert.equal((await f.accounts.invitedPlan('sam',invitation.id)).title,'Friday coffee');assert.equal((await f.accounts.invitationInbox('sam')).invitations[0].unread,false);
 assert.equal((await f.accounts.listPlanInvitations('owner',planId)).revision,2);
});

test('deliberate update requires fresh acceptance and retains truthful prior RSVP without old data',async()=>{
 const f=await fixture(),first=await f.invite();await f.accounts.updateInvitation('sam',first.id,{action:'going'});
 await f.accounts.keepPlan({session:'owner',id:planId,revision:2},plan('Saturday coffee'));await denied(f.invite('sam',2),429);f.advance();const next=await f.invite('sam',2);
 assert.notEqual(first.id,next.id);assert.equal(next.status,'pending');assert.equal(next.previousResponse.status,'going');assert.equal(next.previousResponse.revision,1);assert.equal(next.viewedAt,null);
 await denied(f.accounts.invitedPlan('sam',first.id));await denied(f.accounts.updateInvitation('sam',first.id,{action:'going'}));await denied(f.accounts.invitedPlan('sam',next.id));
 assert.equal((await f.accounts.invitationInbox('sam')).invitations.length,1);await f.accounts.updateInvitation('sam',next.id,{action:'interested'});assert.equal((await f.accounts.invitedPlan('sam',next.id)).revision,2);
 assert.doesNotMatch(JSON.stringify(next),/PRIVATE|High Street/);
});

for(const [actor,action,status] of [['sam','decline','declined'],['sam','leave','left'],['owner','withdraw','withdrawn']])test(`${status} revokes access and duplicate invite cannot revive it`,async()=>{
 const f=await fixture(),first=await f.invite();await f.accounts.updateInvitation('sam',first.id,{action:'going'});
 if(actor==='owner')await f.accounts.withdrawPlanInvitation(actor,planId,first.id);else await f.accounts.updateInvitation(actor,first.id,{action});
 assert.equal((await f.invite()).status,status);await denied(f.accounts.invitedPlan('sam',first.id));await denied(f.accounts.updateInvitation('sam',first.id,{action:'going'}),409);
 assert.equal((await f.accounts.invitationInbox('sam')).invitations[0].status,status);
});

test('read/unread, per-plan mute, badge setting and updates respect recipient choices',async()=>{
 const f=await fixture(),first=await f.invite();await f.accounts.updateInvitation('sam',first.id,{action:'read'});assert.equal((await f.accounts.current('sam')).invitationUnreadCount,0);
 await f.accounts.updateInvitation('sam',first.id,{action:'unread'});assert.equal((await f.accounts.current('sam')).invitationUnreadCount,1);
 await f.accounts.updateInvitation('sam',first.id,{action:'mute'});assert.equal((await f.accounts.current('sam')).invitationUnreadCount,0);assert.equal((await f.accounts.invitationInbox('sam')).invitations.length,1);
 await f.accounts.keepPlan({session:'owner',id:planId,revision:2},plan('Saturday'));f.advance();const next=await f.invite('sam',2);assert.equal((await f.accounts.current('sam')).invitationUnreadCount,0);
 assert.equal((await f.accounts.invitationInbox('sam')).invitations[0].muted,true);await f.accounts.updateInvitation('sam',next.id,{action:'unmute'});assert.equal((await f.accounts.current('sam')).invitationUnreadCount,1);
 await f.accounts.invitationSettings('sam',{badgeEnabled:false});assert.equal((await f.accounts.current('sam')).invitationUnreadCount,0);assert.equal((await f.accounts.invitationInbox('sam')).badgeEnabled,false);
 await denied(f.accounts.invitationSettings('sam',{badgeEnabled:'false'}),400);
});

test('disconnect, owner plan deletion and logout close reads and cannot resurrect old acceptance',async()=>{
 const f=await fixture(),first=await f.invite();await f.accounts.updateInvitation('sam',first.id,{action:'going'});
 await f.accounts.removeCircleMember('owner','friends','sam');assert.deepEqual((await f.accounts.invitationInbox('sam')).invitations,[]);await denied(f.accounts.invitedPlan('sam',first.id));await denied(f.accounts.updateInvitation('sam',first.id,{action:'view'}));
 assert.equal((await f.accounts.listPlanInvitations('owner',planId)).invitations[0].status,'disconnected');
 await f.store.transact(d=>d.circles.friends.members.push({userId:'sam'}));await denied(f.accounts.invitedPlan('sam',first.id));await denied(f.accounts.updateInvitation('sam',first.id,{action:'going'}),409);
 await f.accounts.removePlan('owner',planId);assert.deepEqual((await f.accounts.invitationInbox('sam')).invitations,[]);await denied(f.accounts.invitedPlan('sam',first.id));
 await f.accounts.logout('sam');await denied(f.accounts.invitationInbox('sam'),401);
});

test('multiple circles do not revoke a surviving direct connection or grant another person access',async()=>{
 const f=await fixture(),first=await f.invite();await f.accounts.updateInvitation('sam',first.id,{action:'going'});await f.store.transact(d=>{d.circles.second={id:'second',name:'Second',ownerId:'sam',members:[{userId:'sam'},{userId:'owner'}]};});
 await f.accounts.removeCircle('sam','friends');assert.equal((await f.accounts.invitedPlan('sam',first.id)).revision,1);await denied(f.accounts.invitedPlan('third',first.id));
 await f.accounts.removeCircle('owner','second');await denied(f.accounts.invitedPlan('sam',first.id));
});

test('notification preview omits unconfirmed date/time and accepts only bounded recipients',async()=>{
 const f=await fixture();await f.accounts.keepPlan({session:'owner',id:planId,revision:2},{...plan(),request:{...plan().request,timing:{dateConfirmed:false,timeConfirmed:false}}});const first=await f.invite('sam',2);assert.equal(first.date,null);await f.accounts.updateInvitation('sam',first.id,{action:'going'});const view=await f.accounts.invitedPlan('sam',first.id);assert.equal(view.date,null);assert.equal(view.stops[0].start,null);assert.equal(view.stops[0].end,null);
 await f.store.transact(d=>{for(let i=0;i<20;i++){const id=`person${i}`;d.users[id]={id,profile:{name:id}};d.circles.friends.members.push({userId:id});}});
 for(let i=0;i<19;i++)await f.invite(`person${i}`,2);await denied(f.invite('person19',2),429);assert.equal((await f.accounts.listPlanInvitations('owner',planId)).invitations.length,20);
});

test('HTTP routes enforce session, origin, no-store, exact revision, and no owner-record shortcuts',async t=>{
 const f=await fixture(),server=createApp({provider:{name:'demo'},accounts:f.accounts,rateLimit:false}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`,headers=id=>({'content-type':'application/json',origin:'http://localhost:5173',cookie:`outing-session=${id}`});
 const send=(path,id,method='GET',body)=>fetch(base+path,{method,headers:headers(id),...(body?{body:JSON.stringify(body)}:{})});
 let response=await fetch(`${base}/api/account/plans/${planId}/invitations`,{method:'POST',headers:{...headers('owner'),origin:'https://other.test'},body:JSON.stringify({recipientId:'sam',revision:1})});assert.equal(response.status,403);
 response=await send(`/api/account/plans/${planId}/invitations`,'owner','POST',{recipientId:'sam',revision:1});assert.equal(response.status,200);const invitation=await response.json();
 response=await send('/api/account/invitations','sam');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).invitations.length,1);
 assert.equal((await send(`/api/account/invitations/${invitation.id}/plan`,'sam')).status,404);
 assert.equal((await send(`/api/account/invitations/${invitation.id}`,'sam','PATCH',{action:'going'})).status,200);
 response=await send(`/api/account/invitations/${invitation.id}/plan`,'sam');assert.equal(response.status,200);assert.doesNotMatch(JSON.stringify(await response.json()),new RegExp(privateMarker));
 for(const path of [`/api/account/plans/${planId}`,`/api/account/plans/${planId}/bookings`,`/api/account/circle-plans/owner/${planId}`])assert.equal((await send(path,'sam')).status,404);
 assert.equal((await send(`/api/account/invitations/${invitation.id}`,'stranger','PATCH',{action:'decline'})).status,404);
});

test('invitation and acceptance use the existing single-writer journal; uncertain commits never acknowledge',async t=>{
 const dir=await fs.mkdtemp(join(tmpdir(),'plan-invite-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=join(dir,'accounts.json'),store=createAccountStore({file});const f=await fixture({store});
 const first=await f.invite();let accounts=createAccounts({invitationEpoch,store:createAccountStore({file}),now:f.now});assert.equal((await accounts.invitationInbox('sam')).invitations[0].id,first.id);
 let armed=true;const broken=createAccountStore({file,io:{...fs,rename:async(...args)=>{await fs.rename(...args);if(armed){armed=false;throw Error('synthetic post-rename failure');}}}});accounts=createAccounts({invitationEpoch,store:broken,now:f.now});
 await assert.rejects(accounts.updateInvitation('sam',first.id,{action:'going'}),{code:'account_commit_unknown'});assert.equal((await accounts.invitedPlan('sam',first.id)).revision,1);await assert.rejects(accounts.updateInvitation('sam',first.id,{action:'leave'}),{code:'account_commit_unknown'});
 assert.equal((await broken.reconcile()).outcome,'committed');await accounts.updateInvitation('sam',first.id,{action:'leave'});await denied(accounts.invitedPlan('sam',first.id));
 accounts=createAccounts({invitationEpoch,store:createAccountStore({file}),now:f.now});assert.equal((await accounts.invitationInbox('sam')).invitations[0].status,'left');
});

test('legacy snapshot rewrite preserves additive invitation data but cannot regain access without lifecycle binding',async()=>{
 const f=await fixture(),first=await f.invite();await f.accounts.updateInvitation('sam',first.id,{action:'going'});const durable=await f.store.read(d=>d.planInvitations);
 // This is the old keepPlan replacement shape. An independent review also ran
 // the actual pre-feature accounts.js at 91d7ab6 against the synthetic snapshot.
 await f.store.transact(d=>{const previous=d.users.owner.savedPlans[planId];d.users.owner.savedPlans[planId]={id:planId,revision:2,savedAt:new Date().toISOString(),plan:plan('Legacy rewritten day'),previous:{plan:previous.plan,revision:previous.revision}};});
 assert.deepEqual(await f.store.read(d=>d.planInvitations),durable);await denied(f.accounts.invitedPlan('sam',first.id));assert.equal((await f.accounts.listPlanInvitations('owner',planId)).invitations[0].status,'unavailable');
 f.advance();const next=await f.invite('sam',2);assert.notEqual(next.id,first.id);await denied(f.accounts.invitedPlan('sam',next.id));await f.accounts.updateInvitation('sam',next.id,{action:'going'});assert.equal((await f.accounts.invitedPlan('sam',next.id)).title,'Legacy rewritten day');
});

test('per-owner daily send budget and recipient replacement keep growth bounded',async()=>{
 const f=await fixture();await f.invite();for(let revision=2;revision<=50;revision++){f.advance();await f.accounts.keepPlan({session:'owner',id:planId,revision},plan());await f.invite('sam',revision);}
 f.advance();await f.accounts.keepPlan({session:'owner',id:planId,revision:51},plan());await denied(f.invite('sam',51),429);assert.equal(await f.store.read(d=>Object.keys(d.planInvitations).length),1);assert.equal(await f.store.read(d=>d.users.owner.planInvitationEvents.length),50);
});

test('ambiguous invitation creation has one reconciled inbox item, never a replay or access grant',async t=>{
 const dir=await fs.mkdtemp(join(tmpdir(),'plan-invite-create-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=join(dir,'accounts.json');const f=await fixture({store:createAccountStore({file})});let armed=true;const store=createAccountStore({file,io:{...fs,rename:async(...args)=>{await fs.rename(...args);if(armed){armed=false;throw Error('synthetic post-rename failure');}}}}),accounts=createAccounts({invitationEpoch,store,now:f.now});
 await assert.rejects(accounts.inviteToPlan('owner',planId,{recipientId:'sam',revision:1}),{code:'account_commit_unknown'});const list=await accounts.invitationInbox('sam');assert.equal(list.invitations.length,1);assert.equal(list.invitations[0].status,'pending');await denied(accounts.invitedPlan('sam',list.invitations[0].id));await assert.rejects(accounts.inviteToPlan('owner',planId,{recipientId:'sam',revision:1}),{code:'account_commit_unknown'});
 await store.reconcile();const retried=await accounts.inviteToPlan('owner',planId,{recipientId:'sam',revision:1});assert.equal(retried.id,list.invitations[0].id);assert.equal((await accounts.invitationInbox('sam')).invitations.length,1);
});

test('legacy rollback epoch invalidates old acceptance without deleting history, and re-invitation requires fresh acceptance',async()=>{
 const f=await fixture(),first=await f.invite();await f.accounts.updateInvitation('sam',first.id,{action:'going'});const before=await f.store.read(d=>d.planInvitations);
 // Simulate the legacy writer's disconnect/reconnect, which cannot tombstone
 // invitation records. The retained release guard changes only the epoch.
 await f.store.transact(d=>{d.circles.friends.members=d.circles.friends.members.filter(m=>m.userId!=='sam');});await f.store.transact(d=>{d.circles.friends.members.push({userId:'sam'});});
 const upgraded=createAccounts({store:f.store,now:f.now,invitationEpoch:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});
 assert.deepEqual(await f.store.read(d=>d.planInvitations),before);assert.deepEqual((await upgraded.invitationInbox('sam')).invitations,[]);assert.equal((await upgraded.current('sam')).invitationUnreadCount,0);await denied(upgraded.invitedPlan('sam',first.id));await denied(upgraded.updateInvitation('sam',first.id,{action:'going'}));
 const owner=(await upgraded.listPlanInvitations('owner',planId)).invitations[0];assert.equal(owner.status,'unavailable');assert.equal(owner.previousResponse.status,'going');
 assert.equal((await upgraded.getPlan('owner',planId)).request.title,'Friday coffee');f.advance();const next=await upgraded.inviteToPlan('owner',planId,{recipientId:'sam',revision:1,replaceInvitationId:first.id});assert.notEqual(first.id,next.id);assert.equal(next.status,'pending');assert.equal(next.previousResponse.status,'going');await denied(upgraded.invitedPlan('sam',next.id));await upgraded.updateInvitation('sam',next.id,{action:'interested'});assert.equal((await upgraded.invitedPlan('sam',next.id)).revision,1);
});

test('missing/invalid deployment epoch disables only invitations and never lazily rebinds stored grants',async()=>{
 const f=await fixture(),first=await f.invite();await f.accounts.updateInvitation('sam',first.id,{action:'going'});const before=await f.store.read(d=>d.planInvitations);
 for(const invitationEpoch of [null,'','invalid']){const accounts=createAccounts({store:f.store,now:f.now,invitationEpoch});assert.equal((await accounts.current('sam')).invitationAvailable,false);assert.equal((await accounts.current('sam')).invitationUnreadCount,0);assert.equal((await accounts.getPlan('owner',planId)).request.title,'Friday coffee');await denied(accounts.invitationInbox('sam'),503);await denied(accounts.invitedPlan('sam',first.id),503);await denied(accounts.updateInvitation('sam',first.id,{action:'going'}),503);await denied(accounts.inviteToPlan('owner',planId,{recipientId:'sam',revision:1}),503);}
 assert.deepEqual(await f.store.read(d=>d.planInvitations),before);
});

test('epoch rollover original retry cannot re-notify; explicit same-revision replacement has a bound idempotent precondition',async()=>{
 const f=await fixture(),first=await f.invite();await f.accounts.updateInvitation('sam',first.id,{action:'going'});f.advance();const current=createAccounts({store:f.store,now:f.now,invitationEpoch:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}),body={recipientId:'sam',revision:1};
 assert.equal((await current.inviteToPlan('owner',planId,body)).status,'unavailable');assert.equal((await current.invitationInbox('sam')).invitations.length,0);assert.equal(await f.store.read(d=>d.users.owner.planInvitationEvents.length),1);
 await denied(current.inviteToPlan('owner',planId,{...body,replaceInvitationId:'unrelated'}),409);
 const replacement={...body,replaceInvitationId:first.id},next=await current.inviteToPlan('owner',planId,replacement);assert.equal(next.status,'pending');assert.notEqual(next.id,first.id);assert.equal((await current.inviteToPlan('owner',planId,replacement)).id,next.id);assert.equal((await current.invitationInbox('sam')).invitations.length,1);await current.updateInvitation('sam',next.id,{action:'going'});
 const afterAnotherRollback=createAccounts({store:f.store,now:f.now,invitationEpoch:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'});assert.equal((await afterAnotherRollback.inviteToPlan('owner',planId,replacement)).status,'unavailable');assert.equal((await afterAnotherRollback.invitationInbox('sam')).invitations.length,0);assert.equal(await f.store.read(d=>d.users.owner.planInvitationEvents.length),2);
});
