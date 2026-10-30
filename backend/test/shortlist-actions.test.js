import test from 'node:test';
import assert from 'node:assert/strict';
import {routeFromChoices,shortlistCandidates} from '../../frontend/src/shortlist.js';
import {parseItinerary} from '../src/itinerary.js';

test('adding another drinks place retains the chosen bar and produces an ordered drinks-only route',()=>{
  const first={id:'first',name:'First'},second={id:'second',name:'Second'};
  const plan={request:{activities:['drinks'],party:{adults:2},people:[{name:'You'}],budget:300,area:'East Legon'},stops:[{intent:'drinks',item:first}],shortlist:[{intent:'drinks',item:second}]};
  assert.deepEqual(shortlistCandidates(plan).map(c=>c.item.id),['first','second']);
  const route=routeFromChoices(plan,['first','second']);
  assert.deepEqual(route.activities,['drinks']);assert.deepEqual(route.route,[{intent:'drinks',placeId:'first'},{intent:'drinks',placeId:'second'}]);
  const parsed=parseItinerary(route);assert.equal(parsed.budget,300);assert.equal(parsed.area,'East Legon');assert.equal(parsed.route.length,2);
  assert.deepEqual(routeFromChoices(plan,['second']).route,[{intent:'drinks',placeId:'second'}]);
  assert.throws(()=>routeFromChoices(plan,['first','first']),/different places/);
});
