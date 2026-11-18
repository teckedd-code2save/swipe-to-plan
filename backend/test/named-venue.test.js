import test from 'node:test';
import assert from 'node:assert/strict';
import {createNamedVenueLookup,venueNameMatch} from '../src/named-venue.js';
import {createQlooClient} from '../src/qloo.js';
import {createPlaceGuide} from '../src/place-guide.js';
import {createAgent} from '../src/agent.js';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const row=(id,name='La Lune Café',address='6 Koi Street, Accra, Ghana')=>({entity_id:id,name,types:['urn:entity:place'],properties:{address},tags:[]});
function lookup(rows,{getPlace}={}){const provider={name:'qloo',searchPlaces:async()=>rows,getPlace:getPlace|| (async id=>rows.find(r=>r.entity_id.toUpperCase()===id)),discover:()=>assert.fail('named lookup must not call taste discovery')};return createNamedVenueLookup({provider,places:createPlaceGuide({provider}),now:()=>0});}
test('name comparison folds accents and punctuation but never substitutes a different venue',()=>{
 assert.equal(venueNameMatch('La Lune Cafe','La Lune Café'),'exact');
 assert.equal(venueNameMatch('La Lune Cafe','La Lune & Champagne Café'),'partial');
 assert.equal(venueNameMatch('La Lune Cafe','The Nearby Pub'),null);
});
test('full named venue is available independently of the insights pool with genuine details',async()=>{
 const result=await lookup([row(ids[0])])({query:'La Lune Cafe',area:'Accra'});
 assert.equal(result.action,'find_venue');assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].entityId,ids[0]);assert.equal(result.candidates[0].locationMatch,'matched');assert.equal(result.candidates[0].provenance.provider,'qloo');assert.equal(result.request,undefined);
});
test('ambiguous branches retain address review and wrong-city matches are never confirmed',async()=>{
 const result=await lookup([row(ids[1],'La Lune Café','London, United Kingdom'),row(ids[0])])({query:'La Lune Cafe',area:'Accra'});
 assert.equal(result.candidates.length,2);assert.equal(result.candidates[0].entityId,ids[0]);assert.equal(result.candidates[1].locationMatch,'needs_review');assert.equal(result.candidates[1].verified,undefined);
 const wrong=await lookup([row(ids[1],'La Lune Café','London, United Kingdom')])({query:'La Lune Cafe',area:'Accra'});
 assert.equal(wrong.candidates[0].locationMatch,'needs_review');
});
test('unrelated names, invalid IDs/types and duplicate search hits cannot become named candidates',async()=>{
 const result=await lookup([row(ids[0],'Nearby Pub'),row('fake'),{...row(ids[1]),types:['urn:entity:artist']}])({query:'La Lune Cafe',area:'Accra'});
 assert.equal(result.matchStatus,'not_found');assert.deepEqual(result.candidates,[]);
 const valid=row(ids[0]);assert.equal((await lookup([valid,valid])({query:'La Lune Cafe',area:'Accra'})).candidates.length,1);
});
test('hydration identity mismatch fails rather than displaying substituted venue',async()=>{
 await assert.rejects(lookup([row(ids[0])],{getPlace:async()=>row(ids[1])})({query:'La Lune Cafe',area:'Accra'}),e=>e.code==='provider_unavailable');
});
test('Qloo named lookup calls typed search not insights and returns only place entities',async()=>{
 const calls=[];const provider=createQlooClient({getKey:()=> 'test',fetchImpl:async url=>{calls.push(new URL(url));return {ok:true,status:200,json:async()=>({results:{entities:[row(ids[0]),{...row(ids[1]),types:['urn:entity:artist']}]}})};}});
 const results=await provider.searchPlaces('La Lune Café');assert.equal(results.length,1);assert.equal(calls[0].pathname,'/search');assert.equal(calls[0].searchParams.get('types'),'urn:entity:place');assert.equal(calls[0].searchParams.get('query'),'La Lune Café');
});
const modelResponse=args=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'find_venue',arguments:JSON.stringify(args)}}]}}]})});
test('named tool available in guided and autopilot, preserves name and never invents a planning action',async()=>{
 for(const mode of ['guided','autopilot']){
  let payload;const agent=createAgent({getKey:()=> 'test',fetchImpl:async(_,options)=>{payload=JSON.parse(options.body);return modelResponse({query:'La Lune Café',area:'Accra'});}});
  const result=await agent.interpret({message:'Find La Lune Café in Accra',mode});
  assert.equal(result.action,'find_venue');assert.equal(result.query,'La Lune Café');assert.equal(result.request,undefined);assert.ok(payload.tools.some(t=>t.function.name==='find_venue'));
 }
});
test('named tool asks for missing location and rejects model-supplied venue IDs',async()=>{
 const invoke=args=>createAgent({getKey:()=> 'test',fetchImpl:async()=>modelResponse(args)}).interpret({message:'Find La Lune'});
 assert.equal((await invoke({query:'La Lune',area:''})).status,'needs_input');
 await assert.rejects(invoke({query:'La Lune',area:'Accra',entityId:ids[0]}));
});
test('agent endpoint resolves named candidates without building or saving a plan',async t=>{
 const {createApp}=await import('../src/app.js'),http=await import('node:http');
 const provider={name:'qloo',searchPlaces:async()=>[row(ids[0])],getPlace:async()=>row(ids[0]),discover:()=>assert.fail('no nearby substitution')};
 const accounts={origin:'http://127.0.0.1:5173',mount(){},planTarget:async()=>null,planningPeople:async()=>({}),identity:async()=>null,keepPlan:()=>assert.fail('must not save plan')};
 const agent={interpret:async()=>({status:'action',action:'find_venue',query:'La Lune Café',area:'Accra',candidates:[{name:'model invention'}]})};
 const server=createApp({provider,accounts,agent,rateLimit:false}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const result=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/api/agent',method:'POST',headers:{'content-type':'application/json'}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(data)}));});req.on('error',reject);req.end(JSON.stringify({message:'Find La Lune Café in Accra'}));});
 assert.equal(result.status,200);assert.equal(result.data.candidates[0].entityId,ids[0]);assert.equal(result.data.candidates[0].name,'La Lune Café');assert.equal(result.data.plan,undefined);
});
test('location evidence prioritizes the requested branch before bounded detail hydration',async()=>{
 const rows=Array.from({length:12},(_,i)=>row(`${String(i).padStart(8,'0')}-1111-4111-8111-111111111111`,'La Lune Café',i===11?'Accra, Ghana':'London, United Kingdom'));
 const result=await lookup(rows)({query:'La Lune Café',area:'Accra'});assert.equal(result.candidates.length,8);assert.equal(result.candidates[0].entityId,rows[11].entity_id);assert.equal(result.candidates[0].locationMatch,'matched');
});
