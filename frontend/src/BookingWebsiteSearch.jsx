import {useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {venueSearchUrl} from './booking-contact-links.js';
import {Icon} from './PlannerIcons.jsx';
import './booking-website-search.css';

function domain(value){try{return new URL(value).hostname.replace(/^www\./,'');}catch{return 'Website';}}
export default function BookingWebsiteSearch({snapshot,onSelected,onCancel,externalOnly=false}){
 const [results,setResults]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[opening,setOpening]=useState(''),[attempt,setAttempt]=useState(0),[configured,setConfigured]=useState(true);
 const pending=useRef(null),choosing=useRef(false),generation=useRef(0);
 useEffect(()=>{
  const current=++generation.current,controller=new AbortController();pending.current=controller;choosing.current=false;
  setBusy(true);setResults(null);setError('');setOpening('');setConfigured(true);
  api.bookingWebsites(snapshot.entityId,controller.signal).then(data=>{if(!controller.signal.aborted&&current===generation.current)setResults(data);}).catch(e=>{if(!controller.signal.aborted&&current===generation.current){setConfigured(e.code!=='search_unavailable');setError(e.message||'Website search could not load.');}}).finally(()=>{if(!controller.signal.aborted&&current===generation.current)setBusy(false);});
  return()=>{generation.current++;controller.abort();pending.current?.abort();choosing.current=false;};
 },[snapshot.entityId,attempt]);
 useEffect(()=>{
  if(!results?.expiresAt)return;
  const timer=setTimeout(()=>{pending.current?.abort();choosing.current=false;setBusy(false);setOpening('');setResults(null);setError('These results expired. Search again for current links.');},Math.max(0,Date.parse(results.expiresAt)-Date.now()));
  return()=>clearTimeout(timer);
 },[results?.expiresAt]);
 async function choose(candidateId){
  if(choosing.current||busy||!results?.candidates.some(candidate=>candidate.candidateId===candidateId))return;
  if(!Number.isFinite(Date.parse(results.expiresAt))||Date.parse(results.expiresAt)<=Date.now()){setResults(null);setError('These results expired. Search again for current links.');return;}
  choosing.current=true;const current=generation.current,controller=new AbortController();pending.current=controller;setBusy(true);setOpening(candidateId);setError('');
  try{const candidate=await api.selectBookingWebsite(snapshot.entityId,candidateId,controller.signal);if(!controller.signal.aborted&&current===generation.current)await onSelected(candidate,null);}
  catch(e){if(!controller.signal.aborted&&current===generation.current)setError(e.message||'This result could not be opened.');}
  finally{if(!controller.signal.aborted&&current===generation.current){choosing.current=false;setOpening('');setBusy(false);}}
 }
 function cancel(){generation.current++;pending.current?.abort();choosing.current=false;onCancel();}
 const provider=results?.provider==='serper'?'Serper':results?.provider==='brave'?'Brave Search':results?.provider==='contextfetch'?'ContextFetch':results?.provider==='inspection_cache'?'Previously inspected route':'web search';
 return <section className="booking-website-search" aria-label="Website search results" aria-busy={busy}>
  <div className="booking-website-heading"><div><h2>{results?.venueName||snapshot.name}</h2><p>{results?.venueAddress||snapshot.address||'Choose a website to open'}</p></div><button type="button" className="booking-website-back" onClick={cancel} aria-label="Back to booking options"><Icon name="arrow" size={17}/></button></div>
  <div className="booking-website-scroll">
   {busy&&!results&&<p className="booking-website-status" role="status">Searching the web…</p>}
   {results&&<><p className="booking-website-hint">Check the place and location, then tap a result.</p><div className="booking-website-candidates">{results.candidates.map(candidate=>externalOnly?<a className="booking-website-candidate" key={candidate.candidateId} href={candidate.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${candidate.title} — ${domain(candidate.url)}`}>
    <span className="booking-website-copy"><small>{domain(candidate.url)}</small><strong>{candidate.title}</strong>{candidate.snippet&&<span className="booking-website-snippet">{candidate.snippet}</span>}</span><span className="booking-website-open" aria-hidden="true"><Icon name="arrowUpRight" size={20}/></span></a>:<button type="button" className="booking-website-candidate" disabled={busy} onClick={()=>choose(candidate.candidateId)} key={candidate.candidateId} aria-label={`Open ${candidate.title} — ${domain(candidate.url)}`}>
    <span className="booking-website-copy"><small>{domain(candidate.url)}</small><strong>{candidate.title}</strong>{candidate.snippet&&<span className="booking-website-snippet">{candidate.snippet}</span>}</span><span className="booking-website-open" aria-hidden="true">{opening===candidate.candidateId?<span className="booking-website-spinner"/>:<Icon name="arrowUpRight" size={20}/>}</span></button>)}</div>{!results.candidates.length&&<p>No website results found. Try the venue’s contact options.</p>}</>}
   {opening&&<p className="sr-only" role="status">Opening selected website…</p>}
   {error&&<p className="booking-website-error" role="alert">{error}</p>}
   {!busy&&configured&&<button type="button" className="booking-website-retry" onClick={()=>setAttempt(n=>n+1)}>Search again</button>}
   {error&&<a className="booking-website-retry" href={venueSearchUrl(snapshot)} target="_blank" rel="noopener noreferrer">Search in your browser<Icon name="arrowUpRight" size={14}/></a>}
  </div>
  <details className="booking-website-disclosure"><summary>Results via {provider} · Nothing booked</summary><p>Search results are leads, not verified booking providers. Only the venue’s public details are used for search. No guest details or reservation request are sent.</p></details>
 </section>;
}
