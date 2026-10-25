import test from 'node:test';
import assert from 'node:assert/strict';
import {tailorTasteCards} from '../src/taste-context.js';
test('request-specific card ordering stays within the category and never records a preference',()=>{
 const deck=[{id:'a',kind:'vibe',group:'food'},{id:'b',kind:'vibe',group:'food'},{id:'c',kind:'vibe',group:'mood'}];
 const person={artists:[],vibes:['a']},before=structuredClone(person);
 assert.deepEqual(tailorTasteCards(deck,person,'food',['b','c','fake']).map(c=>c.id),['b','a']);
 assert.deepEqual(person,before);assert.deepEqual(deck.map(c=>c.id),['a','b','c']);
});
