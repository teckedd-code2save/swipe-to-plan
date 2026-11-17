import test from 'node:test';import assert from 'node:assert/strict';
import {resolveBookingReturn,timingReturnKey} from '../src/booking-return.js';
const request={date:'2027-01-01',startTime:'18:00',endTime:'20:00',timing:{dateConfirmed:true,timeConfirmed:true}};
const stop={id:'visit-1',item:{id:'item-1',entityId:'venue-1'}},context={account:'guest',epoch:2,version:3};
const target={...context,stopId:stop.id,itemId:stop.item.id,entityId:stop.item.entityId,timing:timingReturnKey(request)};
test('returns only exact visit from new successfully timed plan',()=>{const next={...stop,start:'18:00'};assert.equal(resolveBookingReturn(target,{request,stops:[next]},context),next);});
test('never returns to changed account, day, request, occurrence or replaced venue',()=>{
 for(const changed of [{account:'other'},{epoch:3},{version:4}])assert.equal(resolveBookingReturn(target,{request,stops:[stop]},{...context,...changed}),null);
 assert.equal(resolveBookingReturn(target,{request:{...request,date:'2027-01-02'},stops:[stop]},context),null);
 for(const wrong of [{...stop,id:'visit-2'},{...stop,item:{...stop.item,entityId:'other'}},{...stop,item:{...stop.item,id:'other'}}])assert.equal(resolveBookingReturn(target,{request,stops:[wrong]},context),null);
});
