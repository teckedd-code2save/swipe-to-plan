import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewCandidatePools} from '../src/candidate-review.js';
import {createAgent} from '../src/agent.js';
import {createQlooClient} from '../src/qloo.js';
import {createDiscovery} from '../src/plan.js';
import {buildItinerary,parseItinerary} from '../src/itinerary.js';
const pool=[{id:'garden',name:'Garden',description:'Botanical garden'},{id:'market',name:'Market',description:'Chaotic electronics scrapyard'}];
const request={activities:['activity'],people:[{vibes:[]}],experience:{atmosphere:'quiet'},pins:{}};
test('relevance review cannot create places, cross pool boundaries or discard explicit pins',async()=>{
 const filtered=await reviewCandidatePools([pool],request,async()=>[{index:0,ids:['garden']}]);
 assert.deepEqual(filtered.pools[0].map(p=>p.id),['garden']);assert.equal(filtered.status,'reviewed');
 const invalid=await reviewCandidatePools([pool],request,async()=>[{index:0,ids:['invented']}]);assert.equal(invalid.status,'unavailable');assert.deepEqual(invalid.pools,[pool]);
 const pinned=await reviewCandidatePools([pool],{...request,pins:{activity:'market'}},async()=>[{index:0,ids:['garden']}]);assert.deepEqual(pinned.pools[0].map(p=>p.id),['market','garden']);
 const unavailable=await reviewCandidatePools([pool],request,async()=>{throw new Error('timeout');});assert.equal(unavailable.status,'unavailable');assert.deepEqual(unavailable.pools,[pool]);
});
test('candidate review removes an unsuitable retrieved place before assignment and shortlist construction',async()=>{
 const provider={name:'qloo',discover:async()=>pool.map(p=>({entity_id:p.id,name:p.name,tags:[{id:'urn:tag:category:place:park',name:'Park'}],properties:{address:'Accra Ghana',short_description:p.description}}))};
 let reviewed=0;
 const discovery=createDiscovery({provider,reviewCandidates:async input=>{reviewed++;assert.equal(input.experience.atmosphere,'quiet');return [{index:0,ids:['qloo:garden']}];}});
 const plan=await buildItinerary(discovery,parseItinerary({area:'Accra',activities:['activity'],experience:{atmosphere:'quiet'},timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'}}));
 assert.equal(reviewed,1);assert.equal(plan.stops[0].item.entityId,'garden');assert.deepEqual(plan.shortlist.map(s=>s.item.entityId),['garden']);assert.equal(plan.qualityReview.basis,'model_relevance_judgment');assert.equal(plan.qualityReview.providerFactsVerified,false);
});
test('explicit atmosphere resolves only exact appropriate Qloo tags and reaches retrieval',async()=>{
 const calls=[];
 const qloo=createQlooClient({getKey:()=> 'test',fetchImpl:async u=>{const url=new URL(u);calls.push(url);return Response.json({results:url.pathname==='/v2/tags'?{tags:[{id:'urn:tag:ambience:qloo:quiet',name:'Quiet'},{id:'urn:tag:genre:music:quiet',name:'Quiet'},{id:'urn:tag:ambience:qloo:quite_loud',name:'Quite loud'}]}:{entities:[]}});}});
 const signals=await qloo.resolveExperienceTags({atmosphere:'quiet'});assert.deepEqual(signals[0].tagIds,['urn:tag:ambience:qloo:quiet']);
 await qloo.discover({signalIds:[],area:'Accra',tagSignals:signals});assert.equal(calls.at(-1).searchParams.get('signal.interests.tags'),'urn:tag:ambience:qloo:quiet');
 await qloo.resolveExperienceTags({atmosphere:'quiet'});assert.equal(calls.filter(u=>u.pathname==='/v2/tags').length,1);
});
test('place review caches identical requests but refreshes when purpose changes',async()=>{
 let calls=0;const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>{calls++;return Response.json({choices:[{message:{tool_calls:[{function:{name:'select_relevant_places',arguments:JSON.stringify({choices:[{index:0,ids:['garden']}]})}}]}}]});}});
 const input={experience:{atmosphere:'quiet'},people:[],candidates:[{index:0,intent:'activity',places:pool}]};
 await agent.reviewCandidates(input);await agent.reviewCandidates(input);assert.equal(calls,1);
 await agent.reviewCandidates({...input,experience:{atmosphere:'lively'}});assert.equal(calls,2);
});

test('relevance review receives whole-group budget and participation without inventing price evidence',async()=>{
 const request={activities:['activity'],people:[],party:{adults:2,children:3},budget:80,currency:'GBP',timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'},experience:{notes:'Indoors; step-free access needed'}};
 let received;
 await reviewCandidatePools([[{id:'museum',name:'Museum',description:'Exhibitions'}]],request,async input=>{received=input;return [{index:0,ids:['museum']}];});
 assert.deepEqual(received.party,{adults:2,children:3});assert.equal(received.budget,80);assert.equal(received.currency,'GBP');assert.equal(received.experience.notes,request.experience.notes);assert.equal(received.candidates[0].places[0].price,undefined);
});
