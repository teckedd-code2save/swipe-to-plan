import {load} from 'cheerio';
import ipaddr from 'ipaddr.js';
import {lookup} from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';

export function publicAddress(value){
 try {let address=ipaddr.parse(value);if(address.kind()==='ipv6'&&address.isIPv4MappedAddress())address=address.toIPv4Address();return address.range()==='unicast';}catch{return false;}
}
export function menuUrl(value){
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||(url.port&&!['80','443'].includes(url.port)))throw Error('Unsupported menu address');
 const host=url.hostname.replace(/^\[|\]$/g,'');
 if(host==='localhost'||!host.includes('.')&&!host.includes(':')||ipaddr.isValid(host)&&!publicAddress(host))throw Error('Non-public menu address');
 return url;
}
// Resolve and pin a public address for each redirect. No browser session, cookies or credentials.
export async function readMenuPage(value,{resolve=lookup,request}={}){
 let url=menuUrl(value);const signal=AbortSignal.timeout(10000);
 for(let redirects=0;redirects<3;redirects++){
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  const addresses=await Promise.race([resolve(hostname,{all:true}),new Promise((_,reject)=>{if(signal.aborted)reject(Error('Menu timeout'));else signal.addEventListener('abort',()=>reject(Error('Menu timeout')),{once:true});})]);
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('Non-public menu destination');
  const pinned=addresses[0];
  const result=await new Promise((resolve,reject)=>{
   const get=request||(url.protocol==='https:'?https.request:http.request);
   const req=get(url,{method:'GET',signal,agent:false,lookup:(_host,options,callback)=>options?.all?callback(null,[pinned]):callback(null,pinned.address,pinned.family),headers:{accept:'text/html,application/xhtml+xml','accept-encoding':'identity','user-agent':'UnstressedMenu/1.0 (+https://unstressed.serendepify.com)'}},res=>{
    const location=res.headers.location;
    if(res.statusCode>=300&&res.statusCode<400&&location){res.resume();resolve({redirect:location});return;}
    if(res.statusCode!==200||!/^(text\/html|application\/xhtml\+xml)/i.test(res.headers['content-type']||'')){res.resume();reject(Error('No readable web menu'));return;}
    let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>500000){req.destroy(Error('Menu page too large'));return;}chunks.push(chunk);});res.on('end',()=>resolve({html:Buffer.concat(chunks).toString('utf8'),url:url.href}));res.on('error',reject);
   });req.on('error',reject);req.end();
  });
  if(!result.redirect)return result;
  url=menuUrl(new URL(result.redirect,url).href);
 }
 throw Error('Too many menu redirects');
}
const list=value=>Array.isArray(value)?value:value?[value]:[];
const currencies=new Set(Intl.supportedValuesOf('currency'));
const clean=(s,max=120)=>typeof s==='string'?s.replace(/\s+/g,' ').trim().slice(0,max):'';
const type=(obj,name)=>list(obj?.['@type']).some(t=>typeof t==='string'&&t.replace(/^https?:\/\/schema.org\//,'')===name);
export function extractMenuPrices(html,sourceUrl,now=Date.now()){
 const $=load(html),found=[],seen=new Set();let count=0;
 function item(name,offer){
  const label=clean(name),raw=offer?.price??offer?.priceSpecification?.price,currency=offer?.priceCurrency??offer?.priceSpecification?.priceCurrency;
  if(!label||!(typeof raw==='number'||typeof raw==='string'&&/^\d+(?:\.\d{1,2})?$/.test(raw.trim()))||!Number.isFinite(Number(raw))||Number(raw)<=0||Number(raw)>1000000||typeof currency!=='string'||!currencies.has(currency))return;
  const expiry=offer.priceValidUntil||offer.availabilityEnds;
  if(expiry&&(!Number.isFinite(Date.parse(expiry))||Date.parse(expiry)<now))return;
  const key=`${label.toLowerCase()}|${currency}|${Number(raw)}`;
  if(seen.has(key)||found.length>=40)return;seen.add(key);found.push({id:`menu-${found.length+1}`,name:label,price:Number(raw),currency,sourceUrl,basis:'published menu markup',availabilityVerified:false});
 }
 function walk(node,depth=0){
  if(!node||typeof node!=='object'||depth>20||count++>4000)return;
  if(type(node,'MenuItem'))for(const offer of list(node.offers))item(node.name,offer);
  for(const child of Object.values(node))if(typeof child==='object')Array.isArray(child)?child.forEach(n=>walk(n,depth+1)):walk(child,depth+1);
 }
 $('script[type="application/ld+json"]').slice(0,30).each((_,el)=>{try{walk(JSON.parse($(el).text()));}catch{/* Malformed structured data supplies no evidence. */}});
 $('[itemscope][itemtype$="/MenuItem"]').slice(0,40).each((_,el)=>{const root=$(el),value=prop=>{const n=root.find(`[itemprop="${prop}"]`).first();return n.attr('content')||n.text();};item(value('name'),{price:value('price'),priceCurrency:value('priceCurrency')});});
 const menuLinks=[];
 $('a[href]').each((_,el)=>{if(menuLinks.length>=3)return;const name=clean($(el).text()).toLowerCase();if(!/\b(menu|menus)\b/.test(name))return;try{const target=menuUrl(new URL($(el).attr('href'),sourceUrl).href);if(target.origin===new URL(sourceUrl).origin&&!/\.pdf(?:\?|$)/i.test(target.href)&&target.href!==sourceUrl&&!menuLinks.includes(target.href))menuLinks.push(target.href);}catch{/* Not a public menu link. */}});
 return {items:found,menuLinks};
}
export function createMenuEvidence({places,readPage=readMenuPage,now=Date.now}){
 const cache=new Map();let active=0;
 return {async get(entityId){
  const place=await places.details(entityId),source=place.links?.menu||place.links?.website;
  if(!source)return {status:'no_source',items:[],checkedAt:new Date(now()).toISOString()};
  const key=`${entityId}:${source}`,hit=cache.get(key);if(hit&&now()-hit.at<900000)return hit.value;
  if(active>=6)return {status:'unavailable',items:[],sourceUrl:source,checkedAt:new Date(now()).toISOString()};
  active++;
  const value=(async()=>{
   const base={items:[],sourceUrl:source,checkedAt:new Date(now()).toISOString(),availabilityVerified:false};
   try{
    const page=await readPage(source),parsed=extractMenuPrices(page.html,page.url,now());
    if(parsed.items.length)return {...base,status:'published_prices',sourceUrl:page.url,items:parsed.items};
    // Follow one same-site menu link, not an unrestricted crawl.
    if(parsed.menuLinks.length){try{const menu=await readPage(parsed.menuLinks[0]),prices=extractMenuPrices(menu.html,menu.url,now());if(prices.items.length)return {...base,status:'published_prices',sourceUrl:menu.url,items:prices.items};}catch{/* Keep the source link when the menu is not readable. */}}
    return {...base,status:'no_prices',sourceUrl:page.url};
   }catch{return {...base,status:'unavailable'};}
  })().finally(()=>{active--;}).then(result=>{if(result.status==='unavailable')cache.delete(key);return result;});if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(key,{at:now(),value});return value;
 }};
}
