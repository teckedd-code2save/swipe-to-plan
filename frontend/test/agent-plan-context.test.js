import test from 'node:test';import assert from 'node:assert/strict';import {agentPlanContext} from '../src/agent-plan-context.js';
test('agent receives actual alternatives and venue-specific menu picks without treating them as selected stops or verified prices',()=>{
 const a={id:'a',entityId:'qa',name:'A'},b={id:'b',entityId:'qb',name:'B'};
 const plan={stops:[{id:'meal',intent:'dinner',item:a,connections:[]}],shortlist:[{item:a,intent:'dinner'},{item:b,intent:'dinner'}],warnings:[]};
 const result=agentPlanContext(plan,{},[{placeId:'b',label:'Rice'}],new Map([['qb',{...b,highlights:['Rice'],facts:{price:{level:2}}}]]));
 assert.equal(result.stops.length,1);assert.equal(result.options.length,2);assert.equal(result.options[1].id,'b');
 const evidence=JSON.parse(result.options[1].practical);assert.deepEqual(evidence.selectedMenuItems,['Rice']);assert.equal(evidence.priceVerified,false);assert.equal(evidence.relativePriceBand,2);
});
