import test from 'node:test';
import assert from 'node:assert/strict';
import { swipeDirection, decideCard, undoCard, likedCards } from '../../frontend/src/swipe.js';
const deck=[{id:'a'},{id:'b'},{id:'c'}];
test('horizontal touch gestures select like/skip; taps and scrolling do not',()=>{
 assert.equal(swipeDirection(95,10,350),'like'); assert.equal(swipeDirection(-95,10,350),'skip');
 assert.equal(swipeDirection(20,2,350),null); assert.equal(swipeDirection(90,120,350),null);
});
test('undo restores either liked or skipped cards and removes their taste signal',()=>{
 const one=decideCard([],deck,true),two=decideCard(one,deck,false);
 assert.deepEqual(likedCards(two),['a']);assert.deepEqual(undoCard(two),one);assert.deepEqual(likedCards(undoCard(one)),[]);
 assert.deepEqual(undoCard([]),[]);
});
test('completed deck cannot add duplicate votes; early shortlist contains only decided likes',()=>{
 const history=deck.reduce((h,_,i)=>decideCard(h,deck,i!==1),[]);
 assert.equal(decideCard(history,deck,true),history);assert.deepEqual(likedCards(history),['a','c']);
 assert.deepEqual(likedCards(history.slice(0,1)),['a']);
});
