import test from 'node:test';import assert from 'node:assert/strict';
import {locationPromptId,upsertLocationPrompt} from '../src/location-prompt.js';
test('repeated missing-area requests reuse the picker identity and collapse prompt spam',()=>{
 const chat=[{id:'user',role:'user',text:'Older outing'},{id:'a',role:'assistant',widget:'location'},{id:'b',role:'assistant',widget:'location'}];
 const id=locationPromptId(chat,'new');assert.equal(id,'b');
 const next=upsertLocationPrompt(chat,{id,role:'assistant',widget:'location',text:'Choose an area'});
 assert.equal(next.filter(t=>t.widget==='location').length,1);assert.equal(next[0].id,'user');assert.equal(next.at(-1).id,'b');
 assert.deepEqual(upsertLocationPrompt(next,next.at(-1)),next);
});
test('a later conversation preserves historical location choices',()=>{
 const chat=[{id:'old',role:'assistant',widget:'location'},{id:'user',role:'user',text:'New outing'}];
 assert.equal(locationPromptId(chat,'new'),'new');assert.equal(upsertLocationPrompt(chat,{id:'new',role:'assistant',widget:'location'}).length,3);
});
