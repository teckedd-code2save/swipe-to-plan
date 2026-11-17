import test from 'node:test';import assert from 'node:assert/strict';import puppeteer from 'puppeteer-core';
import {createReservationForms,browserSession} from '../src/reservation-form.js';
// Explicit local browser test, not production content or live venue submission.
test('real browser fill disconnects before values, suppresses handlers, produces screenshot',{skip:!process.env.TEST_CHROMIUM&&process.env.TEST_KITESURF!=='1'},async()=>{
 const browser=process.env.TEST_CHROMIUM?await puppeteer.launch({executablePath:process.env.TEST_CHROMIUM,args:['--no-sandbox']}):null;
 async function config(){
  if(browser)return {browserWSEndpoint:browser.wsEndpoint()};
  const {default:WebSocket}=await import('ws');
  const {HttpsProxyAgent}=await import('https-proxy-agent');
  const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;
  const ws=new WebSocket('wss://kitesurf.dev/devtools/browser',proxy?{agent:new HttpsProxyAgent(proxy)}:{});
  await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});
  const transport={send:s=>ws.send(s),close:()=>ws.close()};ws.on('message',m=>transport.onmessage?.(m.toString()));ws.on('close',()=>transport.onclose?.());return {transport};
 }
 const id='12345678-1234-1234-1234-123456789ABC',url='https://venue.example/book';
 let requests=0,called=0;
 const html='<form action="https://venue.example/submit" method="post"><label>Date<input name="date" type="date" required></label><label>Email<input name="email" type="email" oninput="window.changed=true;fetch(\'/autosave\',{method:\'POST\',body:this.value})"></label><button>Reserve</button></form>';
 const api=createReservationForms({config:{},places:{details:async()=>({entityId:id,contact:{website:{url,source:{entityId:id,field:'properties.website'}}}})},run:async(_,job)=>browserSession(await config(),async(page,freeze)=>{
   const proxy=new Proxy(page,{get(target,key){if(key==='goto')return async()=>page.setContent(html);if(key==='url')return ()=>url;const val=target[key];return typeof val==='function'?val.bind(target):val;}});
   page.on('request',()=>requests++);
   const result=await job(proxy,async()=>{called++;return freeze();});
   assert.equal(await page.evaluate(()=>!!window.changed),false);if(result.networkDisconnected)await assert.rejects(page.evaluate(()=>fetch('https://example.com/preview-network-probe')));return result;
 })});
 try{const found=await api.discover(id);assert.equal(found.forms.length,1);const preview=await api.preview(id,{formId:found.forms[0].id,consent:true,fields:{'field-0':'2026-12-01','field-1':'test@example.test'}});assert.equal(preview.fields.filter(f=>f.status==='filled').length,2);assert.match(preview.screenshotDataUrl,/^data:image\/png;base64,/);assert.equal(preview.submitted,false);assert.equal(requests,0);assert.equal(called,1);}finally{await browser?.close();}
});
