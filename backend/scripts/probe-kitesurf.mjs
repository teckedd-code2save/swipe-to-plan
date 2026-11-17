// Read-only discovery probe: no guest identity or reservation details are supplied.
import {HttpsProxyAgent} from 'https-proxy-agent';
import WebSocket from 'ws';
import {createReservationForms,browserSession} from '../src/reservation-form.js';
const url=process.argv[2];if(!url)throw Error('Pass an official venue website URL.');
const id='12345678-1234-1234-1234-123456789abc';
const api=createReservationForms({config:{},places:{details:async()=>({entityId:id,contact:{website:{url,source:{entityId:id,field:'properties.website'}}}})},run:async(_,job)=>{
 const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;
 const ws=new WebSocket('wss://kitesurf.dev/devtools/browser',proxy?{agent:new HttpsProxyAgent(proxy)}:{});
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
 const transport={send:s=>ws.send(s),close:()=>ws.close()};ws.on('message',m=>transport.onmessage?.(m.toString()));ws.on('close',()=>transport.onclose?.());
 const resolve=async hostname=>{
  const response=await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,{headers:{accept:'application/dns-json'}});
  if(!response.ok)throw Error('DNS failed');
  const json=await response.json();return (json.Answer||[]).filter(a=>a.type===1).map(a=>({address:a.data,family:4}));
 };
 return browserSession({transport,resolve},job);
}});
console.log(JSON.stringify(await api.discover(id),null,2));
