import test from 'node:test';
import assert from 'node:assert/strict';
import {createQlooClient} from '../src/qloo.js';
const origin='AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', area='BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB';
test('area ideas use actual nearby venue locality evidence and never invent a locality',async()=>{
  const fetchImpl=async input=>{const url=new URL(input);let entities=[];
    if(url.pathname==='/entities')entities=[{entity_id:origin,name:'Accra',types:['urn:entity:locality'],location:{lat:5.60,lon:-0.20},properties:{place:'city',ancestors:[{place:'country',name:'Ghana'}]}}];
    else if(url.pathname==='/v2/insights')entities=[{entity_id:'venue-1',name:'Example Cafe',tags:[{id:'urn:tag:category:place:cafe'}],location:{lat:5.61,lon:-0.19},properties:{geocode:{neighborhood:'Labone'}}},{entity_id:'venue-2',name:'Far place',tags:[{id:'urn:tag:category:place:cafe'}],location:{lat:7,lon:-0.19},properties:{geocode:{neighborhood:'Distant'}}}];
    else if(url.pathname==='/search'&&url.searchParams.get('query')?.startsWith('Labone'))entities=[{entity_id:area,name:'Labone',types:['urn:entity:locality'],location:{lat:5.61,lon:-0.19},properties:{place:'suburb',ancestors:[{place:'country',name:'Ghana'}]}}];
    return {ok:true,json:async()=>({results:{entities}})};
  };
  const qloo=createQlooClient({fetchImpl,getKey:()=> 'test'});const ideas=await qloo.suggestAreas({locationId:origin,activities:['coffee']});
  assert.equal(ideas.length,1);assert.equal(ideas[0].id,area);assert.equal(ideas[0].example,'Example Cafe');
});

test('matching areas use geographic context as a signal and return resolved cities backed by places',async()=>{
  const origin='AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',city='CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC';let insights;
  const client=createQlooClient({getKey:()=> 'test',fetchImpl:async input=>{const url=new URL(input);let entities=[];
    if(url.pathname==='/entities')entities=[{entity_id:origin,name:'Accra',types:['urn:entity:locality'],location:{lat:5.6,lon:-.2},properties:{place:'city',ancestors:[{place:'country',name:'Ghana'}]}}];
    else if(url.pathname==='/v2/insights'){insights=url;entities=[{entity_id:'p1',name:'Art House',tags:[{id:'urn:tag:category:place:art_gallery'}],properties:{geocode:{city:'Kumasi',country_code:'GH'}}}];}
    else if(url.pathname==='/search')entities=[{entity_id:city,name:'Kumasi',types:['urn:entity:locality'],location:{lat:6.68,lon:-1.62},properties:{place:'city',ancestors:[{place:'country',name:'Ghana'}]}}];
    return {ok:true,json:async()=>({results:{entities}})};
  }});
  const result=await client.findMatchingAreas({locationId:origin,activities:['activity']});
  assert.equal(insights.searchParams.get('filter.geocode.country_code'),null);assert.ok(insights.searchParams.has('signal.location'));assert.equal(result[0].name,'Kumasi');assert.equal(result[0].example,'Art House');
});

test('anywhere can query Qloo without a location or profile signals',async()=>{
  let query;
  const client=createQlooClient({getKey:()=> 'test',fetchImpl:async input=>{const url=new URL(input);if(url.pathname==='/v2/insights')query=url;return {ok:true,json:async()=>({results:{entities:[]}})};}});
  assert.deepEqual(await client.findMatchingAreas({activities:[]}),[]);
  assert.equal(query.searchParams.get('filter.type'),'urn:entity:place');
  assert.equal(query.searchParams.has('signal.location'),false);assert.equal(query.searchParams.has('filter.location'),false);
});

test('global discovery falls back to Qloo place search for an explicit topic',async()=>{
  let usedSearch=false;
  const client=createQlooClient({getKey:()=> 'test',fetchImpl:async input=>{const url=new URL(input);
    if(url.pathname==='/v2/insights')return {ok:false,status:400};
    if(url.pathname==='/v2/tags')return {ok:true,json:async()=>({results:{tags:[]}})};
    if(url.pathname==='/search'&&url.searchParams.get('types')==='urn:entity:place'){usedSearch=true;assert.equal(url.searchParams.get('query'),'art gallery');return {ok:true,json:async()=>({results:{entities:[{entity_id:'p',name:'Gallery',tags:[{id:'urn:tag:category:place:art_gallery'}],properties:{geocode:{city:'Kumasi',country_code:'GH'}}}]}})};}
    return {ok:true,json:async()=>({results:{entities:[{entity_id:'CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC',name:'Kumasi',types:['urn:entity:locality'],location:{lat:6.68,lon:-1.62},properties:{place:'city',ancestors:[{place:'country',name:'Ghana'}]}}]}})};
  }});
  const result=await client.findMatchingAreas({experience:{searchTags:['v-art']},activities:['activity']});assert.equal(usedSearch,true);assert.equal(result[0].name,'Kumasi');
});

test('empty global insights try topic search and resolve an unambiguous city without a country code',async()=>{
  const client=createQlooClient({getKey:()=> 'test',fetchImpl:async input=>{const url=new URL(input);let entities=[];
    if(url.pathname==='/v2/tags')return {ok:true,json:async()=>({results:{tags:[]}})};
    if(url.pathname==='/search'&&url.searchParams.get('types')==='urn:entity:place')entities=[{entity_id:'p1',name:'Gallery',properties:{geocode:{city:'Kumasi'}}}];
    if(url.pathname==='/search'&&url.searchParams.get('types')==='urn:entity:locality')entities=[{entity_id:'CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC',name:'Kumasi',types:['urn:entity:locality'],location:{lat:6.68,lon:-1.62},properties:{place:'city',ancestors:[{place:'country',name:'Ghana'}]}}];
    return {ok:true,json:async()=>({results:{entities}})};
  }});
  const result=await client.findMatchingAreas({experience:{searchTags:['v-art']},activities:['activity']});assert.equal(result[0].name,'Kumasi');
});
