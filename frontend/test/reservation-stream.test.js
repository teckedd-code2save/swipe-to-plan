import test from 'node:test';
import assert from 'node:assert/strict';
import {readReservationStream,reservationStreamEvent} from '../src/reservation-stream.js';
const response=text=>new Response(text,{headers:{'content-type':'application/x-ndjson'}});
test('browser stream publishes real frames and stages before returning final result',async()=>{
 let controller;const seen=[];const r=new Response(new ReadableStream({start(c){controller=c;}}),{headers:{'content-type':'application/x-ndjson'}});const task=readReservationStream(r,e=>seen.push(e));const encoder=new TextEncoder();
 controller.enqueue(encoder.encode('{"type":"pro'));controller.enqueue(encoder.encode('gress","stage":"loading","message":"untrusted URL not displayed"}\n{"type":"frame","imageDataUrl":"data:image/jpeg;base64,YQ=="}\n'));await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(seen,[{type:'progress',stage:'loading'},{type:'frame',imageDataUrl:'data:image/jpeg;base64,YQ=='}]);
 controller.enqueue(encoder.encode('{"type":"result","result":{"status":"forms_found"}}\n'));controller.close();assert.deepEqual(await task,{status:'forms_found'});
});
test('interruption, invalid images and terminal server errors fail honestly',async()=>{
 await assert.rejects(readReservationStream(response('{"type":"progress","stage":"loading"}\n')),/interrupted/);
 assert.throws(()=>reservationStreamEvent({type:'frame',imageDataUrl:'data:image/svg+xml,<svg/>'}),/Invalid/);
 await assert.rejects(readReservationStream(response('{"type":"error","code":"timeout","error":"Page load timed out"}\n')),/Page load timed out/);
});
test('JSON compatibility retained, duplicate terminal result rejected',async()=>{
 assert.deepEqual(await readReservationStream(new Response('{"status":"ok"}')),{status:'ok'});
 await assert.rejects(readReservationStream(response('{"type":"result","result":{}}\n{"type":"result","result":{}}\n')),/Unexpected/);
});

test('provider cooldown progress survives stream parsing until successful result',async()=>{
 const seen=[];
 const events=[{type:'progress',stage:'waiting',message:'untrusted provider detail'},{type:'progress',stage:'loading'},{type:'result',result:{status:'forms_found'}}];
 const result=await readReservationStream(response(events.map(e=>JSON.stringify(e)).join('\n')),event=>seen.push(event));
 assert.deepEqual(seen,[{type:'progress',stage:'waiting'},{type:'progress',stage:'loading'}]);assert.equal(result.status,'forms_found');
});
