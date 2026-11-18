import {useState} from 'react';
import {reservationEligible} from './booking-actions.js';
import {PlaceDetails} from './PlaceGuide.jsx';
import {Icon} from './PlannerIcons.jsx';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function normalizeNamedVenueLookup(result){
 if(result?.source!=='qloo'||!['candidates','not_found'].includes(result.matchStatus)||typeof result.query!=='string'||!Array.isArray(result.candidates)||result.candidates.length>8)throw Error('The named-place results could not be verified. Please try again.');
 const seen=new Set();
 const candidates=result.candidates.map(candidate=>{
  if(!uuid.test(candidate?.entityId||'')||candidate.provenance?.provider!=='qloo'||typeof candidate.name!=='string'||!candidate.name.trim()||typeof candidate.address!=='string'||seen.has(candidate.entityId.toUpperCase()))throw Error('The named-place results could not be verified. Please try again.');
  seen.add(candidate.entityId.toUpperCase());return candidate;
 });
 if((result.matchStatus==='not_found')!==!candidates.length)throw Error('The named-place results could not be verified. Please try again.');
 return {query:result.query,area:typeof result.area==='string'?result.area:'',candidates,matchStatus:result.matchStatus,source:'qloo',retrievedAt:result.retrievedAt};
}
export function NamedVenueResults({result,onOpen}){
 return <section className="named-venue-results" aria-label="Named place results"><h3>{result.query}</h3>{result.area&&<p className="named-venue-area"><Icon name="pin" size={14}/>{result.area}</p>}
 {result.candidates.length?<><p>{result.candidates.length>1?'Check the name and address to choose the right place.':'Check this name and address before continuing.'}</p><ul>{result.candidates.map(candidate=><li key={candidate.entityId}><div><strong>{candidate.name}</strong><span>{candidate.address}</span>{candidate.locationMatch==='needs_review'&&<small>Check location · the address does not fully match your requested area.</small>}</div><button type="button" className="pg-link" onClick={()=>onOpen?.(candidate)} aria-label={`Open details for ${candidate.name} at ${candidate.address}`}>Details<Icon name="arrowUpRight" size={16}/></button></li>)}</ul><small>Qloo place records. Your outing has not changed.</small></>:<p role="status">No matching name candidates were found. Try its full name or a more specific address. Nearby alternatives have not replaced your request.</p>}
 </section>;
}
// A named lookup opens evidence, not a scheduled visit. It must not inherit a
// confirmed time, private booking ledger or write permission from an existing day.
export function NamedVenueDetails({candidate,brief,onClose}){
 const [visit,setVisit]=useState(null),[editing,setEditing]=useState(false),[error,setError]=useState('');
 const [draft,setDraft]=useState({date:'',localTime:'',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',adults:'1',children:'0'});
 const change=(key,value)=>{setDraft(previous=>({...previous,[key]:value}));setVisit(null);setError('');};
 function apply(event){event.preventDefault();const next={date:draft.date,localTime:draft.localTime,timeZone:draft.timeZone.trim(),party:{adults:Number(draft.adults),children:Number(draft.children)}};
  if(!reservationEligible(next)){setError('Choose a future date and time, a valid time zone, and the number of guests.');return;}
  setVisit(next);setEditing(false);setError('');
 }
 const stop={id:'named-venue-visit',item:{...candidate,id:`qloo:${candidate.entityId}`},intent:'activity',start:visit?.localTime||null,end:null,connections:[],durationMinutes:60};
 const request={...brief,date:visit?.date||'',party:visit?.party||{adults:1,children:0},timing:{dateConfirmed:!!visit,timeConfirmed:!!visit,mode:'flexible'}};
 const plan={phase:'discovery',request,stops:[stop],timeZone:visit?.timeZone||null};
 const checks={status:'ready',data:{stops:[{entityId:candidate.entityId,start:stop.start,end:null,place:candidate,hours:{status:'unknown',summary:'Availability has not been verified.'}}]}};
 const setup=<section className="named-venue-visit" aria-label="Visit details for this place"><h3>Your visit</h3><p className="pg-note">These details are for this venue only. Your existing outing stays unchanged.</p>
  {visit&&<p>{visit.date} · {visit.localTime} · {visit.timeZone} · {visit.party.adults} adults{visit.party.children?` + ${visit.party.children} children`:''}</p>}
  {!editing?<button type="button" className="pg-link" onClick={()=>setEditing(true)}>{visit?'Edit visit details':'Set visit details'}</button>:<form onSubmit={apply}><div className="named-venue-fields"><label>Date<input type="date" value={draft.date} onChange={e=>change('date',e.target.value)} required/></label><label>Time<input type="time" value={draft.localTime} onChange={e=>change('localTime',e.target.value)} required/></label><label>Time zone<input aria-label="Visit time zone" value={draft.timeZone} maxLength={100} onChange={e=>change('timeZone',e.target.value)} required/></label><label>Adults<input type="number" min="1" max="100" value={draft.adults} onChange={e=>change('adults',e.target.value)} required/></label><label>Children<input type="number" min="0" max="100" value={draft.children} onChange={e=>change('children',e.target.value)} required/></label></div><p className="pg-note">The initial time zone is your browser’s. Confirm the venue’s local time zone.</p><button type="submit" className="pl-button">Use these visit details</button>{error&&<p role="alert">{error}</p>}</form>}
 </section>;
 return <PlaceDetails stop={stop} plan={plan} checks={checks} bookingScope={{allowed:true,type:'guest'}} routeScope={`named-venue:${candidate.entityId}`} visitSetup={setup} onTiming={()=>setEditing(true)} onBookingTiming={()=>setEditing(true)} onClose={onClose} canSwap={false}/>;
}
