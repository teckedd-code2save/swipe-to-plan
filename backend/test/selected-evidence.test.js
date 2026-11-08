import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscovery} from '../src/plan.js';
import {parseRequest} from '../src/contract.js';
import {parseItinerary,buildItinerary} from '../src/itinerary.js';
import {createQlooClient} from '../src/qloo.js';
import {createDays,createDayStore} from '../src/days.js';
import {createAccounts,createAccountStore} from '../src/accounts.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const venue=(id,tags=['cafe'],properties={})=>({entity_id:id,name:`Fixture ${id}`,tags:tags.map(tag=>({id:`urn:tag:category:qloo:${tag}`,name:tag})),properties:{address:'Osu, Accra, Ghana',price_level:2,...properties},query:{explainability:{'signal.interests.entities':[{entity_id:'artist-a',score:.6}]}}});
const input=extra=>parseRequest({location:{area:'Osu'},...extra});
const brief=extra=>parseItinerary({area:'Osu',date:'2099-01-01',timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'},party:{adults:1,children:0},people:[{id:'host',name:'Host',artists:[],vibes:[]}],activities:['coffee','dinner'],...extra});
function fixture({priorB=venue('b',['cafe','restaurant']),freshB,provider:overrides={}}={}){
  let clock=Date.parse('2026-11-08T12:00:00Z'),prior=[venue('a'),priorB,venue('d',['restaurant'])],fresh=[venue('a'),...freshB?[freshB]:[]];const calls=[];
  const provider={name:'qloo',resolveArtist:async requested=>({status:'resolved',name:requested,entityId:requested==='Artist A'?'artist-a':requested.toLowerCase()}),resolveTasteTags:async()=>[],resolveExperienceTags:async()=>[],discover:async args=>{calls.push(args);return args.includeDining?prior:fresh;},...overrides};
  const discovery=createDiscovery({provider,now:()=>clock});
  return {provider,discovery,calls,tick:ms=>clock+=ms,prior:value=>prior=value,fresh:value=>fresh=value,now:()=>clock};
}
const selected=async(f,request=input(),options={})=>(await f.discovery.byIntents(request,['coffee'],{selectedIds:['qloo:b'],...options}))[0];
const seed=async(f,request=input(),options={})=>{await f.discovery.byIntents(request,['coffee','dinner'],options);f.tick(1000);};

test('exact selected café survives category-pool loss with original provider evidence and current hard checks',async t=>{
  t.mock.method(globalThis,'fetch',()=>{throw Error('No external requests');});
  const f=fixture(),original=brief({people:[{id:'host',name:'Host',artists:['Artist A'],vibes:[]}],route:[{intent:'coffee',placeId:'qloo:a'},{intent:'dinner',placeId:'qloo:d'},{intent:'coffee',placeId:'qloo:a'}]});
  const first=await buildItinerary(f.discovery,original),prior=first.shortlist.find(c=>c.item.id==='qloo:b').item;f.tick(1000);
  const next=await buildItinerary(f.discovery,brief({...first.request,activities:['coffee'],stopIntents:['coffee','coffee'],route:[{intent:'coffee',placeId:'qloo:a'},{intent:'coffee',placeId:'qloo:b'}]}));
  assert.equal(next.status,'complete');assert.deepEqual(next.stops.map(s=>s.item.id),['qloo:a','qloo:b']);assert.equal(f.calls.length,2);
  const kept=next.stops[1].item;assert.equal(kept.provenance.retrievedAt,prior.provenance.retrievedAt);assert.notEqual(kept.provenance.retrievedAt,next.provenance.retrievedAt);assert.equal(kept.provenance.selectionEvidence.source,'compatible_cache');assert.equal(kept.provenance.selectionEvidence.cacheAgeMs,1000);
  assert.deepEqual(kept.affinityEvidence,prior.affinityEvidence);assert.equal(kept.scoreComponents.providerOrder,prior.scoreComponents.providerOrder);assert.deepEqual(kept.contact,prior.contact);assert.equal(next.stops[1].selectionEvidence.status,'eligible');assert.match(next.warnings.join(' '),/original retrieval time/);
  assert.equal(next.tasteMap.edges.filter(edge=>edge.to==='stop-1'&&edge.kind==='affinity').length,1);
});

test('real provider adapter loses restaurant supplemental coverage; selected recovery makes no extra provider query',async()=>{
  const calls=[];const provider=createQlooClient({getKey:()=> 'synthetic-only',fetchImpl:async url=>{
    calls.push(url.pathname);const result=url.pathname==='/v2/tags'?[{id:'urn:tag:category:qloo:restaurant'}]:url.searchParams.has('filter.tags')?[venue('b',['cafe','restaurant'])]:[venue('a')];
    return new Response(JSON.stringify({results:result}),{headers:{'content-type':'application/json'}});
  }}),discovery=createDiscovery({provider});
  await discovery.byIntents(input(),['coffee','dinner']);const before=calls.length;
  const [result]=await discovery.byIntents(input(),['coffee'],{selectedIds:['qloo:b']});
  assert.equal(calls.length-before,1);assert.deepEqual(result.ranked.map(p=>p.id),['qloo:a','qloo:b']);assert.equal(result.selectedEvidence['qloo:b'].source,'compatible_cache');
});

test('only explicit selected IDs recover; ordinary discovery remains distinct and excludes old alternatives',async()=>{
  const f=fixture();await seed(f);const request=brief({activities:['coffee'],stopIntents:['coffee','coffee']});
  const plain=await buildItinerary(f.discovery,request);assert.equal(plain.stops.filter(s=>s.item).length,1);assert.equal(plain.shortlist.some(c=>c.item.id==='qloo:b'),false);
  const repeated=await buildItinerary(f.discovery,brief({...request,route:[{intent:'coffee',placeId:'qloo:b'},{intent:'coffee',placeId:'qloo:b'}]}));assert.deepEqual(repeated.stops.map(s=>s.item.id),['qloo:b','qloo:b']);assert.notEqual(repeated.stops[0].id,repeated.stops[1].id);
  const pinned=await buildItinerary(f.discovery,brief({...request,pins:{'stop-0':'qloo:a','stop-1':'qloo:b'}}));assert.deepEqual(pinned.stops.map(s=>s.item.id),['qloo:a','qloo:b']);
  const unknown=await selected(f,input(),{selectedIds:['qloo:client-invented','other:b']});assert.equal(unknown.selectedEvidence['qloo:client-invented'].status,'unavailable');assert.equal(unknown.selectedEvidence['other:b'],undefined);
});

for(const [label,change,options] of [
  ['area',{location:{area:'Labone'}},{}],['location identity',{location:{area:'Osu',id:'12345678-1234-1234-1234-123456789abc'}},{}],['radius',{}, {radiusKm:20}],
  ['artist input',{taste:{artists:['Artist A']}},{}],['vibe input',{taste:{vibes:['v-cafe']}},{}],['personal context',{taste:{context:{role:'Designer'}}},{}],['experience',{}, {experience:{cuisine:'Turkish'}}],
])test(`selected evidence cannot cross ${label} context`,async()=>{
  const f=fixture();await seed(f);const result=await selected(f,input(change),options);assert.equal(result.ranked.some(p=>p.id==='qloo:b'),false);assert.equal(result.selectedEvidence['qloo:b'].reason,'selected_evidence_unavailable');
});

test('changed resolved signals and unavailable optional signals prevent cache recovery',async()=>{
  let artist='artist-a',fail=false;const f=fixture({provider:{resolveArtist:async name=>({status:'resolved',name,entityId:artist}),resolveTasteTags:async()=>{if(fail)throw Error('optional unavailable');return [];}}}),request=input({taste:{artists:['Artist A']}});
  await seed(f,request);artist='new-artist';assert.equal((await selected(f,request)).selectedEvidence['qloo:b'].status,'unavailable');
  artist='artist-a';fail=true;assert.equal((await selected(f,request)).selectedEvidence['qloo:b'].status,'unavailable');
});

for(const elapsed of [600000,600001])test(`selected evidence expires after ${elapsed} ms without renewing its original lifetime`,async()=>{
  const f=fixture();await seed(f);f.tick(elapsed-1000);const result=await selected(f);assert.equal(result.selectedEvidence['qloo:b'].status,'unavailable');
});
test('using recovered evidence does not put it into the new pool or extend its expiration',async()=>{
  const f=fixture();await seed(f);f.tick(539000);assert.equal((await selected(f)).selectedEvidence['qloo:b'].source,'compatible_cache');f.tick(61000);assert.equal((await selected(f)).selectedEvidence['qloo:b'].status,'unavailable');
});
test('cache lookup is bounded and does not recover evicted evidence',async()=>{
  const f=fixture();await seed(f);for(let i=0;i<100;i++)await f.discovery.byIntents(input({location:{area:`Area ${i}, Ghana`}}),['coffee']);
  assert.equal((await selected(f)).selectedEvidence['qloo:b'].status,'unavailable');
});

for(const [label,request,expected] of [
  ['user exclusion',input({constraints:{excludeIds:['qloo:b']}}),'excluded_by_user'],
  ['feedback exclusion',input({feedback:[{candidateId:'qloo:b',reason:'not_relevant'}]}),'excluded_by_user'],
  ['price limit',input({constraints:{maxPriceLevel:1}}),'over_price_limit'],
  ['category restriction',input({constraints:{excludeTags:['cafe']}}),'excluded_tag'],
])test(`recovered selection reruns the current ${label}`,async()=>{
  const f=fixture();await seed(f);const result=await selected(f,request);assert.equal(result.ranked.some(p=>p.id==='qloo:b'),false);assert.deepEqual(result.selectedEvidence['qloo:b'],{status:'rejected',source:'compatible_cache',retrievedAt:new Date(f.now()-1000).toISOString(),reason:expected});
});

for(const [label,b,expected] of [
  ['closure',venue('b',['cafe'],{is_closed:true}),'permanently_closed'],
  ['category',venue('b',['restaurant']),'intent_not_supported'],
  ['area',venue('b',['cafe'],{address:'Labone, Accra, Ghana'}),'location_not_supported'],
  ['missing price',venue('b',['cafe'],{price_level:null}),'price_unknown'],
  ['mall entity',venue('b',['cafe','shopping_mall']),'intent_not_supported'],
])test(`fresh ${label} rejection cannot be resurrected from favorable old evidence`,async()=>{
  const f=fixture({freshB:b});await seed(f);const result=await selected(f,input({constraints:{maxPriceLevel:3}}));assert.equal(result.ranked.some(p=>p.id==='qloo:b'),false);assert.equal(result.selectedEvidence['qloo:b'].source,'current_pool');assert.equal(result.selectedEvidence['qloo:b'].reason,expected);
});

test('newest compatible observation wins; do not search older entries for a favorable version',async()=>{
  const f=fixture();await seed(f);f.prior([venue('a'),venue('b',['cafe'],{is_closed:true})]);await f.discovery.byIntents(input(),['activity','dinner']);f.tick(1000);
  const result=await selected(f);assert.equal(result.selectedEvidence['qloo:b'].reason,'permanently_closed');assert.equal(result.ranked.some(p=>p.id==='qloo:b'),false);
});
test('fresh eligible data wins over old data and raw cache snapshots do not mutate',async()=>{
  const raw=venue('b',['cafe','restaurant']),f=fixture({priorB:raw,freshB:{...raw,name:'Fresh café'}});await seed(f);raw.name='Changed source object';
  const result=await selected(f),item=result.ranked.find(p=>p.id==='qloo:b');assert.equal(item.name,'Fresh café');assert.equal(item.provenance.selectionEvidence,undefined);
  const other=fixture({priorB:raw});await seed(other);raw.name='Mutated again';assert.equal((await selected(other)).ranked.find(p=>p.id==='qloo:b').name,'Changed source object');
});

test('current family exclusions and requested category reject recovered evidence without losing untouched visits',async()=>{
  const f=fixture({priorB:venue('b',['cafe','nightclub'])});await seed(f);
  const family=await buildItinerary(f.discovery,brief({party:{adults:1,children:1},activities:['coffee'],route:[{intent:'coffee',placeId:'qloo:a'},{intent:'coffee',placeId:'qloo:b'}]}));
  assert.equal(family.stops[0].item.id,'qloo:a');assert.equal(family.stops[1].reason,'selected_place_rejected');assert.equal(family.stops[1].selectionEvidence.reason,'excluded_tag');
  const wrongType=await buildItinerary(f.discovery,brief({activities:['dinner'],route:[{intent:'dinner',placeId:'qloo:b'}]}));assert.equal(wrongType.stops[0].selectionEvidence.reason,'intent_not_supported');
});

test('a selected missing ID reports evidence unavailability, not a fabricated category or area rejection',async()=>{
  const f=fixture();const result=await buildItinerary(f.discovery,brief({activities:['coffee'],route:[{intent:'coffee',placeId:'qloo:unknown'}]}));assert.equal(result.stops[0].reason,'selected_evidence_unavailable');assert.equal(result.stops[0].item,null);assert.match(result.warnings.join(' '),/compatible recent provider evidence is unavailable/);
});

test('recovery preserves original locality proof and refuses a different resolved locality or lost locality metadata',async()=>{
  const locality={query:'Osu',id:'provider-osu',label:'Osu, Accra, Ghana',name:'Osu',method:'qloo_locality_filter',radius:0};
  for(const changed of [false,true,'missing']){
    const f=fixture();f.prior(Object.assign([venue('a'),venue('b',['cafe'],{address:'Accra, Ghana'})],{locality}));
    f.fresh(Object.assign([venue('a')],changed==='missing'?{}:{locality:changed?{...locality,id:'different-locality'}:locality}));await seed(f);
    const result=await selected(f),kept=result.ranked.find(p=>p.id==='qloo:b');
    if(changed){assert.equal(kept,undefined);assert.equal(result.selectedEvidence['qloo:b'].status,'unavailable');}
    else {assert.deepEqual(kept.provenance.locality,locality);assert.equal(kept.reasons.find(r=>r.code==='location_match').evidence[0].localityId,locality.id);}
  }
});

test('malformed provider entries do not crash selected lookup or provide fabricated identity evidence',async()=>{
  const f=fixture();f.prior([null,{},venue('b')]);f.fresh([null,{},venue('a')]);await seed(f);const result=await selected(f);assert.equal(result.selectedEvidence['qloo:b'].status,'eligible');
});

test('a fresh group-member rejection cannot be overridden by another member cached selection',async()=>{
  const f=fixture({provider:{discover:async({includeDining,signalIds})=>includeDining?[venue('a'),venue('b',['cafe','restaurant']),venue('d',['restaurant'])]:[venue('a'),...(signalIds.includes('second')?[venue('b',['cafe'],{is_closed:true})]:[])]}});
  const group=brief({party:{adults:2},people:[{id:'one',name:'One',artists:['First'],vibes:[]},{id:'two',name:'Two',artists:['Second'],vibes:[]}]});
  await buildItinerary(f.discovery,group);f.tick(1000);const result=await buildItinerary(f.discovery,brief({...group,activities:['coffee'],route:[{intent:'coffee',placeId:'qloo:a'},{intent:'coffee',placeId:'qloo:b'}]}));
  assert.equal(result.stops[0].item.id,'qloo:a');assert.equal(result.stops[1].item,null);assert.equal(result.stops[1].selectionEvidence.reason,'permanently_closed');assert.equal(result.stops[1].selectionEvidence.source,'current_pool');
});

test('a recovered venue still goes through current reported-hours scheduling',async()=>{
  const f=fixture();await seed(f);f.discovery.placeDetails=async()=>({hours:{thursday:[{open:'01:00',close:'02:00'}]}});
  const plan=await buildItinerary(f.discovery,brief({activities:['coffee'],route:[{intent:'coffee',placeId:'qloo:b'}],timing:{dateConfirmed:true,timeConfirmed:true,mode:'fixed'},startTime:'12:00',endTime:'14:00'}));
  assert.equal(plan.stops[0].item.id,'qloo:b');assert.equal(plan.phase,'needs_timing');assert.equal(plan.stops[0].start,null);assert.equal(plan.stops[0].timeStatus,'needs_time');
});

const twoCafes=request=>brief({...request,activities:['coffee'],stopIntents:['coffee','coffee'],route:[{intent:'coffee',placeId:'qloo:a'},{intent:'coffee',placeId:'qloo:b'}]});
test('shared revisions persist selected original evidence and strict missing reasons through store reload',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'selection-shared-'));t.after(()=>rm(directory,{recursive:true,force:true}));const file=join(directory,'days.json'),f=fixture();
  const days=createDays({discovery:f.discovery,store:createDayStore({file})}),created=await days.create({request:brief()});await days.settled(created.id);const first=await days.get(created.id,created.token);f.tick(1000);
  await days.updateBrief(created.id,created.token,{request:twoCafes(first.request),revision:first.revision});await days.settled(created.id);
  const second=await days.get(created.id,created.token);assert.deepEqual(second.plan.stops.map(s=>s.item.id),['qloo:a','qloo:b']);const kept=second.plan.stops[1].item;
  const reloaded=createDays({discovery:fixture().discovery,store:createDayStore({file})});assert.deepEqual((await reloaded.get(created.id,created.token)).plan.stops[1].item,kept);
  await days.updateBrief(created.id,created.token,{request:{...second.request,excludeIds:['qloo:b']},revision:second.revision});await days.settled(created.id);const rejected=await days.get(created.id,created.token);
  assert.equal(rejected.plan.stops[1].reason,'selected_place_rejected');assert.equal(rejected.plan.stops[1].selectionEvidence.reason,'excluded_by_user');
});

test('account saved revisions and Undo retain original recovered timestamps, evidence and missing reasons',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'selection-account-'));t.after(()=>rm(directory,{recursive:true,force:true}));const file=join(directory,'accounts.json');let nonce,state;
  const accounts=createAccounts({store:createAccountStore({file}),clientId:'synthetic',clientSecret:'synthetic',oauthFactory:()=>({generateAuthUrl:args=>{nonce=args.nonce;state=args.state;return 'https://accounts.google.com/';},getToken:async()=>({tokens:{id_token:'synthetic'}}),verifyIdToken:async()=>({getPayload:()=>({sub:'synthetic-person',email:'person@example.invalid',email_verified:true,name:'Person',nonce})})})});
  const flow=await accounts.start({returnTo:'/'}),session=(await accounts.complete({state,code:'synthetic'},flow.binding)).session;
  const f=fixture();await buildItinerary(f.discovery,brief());f.tick(1000);const kept=await buildItinerary(f.discovery,twoCafes(brief()));
  const target={session,id:'selected-day',revision:1};await accounts.keepPlan(target,kept);const missing=await buildItinerary(f.discovery,brief({...kept.request,excludeIds:['qloo:b']}));await accounts.keepPlan({...target,revision:2},missing);
  const reloaded=createAccounts({store:createAccountStore({file})});assert.equal((await reloaded.getPlan(session,target.id)).stops[1].selectionEvidence.reason,'excluded_by_user');
  const restored=await reloaded.editSavedPlan(session,target.id,{revision:2,restoreRevision:1});assert.deepEqual(restored.stops,kept.stops);assert.equal(restored.stops[1].item.provenance.retrievedAt,kept.stops[1].item.provenance.retrievedAt);
});

test('guest HTTP revisions recover only trusted server evidence, never client-supplied venue facts',async t=>{
  const {createApp}=await import('../src/app.js'),http=await import('node:http');const f=fixture(),server=createApp({provider:f.provider,now:f.now,rateLimit:false}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const call=body=>new Promise((resolve,reject)=>{const request=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/api/itineraries',method:'POST',headers:{'content-type':'application/json'}},response=>{let text='';response.on('data',part=>text+=part);response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(text)}));});request.on('error',reject);request.end(JSON.stringify(body));});
  t.mock.method(globalThis,'fetch',()=>{throw Error('External requests forbidden');});
  const initial=await call(brief());assert.equal(initial.status,200);f.tick(1000);
  const request=twoCafes(initial.body.request),invented=await call({...request,selectedEvidence:{places:[venue('client-invented')]}});assert.equal(invented.status,400);
  const result=await call(request);assert.equal(result.status,200);assert.deepEqual(result.body.stops.map(s=>s.item.id),['qloo:a','qloo:b']);assert.equal(result.body.savedPlan,undefined);assert.equal(result.body.stops[1].item.provenance.selectionEvidence.source,'compatible_cache');assert.equal(f.calls.length,2);
});

test('explicit group selections survive the top-50 merged discovery cap without broadening ordinary results',async()=>{
  const main=Array.from({length:50},(_,i)=>venue(`main-${i}`)),f=fixture();f.prior([...main,venue('b',['cafe','restaurant'])]);f.fresh(main);
  const request=brief({party:{adults:2},people:[{id:'one',name:'One',artists:['First'],vibes:[]},{id:'two',name:'Two',artists:['Second'],vibes:[]}]});await buildItinerary(f.discovery,request);f.tick(1000);
  const next=await buildItinerary(f.discovery,brief({...request,activities:['coffee'],route:[{intent:'coffee',placeId:'qloo:main-0'},{intent:'coffee',placeId:'qloo:b'}]}));
  assert.equal(next.status,'complete');assert.deepEqual(next.stops.map(s=>s.item.id),['qloo:main-0','qloo:b']);assert.equal(next.stops[1].selectionEvidence.members.length,2);assert.ok(next.stops[1].selectionEvidence.members.every(m=>m.source==='compatible_cache'));assert.equal(next.shortlist.some(c=>c.item.id==='qloo:b'),false);
  const {mergeGroup}=await import('../src/plan.js'),items=Array.from({length:51},(_,i)=>({id:`item-${i}`,score:51-i,matchedVibes:[],reasons:[]}));assert.equal(mergeGroup([{id:'one',name:'One',ranked:items}],50).items.length,50);
});

test('cold and warm asynchronous context resolution remains compatible without changing input-taste identity',async()=>{
  let release;const delayed=new Promise(resolve=>release=resolve),calls=[];
  const provider=createQlooClient({getKey:()=> 'synthetic-only',fetchImpl:async url=>{
    calls.push(url.pathname);const name=url.searchParams.get('query');
    if(url.pathname==='/search'){
      if(name==='Book A')await delayed;else setTimeout(release,10);
      return Response.json({results:[{entity_id:name==='Book A'?'book-a':'book-b',name,types:['urn:entity:book']}]});
    }
    return Response.json({results:url.pathname==='/v2/tags'?[{id:'urn:tag:category:qloo:restaurant'}]:url.searchParams.has('filter.tags')?[venue('b',['cafe','restaurant'])]:[venue('a')]});
  }}),discovery=createDiscovery({provider});
  const request=input({taste:{context:{interests:[{type:'book',name:'Book A'},{type:'book',name:'Book B'}]}}});
  const first=await discovery.byIntents(request,['coffee','dinner']);assert.deepEqual(first[0].taste.contextSignals.interests.map(s=>s.name),['Book B','Book A']);const count=calls.length;
  const [next]=await discovery.byIntents(request,['coffee'],{selectedIds:['qloo:b']});assert.deepEqual(next.taste.contextSignals.interests.map(s=>s.name),['Book A','Book B']);assert.equal(next.selectedEvidence['qloo:b'].source,'compatible_cache');assert.equal(calls.length-count,1);
  const changed=input({taste:{context:{interests:[{type:'book',name:'Book B'},{type:'book',name:'Book A'}]}}});assert.equal((await discovery.byIntents(changed,['coffee'],{selectedIds:['qloo:b']}))[0].selectedEvidence['qloo:b'].status,'unavailable');
});

for(const reverse of [false,true])test(`mixed group evidence retains the recovered member timestamp without relabeling fresh venue facts (${reverse?'reverse':'normal'} order)`,async()=>{
  const f=fixture({provider:{discover:async({includeDining,signalIds})=>{
    const fresh=signalIds.includes('first'),b={...venue('b',['cafe','restaurant']),query:{explainability:{'signal.interests.entities':[{entity_id:'first',score:.6},{entity_id:'second',score:.7}]}}};return includeDining?[venue('a'),b,venue('d',['restaurant'])]:[venue('a'),...(fresh?[{...b,name:'Fresh selected café'}]:[])];
  }}}),people=[{id:'one',name:'One',artists:['First'],vibes:[]},{id:'two',name:'Two',artists:['Second'],vibes:[]}];if(reverse)people.reverse();
  const request=brief({party:{adults:2},people});await buildItinerary(f.discovery,request);f.tick(1000);
  const next=await buildItinerary(f.discovery,brief({...request,activities:['coffee'],route:[{intent:'coffee',placeId:'qloo:b'}]})),stop=next.stops[0],old=new Date(f.now()-1000).toISOString(),current=new Date(f.now()).toISOString();
  assert.equal(stop.item.name,'Fresh selected café');assert.equal(stop.item.provenance.retrievedAt,current);assert.equal(stop.item.provenance.selectionEvidence,undefined);assert.equal(stop.selectionEvidence.source,'current_pool');
  assert.equal(stop.selectionEvidence.members.find(m=>m.personId==='two').retrievedAt,old);assert.equal(stop.selectionEvidence.members.find(m=>m.personId==='two').source,'compatible_cache');assert.match(next.warnings.join(' '),/original retrieval time/);
  assert.equal(stop.connections.find(e=>e.personId==='two').kind,'affinity');assert.equal(stop.connections.find(e=>e.personId==='two').contribution,.7);assert.equal(stop.connections.find(e=>e.personId==='two').provenance.retrievedAt,old);assert.equal(stop.connections.find(e=>e.personId==='one').provenance,undefined);
});
