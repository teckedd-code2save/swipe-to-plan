import test from 'node:test';
import assert from 'node:assert/strict';
import {createLatestPlanner,tasteFromSwipe} from '../../frontend/src/day-state.js';
import {bringCircle} from '../../frontend/src/circles.js';
import {daybookHtml,itineraryCalendar} from '../../frontend/src/daybook.js';
import {parseItinerary as parseBrief,buildItinerary} from '../src/itinerary.js';
const parseItinerary=(body={})=>parseBrief({activities:['coffee','dinner'],...body});
import {createDiscovery} from '../src/plan.js';
import {createDemoProvider} from '../src/demo-provider.js';
const tick=()=>new Promise(r=>setImmediate(r));
const p=(id,vibes=[])=>({id,name:id,artists:[],vibes});
test('rapid tastes coalesce and late results or errors cannot overwrite newer work',async()=>{
  const calls=[],results=[],errors=[];let resolve,reject;
  const planner=createLatestPlanner({run:value=>{calls.push(value);return new Promise((yes,no)=>{resolve=yes;reject=no;});},onResult:r=>results.push(r),onError:e=>errors.push(e)});
  planner.enqueue(1);planner.invalidate();planner.enqueue(2);planner.enqueue(3);resolve('old');await tick();
  assert.deepEqual(calls,[1,3]);assert.deepEqual(results,[]);resolve('latest');await tick();assert.deepEqual(results,['latest']);
  planner.enqueue(4);planner.invalidate();reject(Error('outdated error'));await tick();assert.deepEqual(errors,[]);
  planner.enqueue(5);planner.dispose();resolve('disposed');await tick();assert.deepEqual(results,['latest']);
});
test('a saved circle uses refreshed contact tastes without overwriting present members',()=>{
  const circle={people:[p('Alex',['v-cafe']),p('Sam',['v-cafe'])]};
  const brief=parseItinerary({people:[p('Alex',['v-african'])]});
  const merged=bringCircle(brief,circle,[p('Sam',['v-rooftop'])]);
  assert.deepEqual(merged.people.map(p=>p.vibes),[['v-african'],['v-rooftop']]);
  assert.equal(bringCircle(merged,circle).people.length,2);
  const empty=parseItinerary({people:[{id:'blank',name:'You'}]});assert.deepEqual(bringCircle(empty,circle).people.map(p=>p.id),['Alex','Sam']);
  assert.throws(()=>bringCircle({...brief,people:['1','2','3','4','5','6'].map(id=>p(id))},circle),/six/);
  assert.deepEqual(tasteFromSwipe(p('Alex'),{kind:'vibe',id:'v-cafe'},true).vibes,['v-cafe']);
});
test('one-place daybooks and calendars contain only the selected stop',async()=>{
  const plan=await buildItinerary(createDiscovery({provider:createDemoProvider()}),parseItinerary({date:'2099-01-01',activities:['dinner'],party:{adults:1}}));
  assert.equal(plan.stops.length,1);assert.ok(plan.stops[0].item);
  const html=daybookHtml(plan),calendar=itineraryCalendar(plan);
  assert.equal((html.match(/<section class="stop">/g)||[]).length,1);assert.equal((calendar.match(/BEGIN:VEVENT/g)||[]).length,1);
  assert.ok(!html.includes('planning buffer after this stop'));
});

test('personal daybooks escape content, attribute only that person’s threads and calendars remain tentative',async()=>{
  const plan=await buildItinerary(createDiscovery({provider:createDemoProvider()}),parseItinerary({date:'2099-01-01',people:[{id:'alex',name:'Alex',vibes:['v-cafe']},{id:'sam',name:'Sam',vibes:['v-african']}]}));
  plan.request.title='<img src=x onerror=alert(1)> & our day';
  const html=daybookHtml(plan,'alex');
  assert.ok(html.includes('A little daybook for Alex'));assert.ok(html.includes('Alex, you’re part of the picture.'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<b>Sam ·'));assert.ok(html.includes('whole-group allowance'));
  const ics=itineraryCalendar(plan);assert.ok(ics.includes('STATUS:TENTATIVE'));assert.ok(ics.includes('TRANSP:TRANSPARENT'));assert.match(ics,/DTSTART:20990101T\d{6}Z/);
  for(const line of ics.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
});

test('circle search only includes accepted accounts and invitation acceptance resolves a real profile',async()=>{
  const {connectedPeople,newlyJoinedPeople}=await import('../../frontend/src/connections.js');
  const user={id:'host'},circle={people:[p('host'),p('joined',['v-cafe']),p('unclaimed')],accountIds:['host','joined']};
  assert.deepEqual(connectedPeople(user,[circle,circle]).map(p=>p.id),['joined']);
  assert.deepEqual(connectedPeople(null,[circle]),[]);
  assert.deepEqual(newlyJoinedPeople(circle,['host']).map(p=>p.id),['joined']);
});
test('Google Calendar opens one correctly zoned event without exposing participant tastes or invitation credentials',async()=>{
  const {googleCalendarLink}=await import('../../frontend/src/daybook.js');
  const plan={request:{title:'Lunch & a wander',date:'2026-10-25',area:'London',budget:80,currency:'GBP',people:[{name:'Secret name',artists:['Secret taste']}]},timeZone:'Europe/London',inviteToken:'private-token',stops:[{start:'11:00',end:'12:00',item:{name:'Cafe & kitchen',address:'A public address',links:{map:'https://www.google.com/maps/search/?api=1&query=London'}}},{start:'12:30',end:'13:15',item:{name:'A gallery',address:'Another address'}}]};
  const url=new URL(googleCalendarLink(plan));assert.equal(url.origin,'https://calendar.google.com');assert.equal(url.searchParams.get('action'),'TEMPLATE');assert.equal(url.searchParams.get('text'),plan.request.title);
  assert.equal(url.searchParams.get('dates'),'20261025T110000Z/20261025T131500Z');assert.equal(url.searchParams.get('stz'),'Europe/London');assert.match(url.searchParams.get('details'),/11:00–12:00 · Cafe & kitchen/);assert.match(url.searchParams.get('details'),/snapshot/);
  assert.doesNotMatch(decodeURIComponent(url.href),/Secret name|Secret taste|private-token/);
  assert.throws(()=>googleCalendarLink({...plan,timeZone:null}),/time zone/);assert.throws(()=>googleCalendarLink({...plan,stops:[]}),/at least one/);
});

test('signing in attaches the guest organizer to the account without duplicating them or losing the group',async()=>{
  const {adoptAccountProfile}=await import('../../frontend/src/day-state.js');
  const brief=parseItinerary({people:[{id:'guest',name:'You',artists:['SZA']},p('Maya',['v-cafe'])]});
  const profile={id:'account',name:'Alex',artists:['Sade'],vibes:['v-seafood'],spending:{style:'mindful',priority:'dinner'}};
  const adopted=adoptAccountProfile(brief,profile);
  assert.deepEqual(adopted.people.map(p=>p.id),['account','Maya']);assert.deepEqual(adopted.people[0].artists,['SZA']);assert.deepEqual(adopted.people[0].vibes,['v-seafood']);assert.equal(adopted.budget,brief.budget);
  assert.equal(adoptAccountProfile(adopted,profile),null);
});


test('partial daybooks show only actual visits and never advertise old unfilled times',async()=>{
  const plan=await buildItinerary(createDiscovery({provider:createDemoProvider()}),parseItinerary({date:'2099-01-01',activities:['dinner'],startTime:'14:00',party:{adults:1}}));
  plan.request.startTime='09:00';
  plan.stops.unshift({id:'missing',intent:'coffee',start:'09:00',end:'09:45',item:null,connections:[],bufferAfterMinutes:30});
  const html=daybookHtml(plan),calendar=itineraryCalendar(plan);
  assert.equal((html.match(/<section class="stop">/g)||[]).length,1);
  assert.ok(!html.includes('09:00'));assert.ok(!html.includes('Not scheduled'));assert.ok(!html.includes('A moment still to be found'));
  assert.equal((calendar.match(/BEGIN:VEVENT/g)||[]).length,1);
});
