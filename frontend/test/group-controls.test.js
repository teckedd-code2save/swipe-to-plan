import test from 'node:test';import assert from 'node:assert/strict';
import {requestedGroupControl} from '../src/group-controls.js';
import {outageRequests,loadOutageResults} from '../src/outage-discovery.js';
test('explicit circle and group requests surface membership controls without a model',()=>{
 assert.equal(requestedGroupControl('Plan an outing for my curcle this friday'),'circles');
 assert.equal(requestedGroupControl('Drinks with friends'),'people');
 assert.equal(requestedGroupControl('I want to go alone, no group'),null);
 assert.equal(requestedGroupControl('our group wants drinks',{hasGroup:true}),null);
 assert.equal(requestedGroupControl('change my circle',{hasGroup:true}),'circles');
 assert.equal(requestedGroupControl('a circular garden'),null);
});
test('outage discovery queries every chosen person and deduplicates actual places',async()=>{
 const brief={area:'Accra',people:[{id:'a',artists:['A'],vibes:[]},{id:'b',artists:['B'],vibes:[]}],party:{children:0}};
 const requests=outageRequests(brief,true);assert.equal(requests.length,2);
 assert.deepEqual(requests.map(r=>r.taste.artists),[['A'],['B']]);
 assert.deepEqual(outageRequests(brief,false),[]);
 const result=await loadOutageResults(requests,async r=>({items:[{id:'shared',name:'Shared'}, {id:r.taste.artists[0],name:'Individual'}],provenance:{provider:'qloo'}}));
 assert.equal(result.items[0].id,'shared');assert.equal(result.items.length,3);
 assert.equal(result.provenance.provider,'qloo');assert.equal(brief.people.length,2);
});
