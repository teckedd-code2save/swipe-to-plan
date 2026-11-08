import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseItinerary,buildItinerary} from '../src/itinerary.js';
import {createDiscovery} from '../src/plan.js';
import {createAgent} from '../src/agent.js';
import {createAccounts,createAccountStore} from '../src/accounts.js';
import {createDays,createDayStore} from '../src/days.js';
import {routeFromStops} from '../../frontend/src/shortlist.js';
import {planTitle} from '../../shared/plan-title.js';

// Synthetic provider/model responses only; no network or provider credentials.
const venues=[['cafe-a','Cafe A','cafe'],['cafe-b','Cafe B','cafe'],['meal','Meal C','restaurant']];
const discovery=(rows=venues)=>createDiscovery({provider:{name:'qloo',resolveArtist:async()=>null,discover:async()=>rows.map(([id,name,tag])=>({entity_id:id,name,tags:[{id:`urn:tag:category:qloo:${tag}`,name:tag}],properties:{address:'Osu, Accra, Ghana',price_level:2}}))}});
const request=(extra={})=>parseItinerary({area:'Osu, Accra, Ghana',date:'2099-01-01',activities:['coffee','dinner'],party:{adults:1,children:0},people:[{id:'you',name:'You',artists:[],vibes:[]}],timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'},...extra});
const build=(r,rows=venues)=>buildItinerary(discovery(rows),r);
const twoCoffees=plan=>parseItinerary(routeFromStops(plan,[{intent:'coffee',placeId:'qloo:cafe-a'},{intent:'coffee',placeId:'qloo:cafe-b'}]));
const titles=['Coffee & Dinner in Osu','Cafés & A meal in Osu','A day out','Your outing','Family day','Places still to find in Osu','Dinner at our café club','Drinks','Coffee','My birthday surprise'];
const invoke=(name,args,context,extra={})=>createAgent({getKey:()=> 'synthetic',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name,arguments:JSON.stringify(args)}}]}}]})})}).interpret({message:'Synthetic structured action',context,...extra});

test('normalization records title provenance and rejects unsupported or empty custom names',()=>{
  for(const title of [undefined,null,'','   '])assert.equal(request({title}).titleSource,'auto');
  for(const title of titles){
    assert.equal(request({title}).titleSource,'legacy');
    for(const titleSource of ['auto','custom','legacy'])assert.equal(request({title,titleSource}).titleSource,titleSource);
  }
  for(const titleSource of ['generated',false,{},null])assert.throws(()=>request({titleSource}),e=>e.status===400);
  for(const title of ['',null,undefined,'  '])assert.throws(()=>request({title,titleSource:'custom'}),e=>e.status===400);
  assert.deepEqual(parseItinerary(request()),request());
});

test('custom and unknown legacy names survive all results, even exact activity/default/status strings',async()=>{
  for(const title of titles)for(const titleSource of [undefined,'custom']){
    const initial=await build(request({title,...(titleSource?{titleSource}:{})}));
    const revised=twoCoffees(initial);
    for(const rows of [venues,venues.slice(0,1),[]]){
      const result=await build(revised,rows);
      assert.equal(result.request.title,title);assert.equal(result.request.titleSource,titleSource||'legacy');assert.equal(planTitle(result.request),title);
    }
  }
  const open=await build(request({title:'Your outing',titleSource:'custom',activities:[]}));
  assert.equal(open.request.title,'Your outing');assert.equal(open.request.titleSource,'custom');
});

test('automatic titles follow actual categories through complete, partial and empty selected routes',async()=>{
  const initial=await build(request());assert.equal(initial.request.title,'Cafés & A meal in Osu');assert.equal(initial.request.titleSource,'auto');
  const route=twoCoffees(initial);assert.equal(route.titleSource,'auto');
  const complete=await build(route);assert.equal(complete.status,'complete');assert.equal(complete.request.title,'Cafés in Osu');
  const partial=await build(route,venues.slice(0,1));assert.equal(partial.status,'partial');assert.equal(partial.request.title,'Cafe A');
  const empty=await build(route,[]);assert.equal(empty.status,'partial');assert.equal(empty.request.title,'Cafés in Osu');
  for(const plan of [complete,partial,empty]){
    assert.equal(plan.request.titleSource,'auto');
    const restored=await build(parseItinerary(JSON.parse(JSON.stringify(plan.request))));assert.equal(restored.request.title,'Cafés in Osu');
  }
  const moved=await build(parseItinerary({...complete.request,area:'Osu, Ghana',searchRadiusKm:20}));assert.equal(moved.request.title,'Cafés around Osu');
});

test('all ordinary structured planning revisions preserve custom/legacy names, and proposals stay automatic',async()=>{
  for(const titleSource of ['custom','legacy','auto']){
    const context=request({title:'Coffee & Dinner in Osu',titleSource});
    const changes={activities:['coffee'],stopIntents:['coffee','coffee'],experience:{notes:'Two café visits'},title:'A model suggestion'};
    for(const [name,args,extra] of [
      ['revise_day',changes,{}],['autopilot_day',{changes},{mode:'autopilot'}],['show_ui',{panel:'tastes',changes},{}],
      ['set_location',{...changes,area:'London, UK'},{}],['plan_day',{...context,...changes},{}],
    ]){
      const result=await invoke(name,args,context,extra);assert.equal(result.request.titleSource,titleSource,name);
      assert.equal(result.request.title,titleSource==='auto'?'A model suggestion':context.title,name);
    }
  }
  const newPlan=await invoke('plan_day',{...request(),title:'A model suggestion',titleSource:undefined},undefined);
  assert.equal(newPlan.request.titleSource,'auto');assert.equal((await build(newPlan.request)).request.title,'Cafés & A meal in Osu');
});

test('the explicit name action sets custom provenance and can intentionally restore automatic naming',async()=>{
  for(const mode of ['guided','autopilot']){
    const context=request();let payload;
    const named=await createAgent({getKey:()=> 'synthetic',fetchImpl:async(_,options)=>{payload=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'name_day',arguments:JSON.stringify({title:'A day out'})}}]}}]})};}}).interpret({message:'Call it A day out',context,mode});
    assert.ok(payload.tools.some(tool=>tool.function.name==='name_day'));assert.equal(named.request.title,'A day out');assert.equal(named.request.titleSource,'custom');
    const revised=await invoke('revise_day',{activities:['coffee'],experience:{cuisine:'Ghanaian'}},named.request);
    assert.equal(revised.request.title,'A day out');assert.equal(revised.request.titleSource,'custom');
    const reset=await invoke('name_day',{title:''},revised.request,{mode});assert.equal(reset.request.titleSource,'auto');assert.notEqual((await build(reset.request)).request.title,'A day out');
  }
  for(const args of [{},{title:3},{title:'x'.repeat(81)},{title:'Name',titleSource:'custom'}])await assert.rejects(invoke('name_day',args,request()),e=>e.status===400);
});

test('account saving, pin edits, Undo and circle sharing retain provenance across restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'synthetic-title-account-'));
  try{
    const file=join(dir,'accounts.json'),store=createAccountStore({file}),session='synthetic-owner-session',guestSession='synthetic-guest-session';
    const hash=value=>createHash('sha256').update(value).digest('base64url');
    await store.transact(data=>{data.users.you={id:'you',profile:request().people[0]};data.users.guest={id:'guest',profile:{id:'guest',name:'Guest'}};for(const [key,userId] of [[session,'you'],[guestSession,'guest']])data.sessions[hash(key)]={userId,expiresAt:Date.now()+86400000};data.circles.circle={id:'circle',name:'Test circle',ownerId:'you',members:[{userId:'you'},{userId:'guest'}]};});
    const accounts=createAccounts({store});
    for(const source of ['auto','custom','legacy']){
      const initial=await build(request(source==='auto'?{}:{title:'Coffee & Dinner in Osu',titleSource:source}));
      const target={session,id:`plan-${source}`,revision:1,circleId:'circle'};
      await accounts.keepPlan(target,initial);const revised=await build(twoCoffees(initial));await accounts.keepPlan({...target,revision:2},revised);
      const restarted=createAccounts({store:createAccountStore({file})});
      let saved=await restarted.getPlan(session,target.id);assert.equal(saved.request.titleSource,source);assert.equal(saved.request.title,revised.request.title);
      const shared=await restarted.getCirclePlan(guestSession,'you',target.id);assert.equal(shared.request.titleSource,source);assert.equal(shared.request.title,revised.request.title);
      saved=await restarted.editSavedPlan(session,target.id,{revision:2,pins:{'stop-0':'qloo:cafe-a'}});assert.equal(saved.request.titleSource,source);
      saved=await restarted.editSavedPlan(session,target.id,{revision:3,restoreRevision:1});assert.equal(saved.request.titleSource,source);assert.equal(saved.request.title,initial.request.title);
      assert.equal((await build(twoCoffees(saved))).request.title,revised.request.title);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('shared days preserve provenance across route/person revisions and durable reload',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'synthetic-title-shared-'));
  try{
    const file=join(dir,'days.json'),days=createDays({store:createDayStore({file}),discovery:discovery()});
    for(const source of ['auto','custom','legacy']){
      const created=await days.create({request:request(source==='auto'?{}:{title:'Cafés & A meal in Osu',titleSource:source})});await days.settled(created.id);
      let day=await days.get(created.id,created.token);const revised=twoCoffees(day.plan);
      await days.updateBrief(created.id,created.token,{request:revised,revision:day.revision});await days.settled(created.id);day=await days.get(created.id,created.token);
      await days.updatePerson(day.id,created.token,day.request.people[0].id,{...day.request.people[0],spending:{style:'mindful',priority:'coffee'}});await days.settled(day.id);
      const restarted=createDays({store:createDayStore({file}),discovery:discovery()});day=await restarted.get(created.id,created.token);
      assert.equal(day.request.titleSource,source);assert.equal(day.plan.request.titleSource,source);assert.equal(day.plan.request.title,source==='auto'?'Cafés in Osu':'Cafés & A meal in Osu');
      assert.equal((await restarted.get(created.id,created.inviteToken)).plan.request.titleSource,source);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});


test('one explicit naming action also applies combined stop, budget, location and timing changes',async()=>{
  const context=request({title:'Legacy café title'});
  const combined=await invoke('name_day',{title:'Birthday outing',changes:{activities:['coffee'],stopIntents:['coffee','coffee'],budget:120,timePreference:'evening',weekday:'friday'}},context,{locationContext:{confirmed:true,timeZone:'Africa/Accra'}});
  assert.equal(combined.request.title,'Birthday outing');assert.equal(combined.request.titleSource,'custom');assert.deepEqual(combined.request.stopIntents,['coffee','coffee']);assert.equal(combined.request.budget,120);assert.equal(combined.request.startTime,'17:00');assert.equal(combined.request.timing.timeConfirmed,true);assert.equal(combined.request.timing.dateConfirmed,true);
  const located=await invoke('name_day',{title:'London cafés',changes:{area:'London, UK',activities:['coffee']}},context,{locationContext:{confirmed:true}});
  assert.equal(located.action,'set_location');assert.equal(located.request.title,'London cafés');assert.equal(located.request.titleSource,'custom');assert.equal(located.request.area,'London, UK');
  const reset=await invoke('name_day',{title:'',changes:{activities:['coffee']}},combined.request);
  assert.equal(reset.request.titleSource,'auto');assert.notEqual((await build(reset.request)).request.title,'Birthday outing');
  for(const changes of [{title:'conflicting'},{titleSource:'custom'},{party:{adults:0}},{activities:['unsupported']}])await assert.rejects(invoke('name_day',{title:'Chosen',changes},context),e=>e.status===400);
});
