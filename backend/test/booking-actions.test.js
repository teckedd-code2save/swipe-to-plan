import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,rename,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAccounts,createAccountStore} from '../src/accounts.js';
import {createDays,createDayStore} from '../src/days.js';
import {bookingOperation,invalidateBookings} from '../src/booking-actions.js';
const now=()=>Date.parse('2026-01-01T00:00:00Z');
const plan=()=>({request:{title:'Day',date:'2026-12-01',timing:{dateConfirmed:true,timeConfirmed:true,mode:'fixed'},area:'Accra',party:{adults:2,children:0}},timeZone:'Africa/Accra',stops:[{id:'stop-0',start:'18:00',item:{id:'venue-a',entityId:'entity-a',name:'Venue A',links:{website:'https://venue.example/',phone:'tel:+233123456789'}}}]});
const body=(key='create')=>({planRevision:1,idempotencyKey:key,stopId:'stop-0',itemId:'venue-a',entityId:'entity-a',kind:'enquiry',notes:'Hello, is a table available?'});
async function accountFixture(file){const store=createAccountStore({file,now});await store.transact(data=>{for(const id of ['a','b']){data.users[id]={id,profile:{},savedPlans:{p:{id:'p',revision:1,plan:plan()}}};data.sessions[createHash('sha256').update(id).digest('base64url')]={userId:id,expiresAt:now()+86400000};}});return {store,accounts:createAccounts({store,now})};}
const update=(booking,key,extra={})=>({planRevision:1,bookingVersion:booking.bookingVersion,idempotencyKey:key,...extra});

test('owner isolation, scoped idempotency, private serialization and honest handoff/report',async()=>{
 const {accounts}=await accountFixture();const first=await accounts.bookings('a','p','create',body());
 assert.deepEqual(await accounts.bookings('a','p','create',body()),first);
 await assert.rejects(accounts.bookings('a','p','create',{...body(),notes:'changed'}),e=>e.status===409);
 const other=await accounts.bookings('b','p','create',body());assert.notEqual(first.booking.id,other.booking.id);
 for(const [session,id] of [['unknown','p'],['a','absent']])await assert.rejects(accounts.bookings(session,id),e=>e.status===404&&e.message==='Booking not found.');
 await assert.rejects(accounts.bookings('b','p','report',update(first.booking,'steal',{outcome:'confirmed'}),first.booking.id),e=>e.status===404);
 assert.equal((await accounts.getPlan('a','p')).bookingActions,undefined);
 let {booking}=await accounts.bookings('a','p','handoff',update(first.booking,'ready',{channel:'website',reviewed:true}),first.booking.id);
 assert.equal(booking.status,'ready_for_contact');assert.equal(booking.submission.status,'not_submitted');assert.equal(booking.handoff.scope,'user_contact_only');
 ({booking}=await accounts.bookings('a','p','report',update(booking,'report',{outcome:'confirmed',reference:'ABC'}),booking.id));
 assert.equal(booking.status,'user_reported_confirmed');assert.equal(booking.verifiedByService,false);assert.equal(booking.payment.status,'not_requested');
});

test('serialized edits prevent lost writes; stale versions reject concurrent mutations',async()=>{
 const {accounts}=await accountFixture();const {booking}=await accounts.bookings('a','p','create',body());
 const results=await Promise.allSettled(['one','two'].map(key=>accounts.bookings('a','p','patch',update(booking,key,{notes:key}),booking.id)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
});

test('replacement and undo retain historical confirmation but revoke review and replay; forks omit private records',async()=>{
 const {accounts,store}=await accountFixture();let {booking}=await accounts.bookings('a','p','create',body());
 ({booking}=await accounts.bookings('a','p','report',update(booking,'report',{outcome:'confirmed',reference:'PRIVATE'}),booking.id));
 const changed=plan();changed.stops[0].item.id='replacement';await accounts.keepPlan({session:'a',id:'p',revision:2},changed);
 let listing=await accounts.bookings('a','p');assert.equal(listing.bookings[0].stale,true);assert.equal(listing.bookings[0].userReport.reference,'PRIVATE');assert.equal(listing.bookings[0].userReport.stale,true);
 await assert.rejects(accounts.bookings('a','p','create',body()),e=>e.status===409);
 await accounts.editSavedPlan('a','p',{revision:2,restoreRevision:1});listing=await accounts.bookings('a','p');assert.equal(listing.bookings[0].stale,true);
 await store.transact(data=>{data.users.a.savedPlans.p.sourceDayId='shared';});
 const fork=await accounts.editSavedPlan('a','p',{revision:3,pins:{}});assert.notEqual(fork.savedPlan.id,'p');assert.equal((await accounts.bookings('a',fork.savedPlan.id)).bookings.length,0);
});

test('saved booking restart durability and no metadata in shared plan view',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'booking-test-'));try{const file=join(dir,'accounts.json');const {accounts}=await accountFixture(file);const created=await accounts.bookings('a','p','create',body());const restored=createAccounts({store:createAccountStore({file,now}),now});assert.equal((await restored.bookings('a','p')).bookings[0].id,created.booking.id);assert.equal(JSON.stringify(await restored.getPlan('a','p')).includes('Hello, is a table'),false);}finally{await rm(dir,{recursive:true,force:true});}
});

test('failed durable writes do not expose a successful booking or consume its idempotency key',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'booking-write-failure-'));
 try{
  const file=join(dir,'accounts.json'),backup=join(dir,'original.json');
  const {accounts}=await accountFixture(file);
  // An owned fixture directory blocks atomic rename without changing permissions.
  await rename(file,backup);await mkdir(file);
  await assert.rejects(accounts.bookings('a','p','create',body('retry-write')));
  assert.equal((await accounts.bookings('a','p')).bookings.length,0);
  await rm(file,{recursive:true});await rename(backup,file);
  const saved=await accounts.bookings('a','p','create',body('retry-write'));
  assert.equal(saved.booking.status,'draft');
  const restored=createAccounts({store:createAccountStore({file,now}),now});
  assert.equal((await restored.bookings('a','p')).bookings.length,1);
  assert.deepEqual(await accounts.bookings('a','p','create',body('retry-write')),saved);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('shared-day booking ownership, expiry and pending-plan guard',async()=>{
 let time=now();const store=createDayStore({now:()=>time});await store.transact(records=>{records.d={id:'d',ownerToken:'owner',inviteToken:'invite',members:[{editToken:'member'}],revision:1,planRevision:1,expiresAt:time+7000,plan:plan()};});
 const days=createDays({store,now:()=>time,discovery:{}});for(const credential of ['invite','member','visitorId',''])await assert.rejects(days.bookings('d',credential),e=>e.status===404);
 const created=await days.bookings('d','owner','create',body());assert.equal(created.booking.snapshot.name,'Venue A');
 await store.transact(records=>{records.d.revision=2;invalidateBookings(records.d,null);});await assert.rejects(days.bookings('d','owner','create',body('later')),e=>e.status===409);
 time+=7001;await assert.rejects(days.bookings('d','owner'),e=>e.status===404);
});

test('reservation validates real date, DST gaps/folds, future instant, selected identity and bounded input',()=>{
 const run=(p,b)=>bookingOperation({revision:1,plan:p},'create',b,null,{now});
 assert.equal(run(plan(),{...body(),kind:'reservation'}).booking.kind,'reservation');
 for(const [date,start] of [['2026-03-08','02:30'],['2026-11-01','01:30'],['2026-02-30','12:00']]){const p=plan();p.timeZone='America/New_York';p.request.date=date;p.stops[0].start=start;assert.throws(()=>run(p,{...body(),kind:'reservation'}),e=>e.status===400);}
 const undated=plan();undated.request.date=null;undated.stops[0].start=null;assert.equal(run(undated,body()).booking.kind,'enquiry');assert.throws(()=>run(undated,{...body(),kind:'reservation'}),e=>e.status===400);
 assert.throws(()=>run(plan(),{...body(),itemId:'other'}),e=>e.status===409);assert.throws(()=>run(plan(),{...body(),notes:'x'.repeat(2001)}),e=>e.status===400);
 assert.throws(()=>run(plan(),{...body(),providerUrl:'https://evil.example'}),e=>e.status===400);
});

test('HTTP requires owner credential and same-origin JSON, rejects authority fields, keeps private data off normal plan response',async t=>{
 const {createApp}=await import('../src/app.js');const {createDemoProvider}=await import('../src/demo-provider.js');const {once}=await import('node:events');const http=await import('node:http');
 const {accounts}=await accountFixture();const dayStore=createDayStore({now});await dayStore.transact(records=>{records.d={id:'d',ownerToken:'owner',inviteToken:'invite',members:[],revision:1,planRevision:1,expiresAt:now()+86400000,plan:plan()};});
 const server=createApp({accounts,dayStore,now,provider:createDemoProvider(),rateLimit:false}).listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 t.mock.method(globalThis,'fetch',()=>{throw new Error('No external requests allowed');});
 const call=(path,body,headers={},method=body?'POST':'GET')=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{'content-type':'application/json',...headers}},res=>{let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(data)}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});
 const path='/api/account/plans/p/bookings',auth={cookie:'outing-session=a',origin:'http://127.0.0.1:5173'};
 assert.equal((await call(path,body(),{cookie:auth.cookie})).status,403);
 assert.equal((await call(path,body(),{...auth,origin:'https://evil.example'})).status,403);
 assert.equal((await call(path,body(),{...auth,'content-type':'text/plain'})).status,403);
 const created=await call(path,{...body(),notes:'Dear venue,\n\nA table for two?\nThank you.'},auth);assert.equal(created.status,200);assert.equal(created.body.booking.notes,'Dear venue,\n\nA table for two?\nThank you.');assert.equal(created.headers['cache-control'],'no-store');
 assert.equal((await call(path,{...body('authority'),approvedToSend:true},auth)).status,400);
 const hidden=await call('/api/account/plans/p',undefined,auth);assert.equal(JSON.stringify(hidden.body).includes('Dear venue'),false);
 const d='/api/days/d/bookings';assert.equal((await call(d,body(),{origin:auth.origin,authorization:'Bearer invite'})).status,404);assert.equal((await call(d,body(),{authorization:'Bearer owner'})).status,403);assert.equal((await call(d,body(),{origin:auth.origin,authorization:'Bearer owner'})).status,200);
 const wrongPlan=await call('/api/account/plans/unknown/bookings',undefined,auth),wrongRecord=await call(path+'/unknown/report',update(created.body.booking,'missing',{outcome:'confirmed'}),auth);assert.equal(wrongPlan.status,404);assert.deepEqual(wrongPlan.body,wrongRecord.body);
});

test('schedule confirmation flags, ordered stops, party, address/contact and exact message changes invalidate review',()=>{
 const entry={revision:1,plan:plan()};const {booking}=bookingOperation(entry,'create',{...body(),notes:'Hi\n  Thanks\n'},null,{now});assert.equal(booking.notes,'Hi\n  Thanks\n');
 bookingOperation(entry,'handoff',update(booking,'ready',{reviewed:true,channel:'copy'}),booking.id,{now});
 entry.plan.stops[0].item.links.website='https://new-venue.example';invalidateBookings(entry);assert.equal(entry.bookingActions.records[0].handoff,null);assert.equal(entry.bookingActions.records[0].stale,true);
 const unconfirmed=plan();unconfirmed.request.timing.dateConfirmed=false;assert.throws(()=>bookingOperation({revision:1,plan:unconfirmed},'create',{...body(),kind:'reservation'},null,{now}),e=>e.status===400);
 const max=plan();max.request.party={adults:100,children:100};assert.equal(bookingOperation({revision:1,plan:max},'create',{...body(),kind:'reservation'},null,{now}).booking.snapshot.party.children,100);
});

test('re-review cannot attach an old confirmation to new time or party; historical report keeps exact occurrence',async()=>{
 const {accounts}=await accountFixture();let {booking}=await accounts.bookings('a','p','create',body());
 ({booking}=await accounts.bookings('a','p','report',update(booking,'confirmed',{outcome:'confirmed',reference:'OLD'}),booking.id));
 const revised=plan();revised.stops[0].start='19:00';revised.request.party.adults=3;await accounts.keepPlan({session:'a',id:'p',revision:2},revised);
 booking=(await accounts.bookings('a','p')).bookings[0];
 ({booking}=await accounts.bookings('a','p','patch',{...update(booking,'edit',{notes:'A table for three at 19:00'}),planRevision:2},booking.id));
 assert.equal(booking.status,'draft');assert.equal(booking.stale,false);assert.equal(booking.userReport.stale,true);assert.equal(booking.userReport.snapshot.localTime,'18:00');assert.equal(booking.userReport.snapshot.party.adults,2);assert.equal(booking.userReport.notes,body().notes);
 ({booking}=await accounts.bookings('a','p','handoff',{...update(booking,'new-ready',{reviewed:true,channel:'copy'}),planRevision:2},booking.id));assert.equal(booking.status,'ready_for_contact');assert.equal(booking.userReport.stale,true);
 ({booking}=await accounts.bookings('a','p','report',{...update(booking,'new-confirmed',{outcome:'confirmed',reference:'NEW'}),planRevision:2},booking.id));assert.equal(booking.userReport.snapshot.localTime,'19:00');assert.equal(booking.userReport.stale,false);assert.equal(booking.reportHistory[0].reference,'OLD');assert.equal(booking.reportHistory[0].snapshot.party.adults,2);
});

test('booking HTTP rate buckets survive casing, trailing slash, record IDs and account/day route changes',async t=>{
 const {createApp}=await import('../src/app.js');const {createDemoProvider}=await import('../src/demo-provider.js');const {once}=await import('node:events');const http=await import('node:http');
 const {accounts}=await accountFixture();const dayStore=createDayStore({now});await dayStore.transact(records=>{records.d={id:'d',ownerToken:'owner',members:[],revision:1,planRevision:1,expiresAt:now()+86400000,plan:plan()};});
 const server=createApp({accounts,dayStore,now,provider:createDemoProvider(),rateLimit:true}).listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const call=(path,method='GET',payload)=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{'content-type':'application/json',cookie:'outing-session=a',authorization:'Bearer owner',origin:'http://127.0.0.1:5173'}},res=>{let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));});req.on('error',reject);req.end(payload?JSON.stringify(payload):undefined);});
 const variants=['/api/account/plans/p/bookings','/API/ACCOUNT/PLANS/p/BOOKINGS/','/api/days/d/bookings','/API/DAYS/d/BOOKINGS/'];
 for(let i=0;i<60;i++)assert.equal((await call(variants[i%variants.length])).status,200);
 const rateError={code:'rate_limited',error:'Please wait a minute and try again.'};
 for(const path of [...variants,'/api/account/plans/unknown/bookings']){const result=await call(path);assert.equal(result.status,429);assert.deepEqual(result.body,rateError);}
 // Each mutation method has its own bounded bucket, shared across all booking endpoints.
 for(let i=0;i<30;i++)assert.equal((await call(variants[i%variants.length],'POST',body(`request-${i}`))).status,200);
 for(const path of [...variants,'/api/account/plans/p/bookings/private-reference/handoff','/API/DAYS/d/BOOKINGS/other/report/']){const result=await call(path,'POST',{reference:'PRIVATE-REFERENCE',notes:'PRIVATE-MESSAGE'});assert.equal(result.status,429);assert.deepEqual(result.body,rateError);}
 for(let i=0;i<30;i++)assert.equal((await call(`${variants[i%variants.length].replace(/\/$/,'')}/missing-${i}`,'PATCH',update({bookingVersion:1},`patch-${i}`,{notes:'PRIVATE-MESSAGE'}))).status,404);
 for(const path of ['/api/account/plans/p/bookings/new-id','/API/DAYS/d/BOOKINGS/new-id/']){const result=await call(path,'PATCH',{notes:'PRIVATE-MESSAGE'});assert.equal(result.status,429);assert.deepEqual(result.body,rateError);}
});

test('copying unchanged confirmed details keeps the current report; real message edits invalidate it',async()=>{
 const {accounts}=await accountFixture();let {booking}=await accounts.bookings('a','p','create',body());
 ({booking}=await accounts.bookings('a','p','handoff',update(booking,'first-copy',{reviewed:true,channel:'copy'}),booking.id));
 ({booking}=await accounts.bookings('a','p','report',update(booking,'confirmed',{outcome:'confirmed',reference:'KEEP'}),booking.id));
 const current=structuredClone(booking),noop=update(booking,'unchanged',{kind:booking.kind,notes:booking.notes});
 ({booking}=await accounts.bookings('a','p','patch',noop,booking.id));assert.deepEqual(booking,current);
 assert.deepEqual((await accounts.bookings('a','p','patch',noop,booking.id)).booking,current);
 ({booking}=await accounts.bookings('a','p','handoff',update(booking,'copy-again',{reviewed:true,channel:'copy'}),booking.id));
 assert.equal(booking.status,'user_reported_confirmed');assert.equal(booking.userReport.stale,false);assert.deepEqual(booking.userReport,current.userReport);
 ({booking}=await accounts.bookings('a','p','patch',update(booking,'actual-edit',{notes:booking.notes+'\nOne more question.'}),booking.id));
 assert.equal(booking.status,'draft');assert.equal(booking.userReport.stale,true);assert.equal(booking.userReport.reference,'KEEP');assert.equal(booking.handoff,null);
});
