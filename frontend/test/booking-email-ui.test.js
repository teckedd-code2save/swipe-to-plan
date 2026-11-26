import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';

test('signed-in Account queues a pending resend without claiming it was sent, then recognizes verification',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'https://unstressed.example'});
  const globals={};
  for(const k of ['window','document','navigator','location','sessionStorage','localStorage','Event','HTMLElement','IS_REACT_ACT_ENVIRONMENT','fetch'])globals[k]=Object.getOwnPropertyDescriptor(globalThis,k);
  for(const k of ['window','document','navigator','location','sessionStorage','localStorage','Event','HTMLElement'])Object.defineProperty(globalThis,k,{value:dom.window[k],writable:true,configurable:true});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  const frontend=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp(join(frontend,'node_modules/.booking-email-ui-'));
  let root;
  try {
    const out=join(dir,'account.mjs');
    await build({entryPoints:[join(frontend,'src/AccountPanel.jsx')],outfile:out,bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external'});
    const [{AccountPanel},{createRoot}]=await Promise.all([import(pathToFileURL(out).href),import('react-dom/client')]);
    let status='pending';const requests=[];
    globalThis.fetch=async(url,init)=>{
      assert.equal(url,'/api/account/booking-email');requests.push(init.method||'GET');
      if(init.method==='POST')assert.deepEqual(JSON.parse(init.body),{});
      return Response.json({status,...(init.method==='POST'?{resendRequestedAt:Date.now()}: {})});
    };
    root=createRoot(document.getElementById('root'));
    const account={user:{id:'test-user',profile:{name:'Ama'},email:'ama@example.test'},circles:[]};
    await act(async()=>root.render(React.createElement(AccountPanel,{account})));
    const click=async label=>{
      const button=[...document.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(button,label);
      await act(async()=>button.click());
    };
    assert.match(document.body.textContent,/Check your inbox for Cloudflare/);
    await click('Request another verification email');
    assert.match(document.body.textContent,/Resend requested. It won’t arrive until our team sends it./);
    status='verified';
    await click('Check verification');
    assert.match(document.body.textContent,/Booking updates also stay in Unstressed/);
    assert.deepEqual(requests,['GET','POST','GET']);
  } finally {
    if(root)await act(async()=>root.unmount());
    dom.window.close();await rm(dir,{recursive:true,force:true});
    for(const [k,d] of Object.entries(globals))if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];
  }
});
