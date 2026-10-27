import test from 'node:test';
import assert from 'node:assert/strict';
import {createQlooClient} from '../src/qloo.js';
const origin='AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', area='BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB';
test('area ideas use actual nearby venue locality evidence and never invent a locality',async()=>{
  const fetchImpl=async input=>{const url=new URL(input);let entities=[];
    if(url.pathname==='/entities')entities=[{entity_id:origin,name:'Accra',types:['urn:entity:locality'],location:{lat:5.60,lon:-0.20},properties:{place:'city',ancestors:[{place:'country',name:'Ghana'}]}}];
    else if(url.pathname==='/v2/insights')entities=[{entity_id:'venue-1',name:'Example Gallery',location:{lat:5.61,lon:-0.19},properties:{geocode:{neighborhood:'Labone'}}},{entity_id:'venue-2',name:'Far place',location:{lat:7,lon:-0.19},properties:{geocode:{neighborhood:'Distant'}}}];
    else if(url.pathname==='/search'&&url.searchParams.get('query')?.startsWith('Labone'))entities=[{entity_id:area,name:'Labone',types:['urn:entity:locality'],location:{lat:5.61,lon:-0.19},properties:{place:'suburb',ancestors:[{place:'country',name:'Ghana'}]}}];
    return {ok:true,json:async()=>({results:{entities}})};
  };
  const qloo=createQlooClient({fetchImpl,getKey:()=> 'test'});const ideas=await qloo.suggestAreas({locationId:origin,activities:['coffee']});
  assert.equal(ideas.length,1);assert.equal(ideas[0].id,area);assert.equal(ideas[0].example,'Example Gallery');
});
