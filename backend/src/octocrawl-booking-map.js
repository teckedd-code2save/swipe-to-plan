import {lookup} from 'node:dns/promises';
import {menuUrl,publicAddress} from './menu-evidence.js';

const endpoint='https://api.octocrawl.dev/v1/map';
const route=/(?:^|[\/_-])(?:reserv(?:e|ation|ations)|book(?:ing|-a-table)?|table-booking)(?:$|[\/_-])/i;
const maxBytes=128000;
export function publishedBookingOrigin(place,id) {
 const site=place?.contact?.website;
 if(site?.source?.entityId?.toUpperCase()!==id||site.source.field!=='properties.website')return null;
 try{const url=menuUrl(site.url);return url.protocol==='https:'&&url.port===''?url.origin+'/':null;}catch{return null;}
}

export function createOctocrawlBookingMap({fetchImpl=fetch,resolve=lookup,now=Date.now}={}) {
 const memo=new Map(), pending=new Map();
 let day=-1,calls=0;
 async function map(origin,signal) {
  const timeout=AbortSignal.timeout(4800),abort=signal?AbortSignal.any([timeout,signal]):timeout;
  const url=menuUrl(origin);
  const addresses=await resolve(url.hostname.replace(/^\[|\]$/g,''),{all:true,signal:abort});
  abort.throwIfAborted();
  if(!addresses.length||addresses.some(row=>!publicAddress(row.address)))return [];
  const utcDay=Math.floor(now()/86400000);
  if(day!==utcDay){day=utcDay;calls=0;}
  if(calls>=12)return [];
  calls++;
  const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:abort,headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify({url:origin,limit:24,timeout:3500})});
  if(!response.ok||Number(response.headers.get('content-length'))>maxBytes||!response.body)return [];
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)return [];chunks.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{});}
  abort.throwIfAborted();
  const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(result.status!=='completed'||!Array.isArray(result.links)||menuUrl(result.url).href!==origin
   ||menuUrl(result.sources?.startPage?.finalUrl).origin!==url.origin||result.sources?.startPage?.status!=='success')return [];
  const seen=new Set(),rows=[];
  for(const entry of result.links.slice(0,24)){
   try{
    const link=menuUrl(entry.url);
    if(link.origin!==url.origin||link.search||!route.test(link.pathname)||entry.robots==='disallowed')continue;
    link.hash='';if(seen.has(link.href))continue;seen.add(link.href);
    rows.push({url:link.href,title:typeof entry.title==='string'&&entry.title.trim()?entry.title:'Booking page on the listed venue site',
     description:'Octocrawl found this link on the listed venue site. Review it before continuing.',source:'octocrawl'});
    if(rows.length===4)break;
   }catch{/* invalid or non-public URL */}
  }
  return rows;
 }
 return {enabled:true,find(place,id,{signal}={}){
  const origin=publishedBookingOrigin(place,id);
  if(!origin||signal?.aborted)return Promise.resolve([]);
  const key=id+' '+origin, hit=memo.get(key);
  if(hit&&hit.until>now())return Promise.resolve(hit.rows);
  if(pending.has(key))return pending.get(key);
  if(pending.size>=2)return Promise.resolve([]);
  // Bound even a DNS lookup that does not support AbortSignal on this Node version.
  let timer;
  const deadline=new Promise(resolve=>{timer=setTimeout(()=>resolve([]),5000);timer.unref?.();});
  const work=Promise.race([map(origin,signal).catch(()=>[]),deadline]).then(rows=>{
   if(!signal?.aborted){memo.set(key,{rows,until:now()+(rows.length?60:15)*60000});while(memo.size>200)memo.delete(memo.keys().next().value);}
   return rows;
  }).finally(()=>{clearTimeout(timer);pending.delete(key);});
  pending.set(key,work);return work;
 }};
}

export function configuredOctocrawlBookingMap(env=process.env) {
 return env.OCTOCRAWL_BOOKING_ENABLED==='false'?null:createOctocrawlBookingMap();
}
