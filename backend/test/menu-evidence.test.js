import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import {EventEmitter} from 'node:events';
import {extractMenuPrices,createMenuEvidence,menuUrl,publicAddress,readMenuPage} from '../src/menu-evidence.js';
const html=value=>`<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const dish={ '@type':'MenuItem',name:'Jollof rice',offers:{price:'55.50',priceCurrency:'GHS'}};
test('prices require menu-item evidence, an explicit currency and a finite amount',()=>{
 const p=extractMenuPrices(html({'@type':'Menu',hasMenuItem:[dish,dish,{'@type':'Product',name:'T-shirt',offers:{price:10,priceCurrency:'GHS'}},{...dish,name:'Unknown currency',offers:{price:40}},{...dish,name:'Expired',offers:{price:40,priceCurrency:'GHS',priceValidUntil:'2020-01-01'}}]}),'https://venue.example/menu');
 assert.equal(p.items.length,1);assert.equal(p.items[0].price,55.5);assert.equal(p.items[0].currency,'GHS');assert.equal(p.items[0].availabilityVerified,false);assert.equal(p.items[0].sourceUrl,'https://venue.example/menu');
 assert.deepEqual(extractMenuPrices('<p>Rice 40, phone 12345</p>','https://venue.example').items,[]);
});
test('HTML menu microdata is read without treating arbitrary numeric text as prices',()=>{
 const p=extractMenuPrices('<div itemscope itemtype="https://schema.org/MenuItem"><span itemprop="name">Soup</span><meta itemprop="price" content="12.25"><meta itemprop="priceCurrency" content="GBP"></div>','https://venue.example');assert.equal(p.items[0].price,12.25);
});
test('menu links stay on the supplied site and do not become an unrestricted crawler',()=>{
 const p=extractMenuPrices('<a href="/menu">Menu</a><a href="http://localhost/menu">Menu</a><a href="https://elsewhere.example/menu">Menu</a><a href="/menu.pdf">Menu</a>','https://venue.example');assert.deepEqual(p.menuLinks,['https://venue.example/menu']);
});
test('private, metadata, loopback, credential and unsupported protocol addresses are refused',()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.2','::1','::ffff:127.0.0.1','fd00::1'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);
 for(const url of ['file:///etc/passwd','http://127.1','http://2130706433','http://localhost','http://[::1]','https://user:secret@venue.example','https://venue.example:8443/menu'])assert.throws(()=>menuUrl(url));
});
test('DNS resolution is pinned and a redirect to a private address is blocked before a second request',async()=>{
 let requests=0;
 const request=(_url,opts,callback)=>{requests++;opts.lookup('venue.example',{},(e,address)=>assert.equal(address,'8.8.8.8'));const req=new EventEmitter();req.end=()=>{const res=Readable.from([]);res.statusCode=302;res.headers={location:'http://127.0.0.1/admin'};callback(res);};return req;};
 await assert.rejects(readMenuPage('https://venue.example',{resolve:async()=>[{address:'8.8.8.8',family:4}],request}));assert.equal(requests,1);
 await assert.rejects(readMenuPage('https://venue.example',{resolve:async()=>[{address:'10.0.0.1',family:4}],request}));assert.equal(requests,1);
});
test('venue source retrieval is cached, follows only one menu and preserves failure states',async()=>{
 let calls=0;const places={details:async()=>({links:{website:'https://venue.example'}})};
 const menus=createMenuEvidence({places,readPage:async url=>{calls++;return {url,html:url.endsWith('/menu')?html(dish):'<a href="/menu">Menu</a>'};}});
 const [a,b]=await Promise.all([menus.get('id'),menus.get('id')]);assert.equal(calls,2);assert.equal(a.status,'published_prices');assert.deepEqual(a,b);
 const failure=createMenuEvidence({places,readPage:async()=>{throw Error('private error');}});assert.equal((await failure.get('id')).status,'unavailable');
 const missing=createMenuEvidence({places:{details:async()=>({links:{}})}});assert.equal((await missing.get('id')).status,'no_source');
});
