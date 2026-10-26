import test from 'node:test';import assert from 'node:assert/strict';import {modelOptions} from '../src/model-options.js';import {createAgent} from '../src/agent.js';
test('DeepSeek uses non-thinking tool calls without Gemini-specific options',()=>{
 assert.deepEqual(modelOptions('deepseek-flash','https://api.deepseek.com'),{thinking:{type:'disabled'}});
 assert.deepEqual(modelOptions('deepseek-flash','https://api.deepseek.com/v1'),{thinking:{type:'disabled'}});
 assert.deepEqual(modelOptions('deepseek-flash','https://api.deepseek.com.example/v1'),{});
 assert.deepEqual(modelOptions('gemini-3.5-flash-lite','https://generativelanguage.googleapis.com/v1beta/openai/'),{reasoning_effort:'minimal'});
});
test('single configured DeepSeek endpoint handles interpretation with its own request fields',async()=>{
 let request,url;const agent=createAgent({getKey:()=> 'test',getModel:()=> 'deepseek-flash',baseUrl:'https://api.deepseek.com',fetchImpl:async(u,o)=>{url=u;request=JSON.parse(o.body);return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'reply',arguments:JSON.stringify({text:'Here are your options.'})}}]}}]})};}});
 const result=await agent.interpret({message:'What can we do?',mode:'autopilot'});
 assert.equal(String(url),'https://api.deepseek.com/chat/completions');assert.equal(request.model,'deepseek-flash');assert.deepEqual(request.thinking,{type:'disabled'});assert.equal(request.reasoning_effort,undefined);assert.equal(result.status,'reply');
});
