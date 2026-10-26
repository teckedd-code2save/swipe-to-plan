import test from 'node:test';import assert from 'node:assert/strict';import {selectedMenuTotal,pricedMenuSelections,displayMenuPrice} from '../src/menu-prices.js';
test('menu subtotals preserve decimals and never convert or treat unknown prices as free',()=>{
 const picks=[{currency:'GHS',price:55.5},{currency:'GHS',price:10.25},{currency:'GBP',price:20},{label:'Unpriced'}];assert.deepEqual(selectedMenuTotal(picks,'GHS'),{amount:65.75,priced:2,unpriced:2});assert.equal(displayMenuPrice(picks[0]),'GHS 55.50');
});
test('published prices enrich exact venue-specific choices; ambiguous offers stay unpriced',()=>{
 const picks=[{placeId:'a',label:'Rice'},{placeId:'b',label:'Rice'}],map=new Map([['a',{items:[{name:'Rice',price:30,currency:'GHS',sourceUrl:'https://venue.example/menu'}]}],['b',{items:[{name:'Rice',price:20,currency:'GHS'},{name:'Rice',price:40,currency:'GHS'}]}]]);
 const result=pricedMenuSelections(picks,map);assert.equal(result[0].price,30);assert.equal(result[1].price,undefined);assert.equal(picks[0].price,undefined);
});
