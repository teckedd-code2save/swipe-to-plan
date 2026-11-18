import test from 'node:test';import assert from 'node:assert/strict';
import {tableagentAvailabilityPermit,tableagentVisit,prepareTableagent} from '../src/reservation-tableagent.js';
const pageUrl='https://tableagent.com/accra/frontback-accra-icfmrvax/',path='/api/business-hours/',body={id:'123',slugname:'frontback-accra-icfmrvax',reservationdate:'11/20/2026',dayofweek:'5',eventid:'0'};
const req=(overrides={})=>({method:()=> 'PUT',url:()=>`https://tableagent.com${path}`,postData:()=>new URLSearchParams(body).toString(),isNavigationRequest:()=>false,resourceType:()=> 'fetch',...overrides});
test('availability permission is exact, single use, no booking submission',()=>{
 const permit=tableagentAvailabilityPermit({pageUrl,path,body});
 for(const overrides of [{method:()=> 'POST'},{url:()=>`${pageUrl}table-search/`},{url:()=>`https://evil.example${path}`},{postData:()=>new URLSearchParams({...body,email:'x@example.com'}).toString()},{postData:()=>new URLSearchParams({...body,id:'999'}).toString()},{isNavigationRequest:()=>true},{resourceType:()=> 'document'}])assert.equal(permit(req(overrides)),false);
 assert.equal(permit(req()),true);assert.equal(permit(req()),false);
});
test('rejects unsafe or mismatched endpoint scope',()=>{
 for(const change of [{pageUrl:'https://evil.example/accra/frontback-accra-icfmrvax/'},{path:'/api/book/'},{body:{...body,slugname:'other'}},{body:{...body,csrf:'secret'}},{body:{...body,eventid:'1'}},{body:{...body,reservationdate:'02/30/2026'}},{body:{...body,dayofweek:'0'}}])assert.throws(()=>tableagentAvailabilityPermit({pageUrl,path,body,...change}));
});
test('validates visit without accepting contact data or invalid dates',()=>{
 assert.deepEqual(tableagentVisit({'ta-date':'2026-11-20','ta-time':'19:00','ta-party':'2'}),{date:'11/20/2026',time:'19:00',party:'2',dayofweek:'5'});
 for(const change of [{'ta-date':'2026-02-30'},{'ta-time':'25:00'},{'ta-party':'0'},{'ta-party':'100'}])assert.throws(()=>tableagentVisit({'ta-date':'2026-11-20','ta-time':'19:00','ta-party':'2',...change}));
});
test('availability uses two bounded permits, closes each, selects actual option',async()=>{
 const calls=[],permits=[];
 const page={url:()=>pageUrl,evaluate:async(fn,args)=>{calls.push(args);return calls.length===1?[{value:'42',label:'Dinner',min:'1',max:'6',passcode:'false',hourstype:'14'}]:[{value:'19:00:00',label:'7 PM'}];}};
 const result=await prepareTableagent(page,{restaurantId:'123'},{'ta-date':'2026-11-20','ta-time':'19:00','ta-party':'2'},p=>permits.push(p));
 assert.equal(result.time.value,'19:00:00');assert.equal(calls.length,2);assert.deepEqual(permits.map(p=>typeof p),['function','object','function','object']);
 assert.deepEqual(calls[0].body,body);assert.equal(calls[1].body.hours_id,'42');assert.equal(JSON.stringify(calls).includes('email'),false);
});
test('does not guess ambiguous services or unavailable requested times',async()=>{
 for(const responses of [[[ {value:'1'},{value:'2'}]],[[{value:'1',passcode:'true'}]],[[{value:'1',hourstype:'10'}]],[[{value:'1',min:'3',max:'6'}]],[[{value:'1'}],[{value:'18:00',label:'6PM'}]]]){
  let index=0;await assert.rejects(prepareTableagent({url:()=>pageUrl,evaluate:async()=>responses[index++]},{restaurantId:'123'},{'ta-date':'2026-11-20','ta-time':'19:00','ta-party':'2'},()=>{}));
 }
});
test('lookup exception revokes the one-shot permission',async()=>{
 const permits=[];await assert.rejects(prepareTableagent({url:()=>pageUrl,evaluate:async()=>{throw Error('lookup failed');}},{restaurantId:'123'},{'ta-date':'2026-11-20','ta-time':'19:00','ta-party':'2'},p=>permits.push(p)),/lookup failed/);assert.equal(permits.at(-1),null);
});
test('revoking availability while DNS is pending aborts the permitted request',async()=>{
 const {EventEmitter}=await import('node:events');const {browserSession}=await import('../src/reservation-form.js');
 const page=new EventEmitter(),frame={};let finishDns;const calls=[];
 Object.assign(page,{setViewport:async()=>{},setRequestInterception:async()=>{},evaluateOnNewDocument:async()=>{},mainFrame:()=>frame,close:async()=>{}});
 await browserSession({connect:async()=>({newPage:async()=>page,close:async()=>{}}),resolve:()=>new Promise(r=>{finishDns=r;})},async(_,freeze,permit)=>{
  permit(tableagentAvailabilityPermit({pageUrl,path,body}));
  const pending=page.listeners('request')[0](req({frame:()=>frame,abort:async()=>calls.push('abort'),continue:async()=>calls.push('continue')}));
  permit(null);finishDns([{address:'93.184.216.34'}]);await pending;return {};
 });assert.deepEqual(calls,['abort']);
});
test('failed network freeze prevents all Tableagent value writes',async()=>{
 const {createReservationForms}=await import('../src/reservation-form.js');const entityId='12345678-1234-1234-1234-123456789ABC';let writes=0;
 const raw={index:0,adapter:'tableagent-availability-v1',restaurantId:'123',action:`${pageUrl}table-search/`,method:'post',fields:[{id:'ta-date',name:'date',label:'Date',type:'date'},{id:'ta-time',name:'time',label:'Time',type:'time'},{id:'ta-party',name:'party',label:'Party size',type:'number'}]};
 const page={url:()=>pageUrl,goto:async()=>{},evaluate:async(fn,args)=>{
  if(fn.name==='inspectTableagentForms')return [structuredClone(raw)];
  if(args?.path)return args.path.endsWith('hours/')?[{value:'42',label:'Dinner',min:'1',max:'6',passcode:'false',hourstype:'14'}]:[{value:'19:00',label:'7PM'}];
  if(fn.name==='fillTableagent'){writes++;return [];}
  return [];
 }};
 const api=createReservationForms({config:{},previewConfig:null,places:{details:async()=>({entityId,contact:{website:{url:pageUrl,source:{entityId,field:'properties.website'}}}})},run:async(_,job)=>job(page,async()=>{throw Error('offline mode unavailable');},()=>{})});
 const discovery=await api.discover(entityId);assert.equal(discovery.forms[0].availabilityProvider,'tableagent');
 await assert.rejects(api.preview(entityId,{formId:discovery.forms[0].id,consent:true,fields:{'ta-date':'2026-11-20','ta-time':'19:00','ta-party':'2'}}),/offline mode/);assert.equal(writes,0);
});

test('actual FrontBack service requires at least five guests, never substitutes requested two',async()=>{
 const actual=[{value:'107754',label:'Lunch - Dinner',min:'5',max:'40',passcode:'False',hourstype:'14'}];let calls=0;
 await assert.rejects(prepareTableagent({url:()=>pageUrl,evaluate:async()=>{calls++;return actual;}},{restaurantId:'123'},{'ta-date':'2026-11-20','ta-time':'19:00','ta-party':'2'},()=>{}),/accepts 5–40 guests/);assert.equal(calls,1);
 const responses=[actual,[{value:'19:00:00',label:'7:00 pm',disabled:false}]];let index=0;
 const prepared=await prepareTableagent({url:()=>pageUrl,evaluate:async()=>responses[index++]},{restaurantId:'123'},{'ta-date':'2026-11-20','ta-time':'19:00','ta-party':'5'},()=>{});assert.equal(prepared.visit.party,'5');assert.equal(prepared.service.value,'107754');
});

test('only typed availability errors expose safe actionable messages',async()=>{
 const {TableagentAvailabilityError,tableagentPreviewFailure}=await import('../src/reservation-tableagent.js');
 assert.equal(tableagentPreviewFailure(Error('private token secret')),null);assert.equal(tableagentPreviewFailure({code:'tableagent_no_services',message:'secret'}),null);
 const failure=tableagentPreviewFailure(new TableagentAvailabilityError('tableagent_party_unavailable',{min:5,max:40}));assert.match(failure.error,/5–40/);assert.match(failure.error,/not changed/);assert.match(failure.error,/No booking was submitted/);
});
