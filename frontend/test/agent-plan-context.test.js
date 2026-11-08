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
 assert.deepEqual(ctx.options.map(p=>p.id),['b']);assert.deepEqual(ctx.stops.map(p=>p.id),['a']);
 const practical=JSON.parse(ctx.options[0].practical);assert.equal(practical.publishedMenuPrices[0].price,45);assert.equal(practical.hours,'Not checked for this visit');assert.ok(ctx.options[0].practical.length<=1200);
});
test('selected context preserves occurrence order even when the same provider place returns twice',()=>{
 const a={id:'a',entityId:'qa',name:'A'},b={id:'b',entityId:'qb',name:'B'};
 const plan={stops:[{id:'stop-0',intent:'coffee',item:a},{id:'stop-1',intent:'dinner',item:b},{id:'stop-2',intent:'coffee',item:a}],shortlist:[{item:b,intent:'dinner'},{item:a,intent:'coffee'}],warnings:[]};
 const context=agentPlanContext(plan);assert.deepEqual(context.stops.map(s=>[s.stopId,s.id]),[['stop-0','a'],['stop-1','b'],['stop-2','a']]);assert.equal(context.requestedStopCount,3);assert.equal(context.options.length,2);
 const comparison=agentPlanContext(plan,{},[],new Map(),new Map(),['a']);assert.deepEqual(comparison.stops.map(s=>s.stopId),['stop-0','stop-1','stop-2']);assert.equal(comparison.options.length,1);
});
test('repeat-visit hours evidence uses the matching occurrence window, not the first venue report',()=>{
 const item={id:'a',entityId:'qa',name:'A'},stops=[{id:'first',intent:'coffee',item,start:'12:00',end:'13:00'},{id:'return',intent:'coffee',item,start:'20:00',end:'21:00'}];
 const checks={data:{stops:stops.map((stop,index)=>({entityId:'qa',start:stop.start,end:stop.end,hours:{summary:index?'Closed at the return time':'Fits the first visit'}}))}};
 const context=agentPlanContext({stops,shortlist:[],warnings:[]},checks);assert.deepEqual(context.stops.map(s=>JSON.parse(s.practical).hours),['Fits the first visit','Closed at the return time']);
});
