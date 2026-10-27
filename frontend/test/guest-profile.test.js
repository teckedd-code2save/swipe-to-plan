import test from 'node:test';
import assert from 'node:assert/strict';
import {readGuestProfile,saveGuestProfile} from '../src/guest-profile.js';
test('guest tastes survive a new outing without storing an outing or location',()=>{
  const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
  assert.equal(readGuestProfile(storage),null);
  assert.equal(saveGuestProfile({artists:['Sarkodie'],vibes:['v-nature'],name:'You',area:'Osu'},storage),true);
  assert.deepEqual(readGuestProfile(storage),{name:'You',artists:['Sarkodie'],vibes:['v-nature']});
});
