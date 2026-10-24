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
