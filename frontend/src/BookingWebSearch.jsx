import {useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {venueSearchUrl} from './booking-contact-links.js';
import {Icon} from './PlannerIcons.jsx';
import {normalizeSearchFrame,searchPoint} from './booking-web-search.js';

export default function BookingWebSearch({snapshot,onSelected,onCancel}){
 const [frame,setFrame]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const lease=useRef(null),pending=useRef(null),mounted=useRef(false);
 function close(id=lease.current){if(!id)return;if(lease.current===id)lease.current=null;api.closeReservationSearch(snapshot.entityId,id).catch(()=>{});}
 useEffect(()=>{
  mounted.current=true;const abort=new AbortController();pending.current=abort;setBusy(true);setError('');setFrame(null);
  api.reservationSearch(snapshot.entityId,abort.signal).then(raw=>{if(abort.signal.aborted){close(raw?.searchId);return;}lease.current=raw?.searchId;const next=normalizeSearchFrame(raw);setFrame(next);}).catch(e=>{if(!abort.signal.aborted){close();setError(e.message||'Search could not open. Try again shortly.');}}).finally(()=>{if(!abort.signal.aborted){pending.current=null;setBusy(false);}});
  return()=>{mounted.current=false;abort.abort();pending.current?.abort();close();};
 },[snapshot.entityId,attempt]);
 useEffect(()=>{if(!frame)return;const timer=setTimeout(()=>{pending.current?.abort();pending.current=null;close();setBusy(false);setFrame(null);setError('This search session expired. Start again.');},Math.max(0,Date.parse(frame.expiresAt)-Date.now()));return()=>clearTimeout(timer);},[frame?.searchId,frame?.expiresAt]);
 async function action(action){
  if(busy||!frame||(frame.status==='challenge'&&action.type!=='back'))return;const abort=new AbortController();pending.current=abort;setBusy(true);setError('');
  try{const raw=await api.reservationSearchAction(snapshot.entityId,{searchId:frame.searchId,sequence:frame.sequence,action},abort.signal);if(!abort.signal.aborted)setFrame(normalizeSearchFrame(raw));}
  catch(e){if(!abort.signal.aborted){if(e.code==='expired'||e.name==='TimeoutError'){close();setFrame(null);}setError(e.message||'The browser could not update. Refresh the view before trying again.');}}
  finally{if(!abort.signal.aborted){pending.current=null;setBusy(false);}}
 }
 async function select(){
  if(busy||!frame?.canUse)return;const abort=new AbortController();pending.current=abort;setBusy(true);setError('');
  try{const candidate=await api.selectReservationSearch(snapshot.entityId,{searchId:frame.searchId,sequence:frame.sequence},abort.signal);if(abort.signal.aborted)return;close();await onSelected(candidate,frame.imageDataUrl);}
  catch(e){if(!abort.signal.aborted){if(e.code==='expired'||e.name==='TimeoutError'){close();setFrame(null);}setError(e.message||'This website could not be selected.');}}
  finally{if(!abort.signal.aborted&&mounted.current){pending.current=null;setBusy(false);}}
 }
 const blocked=busy||frame?.status==='challenge';
 return <>
 <section className="booking-browser-canvas booking-search-canvas" aria-label="Interactive search browser">
 <div className="booking-search-toolbar"><button className="booking-icon" aria-label="Back in search browser" disabled={busy||!frame||frame.canBack===false} onClick={()=>action({type:'back'})}><Icon name="undo"/></button><button className="booking-icon" aria-label="Refresh search view" disabled={blocked||!frame} onClick={()=>action({type:'refresh'})}><Icon name="search"/></button><span>{frame?new URL(frame.url).hostname:'Opening search…'}</span><button className="pg-link" disabled={blocked||!frame} onClick={()=>action({type:'scroll',deltaY:-600})}>Scroll up</button><button className="pg-link" disabled={blocked||!frame} onClick={()=>action({type:'scroll',deltaY:600})}>Scroll down</button></div>
 {frame?<img className={`booking-search-image ${blocked?'is-busy':''}`} src={frame.imageDataUrl} alt={`Interactive remote browser showing ${frame.title||new URL(frame.url).hostname}. Click a visible website link.`} onClick={event=>{const point=searchPoint(event,frame);if(point)action({type:'click',...point});}}/>:<div className="booking-browser-empty"><Icon name="search" size={36}/><h2>{busy?'Opening web search':'Search unavailable'}</h2><p>{busy?'A real browser will appear here.':'You can retry or return to the venue’s contact options.'}</p></div>}
 </section>
 <aside className="booking-browser-controls" aria-label="Website search controls"><h3>Find the right website</h3><p><strong>{frame?.venueName||snapshot.name}</strong></p>{frame?.venueAddress&&<p className="pg-note">{frame.venueAddress}</p>}<p className="pg-note">Click a website link in the browser, then compare the venue and location before continuing. Search results are not verified venue records.</p>{frame&&<><p className="booking-current-address">{frame.url}</p>{frame.notice&&<p role="status">{frame.notice}</p>}</>}{busy&&<p role="status">Updating the browser…</p>}{frame?.status==='challenge'&&<p role="alert">This search provider requires a check that cannot be completed here. No bypass is attempted. Use the venue’s contact options.</p>}{error&&<p role="alert">{error}</p>}
 {frame?.canUse&&<button className="pl-button" disabled={blocked} onClick={select}>Use this website<Icon name="arrow" size={16}/></button>}
 {!frame&&!busy&&<button className="pl-secondary-button" onClick={()=>setAttempt(n=>n+1)}>Start search again</button>}
 {(error||frame?.status==='challenge')&&<a className="pg-link" href={venueSearchUrl(snapshot)} target="_blank" rel="noopener noreferrer">Open search in your browser <Icon name="arrowUpRight" size={14}/></a>}<button className="pg-link" onClick={onCancel}>Back to booking options</button><p className="booking-safety"><Icon name="lock" size={14}/>Navigation only. No typing or booking submission here.</p></aside>
 </>;
}
