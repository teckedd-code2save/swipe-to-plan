import test from 'node:test';
import assert from 'node:assert/strict';
import {showLocationWelcome} from '../../frontend/src/location-arrival.js';

test('location welcome appears on a fresh arrival, never over a restored or active outing',()=>{
  const fresh={ready:true,dismissed:false,area:'',preferred:null,plan:null,chatLength:0,tool:null,message:'',hash:'',search:''};
  assert.equal(showLocationWelcome(fresh),true);
  assert.equal(showLocationWelcome({...fresh,hash:'#/'}),true);
  for(const change of [{ready:false},{dismissed:true},{area:'Ho, Ghana'},{preferred:{name:'Ho'}},{plan:{}},{chatLength:1},{tool:{}},{message:'Plan for me'},{hash:'#/day/example'},{hash:'#/circle/example'},{hash:'#/discover'},{search:'?signin=success'}])assert.equal(showLocationWelcome({...fresh,...change}),false,JSON.stringify(change));
});
