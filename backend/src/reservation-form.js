import {createHash,randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {menuUrl,publicAddress} from './menu-evidence.js';
import {lookup} from 'node:dns/promises';
import {canonicalContactRedirect} from './contact-evidence.js';
import {locationId} from './locations.js';

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
 return [...document.forms].slice(0,12).map((form,index)=>({index,action:form.action,method:form.method,fields:[...form.querySelectorAll(inputs)].map((el,elementIndex)=>({elementIndex,name:el.name,type:el.tagName==='SELECT'?'select':el.tagName==='TEXTAREA'?'textarea':el.type,label:[...(el.labels||[])].map(l=>l.textContent.trim()).join(' ')||el.getAttribute('aria-label')||el.placeholder||el.name,autocomplete:el.autocomplete,required:el.required,disabled:el.disabled,visible:!!(el.getClientRects().length)&&getComputedStyle(el).visibility!=='hidden',options:el.tagName==='SELECT'?[...el.options].slice(0,100).map(o=>({value:o.value,label:o.text})):undefined})).filter(f=>f.visible&&!f.disabled&&!/leave (?:this )?(?:field )?(?:empty|blank)|do not fill/i.test(f.label)&&!['hidden','submit','button','reset','file','password','checkbox','radio','image'].includes(f.type))})).filter(f=>f.fields.length>0&&f.fields.length<=30);
}
export async function browserSession(config,job){
 const {resolve=lookup,liveView=false,...connection}=config;
 const browser=await puppeteer.connect({...connection,protocolTimeout:20000});
 let page,retained=false;
 const release=async()=>{await page?.close().catch(()=>{});await browser.disconnect();};
 try{
  page=await browser.newPage();
  await page.setViewport({width:1100,height:900});
  await page.setRequestInterception(true);
  await page.evaluateOnNewDocument(()=>{
   // WebSockets and peer connections could outlive the later network freeze.
   Object.defineProperty(window,'open',{value:()=>null,configurable:false,writable:false});
   if(navigator.serviceWorker)Object.defineProperty(navigator.serviceWorker,'register',{value:()=>Promise.reject(Error('Unavailable in reservation preview')),configurable:false,writable:false});
   for(const name of ['WebSocket','WebTransport','RTCPeerConnection','Worker','SharedWorker'])Object.defineProperty(window,name,{value:class{constructor(){throw Error('Unavailable in reservation preview');}},configurable:false,writable:false});
  });
  let frozen=false;const blocked=[],checked=new Map();
  page.on('request',async req=>{
   const safe=(()=>{try{const u=menuUrl(req.url());return u.protocol==='https:';}catch{return false;}})();
   if(frozen||req.method()!=='GET'||!safe){blocked.push({method:req.method(),type:req.resourceType()});return req.abort().catch(()=>{});}
   // Reject hostnames resolving to local/link-local/private addresses. The
   // managed browser is fresh and receives no application cookies or secrets.
   try{
    const host=new URL(req.url()).hostname;
    if(!checked.has(host)){let timer;const pending=Promise.race([resolve(host,{all:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DNS timeout')),8000);})]).finally(()=>clearTimeout(timer));checked.set(host,pending);}
    const addresses=await checked.get(host);
    if(frozen||!addresses.length||addresses.some(a=>!publicAddress(a.address)))return req.abort().catch(()=>{});
    return req.continue().catch(()=>{});
   }catch{return req.abort().catch(()=>{});}
  });
  // Keep all mutation methods blocked even during form discovery. A site requiring
  // a POST for availability must report unsupported, not quietly submit it.
  const result=await job(page,async()=>{
   frozen=true;
   // Disconnect the engine's network before touching personal fields, not only
   // before the submit button. Unsupported engines fail closed here.
   await page.setOfflineMode(true);
   await page.evaluate(()=>{window.stop();document.addEventListener('click',e=>{if(e.target.closest?.('a,button,input[type=submit],input[type=image],input[type=reset]')){e.preventDefault();e.stopImmediatePropagation();}},true);document.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();}},true);document.addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation();},true);HTMLFormElement.prototype.submit=function(){throw Error('Preview only');};HTMLFormElement.prototype.requestSubmit=function(){throw Error('Preview only');};});
   return blocked;
  });
  if(liveView&&result.networkDisconnected===true){
   const cdp=await page.createCDPSession();
   const {devtoolsFrontendUrl}=await cdp.send('Cloudflare.getLiveView',{mode:'tab',expiresInMs:60000});
   const link=new URL(devtoolsFrontendUrl);
   if(link.protocol!=='https:'||link.hostname!=='live.browser.run')throw Error('Untrusted live view URL');
   retained=true;return {...result,liveViewUrl:link.href,release};
  }
  return result;
 }finally{if(!retained)await release();}
}
export function chromiumPreviewConfig(config,enabled=process.env.RESERVATION_FORM_LIVE_VIEW==='true'){
 if(!enabled||!config?.browserWSEndpoint)return null;
 const url=new URL(config.browserWSEndpoint);
 if(url.hostname!=='api.cloudflare.com'||url.searchParams.get('browser')!=='kitesurf')return null;
 url.searchParams.delete('browser');url.searchParams.set('keep_alive','10000');
 return {...config,browserWSEndpoint:url.href,liveView:true};
}
const cleanForms=(raw,url)=>raw.map(form=>({...form,fields:form.fields.map(field=>({...field,id:`field-${field.elementIndex}`,semantic:semanticField(field)}))})).filter(form=>form.fields.some(f=>['date','time','dateTime','partySize'].includes(f.semantic))).map(form=>({...form,sourceUrl:url}));
export function createReservationForms({places,config=configuredKitesurf(),run=browserSession,now=Date.now,previewConfig=chromiumPreviewConfig(config)}={}){
 const discoveries=new Map(),destinations=new Map(),leases=new Map();let active=0;
 async function closePreview(id){const lease=leases.get(id);if(!lease)return;leases.delete(id);clearTimeout(lease.timer);await lease.release();}
 async function runBound(job,selected=config){if(active+leases.size>=2)throw Error('Form preview is busy. Try again shortly.');active++;try{return await run(selected,job);}finally{active--;}}
 async function source(entityId){const id=locationId(entityId),place=await places.details(id),website=place.contact?.website;if(place.entityId?.toUpperCase()!==id||website?.source?.entityId?.toUpperCase()!==id||website.source.field!=='properties.website'||!website.url)throw Error('This venue has no provider-bound website.');return menuUrl(website.url).href;}
 function expire(){
  for(const cache of [discoveries,destinations]){for(const [key,value] of cache)if(value.expires<now())cache.delete(key);while(cache.size>100)cache.delete(cache.keys().next().value);}
 }
 async function scan(page){
  // Give client-rendered forms a short bounded opportunity to mount. No clicks.
  let forms=[];
  for(let attempt=0;attempt<4;attempt++){forms=cleanForms(await page.evaluate(inspectForms),page.url());if(forms.length)break;if(attempt<3)await new Promise(r=>setTimeout(r,250));}
  const links=await page.evaluate(()=>[
   ...[...document.querySelectorAll('a[href]')].filter(a=>/\b(book(?:ing)?|reserv(?:e|ation|ations))\b/i.test(a.textContent)).slice(0,12).map(a=>({url:a.href,label:a.textContent.trim().slice(0,100)})),
   ...[...document.querySelectorAll('iframe[src]')].filter(f=>/book|reserv|table|resos|opentable|serva/i.test(`${f.src} ${f.title}`)).slice(0,4).map(f=>({url:f.src,label:f.title||'Embedded booking page'}))
  ]);
  return {forms,links};
 }
 async function discoverAt(entityId,initial,followSameSite){
  return runBound(async page=>{
   await page.goto(initial,{waitUntil:'domcontentloaded',timeout:20000});
   let url=page.url();menuUrl(url);
   if(!canonicalContactRedirect(new URL(initial),new URL(url)))throw Error('Website redirected to another provider. Review it manually.');
   let {forms,links}=await scan(page);
   if(!forms.length&&followSameSite){const next=links.find(c=>{try{return new URL(c.url).protocol==='https:'&&new URL(c.url).origin===new URL(url).origin&&c.url!==url;}catch{return false;}});
    if(next){const expected=next.url;await page.goto(menuUrl(expected).href,{waitUntil:'domcontentloaded',timeout:20000});url=page.url();if(!canonicalContactRedirect(new URL(expected),new URL(url)))throw Error('Booking destination changed.');const checked=await scan(page);forms=checked.forms;links=[...links,...checked.links];}
   }
   const seen=new Set(),candidates=[];
   for(const item of links){if(candidates.length>=30)break;let target;try{target=menuUrl(item.url);if(target.protocol!=='https:'||target.href===url||seen.has(target.href))continue;}catch{continue;}
    seen.add(target.href);const id=randomUUID(),candidate={id,url:target.href,label:String(item.label||'Booking page').slice(0,100),relationship:target.origin===new URL(url).origin?'same_site':'booking_partner'};
    destinations.set(id,{entityId,url:target.href,expires:now()+5*60000});candidates.push(candidate);
   }
   for(const form of forms){const id=randomUUID();discoveries.set(id,{entityId,form,sourceUrl:url,fingerprint:hash(form),expires:now()+5*60000});form.id=id;}
   expire();
   const unsupported=[];
   if(!forms.length)unsupported.push('no_native_form');
   if(links.some(l=>l.label==='Embedded booking page'))unsupported.push('embedded_forms');
   if(forms.length&&forms.some(f=>!f.fields.some(x=>['date','dateTime'].includes(x.semantic))||!f.fields.some(x=>['time','dateTime'].includes(x.semantic))))unsupported.push('visit_time_not_mapped');
   return {status:forms.length?'forms_found':'no_supported_form',previewAvailable:true,sourceUrl:url,forms:forms.map(({id,fields})=>({id,fields})),candidates,unsupported,submitted:false};
  });
 }
 return {enabled:!!config,closePreview,async discover(entityId){
  if(!config)return {status:'disabled',previewAvailable:false,forms:[],candidates:[]};
  return discoverAt(entityId,await source(entityId),true);
 },async inspectDestination(entityId,body){
  if(!config)throw Error('Form preview is not configured.');
  if(!body||typeof body.candidateId!=='string'||Object.keys(body).some(k=>k!=='candidateId'))throw Error('Select a published booking destination.');
  const destination=destinations.get(body.candidateId);
  if(!destination||destination.entityId!==entityId||destination.expires<now())throw Error('This booking link expired. Find the booking form again.');
  return discoverAt(entityId,destination.url,false);
 },async preview(entityId,body){
  if(!config)throw Error('Form preview is not configured.');
  if(!body||body.consent!==true||typeof body.formId!=='string'||!body.fields||typeof body.fields!=='object'||Array.isArray(body.fields)||Object.keys(body).some(k=>!['consent','formId','fields'].includes(k)))throw Error('Review the fields and authorize preview first.');
  const saved=discoveries.get(body.formId);
  if(!saved||saved.entityId!==entityId||saved.expires<now())throw Error('This form preview expired. Locate the form again.');
  const fields=saved.form.fields;
  for(const [id,value] of Object.entries(body.fields))if(!fields.some(f=>f.id===id)||typeof value!=='string'||value.length>2000)throw Error('Invalid form field.');
  const result=await runBound(async(page,freeze)=>{
   await page.goto(saved.sourceUrl,{waitUntil:'domcontentloaded',timeout:20000});
   const form=cleanForms(await page.evaluate(inspectForms),page.url()).find(f=>f.index===saved.form.index);
   if(!form||hash(form)!==saved.fingerprint)throw Error('The form changed. Locate it again before filling.');
   await freeze();
   const result=await page.evaluate(({index,fields,values})=>{
    const form=document.forms[index],elements=form.querySelectorAll('input,select,textarea');
    return fields.map(field=>{const el=elements[field.elementIndex],value=values[field.id];if(value==null||value==='')return {label:field.label,value:'',status:field.required?'missing_required':'not_provided'};if(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===value))return {label:field.label,value,status:'no_matching_option'};
      // No input/change event: handlers may autosave. The visible native field
      // value is a review preview, not a claim React/app state is submitted-ready.
      el.value=value;return {label:field.label,value:el.value,status:el.value===value?'filled':'unsupported_value'};
    });
   },{index:form.index,fields,values:body.fields});
   const screenshot=await page.screenshot({type:'png'});
   return {status:'preview_ready',sourceUrl:saved.sourceUrl,fields:result,screenshotDataUrl:`data:image/png;base64,${Buffer.from(screenshot).toString('base64')}`,submitted:false,networkDisconnected:true,notice:'Filled for review with networking disabled. No request sent. Dynamic form handlers were not triggered.'};
  },previewConfig||config);
  if(result.release){
   const {release,...response}=result,id=randomUUID(),expiresAt=new Date(now()+120000).toISOString();
   const timer=setTimeout(()=>{closePreview(id).catch(()=>{});},120000);timer.unref?.();
   leases.set(id,{release,timer});return {...response,previewId:id,expiresAt};
  }
  return result;
 }};
}
