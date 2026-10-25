import test from 'node:test';
import assert from 'node:assert/strict';
import {shortlistCandidates,routeFromChoices} from '../src/shortlist.js';
const choice=(id,nearby)=>({intent:'drinks',item:{id,name:id,...(nearby?{nearby:{distanceKm:9}}:{})}});
const plan={request:{activities:['drinks'],area:'East Legon',budget:null,pins:{drinks:'a'},timing:{dateConfirmed:false,timeConfirmed:false}},stops:[],shortlist:[choice('a'),choice('b')],nearbySuggestions:[choice('c',true)]};
test('a shortlist selection creates an ordered repeated-category route without inventing timing or budget',()=>{
  const request=routeFromChoices(plan,['b','a']);
  assert.deepEqual(request.route,[{intent:'drinks',placeId:'b'},{intent:'drinks',placeId:'a'}]);
  assert.deepEqual(request.activities,['drinks']);assert.deepEqual(request.pins,{});
  assert.equal(request.budget,null);assert.equal(request.timing.dateConfirmed,false);assert.equal(request.searchRadiusKm,0);
  assert.deepEqual(plan.request.pins,{drinks:'a'});
});
test('nearby scope is only adopted when a nearby suggestion is explicitly selected',()=>{
  assert.equal(shortlistCandidates(plan).length,3);
  assert.equal(routeFromChoices(plan,['c']).searchRadiusKm,20);
  assert.equal(plan.request.searchRadiusKm,undefined);
  for(const ids of [[],['a','a'],['unknown'],['a','b','c','d']])assert.throws(()=>routeFromChoices(plan,ids));
});
