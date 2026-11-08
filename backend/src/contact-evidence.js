import {load} from 'cheerio';
import {parse as parseDomain} from 'tldts';
import {menuUrl,readMenuPage} from './menu-evidence.js';
import {phoneFormat,safeContactWebsite} from '../../shared/venue-contact.js';
import {locationId} from './locations.js';

const list=v=>Array.isArray(v)?v:v?[v]:[];
const clean=v=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,200):'';
const normalized=v=>clean(v).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const types=node=>list(node?.['@type']).map(t=>typeof t==='string'?t.replace(/^https?:\/\/schema.org\//,''):'');
const business=node=>types(node).some(t=>['LocalBusiness','Restaurant','CafeOrCoffeeShop','BarOrPub','FoodEstablishment','Hotel'].includes(t));
const communicationHost=host=>/(^|\.)(wa\.me|whatsapp\.com|api\.whatsapp\.com|t\.me|telegram\.me|m\.me|messenger\.com)$/.test(host);
function pageUrl(value){const safe=safeContactWebsite(value);if(!safe)throw Error('Unsupported website');const url=menuUrl(safe);if(communicationHost(url.hostname))throw Error('Not a website page');return url;}
// A provider-bound website may explicitly redirect between its apex and www alias.
// Public AND private suffixes matter: never treat hosted tenants as domain aliases.
export function canonicalContactRedirect(from,to){
 try{from=pageUrl(from.href||from);to=pageUrl(to.href||to);}catch{return false;}
 if(from.port||to.port||from.protocol==='https:'&&to.protocol!=='https:')return false;
 if(from.hostname===to.hostname)return true;
 const apex=from.hostname.startsWith('www.')?from.hostname.slice(4):from.hostname;
 const domain=parseDomain(apex,{allowPrivateDomains:true});
 return domain.isIcann&&!domain.isPrivate&&domain.domain===apex&&
  ((from.hostname===apex&&to.hostname===`www.${apex}`)||(from.hostname===`www.${apex}`&&to.hostname===apex));
}
function comparison(value,provider){
 const a=phoneFormat(value),b=phoneFormat(provider);
 if(!b.display)return 'website_only';
 if(a.format==='international'&&b.format==='international')return a.dialUrl===b.dialUrl?'match':'conflict';
 // Country context and number ownership cannot be inferred from a matching suffix.
 return 'not_comparable';
}
function addressText(address){
 if(typeof address==='string')return address;
 if(!address||Array.isArray(address)||typeof address!=='object')return '';
 return ['streetAddress','addressLocality','addressRegion','postalCode','addressCountry'].map(k=>typeof address[k]==='string'?address[k]:'').filter(Boolean).join(', ');
}
// Only literal links and bounded structured data are evidence. Prose numbers are ignored.
export function extractContactEvidence(html,sourceUrl,place){
 const $=load(html),nodes=[],candidates=[],seen=new Set();let visited=0;
 function walk(node,parent=null,depth=0){
  if(!node||typeof node!=='object'||depth>15||visited++>=2000)return;
  if(Array.isArray(node)){for(const child of node)walk(child,parent,depth+1);return;}
  const owner=business(node)?node:parent;
  if(business(node)||types(node).includes('ContactPoint'))nodes.push({node,owner});
  for(const value of Object.values(node))if(value&&typeof value==='object')walk(value,owner,depth+1);
 }
 $('script[type="application/ld+json"]').slice(0,20).each((_,el)=>{try{walk(JSON.parse($(el).text()));}catch{/* Malformed markup is not evidence. */}});
 const businesses=[...new Set(nodes.filter(({node})=>business(node)).map(({node})=>node))];
 // Even same-name chain branches remain manual review on a multi-venue document.
 const identity=owner=>businesses.length===1&&owner===businesses[0]&&normalized(owner.name)&&normalized(owner.name)===normalized(place.name)&&normalized(place.address)&&normalized(addressText(owner.address))===normalized(place.address);
 function add(kind,value,url,basis,owner=null){
  if(candidates.length>=30)return;
  const parsed=kind==='phone'?phoneFormat(value):null;
  if(parsed&&!['international','local_only'].includes(parsed.format))return;
  const display=parsed?.display||clean(value);if(!display)return;
  const assigned=identity(owner),key=`${kind}:${display}:${assigned}`;if(seen.has(key))return;seen.add(key);
  candidates.push({kind,value:display,url,sourceUrl,assignment:assigned?'venue':'manual_review',identityCue:assigned?`${clean(owner.name)} · ${clean(addressText(owner.address))}`:null,comparison:kind==='phone'?comparison(display,place.contact?.phone?.display):'not_comparable',basis});
 }
 for(const {node,owner} of nodes)for(const telephone of list(node.telephone))if(typeof telephone==='string')add('phone',telephone,null,'published structured telephone',owner);
 const contactLinks=[];
 $('a[href]').slice(0,500).each((_,el)=>{
  const raw=$(el).attr('href'),label=clean($(el).text());if(!raw||raw.length>2048)return;
  if(/^tel:/i.test(raw)){try{add('phone',decodeURIComponent(raw.slice(4)),null,'published telephone link');}catch{/* Invalid URI. */}return;}
  let url;try{url=new URL(raw,sourceUrl);}catch{return;}
  if(!safeContactWebsite(url.href))return;
  if(['wa.me','api.whatsapp.com','www.whatsapp.com','whatsapp.com'].includes(url.hostname)){
   const digits=url.hostname==='wa.me'?url.pathname.slice(1):url.pathname==='/send'?url.searchParams.get('phone'):null;
   if(digits&&/^\+?[1-9][0-9]{7,14}$/.test(digits))add('whatsapp',digits,url.href,'published WhatsApp link; no consent inferred');
   return;
  }
  if(communicationHost(url.hostname))return;
  try{pageUrl(url.href);}catch{return;}
  if(/\b(book(?:ing)?|reserv(?:e|ation|ations))\b/i.test(label))add('booking',label,url.href,'published booking link; availability and API access unknown');
  if(contactLinks.length===0&&url.origin===new URL(sourceUrl).origin&&url.href!==sourceUrl&&/\b(contact|reservations?)\b/i.test(label)&&!url.hash&&!/\.(?:pdf|jpg|png|zip)(?:\?|$)/i.test(url.href))contactLinks.push(url.href);
 });
 return {candidates,contactLinks,multiVenue:businesses.length>1,identityKeys:businesses.map(node=>JSON.stringify([normalized(node.name),normalized(addressText(node.address))]))};
}
function summarize(candidates){
 const assigned=candidates.filter(c=>c.assignment==='venue'&&c.kind==='phone');
 if(assigned.some(c=>c.comparison==='conflict'))return 'conflict';
 if(assigned.some(c=>c.comparison==='match'))return 'match';
 if(assigned.some(c=>c.comparison==='website_only'))return 'website_only';
 return candidates.length?'manual_review':'missing';
}
export function createContactEvidence({places,readPage=readMenuPage,now=Date.now}){
 const cache=new Map();let active=0;
 return {async get(entityId){
  const id=locationId(entityId);
  const place=await places.details(id);
  const source=place.contact?.website;
  // Only identity-bound provider fields, never caller URLs or legacy saved links.
  const bound=place.entityId?.toUpperCase()===id&&source?.source?.entityId?.toUpperCase()===id&&source.source.field==='properties.website';
  const sourceUrl=bound?source.url:null;
  const base={entityId:id,sourceUrl,providerSourceUrl:sourceUrl,checkedAt:new Date(now()).toISOString(),providerPhone:place.contact?.phone?.source?.entityId?.toUpperCase()===id?place.contact.phone.display:null,candidates:[],pages:[],ownershipVerified:false,reachabilityVerified:false,whatsappOptIn:false};
  if(!bound)return {...base,status:'unavailable'};
  if(!sourceUrl)return {...base,status:'missing'};
  const key=JSON.stringify([id,sourceUrl,base.providerPhone,place.name,place.address]),hit=cache.get(key);
  if(hit&&now()-hit.at<900000)return hit.value;
  if(active>=4)return {...base,status:'unavailable'};
  active++;
  const value=(async()=>{
   try{
    const initial=pageUrl(sourceUrl),signal=AbortSignal.timeout(15000);
    if(initial.port)throw Error('Unsupported website port');
    const page=await readPage(sourceUrl,{validateRedirect:canonicalContactRedirect,signal});
    if(!canonicalContactRedirect(initial,pageUrl(page.url)))throw Error('Unsupported canonical page');
    const origin=pageUrl(page.url).origin;
    const parsed=extractContactEvidence(page.html,page.url,place),pages=[{url:page.url,status:'read',checkedUrls:page.checkedUrls||[page.url]}];let candidates=parsed.candidates;
    if(parsed.contactLinks.length){
     const link=parsed.contactLinks[0];
     try{const next=await readPage(link,{allowedOrigin:origin,signal});if(pageUrl(next.url).origin!==origin)throw Error('Cross-origin page');const more=extractContactEvidence(next.html,next.url,place);pages.push({url:next.url,status:'read',checkedUrls:next.checkedUrls||[next.url]});candidates=[...candidates,...more.candidates].slice(0,60);if(parsed.multiVenue||more.multiVenue||new Set([...parsed.identityKeys,...more.identityKeys]).size>1)candidates=candidates.map(c=>({...c,assignment:'manual_review',identityCue:null}));}
     catch(error){pages.push({url:link,status:'unavailable',checkedUrls:error.checkedUrls||[]});}
    }
    return {...base,sourceUrl:page.url,candidates,pages,status:summarize(candidates)};
   }catch(error){return {...base,status:'unavailable',pages:error.checkedUrls?.length?[{url:sourceUrl,status:'unavailable',checkedUrls:error.checkedUrls}]:[]};}
  })().finally(()=>{active--;});
  if(cache.size>=256)cache.delete(cache.keys().next().value);
  // Failures are cached too: repeatedly clicking cannot hammer a broken provider page.
  cache.set(key,{at:now(),value});return value;
 }};
}
