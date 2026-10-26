import test from 'node:test';import assert from 'node:assert/strict';import{venueMentions}from'../src/venue-mentions.js';
const stops=[{item:{name:'Bar Naas',entityId:'a'}},{item:{name:'Noble House',entityId:'b'}}];
test('links actual complete venue names, preserving all response text',()=>{const text='Try Bar Naas; NOBLE HOUSE is another option.';const parts=venueMentions(text,stops);assert.equal(parts.map(p=>p.text).join(''),text);assert.deepEqual(parts.filter(p=>p.stop).map(p=>p.stop.item.entityId),['a','b']);});
test('does not link partial names, invented places or unverified entities',()=>{assert.equal(venueMentions('Bar Naasville and Imaginary Place',stops).filter(p=>p.stop).length,0);assert.equal(venueMentions('Bar Naas',[{item:{name:'Bar Naas'}}]).filter(p=>p.stop).length,0);});
