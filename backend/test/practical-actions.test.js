import test from 'node:test';
import assert from 'node:assert/strict';
import {routeLegs,routeLink} from '../../frontend/src/route-links.js';
import {nextPlanSteps,partialPlanSummary} from '../../frontend/src/plan-assistance.js';
import {planTitle} from '../../shared/plan-title.js';
import {suggestBudget} from '../../shared/budget-suggestion.js';
const stop=(id,intent='dinner')=>({id,intent,item:{name:`Place ${id}`,coordinates:{lat:5.5,lng:-.3}}});
test('directions include the first journey and individual transit legs, without fabricated origins',()=>{
  const legs=routeLegs({stops:[stop('one'),{id:'empty',item:null},stop('two')]});
  assert.equal(legs.length,2);
  const first=new URL(routeLink(legs[0]));assert.equal(first.searchParams.has('origin'),false);assert.equal(first.searchParams.has('travelmode'),false);
  for(const mode of ['walking','driving','transit']){
    const link=new URL(routeLink(legs[1],mode));assert.equal(link.searchParams.get('travelmode'),mode);assert.equal(link.searchParams.get('origin'),'5.5,-0.3');assert.equal(link.searchParams.has('waypoints'),false);
  }
  assert.equal(routeLink(null),null);
});
test('mixed coverage and timing gaps explain each cause and do not advertise a complete day',()=>{
  const plan={request:{people:[]},stops:[stop('drinks','drinks'),{intent:'coffee',item:null,reason:'no_eligible_places'},{intent:'activity',item:null,reason:'no_open_place'}]};
  const next=nextPlanSteps(plan);
  assert.equal(next.actions[0].id,'review');assert.equal(next.actions[1].id,'location');assert.equal(next.actions[2].id,'keep_found');
  assert.match(next.note,/coffee in this area/);assert.match(next.note,/discovery into your time window/);
  assert.match(partialPlanSummary(plan),/1 of 3 requested stops/);
});
test('custom names survive and old generic saved titles are displayable from real activities',()=>{
  assert.equal(planTitle({title:'A day out',activities:['drinks'],area:'Mallam, Ghana'}),'Drinks in Mallam');
  assert.equal(planTitle({title:'A celebration for Ama',titleMode:'custom',activities:['drinks']}),'A celebration for Ama');
});
test('suggestions depend on activities, party and currency, not one global budget',()=>{
  const r={currency:'GHS',party:{adults:1,children:0},people:[{spending:{style:'mindful'}}],activities:['drinks']};
  assert.ok(suggestBudget({...r,party:{adults:3,children:0}})>suggestBudget(r));
  assert.ok(suggestBudget({...r,activities:['dinner','drinks']})>suggestBudget(r));
  assert.equal(suggestBudget({...r,currency:'CHF'}),null);assert.equal(suggestBudget({...r,activities:[]}),null);
});

test('complete plans never receive an incomplete-day receipt',()=>{assert.equal(partialPlanSummary({stops:[stop('one')]}),null);});
