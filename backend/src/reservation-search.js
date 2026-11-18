import {reservationGuardFailure,recordReservationGuardFailure} from './reservation-dns.js';
import {randomUUID} from 'node:crypto';
import {menuUrl} from './menu-evidence.js';
import {locationId} from './locations.js';
const width=1100,height=900,ttl=180000;
const searchHost=host=>/(^|\.)(google\.[a-z.]+|gstatic\.com|googleusercontent\.com|bing\.com|duckduckgo\.com)$/.test(host);
function safeUrl(value){const url=menuUrl(value);if(url.protocol!=='https:')throw Error('Only secure public pages can be opened.');return url.href;}
function strict(body,keys){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k)))throw Error('Invalid browser action.');}
// Private transient input-target map, not search results: no labels, snippets or
// content are extracted or returned. It only binds a screenshot click to the
// same visible link still occupying that location when the click arrives.
export function searchTargets(){
 return [...document.querySelectorAll('a[href]')].slice(0,1000).flatMap(a=>{
  if(a.closest('form')||a.hasAttribute('download')||a.getAttribute('role')==='button'||getComputedStyle(a).visibility!=='visible')return [];
  return [...a.getClientRects()].filter(r=>r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<1100&&r.top<900).map(r=>({href:a.href,left:r.left,top:r.top,right:r.right,bottom:r.bottom}));
 }).slice(0,500);
}
export function searchTargetAt({x,y}){
 const a=document.elementFromPoint(x,y)?.closest('a[href]');
 if(!a||a.closest('form')||a.hasAttribute('download')||a.getAttribute('role')==='button')return null;
 const r=[...a.getClientRects()].find(r=>x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom);
 return r?{href:a.href,left:r.left,top:r.top,right:r.right,bottom:r.bottom}:null;
}
export function searchIsBlocked(){return /verify (?:that )?you are human|unusual traffic|automated (?:queries|traffic)|checking your browser|before you continue to google|accept all cookies|captcha|access denied/i.test(document.body?.innerText||'');}
// The real provider page is shown intact. No search-result extraction, ranking,
// invisible clicks, typing or form submission. Coordinates resolve only links.
export function createReservationSearch({places,runBound,config,registerDestination,now=Date.now,ErrorType=Error}){
 const sessions=new Map();
 function pageFailure(error){if(ErrorType!==Error&&error instanceof ErrorType)return error;return new ErrorType(error?.name==='TimeoutError'||/Navigation timeout/i.test(String(error?.message||''))?'page_timeout':'page_unavailable');}
 async function close(searchId){const session=sessions.get(searchId);if(!session)return;sessions.delete(searchId);clearTimeout(session.timer);await session.release();}
 async function capture(session,notice){
  const url=safeUrl(session.page.url());
  const blocked=await session.page.evaluate(searchIsBlocked);
  session.targets=blocked?[]:await session.page.evaluate(searchTargets);
  const bytes=await session.page.screenshot({type:'png'});
  session.url=url;session.sequence++;
  session.blocked=blocked;
  return {searchId:session.id,venueName:session.venueName,venueAddress:session.venueAddress,sequence:session.sequence,imageDataUrl:`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,url,title:String(await session.page.title()).slice(0,180),width,height,canBack:session.history.length>1,canUse:!blocked&&!searchHost(new URL(url).hostname),expiresAt:new Date(session.expires).toISOString(),status:blocked?'challenge':'ready',submitted:false,...(notice?{notice}:{})};
 }
 function sessionFor(entityId,body){
  const session=sessions.get(body.searchId);
  if(!session||session.entityId!==locationId(entityId))throw new ErrorType('expired');
  if(session.expires<=now()){close(session.id).catch(()=>{});throw new ErrorType('expired');}
  if(session.busy)throw new ErrorType('busy');return session;
 }
 function currentFrame(session,sequence){return Number.isInteger(sequence)&&sequence===session.sequence&&session.page.url()===session.url;}
 async function navigate(session,url){
  const target=safeUrl(url);let response;recordReservationGuardFailure(session.page,null);
  try{response=await session.page.goto(target,{waitUntil:'domcontentloaded',timeout:20000});}catch(error){const guard=reservationGuardFailure(session.page);throw guard?new ErrorType(guard):pageFailure(error);}
  if(response?.status?.()>=400)throw new ErrorType('page_http_error');
  safeUrl(session.page.url());
 }
 return {get size(){return sessions.size;},close,
  async start(entityId,body,options={}){
   strict(body,[]);if(!config)throw new ErrorType('browser_unavailable');
   const id=locationId(entityId);let place;try{place=await places.details(id);}catch{throw new ErrorType('provider_unavailable');}
   if(place.entityId?.toUpperCase()!==id||!place.name||!place.address)throw new ErrorType('provider_unavailable');
   const phone=place.contact?.phone,query=[place.name,place.address,phone?.source?.entityId?.toUpperCase()===id&&phone.source.field==='properties.phone'?phone.display:null,'official website reservations'].filter(Boolean).join(' ').slice(0,600);
   const target=`https://www.google.com/search?q=${encodeURIComponent(query)}`;
   let retained,started=false;
   try{retained=await runBound(async page=>{started=true;await navigate({page},target);return {retainReadOnly:true};},{...config,liveView:false,retainReadOnly:true},options);}
   catch(error){if(ErrorType!==Error&&error instanceof ErrorType)throw error;throw started?pageFailure(error):new ErrorType('browser_unavailable');}
   if(!retained.page||typeof retained.release!=='function')throw new ErrorType('browser_unavailable');
   if(options.signal?.aborted){await retained.release();throw new ErrorType('expired');}
   const searchId=randomUUID(),session={id:searchId,entityId:id,venueName:String(place.name).slice(0,500),venueAddress:String(place.address).slice(0,500),page:retained.page,release:retained.release,expires:now()+ttl,sequence:0,history:[target],busy:false};
   sessions.set(searchId,session);session.timer=setTimeout(()=>close(searchId).catch(()=>{}),ttl);session.timer.unref?.();
   try{const result=await capture(session);if(options.signal?.aborted)throw new ErrorType('expired');return result;}catch(error){await close(searchId);throw pageFailure(error);}
  },
  async action(entityId,body){
   strict(body,['searchId','sequence','action']);strict(body.action,['type','x','y','deltaY']);
   const session=sessionFor(entityId,body);session.busy=true;
   try{
    if(!Number.isInteger(body.sequence)||!await currentFrame(session,body.sequence))return await capture(session,'The page changed. Review the refreshed view before clicking.');
    const action=body.action;
    if(action.type!=='back'&&await session.page.evaluate(searchIsBlocked))return await capture(session,'This page requires verification or consent. Go back or close this read-only browser.');
    if(action.type==='click'){
     if(!Number.isInteger(action.x)||!Number.isInteger(action.y)||action.x<0||action.x>=width||action.y<0||action.y>=height)throw Error('Invalid click.');
     const intended=session.targets.filter(r=>action.x>=r.left&&action.x<=r.right&&action.y>=r.top&&action.y<=r.bottom);
     if(!intended.length)return await capture(session,'Only website links can be opened here. Buttons, forms and verification controls are disabled.');
     const current=await session.page.evaluate(searchTargetAt,{x:action.x,y:action.y});
     if(intended.length!==1||!current||current.href!==intended[0].href||['left','top','right','bottom'].some(key=>Math.abs(current[key]-intended[0][key])>2))return await capture(session,'The link moved or changed. Review the refreshed view before clicking.');
     await navigate(session,current.href);session.history.push(session.page.url());
    }else if(action.type==='scroll'){
     if(!Number.isInteger(action.deltaY)||Math.abs(action.deltaY)>700)throw Error('Invalid scroll.');
     await session.page.evaluate(delta=>window.scrollBy(0,delta),action.deltaY);
    }else if(action.type==='back'){
     if(session.history.length>1){session.history.pop();await navigate(session,session.history.at(-1));}
    }else if(action.type!=='refresh')throw Error('Unsupported action.');
    return await capture(session);
   }finally{session.busy=false;}
  },
  async select(entityId,body){
   strict(body,['searchId','sequence']);const session=sessionFor(entityId,body);session.busy=true;
   try{
    if(!await currentFrame(session,body.sequence))throw new ErrorType('search_changed');
    const url=safeUrl(session.page.url());if(await session.page.evaluate(searchIsBlocked)||searchHost(new URL(url).hostname))throw new ErrorType('search_select');
    if(!currentFrame(session,body.sequence))throw new ErrorType('search_changed');
    const candidate=registerDestination(session.entityId,url);await close(session.id);return candidate;
   }finally{session.busy=false;}
  }
 };
}
