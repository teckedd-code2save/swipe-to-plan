import test from 'node:test';import assert from 'node:assert/strict';
import {configuredKitesurf,semanticField,createReservationForms} from '../src/reservation-form.js';
const id='12345678-1234-1234-1234-123456789ABC',url='https://venue.example/book';
const raw=[{index:0,action:url,method:'post',fields:[{elementIndex:0,type:'date',label:'Date',name:'date',required:true},{elementIndex:1,type:'email',label:'Email',name:'email',required:true}]}];
function fixture(){let frozen=false,valuesSeen;const places={details:async()=>({entityId:id,contact:{website:{url,source:{entityId:id,field:'properties.website'}}}})};const run=async(_,job)=>job({goto:async()=>{},url:()=>url,evaluate:async(fn,args)=>{if(args){assert.equal(frozen,true);valuesSeen=args.values;return [{label:'Email',value:args.values['field-1'],status:'filled'}];}return fn.name==='inspectForms'?structuredClone(raw):[];},screenshot:async()=>Buffer.from('test image')},async()=>{frozen=true;});return {api:createReservationForms({places,config:{},run}),values:()=>valuesSeen};}
test('feature default off; anonymous playground cannot receive private forms',()=>{assert.equal(configuredKitesurf({}),null);assert.equal(configuredKitesurf({RESERVATION_FORM_PREVIEW:'true',KITESURF_CDP_URL:'wss://kitesurf.dev/devtools/browser'}),null);});
test('maps real form field semantics without invented values',()=>{assert.equal(semanticField({label:'Party size',type:'number'}),'partySize');assert.equal(semanticField({label:'First name',type:'text'}),'firstName');assert.equal(semanticField({label:'Email',type:'text'}),'email');assert.equal(semanticField({label:'Special code',type:'text'}),null);});
test('discovery gives no personal data; preview freezes before copying reviewed values',async()=>{const {api,values}=fixture();const found=await api.discover(id);assert.equal(found.status,'forms_found');const formId=found.forms[0].id;assert.equal(values(),undefined);const result=await api.preview(id,{formId,consent:true,fields:{'field-1':'review@example.test'}});assert.equal(result.submitted,false);assert.equal(result.networkDisconnected,true);assert.equal(values()['field-1'],'review@example.test');});
test('rejects missing consent, unknown fields, and venue mismatch',async()=>{const {api}=fixture();const {forms}=await api.discover(id);const formId= forms[0].id;await assert.rejects(api.preview(id,{formId,fields:{}}),/authorize/);await assert.rejects(api.preview(id,{formId,consent:true,fields:{unknown:'value'}}),/Invalid/);await assert.rejects(api.preview('other',{formId,consent:true,fields:{}}),/expired/);});
test('disabled feature never runs browser',async()=>{const api=createReservationForms({config:null,run:()=>{throw Error('must not run')}});assert.equal((await api.discover(id)).status,'disabled');await assert.rejects(api.preview(id,{}),/not configured/);});

test('hybrid selects Chromium only for preview and closes retained lease',async()=>{
 let closes=0;const configs=[];
 const run=async(config,job)=>{configs.push(config);const result=await job({goto:async()=>{},url:()=>url,evaluate:async(fn,args)=>args?[]:fn.name==='inspectForms'?structuredClone(raw):[],screenshot:async()=>Buffer.from('test')},async()=>[]);return config.engine==='chromium'?{...result,liveViewUrl:'https://live.browser.run/ui/view?wss=test',release:async()=>{closes++;}}:result;};
 const api=createReservationForms({config:{engine:'kitesurf'},previewConfig:{engine:'chromium'},run,places:{details:async()=>({entityId:id,contact:{website:{url,source:{entityId:id,field:'properties.website'}}}})}});
 const found=await api.discover(id),result=await api.preview(id,{formId:found.forms[0].id,fields:{},consent:true});assert.deepEqual(configs.map(c=>c.engine),['kitesurf','chromium']);assert.equal(typeof result.previewId,'string');assert.equal(result.release,undefined);assert.equal(result.submitted,false);await api.closePreview(result.previewId);await api.closePreview(result.previewId);assert.equal(closes,1);
});

test('published partner destination requires explicit selection and cannot accept caller URLs',async()=>{
 let current=url,visits=[];
 const partner='https://booking.example/restaurant/real-venue';
 const api=createReservationForms({config:{},previewConfig:null,places:{details:async()=>({entityId:id,contact:{website:{url,source:{entityId:id,field:'properties.website'}}}})},run:async(_,job)=>job({goto:async target=>{current=target;visits.push(target);},url:()=>current,evaluate:async fn=>fn.name==='inspectForms'?structuredClone(raw):fn.name==='inspectWixForms'?[]:current===url?[{url:partner,label:'Reserve a table'},{url:'javascript:alert(1)',label:'Book'}]:[]})});
 const first=await api.discover(id);assert.deepEqual(visits,[url]);assert.equal(first.candidates.length,1);assert.equal(first.candidates[0].relationship,'booking_partner');
 await assert.rejects(api.inspectDestination(id,{candidateId:first.candidates[0].id,url:partner}),/Select/);
 await assert.rejects(api.inspectDestination('other',{candidateId:first.candidates[0].id}),/expired/);
 const next=await api.inspectDestination(id,{candidateId:first.candidates[0].id});assert.equal(next.sourceUrl,partner);assert.deepEqual(visits,[url,partner]);assert.equal(next.submitted,false);
});
test('unmapped date/time is visible and datetime-local is recognized',async()=>{
 assert.equal(semanticField({type:'datetime-local',label:'Visit'}),'dateTime');
 const {api}=fixture();const result=await api.discover(id);assert.deepEqual(result.unsupported,['visit_time_not_mapped']);
});

test('HTTP provider websites upgrade to HTTPS without ever navigating HTTP',async()=>{
 let current,visits=[];
 const api=createReservationForms({config:{},places:{details:async()=>({entityId:id,contact:{website:{url:'http://venue.example/book',source:{entityId:id,field:'properties.website'}}}})},run:async(_,job)=>job({goto:async value=>{current=value;visits.push(value);},url:()=>current,evaluate:async fn=>fn.name==='inspectForms'?structuredClone(raw):[]})});
 assert.equal((await api.discover(id)).status,'forms_found');assert.deepEqual(visits,[url]);
});
test('discovery failures distinguish provider, browser, HTTPS page and missing form without exposing secrets',async()=>{
 const {reservationDiscoveryFailure,reservationPageUrl}=await import('../src/reservation-form.js');
 assert.equal(reservationPageUrl('http://venue.example:80/book'),url);
 for(const value of ['http://127.0.0.1/book','https://user:password@venue.example/book','file:///etc/passwd'])assert.throws(()=>reservationPageUrl(value));
 const places={details:async()=>({entityId:id,contact:{website:{url,source:{entityId:id,field:'properties.website'}}}})};
 for(const [code,run] of [['browser_unavailable',async()=>{throw Error('secret auth token');}],['page_unavailable',async(_,job)=>job({goto:async()=>{throw Error('secret url');}})]]){
  const api=createReservationForms({config:{},places,run});let failure;try{await api.discover(id);}catch(e){failure=reservationDiscoveryFailure(e);}assert.equal(failure.code,code);assert.doesNotMatch(JSON.stringify(failure),/secret/);
 }
 const noSite=createReservationForms({config:{},places:{details:async()=>({entityId:id})}});await assert.rejects(noSite.discover(id),e=>reservationDiscoveryFailure(e).code==='no_website');
 const unavailable=createReservationForms({config:{},places:{details:async()=>{throw Error('private provider url');}}});await assert.rejects(unavailable.discover(id),e=>reservationDiscoveryFailure(e).code==='provider_unavailable');
 const empty=createReservationForms({config:{},places,run:async(_,job)=>job({goto:async()=>{},url:()=>url,evaluate:async()=>[]})});assert.equal((await empty.discover(id)).status,'no_supported_form');
 assert.equal(reservationDiscoveryFailure(Error('secret')).code,'discovery_failed');assert.doesNotMatch(reservationDiscoveryFailure(Error('secret')).error,/secret/);
});

test('readonly custom date widgets do not count as mapped writable timing',async()=>{
 const custom=[{index:0,action:url,method:'post',fields:[
  {elementIndex:0,type:'text',label:'Date',name:'date',readOnly:true},
  {elementIndex:1,type:'time',label:'Time',name:'time'}
 ]}];
 const api=createReservationForms({config:{},places:{details:async()=>({entityId:id,contact:{website:{url,source:{entityId:id,field:'properties.website'}}}})},run:async(_,job)=>job({goto:async()=>{},url:()=>url,evaluate:async fn=>fn.name==='inspectForms'?structuredClone(custom):[]})});
 const result=await api.discover(id);
 assert.ok(result.unsupported.includes('visit_time_not_mapped'));
 assert.equal(result.forms[0].fields[0].readOnly,true);
});

test('preview never writes to readonly native backing inputs of custom widgets',async()=>{
 const custom=[{index:0,action:url,method:'post',fields:[{elementIndex:0,type:'text',label:'Date',name:'date',readOnly:true}]}];
 const el={readOnly:true,value:'11/17/2026',getAttribute:()=>null};let frozen=false;
 const api=createReservationForms({config:{},places:{details:async()=>({entityId:id,contact:{website:{url,source:{entityId:id,field:'properties.website'}}}})},run:async(_,job)=>job({goto:async()=>{},url:()=>url,evaluate:async(fn,args)=>{
  if(!args)return fn.name==='inspectForms'?structuredClone(custom):[];
  assert.equal(frozen,true);
  const prior=globalThis.document;
  globalThis.document={forms:[{querySelectorAll:()=>[el]}]};
  try{return fn(args);}finally{if(prior===undefined)delete globalThis.document;else globalThis.document=prior;}
 },screenshot:async()=>Buffer.from('test')},async()=>{frozen=true;})});
 const found=await api.discover(id);
 const result=await api.preview(id,{formId:found.forms[0].id,consent:true,fields:{'field-0':'2026-11-18'}});
 assert.equal(result.fields[0].status,'unsupported_control');
 assert.equal(el.value,'11/17/2026');assert.equal(result.submitted,false);
});
