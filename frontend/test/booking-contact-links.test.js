import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedWhatsapp,venueSearchUrl} from '../src/booking-contact-links.js';
const snapshot={entityId:'venue-1',contacts:{phone:'tel:+233208879168'}};
const evidence={entityId:'venue-1',providerSourceUrl:'https://venue.example/',candidates:[{kind:'whatsapp',url:'https://wa.me/233208879168',sourceUrl:'https://venue.example/contact'}]};
test('WhatsApp needs a published link matching venue phone and bound website',()=>{assert.equal(publishedWhatsapp(evidence,snapshot),'https://wa.me/233208879168');for(const change of [{entityId:'other'}, {providerSourceUrl:null}, {candidates:[{...evidence.candidates[0],url:'https://wa.me/233208879169'}]}, {candidates:[{...evidence.candidates[0],sourceUrl:'https://other.example'}]}])assert.equal(publishedWhatsapp({...evidence,...change},snapshot),null);});
test('search handoff includes venue location and encodes text',()=>{const u=new URL(venueSearchUrl({name:'Bar Naas',address:'Ahodwo, Kumasi'}));assert.equal(u.hostname,'www.google.com');assert.match(u.searchParams.get('q'),/Ahodwo, Kumasi/);});
