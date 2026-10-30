import test from 'node:test';import assert from 'node:assert/strict';import {agentPlanContext} from '../src/agent-plan-context.js';
test('agent receives actual alternatives and venue-specific menu picks without treating them as selected stops or verified prices',()=>{
 const a={id:'a',entityId:'qa',name:'A'},b={id:'b',entityId:'qb',name:'B'};
 const plan={stops:[{id:'meal',intent:'dinner',item:a,connections:[]}],shortlist:[{item:a,intent:'dinner'},{item:b,intent:'dinner'}],warnings:[]};
 const result=agentPlanContext(plan,{},[{placeId:'b',label:'Rice'}],new Map([['qb',{...b,highlights:['Rice'],facts:{price:{level:2}}}]]));
 assert.equal(result.stops.length,1);assert.equal(result.options.length,2);assert.equal(result.options[1].id,'b');
 const evidence=JSON.parse(result.options[1].practical);assert.deepEqual(evidence.selectedMenuItems,['Rice']);assert.equal(evidence.priceVerified,false);assert.equal(evidence.relativePriceBand,2);
});
test('comparison contains only inspected places and preserves parseable bounded evidence',()=>{
 const a={id:'a',entityId:'qa',name:'A'},b={id:'b',entityId:'qb',name:'B'};
 const plan={stops:[{id:'meal',intent:'dinner',item:a,connections:[]}],shortlist:[{item:a,intent:'dinner'},{item:b,intent:'dinner'}],warnings:[]};
 const menus=new Map([['qb',{items:[{name:'Rice',price:45,currency:'GHS'}],sourceUrl:'https://example.org/menu'}]]);
 const ctx=agentPlanContext(plan,{},[{placeId:'b',label:'Rice'}],new Map([['qb',{...b,description:'x'.repeat(2000),highlights:['Rice']}]]),menus,['b']);
 assert.deepEqual(ctx.options.map(p=>p.id),['b']);assert.equal(ctx.stops.length,0);
 const practical=JSON.parse(ctx.options[0].practical);assert.equal(practical.publishedMenuPrices[0].price,45);assert.equal(practical.hours,'Not checked for this visit');assert.ok(ctx.options[0].practical.length<=1200);
});

test('comparison uses the same price band displayed on the result card when refreshed details disagree',()=>{
 const place={id:'bar',entityId:'qbar',name:'Bar',facts:{price:{level:1}}};
 const plan={stops:[{id:'stop-0',intent:'drinks',item:place,connections:[]}],warnings:[]};
 const refreshed={...place,facts:{price:{level:2}}};
 const context=agentPlanContext(plan,{},[],new Map([['qbar',refreshed]]));
 assert.equal(JSON.parse(context.stops[0].practical).relativePriceBand,1);
});
