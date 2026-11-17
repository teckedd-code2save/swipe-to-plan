import GettingReady from './GettingReady.jsx';
import {checkedVisit} from './decision-evidence.js';
import {useQueryClient} from '@tanstack/react-query';
import VenueMenuEvidence from './VenueMenuEvidence.jsx';
import RouteGuide from './RouteGuide.jsx';
import BookingAction from './BookingAction.jsx';
import {useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {ACTIVITY_NAMES,Icon,dateLabel} from './PlannerIcons.jsx';
import {formatMoney} from './money.js';

export function usePlaceChecks(plan) {
  const stops = plan?.stops.filter(s=>s.item?.entityId&&s.item?.provenance?.provider==='qloo').map(s=>({entityId:s.item.entityId,start:s.start,end:s.end})) || [];
  const discovery=plan?.phase==='discovery'||plan?.phase==='needs_timing';
  const payload = stops.length ? JSON.stringify({date:plan.request.date,stops,discovery}) : '';
  const [state,setState] = useState({key:'',status:'idle'}), [revision,setRevision] = useState(0);
  useEffect(()=>{
    if(!payload || !JSON.parse(payload).stops.length) return;
    const abort = new AbortController();
    setState({key:payload,status:'loading'});
    const request=JSON.parse(payload);
    const task=request.discovery?Promise.all(request.stops.map(async stop=>{try{const place=await api.place(stop.entityId,abort.signal);return {...stop,place,hours:{status:'unknown',summary:'Choose a time to check reported opening hours.'},menu:{status:place.links?.menu?'link_available':place.highlights?.length?'highlights_only':'unknown',highlights:place.highlights||[],link:place.links?.menu||null,priceVerified:false}};}catch{return {...stop,error:'Venue details could not be loaded.'};}})).then(stops=>({stops})):api.placeChecks({date:request.date,stops:request.stops},abort.signal);
    task.then(data=>{if(!abort.signal.aborted)setState({key:payload,status:'ready',data});}).catch(e=>{if(!abort.signal.aborted)setState({key:payload,status:'error',error:e.message});});
    return ()=>abort.abort();
  },[payload,revision]);
  return {...(state.key===payload?state:{status:payload?'loading':'idle'}),refresh:()=>setRevision(v=>v+1)};
}
const hourTone = status => status==='fits_reported_hours'?'found':['outside_reported_hours','reported_closed'].includes(status)?'attention':'unknown';
const hourLabel = status => ({fits_reported_hours:'Fits reported hours',outside_reported_hours:'Timing needs a look',reported_closed:'Reported closed'})[status] || 'Hours to confirm';
const periods = rows => rows === null || rows === undefined ? 'Not listed' : rows.length ? rows.map(row=>`${row.opens}–${row.closes}${row.overnight?' (+1 day)':''}`).join(' · ') : 'Closed';
function VenueLinks({place}) {
  return <div className="pg-links">{place.links?.website&&<a href={place.links.website} target="_blank" rel="noreferrer">Venue website <Icon name="arrowUpRight" size={14}/></a>}{place.links?.menu&&<a href={place.links.menu} target="_blank" rel="noreferrer">Menu <Icon name="arrowUpRight" size={14}/></a>}{place.links?.map&&<a href={place.links.map} target="_blank" rel="noreferrer">Google Maps <Icon name="arrowUpRight" size={14}/></a>}</div>;
}
export function BeforeGoing(props) { return <GettingReady {...props}/>; }

export function PlaceCheckNotice({checks,onOpen}) {
  const issues=checks.data?.stops.filter(s=>hourTone(s.hours?.status)==='attention').length||0;
  if(!issues)return null;
  return <button className="pg-plan-alert" onClick={onOpen}><Icon name="clock" size={17}/><span>{issues===1?'One stop needs a timing check.':`${issues} stops need a timing check.`}<small>I found a mismatch with reported opening hours.</small></span><Icon name="arrow" size={17}/></button>;
}
export function PlaceDetails({stop,plan,checks,onClose,onSwap,canSwap,initialView='overview',onSelect,onTiming,onBookingTiming,routeScope,bookingScope,savedAreas,onSaveArea,signedIn}) {
  const cache=useQueryClient();
  const [view,setView]=useState(initialView);
  const filled=plan.stops.filter(s=>s.item);
  const dialog=useRef(null),[imageFailed,setImageFailed]=useState(false);
  const existingReport=checkedVisit(checks,stop),[detail,setDetail]=useState(null);
  useEffect(()=>{if(existingReport?.place||stop.id!=='shortlist-place')return;const abort=new AbortController();api.place(stop.item.entityId,abort.signal).then(place=>{if(!abort.signal.aborted){setDetail({entityId:stop.item.entityId,place});cache.setQueryData(['venue',stop.item.entityId],place);}}).catch(()=>{});return()=>abort.abort();},[stop.item.entityId,existingReport?.place]);
  const currentDetail=detail?.entityId===stop.item.entityId?detail.place:null;
  const report=existingReport||(currentDetail?{place:currentDetail,hours:{status:'unknown',summary:'Choose a visit time to check reported opening hours.'},menu:{highlights:currentDetail.highlights||[],link:currentDetail.links?.menu||null}}:null),place=report?.place||stop.item;
  useEffect(()=>{const element=dialog.current,trigger=document.activeElement;element.showModal();return()=>{element.close();if(trigger?.isConnected)trigger.focus({preventScroll:true});};},[]);
  const visitDay=plan.request.date?new Date(`${plan.request.date}T12:00:00Z`).toLocaleDateString('en-US',{weekday:'long',timeZone:'UTC'}):null;
  const visitHours=visitDay&&Object.entries(place.hours||{}).find(([day])=>day.toLowerCase()===visitDay.toLowerCase());
  return <dialog className="pl-dialog pg-dialog pg-place-sheet" ref={dialog} onCancel={onClose} aria-labelledby="place-details-title">
    <div className="pg-sheet-header">
      <div className="pg-sheet-image">{(place.image||stop.item.image)&&!imageFailed?<img src={place.image||stop.item.image} alt="" onError={()=>setImageFailed(true)}/>:<Icon name={stop.intent} size={32}/>}</div>
      <div className="pg-sheet-identity"><span className="pg-sheet-eyebrow">{ACTIVITY_NAMES[stop.intent]}</span><h2 id="place-details-title">{place.name}</h2>{place.address&&<p><Icon name="pin" size={14}/>{place.address}</p>}</div>
      <button type="button" className="pl-dialog-close" aria-label="Close place details" onClick={onClose}><Icon name="close" size={20}/></button>
    </div>
    {filled.length>1&&stop.id!=='shortlist-place'&&<label className="pg-stop-picker">Place in your day<select aria-label="Place to review" value={stop.id} onChange={e=>onSelect?.(e.target.value,view)}>{filled.map(s=><option key={s.id} value={s.id}>{s.start||'Time to choose'} · {s.item.name}</option>)}</select></label>}
    <nav className="pg-detail-tabs" aria-label="Place details sections">{[['overview','Overview','info'],['practical','Hours & menu','clock'],['route','Getting there','map'],['booking','Booking','calendar']].map(([id,label,icon])=><button type="button" key={id} aria-pressed={view===id} onClick={()=>setView(id)}><Icon name={icon} size={16}/>{label}</button>)}</nav>
    <div className={`pg-sheet-layout pg-dialog-scroll ${view!=='overview'?'pg-sheet-focused':''}`} key={view}>
      <main className="pg-sheet-content">
        {view==='overview'&&<><h3>About this place</h3><p className="pg-description">{place.description||'Explore the hours, menu and booking options to see whether this place fits your day.'}</p>{!!place.tagNames?.length&&<div className="pg-tags">{place.tagNames.filter(tag=>tag.toLowerCase()!=='place').slice(0,5).map(tag=><span key={tag}>{tag}</span>)}</div>}{!!place.practicalTags?.length&&<section className="pg-detail-section"><h3>Good to know</h3><div className="pg-tags">{[...new Set(place.practicalTags)].slice(0,8).map((tag,i)=><span key={`${tag}-${i}`}>{tag}</span>)}</div></section>}<button className="pg-sheet-next" onClick={()=>setView('practical')}><Icon name="clock" size={18}/><span>Plan your visit<small>Opening hours and menu</small></span><Icon name="arrow" size={18}/></button></>}
        {view==='booking'?<BookingAction onTiming={onBookingTiming||onTiming} scope={bookingScope} context={routeScope} plan={plan} stop={stop} place={place} compact/>:view==='route'?<RouteGuide onSaveArea={onSaveArea} signedIn={signedIn} savedAreas={savedAreas} routeScope={routeScope} plan={stop.id==='shortlist-place'?{...plan,stops:[stop]}:plan} checks={checks} initialStopId={stop.id} onTiming={onTiming}/>:null}
        {view==='practical'&&<>
          <section className={`pg-sheet-hours ${hourTone(report?.hours?.status)}`}><div className="pg-section-title"><Icon name="clock" size={18}/><h3>Opening hours</h3></div>
            {hourTone(report?.hours?.status)!=='unknown'&&<p className="pg-sheet-hours-status">{hourLabel(report?.hours?.status)}{report?.hours?.summary&&` · ${report.hours.summary}`}</p>}
            {report?.hours?.intervals&&<p>{dateLabel(plan.request.date)} · {periods(report.hours.intervals)}</p>}
            {place.hours?<>{visitHours&&!report?.hours?.intervals&&<div className="pg-sheet-day"><span>{visitDay}</span><strong>{periods(visitHours[1])}</strong></div>}<details className="pg-week-disclosure"><summary>Full weekly schedule</summary><dl className="pg-week">{Object.entries(place.hours).map(([day,rows])=><div key={day}><dt>{day}</dt><dd>{periods(rows)}</dd></div>)}</dl></details></>:<p className="pg-note">{checks.status==='loading'?'Checking reported hours…':report?.error?'Hours couldn’t load. Try again shortly.':'Hours are not listed. Check with the venue before visiting.'}</p>}
            {place.hours&&<p className="pg-note">Reported hours · special dates may differ.</p>}
            {hourTone(report?.hours?.status)==='attention'&&canSwap&&<button className="pg-link" onClick={onSwap}>Find another place <Icon name="arrow" size={15}/></button>}
          </section><VenueMenuEvidence place={place}/>
        </>}
        {checks.status==='error'&&<p className="pg-note" role="alert">Details couldn’t load. <button className="pg-link" onClick={checks.refresh}>Try again</button></p>}
        {report?.place&&view==='overview'&&<details className="pg-source"><summary>About these details</summary><p>Place details supplied by Qloo. Retrieved {new Date(place.provenance.retrievedAt).toLocaleString()}. Its last update time is unknown; holidays and private events may differ.</p></details>}
      </main>
      {view==='overview'&&<aside className="pg-sheet-sidebar" aria-label="Visit essentials">
        <section><span className="pg-sheet-eyebrow">Your visit</span><div className="pg-sheet-fact"><Icon name="calendar" size={18}/><div><strong>{stop.start&&stop.end?`${stop.start}–${stop.end}`:'Choose a time'}</strong><small>{stop.start?dateLabel(plan.request.date):'Find the place first, choose when next.'}</small></div></div>{onTiming&&<button type="button" className="pg-link" onClick={onTiming}>{stop.start?'Review visit time':'Set visit time'}<Icon name="arrow" size={14}/></button>}</section>
        <section><span className="pg-sheet-eyebrow">Price guide</span><strong className="pg-sheet-price">{place.facts?.price?.level?['','Lower price range','Mid price range','Higher price range','Premium price range'][place.facts.price.level]:'Prices not listed'}</strong><small>Venue price band, not a quote.</small><div className="pg-sheet-budget"><span>{plan.request.budget==null?'Suggested outing total':'Your outing limit'}</span><strong>{formatMoney(plan.request.budget??plan.allowance?.amount,plan.request.currency)}</strong></div></section>
        <section><span className="pg-sheet-eyebrow">Explore directly</span><VenueLinks place={place}/>{!place.links?.website&&!place.links?.menu&&!place.links?.map&&<small>Website and map links aren’t available.</small>}</section>
      </aside>}
    </div>
    {view==='overview'&&<footer className="pg-sheet-footer"><span><Icon name="calendar" size={18}/><span>Make it happen<small>Check online booking or contact the venue.</small></span></span><button className="pl-button" onClick={()=>setView('booking')}>Booking options <Icon name="arrow" size={17}/></button></footer>}
  </dialog>;
}
