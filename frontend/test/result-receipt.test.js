import test from 'node:test';
import assert from 'node:assert/strict';
import {resultPlaceLabel,updateResultReceipt} from '../src/result-receipt.js';
test('result card reflects nearby suggestions and subsequently found stops',()=>{
 const empty={stops:[{item:null},{item:null}],nearbySuggestions:[{},{}]};
 assert.equal(resultPlaceLabel(empty),'2 nearby places to explore');
 const found={stops:[{item:{id:'a'}},{item:{id:'b'}}],nearbySuggestions:[]};
 assert.equal(resultPlaceLabel(found),'2 stops');
 const chat=[{id:'one',text:'old',result:{detail:'0 stops'}},{id:'two',text:'other'}];
 const updated=updateResultReceipt(chat,{text:'Updated places',result:{detail:resultPlaceLabel(found)}});
 assert.equal(updated[0].result.detail,'2 stops');assert.equal(updated[0].text,'Updated places');assert.equal(updated[1],chat[1]);
});
