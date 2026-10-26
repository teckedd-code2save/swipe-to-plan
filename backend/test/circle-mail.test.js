import test from 'node:test';import assert from 'node:assert/strict';import {sendCircleMail} from '../src/circle-mail.js';
const request={email:'friend@example.test',name:'Friends <script>',url:'https://example.test/#/circle/1?invite=test',key:'test-key',from:'Invites <invites@example.test>',idempotencyKey:'circle-invite/123'};
test('invite HTML escapes names and records provider acceptance without claiming delivery',async()=>{
 let sent;const result=await sendCircleMail({...request,fetchImpl:async(_url,options)=>{sent=options;return {ok:true,json:async()=>({id:'provider-id'})};}});
 assert.equal(sent.headers['Idempotency-Key'],'circle-invite/123');
 const body=JSON.parse(sent.body);assert.equal(body.to[0],request.email);assert.ok(body.html.includes('&lt;script&gt;'));assert.ok(!body.html.includes('<script>'));
 assert.deepEqual(result,{sent:true,status:'accepted',messageId:'provider-id'});
});
test('provider rejection and missing acknowledgment cannot become a sent invitation',async()=>{
 await assert.rejects(sendCircleMail({...request,fetchImpl:async()=>({ok:false,status:403,json:async()=>({message:'private provider details'})})}),e=>e.status===502&&/configuration/.test(e.message)&&!e.message.includes('private'));
 await assert.rejects(sendCircleMail({...request,fetchImpl:async()=>({ok:true,json:async()=>({})})}),/did not confirm/);
});
