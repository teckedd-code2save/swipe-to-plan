import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once,EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {createContactEvidence,extractContactEvidence} from '../src/contact-evidence.js';
import {readMenuPage} from '../src/menu-evidence.js';
import {shapePlace} from '../src/plan.js';
import {createApp} from '../src/app.js';
const id='AB662328-C415-495E-B21E-390E20FC08F9',other='AB662328-C415-495E-B21E-390E20FC08F8';
const source='https://venue.example/';
const raw={entity_id:id,name:'Cafe One',properties:{address:'1 Main St, Accra',phone:'+233201234567',website:source}};
const place=shapePlace(raw,'qloo',new Date(0).toISOString());
const json=node=>`<script type="application/ld+json">${JSON.stringify(node)}</script>`;
const business={'@type':'Restaurant',name:raw.name,address:raw.properties.address,telephone:'+233 20 123 4567'};
const parse=html=>extractContactEvidence(html,source,place);
test('website telephone requires explicit publication; identity requires exact name and address',()=>{
 const {candidates}=parse(json(business));assert.equal(candidates.length,1);assert.equal(candidates[0].comparison,'match');assert.equal(candidates[0].assignment,'venue');assert.equal(candidates[0].url,null);
 for(const data of [{...business,address:undefined},{...business,name:'Other Cafe'},{...business,address:'Other branch'}])assert.equal(parse(json(data)).candidates[0].assignment,'manual_review');
 assert.equal(parse('<p>Call +233201234567, booking 2026</p><script>telephone="+233201234567"</script>').candidates.length,0);
});
test('different international numbers are comparison conflicts, not ownership conclusions; local format remains uncertain',()=>{
 assert.equal(parse(json({...business,telephone:'+233201234568'})).candidates[0].comparison,'conflict');
 for(const number of ['0201234567','233201234567'])assert.equal(parse(json({...business,telephone:number})).candidates[0].comparison,'not_comparable');
 assert.equal(extractContactEvidence(json(business),source,{...place,contact:{phone:{display:null}}}).candidates[0].comparison,'website_only');
});
test('multi-venue and detached ContactPoint records stay unassigned even when names repeat',()=>{
 const result=parse(json([business,{...business,address:'2 Main St, Accra',telephone:'+233201234569'},{'@type':'ContactPoint',telephone:'+233201234568'}]));assert.equal(result.multiVenue,true);assert.ok(result.candidates.every(c=>c.assignment==='manual_review'));
 const nested=parse(json({...business,telephone:undefined,contactPoint:{'@type':'ContactPoint',telephone:'+233201234567'}}));assert.equal(nested.candidates[0].assignment,'venue');
 assert.equal(parse(json({'@type':'ContactPoint',telephone:'+233201234567'})).candidates[0].assignment,'manual_review');
});
test('explicit tel, WhatsApp and reservation links remain evidence only with no inferred consent or guessed links',()=>{
 const result=parse('<a href="tel:+233201234567">Call</a><a href="https://wa.me/233201234567?text=Hello">WhatsApp</a><a href="https://booking.example/table">Reservations</a><a href="mailto:a@example.com">Reserve</a><a href="javascript:alert(1)">Reserve</a><a href="https://user:password@evil.example">Reserve</a><a href="http://127.0.0.1/reserve">Reserve</a><a href="/contact">Contact</a><a href="/contact2">Contact</a><a href="https://outside.example/contact">Contact</a><a href="/contact.pdf">Contact</a>');
 assert.deepEqual(result.candidates.map(c=>c.kind),['phone','whatsapp','booking']);assert.ok(result.candidates.every(c=>c.assignment==='manual_review'));assert.match(result.candidates[1].basis,/no consent inferred/);assert.deepEqual(result.contactLinks,[source+'contact']);
 assert.equal(parse('<a href="tel:+233201234567;ext=8">Call</a><a href="tel:%zz">Call</a><a href="https://wa.me/abc">WhatsApp</a><form action="/booking"><input name="phone"></form>').candidates.length,0);
});
test('adversarial structured markup is bounded and invalid schemas are ignored',()=>{
 assert.equal(parse('<script type="application/ld+json">broken</script>'+json({'@type':'Person',telephone:'+233201234567'})).candidates.length,0);
 assert.equal(parse(json(Array.from({length:200},(_,i)=>({...business,telephone:`+23320123${String(i).padStart(4,'0')}`})))).candidates.length,30);
 let node=business;for(let i=0;i<25;i++)node={nested:node};assert.equal(parse(json(node)).candidates.length,0);
});
test('contact service follows at most one explicit same-origin page, coalesces and caches all outcomes',async()=>{
 let calls=0,clock=0;const service=createContactEvidence({places:{details:async()=>place},now:()=>clock,readPage:async(url,options)=>{calls++;assert.equal(options.allowedOrigin,new URL(source).origin);assert.ok(options.signal);return {url,html:url===source?'<a href="/contact">Contact</a><a href="/other">Contact</a>':json(business)+'<a href="/next">Contact</a>'};}});
 const [a,b]=await Promise.all([service.get(id),service.get(id)]);assert.equal(calls,2);assert.deepEqual(a,b);assert.equal(a.status,'match');assert.equal(a.pages.length,2);assert.equal(a.whatsappOptIn,false);assert.equal(a.ownershipVerified,false);assert.equal(a.reachabilityVerified,false);assert.equal(a.providerPhone,raw.properties.phone);
 await service.get(id);assert.equal(calls,2);clock=900001;await service.get(id);assert.equal(calls,4);
 let failures=0;const failed=createContactEvidence({places:{details:async()=>place},readPage:async()=>{failures++;throw Error('private failure');}});assert.equal((await failed.get(id)).status,'unavailable');assert.equal((await failed.get(id)).status,'unavailable');assert.equal(failures,1);
});
test('partial page errors keep evidence and explicit unavailable page, multi-venue second page removes assignments',async()=>{
 const service=createContactEvidence({places:{details:async()=>place},readPage:async url=>{if(url!==source)throw Error('not allowed');return {url,html:json(business)+'<a href="/contact">Contact</a>'};}});const result=await service.get(id);assert.equal(result.status,'match');assert.equal(result.pages[1].status,'unavailable');
 const multiple=createContactEvidence({places:{details:async()=>place},readPage:async url=>({url,html:url===source?json(business)+'<a href="/contact">Contact</a>':json([business,{...business,name:'Other'}])})});assert.equal((await multiple.get(id)).status,'manual_review');
});
test('only exact entity-bound provider website is fetched, never legacy or caller URL or communication channel',async()=>{
 let calls=0;const reader=async()=>{calls++;throw Error('should not fetch');};
 for(const p of [{...place,entityId:other},{...place,contact:undefined},{...place,contact:{...place.contact,website:{...place.contact.website,source:{...place.contact.website.source,entityId:other}}}},{...place,contact:{...place.contact,website:{...place.contact.website,url:'https://wa.me/233201234567'}}}])assert.equal((await createContactEvidence({places:{details:async()=>p},readPage:reader}).get(id)).status,'unavailable');
 assert.equal(calls,0);await assert.rejects(createContactEvidence({places:{details:async()=>{throw Error('must not resolve');}},readPage:reader}).get(source));
 const missing=shapePlace({...raw,properties:{}},'qloo',new Date().toISOString());assert.equal((await createContactEvidence({places:{details:async()=>missing},readPage:reader}).get(id)).status,'missing');
});
test('contact reader shares DNS pinning and blocks all cross-origin redirects before following',async()=>{
 let calls=0;
 const request=(url,options,callback)=>{calls++;options.lookup(url.hostname,{},(_,address)=>assert.equal(address,'8.8.8.8'));assert.equal(options.headers.cookie,undefined);assert.equal(options.headers.authorization,undefined);const req=new EventEmitter();req.end=()=>{const res=Readable.from([]);res.statusCode=302;res.headers={location:'https://external.example/contact'};callback(res);};return req;};
 await assert.rejects(readMenuPage(source,{allowedOrigin:new URL(source).origin,resolve:async()=>[{address:'8.8.8.8',family:4}],request}),/Cross-origin/);assert.equal(calls,1);
 await assert.rejects(readMenuPage(source,{resolve:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}],request}),/Non-public/);assert.equal(calls,1);
});
test('contact service bounds concurrent page reads',async()=>{
 const releases=[];const service=createContactEvidence({places:{details:async entityId=>shapePlace({...raw,entity_id:entityId},'qloo',new Date(0).toISOString())},readPage:url=>new Promise(resolve=>releases.push(()=>resolve({url,html:''})))});
 const ids=Array.from({length:5},(_,i)=>id.slice(0,-1)+i),pending=ids.slice(0,4).map(i=>service.get(i));await new Promise(resolve=>setImmediate(resolve));assert.equal(releases.length,4);assert.equal((await service.get(ids[4])).status,'unavailable');releases.forEach(r=>r());await Promise.all(pending);
});
test('endpoint is read-only, rejects URL/query input and mismatched provider identity, rate limit spans entities',async t=>{
 let reads=0,providerCalls=0;const app=createApp({provider:{name:'qloo',getPlace:async entityId=>{providerCalls++;return {...raw,entity_id:entityId===other?id:entityId};}},contactEvidenceReader:async url=>{reads++;return {url,html:json(business)};}});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const get=path=>new Promise((resolve,reject)=>{http.get(`http://127.0.0.1:${server.address().port}${path}`,res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body),headers:res.headers}));}).on('error',reject);});
 const base=`/api/places/${id}/contact-evidence`;
 const head=await new Promise((resolve,reject)=>{const req=http.request(`http://127.0.0.1:${server.address().port}${base}`,{method:'HEAD'},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});assert.equal(head,405);assert.equal(providerCalls,0);
 assert.equal((await get(base+'?url=https://evil.example')).status,400);assert.equal(providerCalls,0);
 assert.equal((await get('/api/places/'+encodeURIComponent(source)+'/contact-evidence')).status,400);assert.equal(providerCalls,0);
 assert.equal((await get(`/api/places/${other}/contact-evidence`)).status,400);assert.equal(reads,0);
 const result=await get(base);assert.equal(result.status,200);assert.equal(result.body.status,'match');assert.equal(result.headers['cache-control'],'no-store');
 for(let i=0;i<4;i++)assert.equal((await get(base)).status,200);assert.equal(reads,1);
 assert.equal((await get(`/api/places/${other}/contact-evidence`)).status,429);
});
test('public reader enforces HTML success, body size and shared abort without exposing response contents',async()=>{
 const resolve=async()=>[{address:'8.8.8.8',family:4}];
 function response(statusCode,headers,chunks){return (_url,options,callback)=>{const req=new EventEmitter();req.destroy=error=>req.emit('error',error);req.end=()=>{const res=Readable.from(chunks);res.statusCode=statusCode;res.headers=headers;callback(res);};return req;};}
 await assert.rejects(readMenuPage(source,{resolve,request:response(403,{'content-type':'text/html'},[Buffer.from('private error')])}),/No readable/);
 await assert.rejects(readMenuPage(source,{resolve,request:response(200,{'content-type':'application/pdf'},[])}),/No readable/);
 await assert.rejects(readMenuPage(source,{resolve,request:response(200,{'content-type':'text/html'},[Buffer.alloc(500001)])}),/too large/);
 const controller=new AbortController();const pending=readMenuPage(source,{resolve:()=>new Promise(()=>{}),signal:controller.signal});controller.abort();await assert.rejects(pending,/timeout/);
});

test('different single-venue branches across the checked pages downgrade all assignment',async()=>{
 const service=createContactEvidence({places:{details:async()=>place},readPage:async url=>({url,html:url===source?json(business)+'<a href="/contact">Contact</a>':json({...business,address:'2 Main St, Accra',telephone:'+233201234568'})})});
 const result=await service.get(id);assert.equal(result.status,'manual_review');assert.ok(result.candidates.every(c=>c.assignment==='manual_review'&&c.identityCue===null));
});
