import {randomUUID} from 'node:crypto';
import {load} from 'cheerio';
import {menuUrl} from './menu-evidence.js';
import {locationId} from './locations.js';
import {createBookingRouteResolver} from './booking-route-resolver.js';
import {configuredContextFetchBookingSearch} from './contextfetch-booking-search.js';
const ttl=180000;
const clean=(value,max)=>typeof value==='string'?load(value.slice(0,10000)).text().replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
function failure(code){const error=new Error(code);error.code=code;return error;}
function strict(body,keys){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!keys.includes(key)))throw failure('search_failed');}
export function createBraveSearch({apiKey=process.env.BRAVE_SEARCH_API_KEY,...options}={}){return createProviderSearch({provider:'brave',apiKey,...options});}
export function createSerperSearch({apiKey=process.env.SERPER_API_KEY,...options}={}){return createProviderSearch({provider:'serper',apiKey,...options});}
export function configuredWebsiteSearch(env=process.env){
 if(env.SERPER_SEARCH_ENABLED==='true')return createSerperSearch({apiKey:env.SERPER_API_KEY});
 if(env.BRAVE_SEARCH_ENABLED==='true')return createBraveSearch({apiKey:env.BRAVE_SEARCH_API_KEY});
 return null;
}
function createProviderSearch({provider,apiKey,fetchImpl=fetch}){
 return {provider,enabled:Boolean(apiKey),async search(query,{signal}={}){
  if(!apiKey)throw failure('search_unavailable');
  if(signal?.aborted)throw failure('expired');
  const timeout=AbortSignal.timeout(10000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
  try{
   let url,request;
   if(provider==='serper'){
    url=new URL('https://google.serper.dev/search');
    request={method:'POST',headers:{accept:'application/json','content-type':'application/json','X-API-KEY':apiKey},body:JSON.stringify({q:query,num:10})};
   }else{
    url=new URL('https://api.search.brave.com/res/v1/web/search');url.searchParams.set('q',query);url.searchParams.set('count','10');url.searchParams.set('text_decorations','false');url.searchParams.set('safesearch','moderate');
    request={headers:{accept:'application/json','X-Subscription-Token':apiKey}};
   }
   const response=await fetchImpl(url,{...request,signal:combined,redirect:'error'});
   if(response.status===429)throw failure('search_rate_limited');
   if(!response.ok)throw failure(response.status===401||response.status===403?'search_unavailable':'search_failed');
   if(Number(response.headers?.get('content-length'))>500000)throw failure('search_failed');
   // Bound response memory; never retain raw response/search results beyond this call.
   let data;
   if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>500000)throw failure('search_failed');chunks.push(Buffer.from(value));}data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}finally{await reader.cancel().catch(()=>{});}}
   else data=await response.json();
   if(provider==='serper')return Array.isArray(data?.organic)?data.organic.slice(0,10).map(item=>({title:item.title,url:item.link,description:item.snippet})):[];
   return Array.isArray(data?.web?.results)?data.web.results.slice(0,10):[];
  }catch(error){if(signal?.aborted)throw failure('expired');if(timeout.aborted||error?.name==='TimeoutError')throw failure('search_timeout');if(['search_rate_limited','search_unavailable','search_failed'].includes(error?.code))throw error;throw failure('search_failed');}
 }};
}
// Search API results remain transient. No venue-ownership claim is made: a person
// reviews the original title/URL/snippet and explicitly selects a destination.
export function createBookingWebsiteSearch({places,registerDestination,search,contextfetch=null,now=Date.now,routeResolver=createBookingRouteResolver({now}),ErrorType=Error}){
 const candidates=new Map();let timer;
 function prune(){for(const [id,item]of candidates)if(item.expires<=now())candidates.delete(id);if(!candidates.size){clearInterval(timer);timer=undefined;}}
 function typed(error){return new ErrorType(['search_unavailable','search_rate_limited','search_timeout','search_failed','expired'].includes(error?.code)?error.code:'search_failed');}
 return {enabled:Boolean(contextfetch?.enabled||search?.enabled),async rememberInspected(entityId,url){
  try {const id=locationId(entityId),place=await places.details(id);return place?.entityId?.toUpperCase()===id && routeResolver.remember(id,place,url);}catch{return false;}
 },async find(entityId,body,options={}){
  strict(body,[]);const selected=contextfetch?.enabled?contextfetch:search;if(!selected?.enabled)throw new ErrorType('search_unavailable');
  const id=locationId(entityId);let place;try{place=await places.details(id);}catch{throw new ErrorType('provider_unavailable');}
  if(place?.entityId?.toUpperCase()!==id||!place.name||!place.address)throw new ErrorType('provider_unavailable');
  const venueName=clean(place.name,200),venueAddress=clean(place.address,400);if(!venueName||!venueAddress)throw new ErrorType('provider_unavailable');
  let results=routeResolver.reuse(id,place),provider=results.length?'inspection_cache':selected.provider;
  if(!results.length){try{results=await selected.search(`${venueName} ${venueAddress} reservations book a table`.slice(0,650),options);}catch(error){throw typed(error);}}
  if(options.signal?.aborted)throw new ErrorType('expired');prune();const expires=now()+ttl,seen=new Set(),items=[];
  for(const result of routeResolver.rank(results,{name:venueName,address:venueAddress})){
   let url;try{url=menuUrl(result.url);if(url.protocol!=='https:')continue;}catch{continue;}
   url.hash='';if(seen.has(url.href))continue;seen.add(url.href);const title=clean(result.title,200),snippet=clean(result.description,600);if(!title)continue;
   const candidateId=randomUUID();while(candidates.size>=120)candidates.delete(candidates.keys().next().value);candidates.set(candidateId,{entityId:id,url:url.href,expires});items.push({candidateId,title,url:url.href,snippet,score:result.score,evidence:result.evidence});
  }
  if(candidates.size&&!timer){timer=setInterval(prune,30000);timer.unref?.();}
  return {provider,venueName,venueAddress,candidates:items,expiresAt:new Date(expires).toISOString(),submitted:false};
 },async select(entityId,body,options={}){
  strict(body,['candidateId']);prune();const candidate=candidates.get(body.candidateId);
  if(options.signal?.aborted||!candidate||candidate.entityId!==locationId(entityId))throw new ErrorType('expired');
  candidates.delete(body.candidateId);return registerDestination(candidate.entityId,candidate.url);
 }};
}
