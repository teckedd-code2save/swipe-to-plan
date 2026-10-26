import test from 'node:test';import assert from 'node:assert/strict';import {menuHighlights} from '../src/menu-highlights.js';import {alternativeCandidates} from '../src/shortlist.js';import {resultsReady} from '../src/results-ready.js';
test('menu highlights remove duplicated casing without inventing dishes or prices',()=>{
 assert.deepEqual(menuHighlights(['Jollof Rice','Jollof rice','  Club   sandwich ','',null]),[{key:'jollof rice',label:'Jollof Rice'},{key:'club sandwich',label:'Club sandwich'}]);
});
test('a single planned stop does not conceal other discovered places',()=>{
 const one={id:'one'},two={id:'two'},plan={request:{area:'East Legon'},stops:[{item:one}],shortlist:[{intent:'drinks',item:one},{intent:'drinks',item:two}]};
 assert.deepEqual(alternativeCandidates(plan),[{intent:'drinks',item:two}]);assert.equal(resultsReady(plan,null).count,2);
});
