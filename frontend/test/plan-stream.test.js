import test from 'node:test';
import assert from 'node:assert/strict';
import {readPlanStream} from '../src/plan-stream.js';
import {createLatestPlanner} from '../src/day-state.js';
test('Qloo places appear before vetting finishes, including split network chunks',async()=>{
 let controller;const seen=[];
 const response=new Response(new ReadableStream({start(c){controller=c;}}),{headers:{'content-type':'application/x-ndjson'}});
 const task=readPlanStream(response,plan=>seen.push(plan));const bytes=new TextEncoder();
 controller.enqueue(bytes.encode('{"type":"discov'));controller.enqueue(bytes.encode('ery","plan":{"places":["garden"]}}\n'));
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(seen,[{places:['garden']}]);
 controller.enqueue(bytes.encode('{"type":"complete","plan":{"reviewed":true}}\n'));controller.close();assert.deepEqual(await task,{reviewed:true});
});
test('an interrupted review retains the already-published places and reports failure',async()=>{
 const seen=[];const response=new Response('{"type":"discovery","plan":{"id":"first"}}\n{"type":"error","error":"Review unavailable"}\n',{headers:{'content-type':'application/x-ndjson'}});
 await assert.rejects(readPlanStream(response,p=>seen.push(p)),/Review unavailable/);assert.deepEqual(seen,[{id:'first'}]);
});
test('a newer brief aborts an older search and cannot receive its provisional results',async()=>{
 const started=[],seen=[];let previewOld;
 const planner=createLatestPlanner({run:(value,{signal,onPreview})=>new Promise((resolve,reject)=>{started.push(value);if(value===1)previewOld=onPreview;signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));if(value===2){onPreview({id:2});resolve({id:2});}}),onPreview:p=>seen.push(p.id),onResult:()=>{},onError:()=>{throw Error('Stale abort surfaced');}});
 planner.enqueue(1);planner.enqueue(2);previewOld({id:1});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(started,[1,2]);assert.deepEqual(seen,[2]);planner.dispose();
});
