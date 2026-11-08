import test from 'node:test';
import assert from 'node:assert/strict';
import {currentAreaPoint} from '../src/nearby-location.js';
import {currentRoutePoint} from '../src/route-start.js';
const coords={latitude:5.561234,longitude:-0.182345,accuracy:2000};
function device(position){return {getCurrentPosition(success,error,options){assert.equal(options.enableHighAccuracy,false);assert.equal(options.timeout,10000);success(position);}};}
test('same 2 km fix yields rounded planning lookup and explicit approximate route chooser, never exact route origin',async()=>{
  const gps=device({coords,timestamp:Date.now()});
  assert.deepEqual(await currentAreaPoint(gps),{latitude:5.56,longitude:-0.18});
  assert.deepEqual(await currentRoutePoint(gps),{kind:'nearby',point:{latitude:5.56,longitude:-0.18}});
});
test('fresh precise route fix remains exact and transient',async()=>{
  const point=await currentRoutePoint(device({coords:{...coords,accuracy:25},timestamp:Date.now()}));
  assert.equal(point.kind,'current');assert.equal(point.coordinates.lat,coords.latitude);
});
for(const bad of [{},{coords:{}},{coords:{...coords,accuracy:-1}},{coords:{...coords,accuracy:25001}},{coords:{...coords,latitude:NaN}},{coords,timestamp:Date.now()-600001}])test(`invalid or stale fix is rejected safely ${JSON.stringify(bad)}`,async()=>{for(const acquire of [currentAreaPoint,currentRoutePoint])await assert.rejects(acquire(device(bad)));});
for(const code of [1,2,3])test(`permission/device error ${code} has useful copy without another request`,async()=>{
  let count=0;await assert.rejects(currentRoutePoint({getCurrentPosition(success,error){count++;error({code});}}),code===1?/site settings/:code===3?/too long/:/couldn’t find/);assert.equal(count,1);
});
