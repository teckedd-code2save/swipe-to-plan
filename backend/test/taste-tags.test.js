import test from 'node:test';
import assert from 'node:assert/strict';
import {createQlooClient} from '../src/qloo.js';
import {createDiscovery} from '../src/plan.js';
import {parseRequest} from '../src/contract.js';

test('Qloo resolves food and activity tag IDs, rejects unrelated tags and retrieves a discovery pool',async()=>{
  const requests=[];
  const client=createQlooClient({getKey:()=> 'test',fetchImpl:async url=>{
    requests.push(url);const query=url.searchParams.get('filter.query');
    if(url.pathname==='/v2/tags')return {ok:true,json:async()=>({results:{tags:query==='museum'?[{id:'urn:tag:category:place:museum'},{id:'urn:tag:genre:place:restaurant:museum'},{id:'urn:tag:nearby_attraction:qloo:museum'}]:[{id:'urn:tag:genre:place:restaurant:seafood'},{id:'urn:tag:keyword:qloo:seafood'}]}})};
    return {ok:true,json:async()=>({results:{entities:[{entity_id:url.searchParams.has('filter.tags')?'museum':'restaurant',name:'Example'}]}})};
  }});
  const tagSignals=await client.resolveTasteTags(['v-history','v-seafood']);
  assert.deepEqual(tagSignals,[{preferenceId:'v-history',tagIds:['urn:tag:category:place:museum']},{preferenceId:'v-seafood',tagIds:['urn:tag:genre:place:restaurant:seafood']}]);
  const places=await client.discover({area:'Accra',signalIds:[],tagSignals,includeActivity:true});assert.equal(places.length,2);
  const targeted=requests.find(url=>url.searchParams.has('filter.tags'));assert.equal(targeted.searchParams.get('filter.tags'),'urn:tag:category:place:museum');assert.equal(targeted.searchParams.get('signal.interests.tags'),tagSignals.flatMap(s=>s.tagIds).join(','));
  await client.resolveTasteTags(['v-history']);assert.equal(requests.filter(u=>u.pathname==='/v2/tags').length,2);
});

test('food and activity changes invalidate discovery caches while budget-only changes reuse them',async()=>{
  let count=0;
  const discovery=createDiscovery({provider:{name:'qloo',resolveTasteTags:async ids=>ids.map(id=>({preferenceId:id,tagIds:[`urn:tag:category:place:${id}`]})),discover:async()=>{count++;return [];}}});
  const a=parseRequest({taste:{vibes:['v-history']}}),b=parseRequest({taste:{vibes:['v-seafood']}});
  await discovery.byIntents(a,['coffee','dinner']);await discovery.byIntents(a,['coffee','dinner']);assert.equal(count,1);
  await discovery.byIntents(b,['coffee','dinner']);assert.equal(count,2);
  await discovery.byIntents(b,['activity','dinner']);assert.equal(count,3);
});


test('drinks retrieval adds a Qloo bar/nightclub pool and does not use full-bar offerings as cocktail-bar taste evidence',async()=>{
  const requests=[];
  const client=createQlooClient({getKey:()=> 'test',fetchImpl:async url=>{
    requests.push(url);
    if(url.pathname==='/v2/tags')return {ok:true,json:async()=>({results:{tags:[
      {id:'urn:tag:category:place:bar'},
      {id:'urn:tag:genre:place:nightclub'},
      {id:'urn:tag:beverage_offering:place:full_bar'}
    ]}})};
    return {ok:true,json:async()=>({results:{entities:[]}})};
  }});
  const tags=await client.resolveTasteTags(['v-bar']);
  assert.deepEqual(tags[0].tagIds,['urn:tag:category:place:bar']);
  await client.discover({signalIds:[],area:'Accra',includeDrinks:true,tagSignals:tags});
  const filtered=requests.find(u=>u.searchParams.has('filter.tags'));
  assert.ok(filtered);
  assert.equal(filtered.searchParams.get('operator.filter.tags'),'union');
  assert.ok(filtered.searchParams.get('filter.tags').includes('urn:tag:genre:place:nightclub'));
  assert.ok(!filtered.searchParams.get('filter.tags').includes('full_bar'));
});

test('changing from dining to drinks retrieves a fresh category-specific pool',async()=>{
  const seen=[];
  const discovery=createDiscovery({provider:{name:'qloo',resolveTasteTags:async()=>[],discover:async args=>{seen.push(args.includeDrinks);return [];}}});
  const request=parseRequest();
  await discovery.byIntents(request,['dinner']);
  await discovery.byIntents(request,['drinks']);
  await discovery.byIntents(request,['drinks']);
  assert.deepEqual(seen,[false,true]);
});

test('nearby suggestions use a bounded point query in metres, with separate proximity provenance',async()=>{
  const id='12345678-1234-1234-1234-123456789ABC',requests=[];
  const client=createQlooClient({getKey:()=> 'test',fetchImpl:async url=>{
    requests.push(url);
    if(url.pathname==='/entities')return {ok:true,json:async()=>({results:{entities:[{entity_id:id,name:'Selected Area',types:['urn:entity:locality'],location:{lat:5.6,lon:-.2},properties:{place:'suburb'}}]}})};
    return {ok:true,json:async()=>({results:{entities:[]}})};
  }});
  const result=await client.discover({signalIds:[],locationId:id,area:'Selected Area',radiusKm:20});
  const query=requests.find(u=>u.pathname==='/v2/insights');
  assert.equal(query.searchParams.get('filter.location'),'POINT(-0.2 5.6)');
  assert.equal(query.searchParams.get('filter.location.radius'),'20000');
  assert.equal(result.locality.scope,'nearby');
  assert.deepEqual(result.locality.center,{latitude:5.6,longitude:-.2});
});

test('new leisure choices resolve only provider categories, not incidental venue amenities',async()=>{
  const client=createQlooClient({getKey:()=> 'test',fetchImpl:async url=>({ok:true,json:async()=>({results:{tags:[{id:'urn:tag:category:place:cinema'},{id:'urn:tag:amenity:place:cinema'},{id:'urn:tag:category:place:bowling_alley'},{id:'urn:tag:category:place:playground'}]}})})});
  const signals=await client.resolveTasteTags(['v-cinema','v-games','v-familyplay']);
  assert.deepEqual(signals,[{preferenceId:'v-cinema',tagIds:['urn:tag:category:place:cinema']},{preferenceId:'v-games',tagIds:['urn:tag:category:place:bowling_alley']},{preferenceId:'v-familyplay',tagIds:['urn:tag:category:place:playground']}]);
});

test('dining requests retrieve a restaurant pool using provider-resolved category IDs',async()=>{
 const calls=[];
 const client=createQlooClient({getKey:()=> 'test',fetchImpl:async url=>{calls.push(url);return {ok:true,json:async()=>url.pathname==='/v2/tags'?{results:{tags:[{id:'urn:tag:category:place:restaurant'},{id:'urn:tag:amenity:place:restaurant'}]}}:{results:{entities:[]}}};}});
 await client.discover({signalIds:[],area:'London',includeDining:true});
 assert.ok(calls.some(u=>u.searchParams.get('filter.tags')==='urn:tag:category:place:restaurant'));
 assert.ok(!calls.some(u=>u.searchParams.get('filter.tags')?.includes('amenity')));
});

test('explicit outing topics retrieve relevant categories without recording a saved taste',async()=>{
 const calls=[];
 const client=createQlooClient({getKey:()=> 'test',fetchImpl:async url=>{calls.push(url);return {ok:true,json:async()=>url.pathname==='/v2/tags'?{results:{tags:[{id:'urn:tag:category:place:movie_theater'}]}}:{results:{entities:[]}}};}});
 const tags=await client.resolveExperienceTags({searchTags:['v-cinema']});
 await client.discover({signalIds:[],area:'London',tagSignals:tags,includeActivity:true});
 assert.deepEqual(tags,[{preferenceId:'v-cinema',tagIds:['urn:tag:category:place:movie_theater']}]);
 assert.ok(calls.some(u=>u.searchParams.get('filter.tags')==='urn:tag:category:place:movie_theater'));
});


test('film discovery resolves movie theaters and rejects cinema equipment suppliers',async()=>{
 const calls=[];
 const client=createQlooClient({getKey:()=> 'test',fetchImpl:async url=>{calls.push(url);return {ok:true,json:async()=>({results:{tags:[{id:'urn:tag:category:place:cinema_equipment_supplier'},{id:'urn:tag:category:place:movie_theater'}]}})};}});
 assert.deepEqual(await client.resolveTasteTags(['v-cinema']),[{preferenceId:'v-cinema',tagIds:['urn:tag:category:place:movie_theater']}]);
 assert.equal(calls[0].searchParams.get('filter.query'),'movie theater');
});
