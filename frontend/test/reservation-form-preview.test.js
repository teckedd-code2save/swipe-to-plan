import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeReservationForms,normalizeReservationPreview,seedReservationFields} from '../src/reservation-form-preview.js';
const form={id:'form-1',fields:[{id:'name',label:'Name',type:'text',semantic:'name',options:[]},{id:'date',label:'Date',type:'date',semantic:'date',options:[]},{id:'guests',label:'Guests',type:'select',semantic:'guests',options:[{label:'2',value:'two'},{label:'4',value:'four'}]},{id:'time',label:'Time',type:'select',semantic:'time',options:[{label:'19:00',value:'19:00'}]},{id:'notes',label:'Notes',type:'text',semantic:'notes',options:[]}]};
test('fills only actual known reservation details and leaves identity empty',()=>{
 assert.deepEqual(seedReservationFields(form,{date:'2026-12-01',localTime:'18:00',party:{adults:2,children:0}},'Actual request'),{name:'',date:'2026-12-01',guests:'two',time:'',notes:'Actual request'});
});
test('unknown party and dates never become defaults',()=>{
 assert.equal(seedReservationFields(form,{},'').guests,'');assert.equal(seedReservationFields(form,{},'').date,'');
});
test('rejects unverified source and duplicate fields',()=>{
 assert.throws(()=>normalizeReservationForms({status:'found',sourceUrl:'javascript:alert(1)',forms:[form]}));
 assert.throws(()=>normalizeReservationForms({status:'found',sourceUrl:'https://example.com',forms:[{...form,fields:[form.fields[0],form.fields[0]]}]}));
});
test('rejects alleged submission and unsafe image payloads',()=>{
 assert.throws(()=>normalizeReservationPreview({status:'filled',submitted:true,fields:[]}));
 assert.throws(()=>normalizeReservationPreview({status:'filled',submitted:false,fields:[],screenshotDataUrl:'data:image/svg+xml,<svg/>'}));
 assert.equal(normalizeReservationPreview({status:'filled',submitted:false,fields:[]}).status,'filled');
});
test('interactive preview accepts only Cloudflare live-view URLs with complete unexpired lease',()=>{
 const base={status:'preview_ready',submitted:false,fields:[],previewId:'e81234ab-4123-4123-8123-123456789abc',expiresAt:new Date(Date.now()+60000).toISOString(),liveViewUrl:'https://live.browser.run/session?token=private'};
 assert.equal(normalizeReservationPreview(base).previewId,base.previewId);
 for(const liveViewUrl of ['https://live.browser.run.attacker.example/session','http://live.browser.run/session','https://user:pass@live.browser.run/session','https://live.browser.run:444/session','javascript:alert(1)'])assert.throws(()=>normalizeReservationPreview({...base,liveViewUrl}));
 assert.throws(()=>normalizeReservationPreview({...base,previewId:'not-a-uuid'}));
 assert.throws(()=>normalizeReservationPreview({...base,expiresAt:'2000-01-01T00:00:00Z'}));
 assert.throws(()=>normalizeReservationPreview({...base,expiresAt:null}));
});
test('dateTime uses the actual visit and never guesses missing date or time',()=>{
 const f={fields:[{id:'when',semantic:'dateTime',options:[]},{id:'first',semantic:'firstName',options:[]},{id:'last',semantic:'lastName',options:[]}]};
 assert.deepEqual(seedReservationFields(f,{date:'2026-12-01',localTime:'19:30'},''),{when:'2026-12-01T19:30',first:'',last:''});
 assert.equal(seedReservationFields(f,{date:'2026-12-01'},'').when,'');
});
test('validates published candidates without requiring a native form',()=>{
 const candidate={id:'e81234ab-4123-4123-8123-123456789abc',url:'https://booking.example.com/venue',label:'Book a table',relationship:'booking_partner'};
 const response={status:'no_supported_form',forms:[],candidates:[candidate],unsupported:['embedded_forms']};
 assert.equal(normalizeReservationForms(response).candidates[0].relationship,'booking_partner');
 for(const bad of [{...candidate,url:'javascript:alert(1)'},{...candidate,id:'not-an-id'},{...candidate,relationship:'trusted'}])assert.throws(()=>normalizeReservationForms({...response,candidates:[bad]}));
});
test('bounded widget fields preserve reviewed date, time and party without supplying identity',()=>{
 const response=normalizeReservationForms({status:'found',sourceUrl:'https://www.saighana.com/',previewAvailable:true,forms:[{id:'wix-form',fields:[{id:'wix-date',label:'Date',type:'date',semantic:'date',required:true},{id:'wix-time',label:'Time',type:'time',semantic:'time',required:true},{id:'wix-partySize',label:'Party size',type:'number',semantic:'partySize',required:true}]}]});
 assert.deepEqual(seedReservationFields(response.forms[0],{date:'2026-12-01',localTime:'19:30',party:{adults:2,children:0}},''),{'wix-date':'2026-12-01','wix-time':'19:30','wix-partySize':'2'});
 assert.deepEqual(seedReservationFields(response.forms[0],{},''),{'wix-date':'','wix-time':'','wix-partySize':''});
});

test('cross-domain redirect is a review candidate, not an authorized form',async()=>{
 const {unsupportedFormMessage}=await import('../src/reservation-form-preview.js');
 const result=normalizeReservationForms({status:'no_supported_form',sourceUrl:'https://www.capitolgh.com/',forms:[],candidates:[{id:'e81234ab-4123-4123-8123-123456789abc',url:'https://capitolghana.com/',label:'Website redirected here — review before continuing',relationship:'website_redirect'}],unsupported:['destination_review_required'],previewAvailable:true,submitted:false});
 assert.equal(result.candidates[0].relationship,'website_redirect');assert.deepEqual(result.forms,[]);
 assert.match(unsupportedFormMessage(result),/Review it before continuing/);
 assert.throws(()=>normalizeReservationForms({...result,candidates:[{...result.candidates[0],url:'javascript:alert(1)'}]}));
});

test('booking error handoff preserves HTTPS instead of returning stale provider HTTP',async()=>{
 const {secureBookingWebsite}=await import('../src/reservation-form-preview.js');
 assert.equal(secureBookingWebsite('http://www.frontbackaccra.com/'),'https://www.frontbackaccra.com/');
 assert.equal(secureBookingWebsite('https://www.frontbackaccra.com/'),'https://www.frontbackaccra.com/');
 for(const value of ['javascript:alert(1)','http://user:pass@example.com/','http://127.0.0.1/'])assert.equal(secureBookingWebsite(value),null);
});
