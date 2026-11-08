import test from 'node:test';
import assert from 'node:assert/strict';
import {phoneFormat,safeContactWebsite,contactForItem} from '../../shared/venue-contact.js';
import {shapePlace} from '../src/plan.js';
import {bookingOperation,invalidateBookings} from '../src/booking-actions.js';
const at='2026-11-08T12:00:00.000Z';
const raw=(phone='+44 (20) 7734-8547')=>({entity_id:'venue-a',name:'Venue',properties:{phone,website:'https://venue.example/contact'}});
test('phone syntax allows explicit international format only, never invents country or extension',()=>{
 assert.deepEqual(phoneFormat('+44 (20) 7734-8547'),{display:'+44 (20) 7734-8547',format:'international',dialUrl:'tel:+442077348547'});
 for(const value of ['02077348547','00233241234567','123456']) {assert.equal(phoneFormat(value).format,'local_only');assert.equal(phoneFormat(value).dialUrl,null);}
 for(const value of ['+0123456789','+12345','+1234567890123456','*123#','+442077348547;ext=1','+442077348547,123','+442077348547p12','tel:+442077348547','javascript:alert(1)','+442077348547\n',123456789,{},'+44 20 7734 8547 ext 1']) {assert.equal(phoneFormat(value).format,'invalid');assert.equal(phoneFormat(value).dialUrl,null);}
 assert.equal(phoneFormat(undefined).format,'missing');
});
test('website links reject credentials, schemes, controls and local targets without fetching',()=>{
 assert.equal(safeContactWebsite('https://venue.example/contact'),'https://venue.example/contact');
 for(const value of ['javascript:alert(1)','data:text/html,hello','file:///etc/passwd','https://user:pass@venue.example','https://venue.example\n','https://localhost/x','https://127.0.0.1','https://[::1]','https://venue.example\\@evil.example'])assert.equal(safeContactWebsite(value),null);
});
test('shape records provider fields, entity and retrieval time but never claims venue ownership or WhatsApp',()=>{
 const item=shapePlace(raw(),'qloo',at);
 assert.equal(item.links.phone,'tel:+442077348547');
 assert.deepEqual(item.contact.phone.source,{provider:'qloo',entityId:'venue-a',field:'properties.phone',retrievedAt:at,providerUpdatedAt:null});
 assert.equal(item.contact.phone.status,'provider_reported');assert.equal(item.contact.phone.ownership,'unverified');assert.equal(item.contact.phone.reachability,'unverified');
 assert.deepEqual(item.contact.whatsapp,{capability:'unknown',optIn:'unknown'});
 assert.equal(shapePlace(raw('02077348547'),'qloo',at).links.phone,null);
 const missing=shapePlace({entity_id:'venue-b',name:'No contact'},'qloo',at);
 assert.equal(missing.contact.phone.format,'missing');assert.equal(missing.contact.website.url,null);
 assert.equal(shapePlace(raw(),'qloo','not a date').contact.phone.source.retrievedAt,null);
});
test('legacy plans are re-sanitized with unknown provenance and no invented timestamp',()=>{
 const legacy=contactForItem({entityId:'old',links:{phone:'tel:+233241234567',website:'https://venue.example'}});
 assert.equal(legacy.phone.status,'legacy_reported');assert.equal(contactForItem({entityId:'old',contact:legacy}).phone.status,'legacy_reported');assert.equal(legacy.phone.source.provider,null);assert.equal(legacy.phone.source.retrievedAt,null);
 assert.equal(contactForItem({links:{phone:'tel:02077348547'}}).phone.dialUrl,null);
 assert.equal(contactForItem({links:{phone:'tel:+123456789;ext=1'}}).phone.dialUrl,null);
 const item=shapePlace(raw(),'qloo',at);item.entityId='another-venue';
 const conflict=contactForItem(item);
 assert.equal(conflict.identityStatus,'conflicting');assert.equal(conflict.phone.dialUrl,null);assert.equal(conflict.phone.display,null);assert.equal(conflict.website.url,null);
 for(const channel of ['phone','website'])assert.deepEqual(conflict[channel].source,{provider:null,entityId:null,field:null,retrievedAt:null,providerUpdatedAt:null});
 assert.equal(contactForItem({links:{phone:'tel:+233241234567',website:'https://venue.example'}}).phone.dialUrl,'tel:+233241234567');
 const mixed=shapePlace(raw(),'qloo',at);mixed.contact.website.source.entityId='another-venue';
 assert.equal(contactForItem(mixed).phone.dialUrl,null);assert.equal(contactForItem(mixed).website.url,null);
});
const createBody={planRevision:1,idempotencyKey:'a',stopId:'stop-a',itemId:'qloo:venue-a',entityId:'venue-a',kind:'enquiry',notes:'Can we visit?'};
function entry(){return {revision:1,plan:{request:{},stops:[{id:'stop-a',item:shapePlace(raw(),'qloo',at)},{id:'stop-b',item:shapePlace(raw(),'qloo',at)}]}};}
test('booking evidence follows occurrence and source; fresh retrieval does not revoke review, changed destination does',()=>{
 const value=entry();const {booking}=bookingOperation(value,'create',createBody);
 bookingOperation(value,'handoff',{planRevision:1,idempotencyKey:'b',bookingVersion:booking.bookingVersion,reviewed:true,channel:'phone'},booking.id);
 const record=value.bookingActions.records[0];
 assert.equal(record.snapshot.stopId,'stop-a');assert.equal(record.snapshot.contactEvidence.phone.source.retrievedAt,at);
 value.plan.stops[0].item=shapePlace(raw(),'qloo','2026-11-09T12:00:00.000Z');invalidateBookings(value);
 assert.equal(record.stale,false);assert.ok(record.handoff);
 value.plan.stops[0].item=shapePlace(raw('+442077348548'),'qloo',at);invalidateBookings(value);
 assert.equal(record.stale,true);assert.equal(record.handoff,null);
});
test('booking API rejects caller-provided contact destinations and metadata',()=>{
 for(const extra of [{contacts:{phone:'tel:+123456789'}},{contactEvidence:{}},{website:'https://evil.example'}])assert.throws(()=>bookingOperation(entry(),'create',{...createBody,...extra}));
});
test('legacy snapshots can gain evidence without invalidating review and unsafe stored destinations cannot be handed off',()=>{
 const value=entry();delete value.plan.stops[0].item.contact;
 const {booking}=bookingOperation(value,'create',createBody);
 const record=value.bookingActions.records[0];delete record.snapshot.contactEvidence;
 value.plan.stops[0].item=shapePlace(raw(),'qloo',at);invalidateBookings(value);
 assert.equal(record.stale,false);
 record.snapshot.contacts.phone='tel:02077348547';
 assert.throws(()=>bookingOperation(value,'handoff',{planRevision:1,idempotencyKey:'bad-old',bookingVersion:record.bookingVersion,reviewed:true,channel:'phone'},booking.id),/No sourced contact/);
});
