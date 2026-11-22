import {resolveReservationHost,reservationGuardFailure,recordReservationGuardFailure} from './reservation-dns.js';
import {createBookingWebsiteSearch,configuredWebsiteSearch} from './booking-website-search.js';
import {configuredContextFetchBookingSearch} from './contextfetch-booking-search.js';
import {createReservationSearch} from './reservation-search.js';
import {inspectWixForms,fillWixForm,installReservationClickGate} from '../../shared/reservation-wix.js';
import {inspectTableagentForms} from '../../shared/reservation-tableagent.js';
import {prepareTableagent,fillTableagent} from './reservation-tableagent.js';
import {startReservationScreencast} from './reservation-stream.js';
import {createHash,randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {menuUrl,publicAddress} from './menu-evidence.js';
import {lookup} from 'node:dns/promises';
import {setTimeout as waitFor} from 'node:timers/promises';
import {canonicalContactRedirect} from './contact-evidence.js';
import {locationId} from './locations.js';

export class ReservationFormError extends Error {
 constructor(code){super(code);this.code=code;}
}
const discoveryMessages={
 search_unavailable:'In-app website search is not configured on this instance. Use your own browser or the venue’s contact options.',
 search_rate_limited:'The search provider has reached its current limit. Try later or use the venue’s contact options.',
 search_timeout:'Website search took too long. Try later.',
 search_failed:'Website search could not return results. Try later or use the venue’s contact options.',
 search_challenge:'The search site is asking this browser to verify it is human. In-app search cannot continue here. Open search in your own browser or use the venue’s contact options. No booking was submitted.',
 search_changed:'The page changed. Refresh the search view and review it before selecting.',
 search_select:'Open and review the venue website before using it for booking.',
 no_website:'No provider-linked website is available for this venue. Use its contact details instead.',
 provider_unavailable:'Venue website details could not be loaded. Try again shortly.',
 visual_unavailable:'This browser could not start a live visual stream. No reservation details were sent. Try again or use the venue website.',
 browser_rate_limited:'The booking browser is busy. Please try again shortly; no reservation details were sent.',
 browser_quota_exceeded:'The booking browser has reached its usage allowance. Use the venue website for now; no reservation details were sent.',
 browser_unavailable:'The booking-form browser is unavailable. Try again shortly; no reservation details were sent.',
 page_unavailable:'The booking browser could not load this website. It may still open in your browser. No reservation details were sent.',
 page_dns_failed:'The booking browser could not resolve this website’s address. Try again later or open the venue website; no reservation details were sent.',
 page_unsafe_destination:'This destination could not be opened safely. No reservation details were sent.',
 page_timeout:'The venue website took too long to load. Try again or open it in your browser. No reservation details were sent.',
 page_connection_failed:'The booking browser could not connect to this website. It may still open in your browser. No reservation details were sent.',
 page_tls_failed:'The booking browser could not verify this website’s secure connection. No reservation details were sent.',
 page_http_error:'The venue website returned an error to the booking browser. Try again later or open it in your browser. No reservation details were sent.',
 destination_changed:'The website redirected to a different destination. Review the venue website manually before continuing.',
 busy:'Booking-form preview is busy. Try again shortly.',
 expired:'This booking link expired. Find the booking form again.'
};
export function reservationDiscoveryFailure(error){
 const code=error instanceof ReservationFormError&&Object.hasOwn(discoveryMessages,error.code)?error.code:'discovery_failed';
 return {code,error:discoveryMessages[code]||'The booking-form check could not finish. Try again or open the venue website. No reservation details were sent.'};
}
export function reservationPageFailure(error){
 const message=String(error?.message||'');
 if(error?.name==='TimeoutError'||/Navigation timeout/i.test(message))return new ReservationFormError('page_timeout');
 if(/net::ERR_(?:CERT_|SSL_|TLS_)/.test(message))return new ReservationFormError('page_tls_failed');
 if(/net::ERR_(?:HTTP2_PROTOCOL_ERROR|CONNECTION_|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|NETWORK_CHANGED|TIMED_OUT)/.test(message))return new ReservationFormError('page_connection_failed');
 return new ReservationFormError('page_unavailable');
}
async function navigateReservation(page,url){
 let response;recordReservationGuardFailure(page,null);
 try{response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});}
 catch(error){const guard=reservationGuardFailure(page);throw guard?new ReservationFormError(guard):reservationPageFailure(error);}
 if(response?.status?.()>=400)throw new ReservationFormError('page_http_error');
}
export function reservationPageUrl(value){
 const url=menuUrl(value);
 // Try the same published address securely. Never fall back to HTTP, bypass
 // certificate checks, or relax private-address validation.
 if(url.protocol==='http:')url.protocol='https:';
 return url.href;
}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function configuredKitesurf(env=process.env){
 const endpoint=env.KITESURF_CDP_URL;
 if(!endpoint||env.RESERVATION_FORM_PREVIEW!=='true')return null;
 let url;try{url=new URL(endpoint);}catch{return null;}
 // Never silently send personal details to the anonymous public playground.
 if(url.protocol!=='wss:'||url.hostname!=='api.cloudflare.com'||!/^\/client\/v4\/accounts\/[a-f0-9]{32}\/browser-run\/devtools\/browser$/.test(url.pathname)||url.searchParams.get('browser')!=='kitesurf'||!env.CLOUDFLARE_BROWSER_TOKEN)return null;
 return {browserWSEndpoint:url.href,headers:{Authorization:`Bearer ${env.CLOUDFLARE_BROWSER_TOKEN}`}};
}
export function semanticField(field){
 const s=`${field.autocomplete||''} ${field.name||''} ${field.label||''}`.toLowerCase();
 if(field.type==='email'||/\bemail\b/.test(s))return 'email';
 if(field.type==='tel'||/phone|telephone|mobile/.test(s))return 'phone';
 if(/first.?name|given.name/.test(s))return 'firstName';
 if(/last.?name|family.name|surname/.test(s))return 'lastName';
 if(/\bname\b/.test(s))return 'name';
 if(field.type==='datetime-local')return 'dateTime';
 if(field.type==='date'||/\bdate\b/.test(s))return 'date';
 if(field.type==='time'||/\btime\b/.test(s))return 'time';
 if(/guests|party|people|persons|covers/.test(s))return 'partySize';
 if(/message|notes|requests|comments/.test(s))return 'message';
 return null;
}
// Runs inside the browser. No selectors or executable text supplied by the venue/user.
export function inspectForms(){
 const inputs='input,select,textarea';
 return [...document.forms].slice(0,12).map((form,index)=>({index,action:form.action,method:form.method,fields:[...form.querySelectorAll(inputs)].map((el,elementIndex)=>({elementIndex,name:el.name,type:el.tagName==='SELECT'?'select':el.tagName==='TEXTAREA'?'textarea':el.type,label:[...(el.labels||[])].map(l=>l.textContent.trim()).join(' ')||el.getAttribute('aria-label')||el.placeholder||el.name,autocomplete:el.autocomplete,required:el.required,disabled:el.disabled,readOnly:el.readOnly===true||el.getAttribute('aria-readonly')==='true',visible:!!(el.getClientRects().length)&&getComputedStyle(el).visibility!=='hidden',options:el.tagName==='SELECT'?[...el.options].slice(0,100).map(o=>({value:o.value,label:o.text})):undefined})).filter(f=>f.visible&&!f.disabled&&!/leave (?:this )?(?:field )?(?:empty|blank)|do not fill/i.test(f.label)&&!['hidden','submit','button','reset','file','password','checkbox','radio','image'].includes(f.type))})).filter(f=>f.fields.length>0&&f.fields.length<=30);
}
export async function connectReservationBrowser(connect,connection,{signal,emit,wait=waitFor}={}){
 for(let attempt=0;attempt<2;attempt++){
  signal?.throwIfAborted();
  try{return await connect({...connection,protocolTimeout:20000});}
  catch(error){
   signal?.throwIfAborted();
   const message=String(error?.message||'');
   const limited=error?.status===429||/(?:response|status|code)[: =]+429\b/i.test(message);
   if(!limited)throw error;
   if(/(?:daily|today|time limit exceeded|quota exceeded)/i.test(message))throw new ReservationFormError('browser_quota_exceeded');
   if(attempt)throw new ReservationFormError('browser_rate_limited');
   // Cloudflare's free plan permits one new browser every 20 seconds.
   // Retry only session creation, never page navigation or form actions.
   emit?.({type:'progress',stage:'waiting',message:'Waiting briefly for a booking browser…'});
   await wait(21000,undefined,{signal});
  }
 }
}
export async function browserSession(config,job){
 const {resolve=lookup,liveView=false,retainReadOnly=false,emit,signal,connect=puppeteer.connect.bind(puppeteer),...connection}=config;
 signal?.throwIfAborted();
 const browser=await connectReservationBrowser(connect,connection,{signal,emit});
 let page,retained=false,stopFrames,releasePromise;
 // These sessions are owned by this operation, not a shared browser pool.
 // Disconnect alone leaves Cloudflare's session alive until its idle timeout.
 const release=()=>releasePromise??=(async()=>{
  try{await stopFrames?.();}catch{}
  try{await page?.close();}catch{}
  try{await browser.close();}catch{
   // An already closed/unsupported engine must still release the transport.
   try{await browser.disconnect();}catch{}
  }
 })();
 const aborted=()=>{release().catch(()=>{});};signal?.addEventListener("abort",aborted,{once:true});
 try{
  signal?.throwIfAborted();
  page=await browser.newPage();
  await page.setViewport({width:1100,height:900});
  await page.setRequestInterception(true);
  await page.evaluateOnNewDocument(()=>{
   // WebSockets and peer connections could outlive the later network freeze.
   Object.defineProperty(window,'open',{value:()=>null,configurable:false,writable:false});
   if(navigator.serviceWorker)Object.defineProperty(navigator.serviceWorker,'register',{value:()=>Promise.reject(Error('Unavailable in reservation preview')),configurable:false,writable:false});
   for(const name of ['WebSocket','WebTransport','RTCPeerConnection','Worker','SharedWorker'])Object.defineProperty(window,name,{value:class{constructor(){throw Error('Unavailable in reservation preview');}},configurable:false,writable:false});
  });
  let frozen=false,availabilityPermit=null;const blocked=[],checked=new Map();
  page.on('request',async req=>{
   const mainNavigation=req.isNavigationRequest?.()&&req.frame?.()===page.mainFrame();
   if(mainNavigation){recordReservationGuardFailure(page,null);try{checked.delete(new URL(req.url()).hostname);}catch{}}
   const safe=(()=>{try{const u=menuUrl(req.url());return u.protocol==='https:';}catch{return false;}})();
   const requestPermit=availabilityPermit;
   const allowedAvailability=!frozen&&req.frame?.()===page.mainFrame()&&requestPermit?.(req)===true;
   if(frozen||(req.method()!=='GET'&&!allowedAvailability)||!safe){if(mainNavigation&&!safe)recordReservationGuardFailure(page,'page_unsafe_destination');blocked.push({method:req.method(),type:req.resourceType()});return req.abort().catch(()=>{});}
   // Reject hostnames resolving to local/link-local/private addresses. The
   // managed browser is fresh and receives no application cookies or secrets.
   try{
    const host=new URL(req.url()).hostname;
    if(!checked.has(host))checked.set(host,resolveReservationHost(host,{resolve,signal}));
    const addresses=await checked.get(host);
    if(frozen||(allowedAvailability&&availabilityPermit!==requestPermit))return req.abort().catch(()=>{});
    if(!addresses.length||addresses.some(a=>!publicAddress(a.address))){if(mainNavigation)recordReservationGuardFailure(page,addresses.length?'page_unsafe_destination':'page_dns_failed');return req.abort().catch(()=>{});}
    return req.continue().catch(()=>{});
   }catch{if(mainNavigation)recordReservationGuardFailure(page,'page_dns_failed');return req.abort().catch(()=>{});}
  });
  if(emit){try{stopFrames=await startReservationScreencast(page,emit);}catch{throw new ReservationFormError("visual_unavailable");}}
  signal?.throwIfAborted();
  // Discovery stays GET-only. Reviewed provider adapters can grant a one-shot
  // exact availability request; booking submission is never permitted.
  const result=await job(page,async()=>{
   frozen=true;
   // Disconnect the engine's network before touching personal fields, not only
   // before the submit button. Unsupported engines fail closed here.
   await page.setOfflineMode(true);
   const gate=await page.evaluateHandle(installReservationClickGate);
   return {blocked,gate};
  },permit=>{if(frozen&&permit)throw Error('Page is disconnected.');availabilityPermit=permit;});
  signal?.throwIfAborted();
  await stopFrames?.();
  if(retainReadOnly&&result.retainReadOnly===true){retained=true;return {...result,page,release};}
  if(liveView&&result.networkDisconnected===true){
   const cdp=await page.createCDPSession();
   const {devtoolsFrontendUrl}=await cdp.send('Cloudflare.getLiveView',{mode:'tab',expiresInMs:60000});
   const link=new URL(devtoolsFrontendUrl);
   if(link.protocol!=='https:'||link.hostname!=='live.browser.run')throw Error('Untrusted live view URL');
   signal?.throwIfAborted();
   retained=true;return {...result,liveViewUrl:link.href,release};
  }
  return result;
 }finally{signal?.removeEventListener("abort",aborted);if(!retained)await release();}
}
export function chromiumPreviewConfig(config,enabled=process.env.RESERVATION_FORM_LIVE_VIEW==='true'){
 if(!enabled||!config?.browserWSEndpoint)return null;
 const url=new URL(config.browserWSEndpoint);
 if(url.hostname!=='api.cloudflare.com'||url.searchParams.get('browser')!=='kitesurf')return null;
 url.searchParams.delete('browser');url.searchParams.set('keep_alive','10000');
 return {...config,browserWSEndpoint:url.href,liveView:true};
}
const cleanForms=(raw,url)=>raw.map(form=>({...form,fields:form.fields.map(field=>({...field,id:field.id||`field-${field.elementIndex}`,semantic:semanticField(field)}))})).filter(form=>form.fields.some(f=>['date','time','dateTime','partySize'].includes(f.semantic))).map(form=>({...form,sourceUrl:url}));
export function createReservationForms({places,config=configuredKitesurf(),run=browserSession,now=Date.now,previewConfig=chromiumPreviewConfig(config),websiteSearch=configuredWebsiteSearch(),contextfetch=websiteSearch?null:configuredContextFetchBookingSearch()}={}){
 const discoveries=new Map(),destinations=new Map(),leases=new Map();let active=0;
 async function closePreview(id){const lease=leases.get(id);if(!lease)return;leases.delete(id);clearTimeout(lease.timer);await lease.release();}
 async function runBound(job,selected=config,options={}){options.signal?.throwIfAborted();if(active+leases.size+search.size>=2)throw new ReservationFormError('busy');active++;try{return await run({...selected,...options},job);}finally{active--;}}
 const search=createReservationSearch({places,runBound,config:previewConfig||chromiumPreviewConfig(config,true)||config,now,ErrorType:ReservationFormError,registerDestination(entityId,url){
  const candidateId=randomUUID();destinations.set(candidateId,{entityId,url,expires:now()+5*60000});expire();
  return {candidateId,url,label:'Website selected by you',relationship:'user_selected_search',submitted:false};
 }});
 const websites=createBookingWebsiteSearch({places,search:websiteSearch,contextfetch,now,ErrorType:ReservationFormError,registerDestination(entityId,url){const candidateId=randomUUID();destinations.set(candidateId,{entityId,url,expires:now()+5*60000});expire();return {candidateId,url,label:'Website selected by you',relationship:'user_selected_search',submitted:false};}});
 async function source(entityId){
  const id=locationId(entityId);let place;
  try{place=await places.details(id);}catch{throw new ReservationFormError('provider_unavailable');}
  const website=place.contact?.website;
  if(place.entityId?.toUpperCase()!==id||website?.source?.entityId?.toUpperCase()!==id||website.source.field!=='properties.website'||!website.url)throw new ReservationFormError('no_website');
  try{return reservationPageUrl(website.url);}catch{throw new ReservationFormError('page_unavailable');}
 }
 function expire(){
  for(const cache of [discoveries,destinations]){for(const [key,value] of cache)if(value.expires<now())cache.delete(key);while(cache.size>100)cache.delete(cache.keys().next().value);}
 }
 async function readForms(page){
  const native=await page.evaluate(inspectForms),wix=await page.evaluate(inspectWixForms);
  const tableagent=new URL(page.url()).origin==='https://tableagent.com'?await page.evaluate(inspectTableagentForms):[];
  return cleanForms([...native.filter(f=>![...wix,...tableagent].some(w=>w.index===f.index)),...wix,...tableagent],page.url());
 }
 async function scan(page){
  // Give client-rendered forms a short bounded opportunity to mount. No clicks.
  let forms=[];
  for(let attempt=0;attempt<4;attempt++){forms=await readForms(page);if(forms.some(f=>f.adapter||f.fields.some(x=>!x.readOnly&&['date','dateTime','time','partySize'].includes(x.semantic))))break;if(attempt<3)await new Promise(r=>setTimeout(r,250));}
  const links=await page.evaluate(()=>[
   ...[...document.querySelectorAll('a[href]')].filter(a=>/\b(book(?:ing)?|reserv(?:e|ation|ations))\b/i.test(a.textContent)).slice(0,12).map(a=>({url:a.href,label:a.textContent.trim().slice(0,100)})),
   ...[...document.querySelectorAll('iframe[src]')].filter(f=>/book|reserv|table|resos|opentable|serva/i.test(`${f.src} ${f.title}`)).slice(0,4).map(f=>({url:f.src,label:f.title||'Embedded booking page'}))
  ]);
  return {forms,links};
 }
 // A navigation is evidence of a redirect, not proof that the new site belongs
 // to the venue. Never inspect or authorize its fields until the user selects
 // this server-held, expiring destination through the normal candidate flow.
 function redirectedDestination(entityId,from,value){
  const target=menuUrl(value);
  if(target.protocol!=='https:')throw new ReservationFormError('destination_changed');
  const id=randomUUID();
  destinations.set(id,{entityId,url:target.href,expires:now()+5*60000});
  expire();
  return {status:'no_supported_form',previewAvailable:true,sourceUrl:from,forms:[],candidates:[{id,url:target.href,label:'Website redirected here — review before continuing',relationship:'website_redirect',redirectedFrom:from}],unsupported:['destination_review_required'],submitted:false};
 }
 async function discoverAt(entityId,initial,followSameSite,options={}){
  const progress=(stage,message)=>options.emit?.({type:"progress",stage,message});
  progress("connecting","Opening a read-only booking browser…");
  let started=false;
  try{return await runBound(async page=>{
   started=true;
   progress("loading","Loading the venue website securely…");
   await navigateReservation(page,initial);
   let url=page.url();menuUrl(url);
   if(!canonicalContactRedirect(new URL(initial),new URL(url)))return redirectedDestination(entityId,initial,url);
   progress("inspecting","Looking for published reservation fields and booking links…");
   let {forms,links}=await scan(page);
   // Two bounded same-origin booking hops; never click a button or cross an unreviewed domain.
   const visited=new Set([url]),homeOrigin=new URL(url).origin;
   for(let hop=0;hop<2&&!forms.length&&followSameSite;hop++){
    const choices=links.filter(c=>{try{const target=reservationPageUrl(c.url);return new URL(target).origin===homeOrigin&&!visited.has(target);}catch{return false;}});
    choices.sort((a,b)=>{
     const rank=x=>/book|reserv|table/i.test(new URL(reservationPageUrl(x.url)).pathname)?2:0;
     return rank(b)-rank(a);
    });
    const next=choices[0];if(!next)break;
    const expected=reservationPageUrl(next.url);visited.add(expected);
    progress("loading","Opening a published booking page…");
    await navigateReservation(page,expected);url=page.url();
    if(!canonicalContactRedirect(new URL(expected),new URL(url)))return redirectedDestination(entityId,expected,url);
    visited.add(url);
    const checked=await scan(page);forms=checked.forms;links=[...links,...checked.links];
   }
   const seen=new Set(),candidates=[];
   for(const item of links){if(candidates.length>=30)break;let target;try{target=new URL(reservationPageUrl(item.url));if(target.href===url||seen.has(target.href))continue;}catch{continue;}
    seen.add(target.href);const id=randomUUID(),candidate={id,url:target.href,label:String(item.label||'Booking page').slice(0,100),relationship:target.origin===new URL(url).origin?'same_site':'booking_partner'};
    destinations.set(id,{entityId,url:target.href,expires:now()+5*60000});candidates.push(candidate);
   }
   for(const form of forms){const id=randomUUID();discoveries.set(id,{entityId,form,sourceUrl:url,fingerprint:hash(form),expires:now()+5*60000});form.id=id;}
   expire();
   // Remember only structural form discovery; the next user must re-inspect the live form.
   if(forms.length)await websites.rememberInspected(entityId,url).catch(()=>{});
   const unsupported=[];
   if(!forms.length)unsupported.push('no_native_form');
   if(links.some(l=>l.label==='Embedded booking page'))unsupported.push('embedded_forms');
   if(forms.length&&forms.some(f=>!f.fields.some(x=>!x.readOnly&&['date','dateTime'].includes(x.semantic))||!f.fields.some(x=>!x.readOnly&&['time','dateTime'].includes(x.semantic))))unsupported.push('visit_time_not_mapped');
   return {status:forms.length?'forms_found':'no_supported_form',previewAvailable:true,sourceUrl:url,forms:forms.map(({id,fields,adapter})=>({id,fields,...(adapter==='tableagent-availability-v1'?{availabilityProvider:'tableagent'}:{})})),candidates,unsupported,submitted:false};
  },options.emit?(previewConfig||chromiumPreviewConfig(config,true)||config):config,options);}catch(error){if(error instanceof ReservationFormError)throw error;throw new ReservationFormError(started?'page_unavailable':'browser_unavailable');}
 }
 return {enabled:!!config,websiteSearchEnabled:websites.enabled,findWebsites:websites.find,selectWebsite:websites.select,closePreview,startSearch:search.start,searchAction:search.action,selectSearch:search.select,closeSearch:search.close,async discover(entityId,options={}){
  if(!config)return {status:'disabled',previewAvailable:false,forms:[],candidates:[]};
  return discoverAt(entityId,await source(entityId),true,options);
 },async inspectDestination(entityId,body,options={}){
  if(!config)throw Error('Form preview is not configured.');
  if(!body||typeof body.candidateId!=='string'||Object.keys(body).some(k=>k!=='candidateId'))throw Error('Select a published booking destination.');
  const destination=destinations.get(body.candidateId);
  if(!destination||destination.entityId!==entityId||destination.expires<now())throw new ReservationFormError('expired');
  return discoverAt(entityId,destination.url,false,options);
 },async preview(entityId,body,options={}){
  const progress=(stage,message)=>options.emit?.({type:"progress",stage,message});
  if(!config)throw Error('Form preview is not configured.');
  if(!body||body.consent!==true||typeof body.formId!=='string'||!body.fields||typeof body.fields!=='object'||Array.isArray(body.fields)||Object.keys(body).some(k=>!['consent','formId','fields'].includes(k)))throw Error('Review the fields and authorize preview first.');
  const saved=discoveries.get(body.formId);
  if(!saved||saved.entityId!==entityId||saved.expires<now())throw Error('This form preview expired. Locate the form again.');
  const fields=saved.form.fields;
  for(const [id,value] of Object.entries(body.fields))if(!fields.some(f=>f.id===id)||typeof value!=='string'||value.length>2000)throw Error('Invalid form field.');
  progress("connecting","Opening a secure review browser…");
  const result=await runBound(async(page,freeze,permitAvailability)=>{
   progress("loading","Loading the reviewed booking page…");
   await navigateReservation(page,saved.sourceUrl);
   let form;
   for(let attempt=0;attempt<4;attempt++){
    options.signal?.throwIfAborted();
    form=(await readForms(page)).find(f=>f.index===saved.form.index);
    if(form&&hash(form)===saved.fingerprint)break;
    if(attempt<3)await new Promise(r=>setTimeout(r,250));
   }
   if(!form||hash(form)!==saved.fingerprint)throw Error('The form changed. Locate it again before filling.');
   const prepared=form.adapter==='tableagent-availability-v1'?await prepareTableagent(page,form,body.fields,permitAvailability):null;
   if(prepared){const refreshed=(await readForms(page)).find(f=>f.index===form.index);if(!refreshed||hash(refreshed)!==saved.fingerprint)throw Error('The form changed. Locate it again before filling.');}
   progress("freezing","Disconnecting the page before entering your details…");
   const frozen=await freeze();
   options.signal?.throwIfAborted();
   progress("filling","Filling reviewed details with networking disabled…");
   const result=form.adapter==='tableagent-availability-v1'?await page.evaluate(fillTableagent,{index:form.index,prepared}):form.adapter==='wix-reservation-v1'
    ?await page.evaluate(fillWixForm,{index:form.index,values:body.fields},frozen.gate)
    :await page.evaluate(({index,fields,values})=>{
    const form=document.forms[index],elements=form.querySelectorAll('input,select,textarea');
    return fields.map(field=>{const el=elements[field.elementIndex],value=values[field.id];if(el.readOnly||el.getAttribute('aria-readonly')==='true')return {label:field.label,value:'',status:'unsupported_control'};if(value==null||value==='')return {label:field.label,value:'',status:field.required?'missing_required':'not_provided'};if(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===value))return {label:field.label,value,status:'no_matching_option'};
      // No input/change event: handlers may autosave. The visible native field
      // value is a review preview, not a claim React/app state is submitted-ready.
      el.value=value;return {label:field.label,value:el.value,status:el.value===value?'filled':'unsupported_value'};
    });
   },{index:form.index,fields,values:body.fields});
   const screenshot=await page.screenshot({type:'png'});
   return {status:form.adapter&&result.length===3&&result.every(f=>f.status==='filled')?'filled':'preview_ready',sourceUrl:saved.sourceUrl,fields:result,screenshotDataUrl:`data:image/png;base64,${Buffer.from(screenshot).toString('base64')}`,submitted:false,networkDisconnected:true,notice:form.adapter==='tableagent-availability-v1'?'Checked date availability with Tableagent, then filled visible fields offline. No booking submitted.':form.adapter?'Selected available widget values for review with networking disabled. No request sent.':'Filled for review with networking disabled. No request sent. Dynamic form handlers were not triggered.'};
  },previewConfig||config,options);
  progress("ready","The filled form is ready for review. Nothing was submitted.");
  if(result.release){
   const {release,...response}=result,id=randomUUID(),expiresAt=new Date(now()+120000).toISOString();
   const timer=setTimeout(()=>{closePreview(id).catch(()=>{});},120000);timer.unref?.();
   leases.set(id,{release,timer});return {...response,previewId:id,expiresAt};
  }
  return result;
 }};
}
