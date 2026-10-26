import test from 'node:test';
import assert from 'node:assert/strict';
import {parseContext,validateDisclosures} from '../src/context.js';
import {parseItinerary} from '../src/itinerary.js';
import {createQlooClient} from '../src/qloo.js';
import {createDiscovery} from '../src/plan.js';
import {parseRequest} from '../src/contract.js';
const tech='urn:audience:professional_area:technology_professional';
const catalog=[{id:tech,name:'Technology Professional'}];
test('new role and cultural tastes require a real user disclosure; model text is not evidence',()=>{
 const person={id:'me',context:{role:'Software engineer',roleQuote:'software engineer',audiences:[tech]}};
 assert.doesNotThrow(()=>validateDisclosures([person],[],'I am a software engineer',[],catalog));
 assert.throws(()=>validateDisclosures([person],[],'I want drinks',[{role:'assistant',text:'software engineer'}],catalog));
 assert.throws(()=>validateDisclosures([{id:'me',context:{interests:[{type:'book',name:'Dune'}]}}],[],'I am a researcher',[],catalog));
 assert.throws(()=>validateDisclosures([person],[],'software engineer',[],[]));
});
test('context survives itinerary validation without inventing budget, timing or tastes',()=>{
 const request=parseItinerary({timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'},people:[{name:'You',context:{role:'Research student'}}]});
 assert.equal(request.people[0].context.role,'Research student');assert.equal(request.budget,null);
 assert.deepEqual(request.people[0].vibes,[]);assert.equal(request.timing.timeConfirmed,false);
 assert.throws(()=>parseContext({interests:[{type:'diagnosis',name:'stress'}]}));
});
test('Qloo validates audience IDs against live catalog, resolves cross-domain entities and weights cohort weakly',async()=>{
 const calls=[];
 const qloo=createQlooClient({getKey:()=> 'test',fetchImpl:async input=>{
  const url=new URL(input);calls.push(url);
  if(url.pathname==='/v2/audiences')return Response.json({results:{audiences:url.searchParams.get('filter.parents.types')==='urn:audience:professional_area'?catalog:[]}});
  if(url.pathname==='/search')return Response.json({results:{entities:[{entity_id:'book-id',name:'Dune',types:['urn:entity:book']}]}});
  return Response.json({results:{entities:[]}});
 }});
 const signals=await qloo.resolveContext({audiences:[tech,'urn:audience:professional_area:invented'],interests:[{type:'book',name:'Dune'},{type:'movie',name:'Dune'}]});
 assert.deepEqual(signals.audiences.map(({id,name})=>({id,name})),catalog);assert.equal(signals.interests.length,1);assert.equal(signals.unresolved.length,1);
 await qloo.discover({signalIds:['book-id'],area:'Accra',contextSignals:signals});
 const insight=calls.find(u=>u.pathname==='/v2/insights');
 assert.equal(insight.searchParams.get('signal.demographics.audiences'),tech);
 assert.equal(insight.searchParams.get('signal.demographics.audiences.weight'),'0.35');
 assert.equal(insight.searchParams.get('signal.interests.entities'),'book-id');
 await qloo.audienceCatalog();assert.equal(calls.filter(u=>u.pathname==='/v2/audiences').length,4);
});
test('context affects discovery cache identity and cultural entities reach retrieval without false artist evidence',async()=>{
 const calls=[];const discovery=createDiscovery({provider:{name:'qloo',resolveContext:async c=>({audiences:c?.audiences?.map(id=>({id,name:id}))||[],interests:[{type:'book',name:'Dune',entityId:'book-id'}],unresolved:[]}),discover:async args=>{calls.push(args);return [];}}});
 const request=id=>parseRequest({taste:{context:{audiences:[id]}}});
 const first=await discovery.person(request(tech));
 await discovery.person(request('urn:audience:professional_area:medical_professional'));
 await discovery.person(request(tech));
 assert.equal(calls.length,2);assert.deepEqual(calls[0].signalIds,['book-id']);
 assert.deepEqual(first.taste.resolved,[]);assert.equal(first.taste.contextSignals.interests[0].name,'Dune');
});

import {auditContext} from '../src/context-audit.js';
test('context review can only remove signals and preserves existing personal preferences on failure',async()=>{
 const previous=[{id:'you',vibes:['v-art'],context:{audiences:[tech]}}];
 const result=()=>({request:{people:[{id:'you',vibes:['v-art','v-cafe'],context:{role:'Research student',audiences:[tech,'urn:audience:professional_area:business_professional'],interests:[{type:'destination',name:'hiking'},{type:'movie',name:'Spirited Away'}]}}]}});
 const reviewed=await auditContext(result(),{previous,message:'I am a research student and love Spirited Away',review:async()=>[{id:'you',audiences:['invented-id'],vibes:['invented-vibe'],interestIndexes:[1,99]}]});
 const person=reviewed.request.people[0];assert.deepEqual(person.vibes,['v-art']);assert.deepEqual(person.context.audiences,[tech]);assert.equal(person.context.interests[0].name,'Spirited Away');assert.equal(person.context.interests.length,1);
 const fallback=await auditContext(result(),{previous,review:async()=>{throw new Error('timeout');}});
 assert.deepEqual(fallback.request.people[0].context.audiences,[tech]);assert.deepEqual(fallback.request.people[0].context.interests,[]);assert.deepEqual(fallback.request.people[0].vibes,['v-art']);assert.equal(fallback.request.people[0].context.role,'Research student');
});

import {nextWeekdayDate} from '../src/scheduling.js';
test('named weekdays resolve from the destination date across month/year boundaries',()=>{
 assert.equal(nextWeekdayDate('2026-10-26','friday'),'2026-10-30');
 assert.equal(nextWeekdayDate('2026-10-30','friday'),'2026-10-30');
 assert.equal(nextWeekdayDate('2026-12-31','monday'),'2027-01-04');
 assert.throws(()=>nextWeekdayDate('2026-10-26','someday'));
});
