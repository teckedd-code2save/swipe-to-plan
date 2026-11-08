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

test('refreshing the current receipt retains older receipts, user turns and free-form comparisons',()=>{
 const older={id:'old',text:'Original result',result:{detail:'1 stop'}},question={id:'user',role:'user',text:'Keep my first visits.'},current={id:'current',text:'Two visits',result:{detail:'2 stops'}},comparison={id:'comparison',text:'Historical comparison, unchanged.',comparisonKey:'old-route'};
 const chat=[older,question,current,comparison],updated=updateResultReceipt(chat,{text:'Three visits restored',result:{detail:'3 stops'}});
 assert.deepEqual(updated.map(turn=>turn.id),chat.map(turn=>turn.id));assert.equal(updated[0],older);assert.equal(updated[1],question);assert.equal(updated[3],comparison);assert.equal(updated[2].result.detail,'3 stops');assert.equal(chat[2].result.detail,'2 stops');
});
