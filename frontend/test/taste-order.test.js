import test from 'node:test';
import assert from 'node:assert/strict';
import {bringCardToFront} from '../src/taste-order.js';
test('deciding a later fan card preserves all undecided cards and their order',()=>{
 const deck=['a','b','c','d'].map(id=>({id}));
 assert.deepEqual(bringCardToFront(deck,0,'c').map(card=>card.id),['c','a','b','d']);
 assert.deepEqual(bringCardToFront(deck,1,'d').map(card=>card.id),['a','d','b','c']);
});
test('already decided and nonexistent cards cannot reorder the fan',()=>{
 const deck=['a','b','c'].map(id=>({id}));
 assert.equal(bringCardToFront(deck,1,'a'),deck);
 assert.equal(bringCardToFront(deck,1,'unknown'),deck);
});
