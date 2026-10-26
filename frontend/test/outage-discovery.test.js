import test from 'node:test';
import assert from 'node:assert/strict';
import {outageRequest,isChatOutage,discoverDuringOutage} from '../src/outage-discovery.js';
const brief={area:'Kasoa, Ghana',locationId:'a',people:[{artists:['Amaarae'],vibes:['v-cafe'],context:{role:'Engineer'}}],party:{children:1},excludeIds:['excluded'],maxPriceLevel:2,budget:500,date:'2026-10-26'};
test('recovery uses only confirmed preferences and preserves hard discovery constraints',()=>{
 const request=outageRequest(brief,true);
 assert.deepEqual(request.location,{area:brief.area,id:'a'});
 assert.deepEqual(request.taste,brief.people[0]);
 assert.equal(request.constraints.maxPriceLevel,2);
 assert.deepEqual(request.constraints.excludeIds,['excluded']);
 assert.ok(request.constraints.excludeTags.includes('nightclub'));
 assert.equal(request.intent,'any');assert.equal(request.budget,undefined);assert.equal(request.date,undefined);
 assert.equal(brief.budget,500);
});
test('unconfirmed areas and group requests cannot become solo discovery',()=>{
 assert.equal(outageRequest(brief,false),null);
 assert.equal(outageRequest({...brief,people:[...brief.people,...brief.people]},true),null);
});
test('stale recovery never replaces newer results and provider failures do not clear anything',async()=>{
 let published=false;
 assert.equal(await discoverDuringOutage({request:{},load:async()=>({items:[{}]}),isCurrent:()=>false,publish:()=>{published=true;}}),false);
 assert.equal(await discoverDuringOutage({request:{},load:async()=>{throw Error('offline');},isCurrent:()=>true,publish:()=>{published=true;}}),false);
 assert.equal(published,false);
});
test('successful recovery publishes actual provider response once',async()=>{
 const result={items:[{id:'real-place'}]};let received;
 assert.equal(await discoverDuringOutage({request:{},load:async()=>result,isCurrent:()=>true,publish:r=>{received=r;}}),true);
 assert.equal(received,result);
 assert.equal(isChatOutage({code:'invalid_request'}),false);
 assert.equal(isChatOutage({code:'agent_unavailable'}),true);
});
