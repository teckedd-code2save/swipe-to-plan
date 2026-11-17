import GettingReady from './GettingReady.jsx';
import {checkedVisit} from './decision-evidence.js';
import {useQueryClient} from '@tanstack/react-query';
import VenueMenuEvidence from './VenueMenuEvidence.jsx';
import RouteGuide from './RouteGuide.jsx';
import BookingAction from './BookingAction.jsx';
import {useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {ACTIVITY_NAMES,Icon,PERSON_COLORS,dateLabel} from './PlannerIcons.jsx';
import {formatMoney,allowanceLabel} from './money.js';

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
  const report=existingReport||(currentDetail?{place:currentDetail,hours:{status:'unknown',summary:'Choose a visit time to check reported opening hours.'},menu:{highlights:currentDetail.highlights||[],link:currentDetail.links?.menu||null}}:null),place=report?.place||stop.item,allowance=plan.budget.allocations.find(a=>a.stopId===stop.id||!a.stopId&&a.intent===stop.intent);
  useEffect(()=>{const element=dialog.current,trigger=document.activeElement;element.showModal();return()=>{element.close();if(trigger?.isConnected)trigger.focus({preventScroll:true});};},[]);
  return <dialog className="pl-dialog pg-dialog" ref={dialog} onCancel={onClose} aria-labelledby="place-details-title">
    <div className="pg-dialog-top"><div className="pg-visit-control"><span>{ACTIVITY_NAMES[stop.intent]} · {stop.start&&stop.end?`${stop.start}–${stop.end}`:"Time to choose"}</span>{onTiming&&<button type="button" className="pg-link" onClick={onTiming}><Icon name="clock" size={15}/>{stop.start?'Review visit time':'Find a good time'}</button>}</div><button type="button" className="pl-dialog-close" aria-label="Close place details" onClick={onClose}><Icon name="close" size={18}/></button></div>
    {filled.length>1&&stop.id!=='shortlist-place'&&<label className="pg-stop-picker">Place in your day<select aria-label="Place to review" value={stop.id} onChange={e=>onSelect?.(e.target.value,view)}>{filled.map(s=><option key={s.id} value={s.id}>{s.start||'Time to choose'} · {s.item.name}</option>)}</select></label>}
    <nav className="pg-detail-tabs" aria-label="Place details sections">{[['overview','Overview','info'],['practical','Hours & menu','clock'],['route','Getting there','map'],['booking','Booking','calendar']].map(([id,label,icon])=><button type="button" key={id} aria-pressed={view===id} onClick={()=>setView(id)}><Icon name={icon} size={16}/>{label}</button>)}</nav>
    <div className="pg-dialog-scroll" key={view}>
      {view==='overview'&&<div className={`pg-photo ${!place.image||imageFailed?'empty':''}`}>{place.image&&!imageFailed?<img src={place.image} alt={place.name} onError={()=>setImageFailed(true)}/>:<Icon name={stop.intent} size={56}/>}</div>}
      <div className="pg-detail-body"><div className="pg-place-heading"><h2 id="place-details-title">{place.name}</h2><p><Icon name="pin" size={16}/>{place.address}</p></div>
        {view==='overview'&&place.description&&<p className="pg-description">{place.description}</p>}
        {view==='overview'&&!!place.tagNames?.length&&<div className="pg-tags">{place.tagNames.slice(0,5).map(tag=><span key={tag}>{tag}</span>)}</div>}
        {view==='booking'?<BookingAction onTiming={onBookingTiming||onTiming} scope={bookingScope} context={routeScope} plan={plan} stop={stop} place={place} compact/>:view==='route'?<RouteGuide onSaveArea={onSaveArea} signedIn={signedIn} savedAreas={savedAreas} routeScope={routeScope} plan={stop.id==='shortlist-place'?{...plan,stops:[stop]}:plan} checks={checks} initialStopId={stop.id} onTiming={onTiming}/>:<>
        {view==='practical'&&<section className={`pg-hours ${hourTone(report?.hours?.status)}`}><div className="pg-section-title"><Icon name="clock" size={20}/><h3>{checks.status==='loading'?'Checking your timing…':hourLabel(report?.hours?.status)}</h3></div><p>{report?.hours?.summary||(report?.error?'Opening hours couldn’t load. Try again shortly.':'Opening hours aren’t listed yet.')}</p>{report?.hours?.intervals&&<strong>{dateLabel(plan.request.date)} · {periods(report.hours.intervals)}</strong>}<small>Reported weekly schedule. Special dates may differ.</small>{place.hours&&<div className="pg-open-hours"><h4>Reported weekly hours</h4><dl className="pg-week">{Object.entries(place.hours).map(([day,rows])=><div key={day}><dt>{day}</dt><dd>{periods(rows)}</dd></div>)}</dl></div>}{(hourTone(report?.hours?.status)==='attention'||!stop.start)&&onTiming&&<button className="pg-link" onClick={onTiming}>Adjust the visiting time <Icon name="clock" size={15}/></button>}{hourTone(report?.hours?.status)==='attention'&&canSwap&&<button className="pg-link" onClick={onSwap}>Find another place <Icon name="arrow" size={15}/></button>}</section>}
        {view==='practical'&&<VenueMenuEvidence place={place}/>}
        <VenueLinks place={place}/>
        {checks.status==='error'&&<p className="pg-note" role="alert">Details couldn’t load. <button className="pg-link" onClick={checks.refresh}>Try again</button></p>}
        <section className="pg-detail-section"><h3>Budget & prices</h3><div className="pg-spend"><span><strong>{formatMoney(plan.request.budget??plan.allowance?.amount,plan.request.currency)}</strong><small>{(plan.request.budget==null?'Suggested outing total':'Your outing limit')}</small></span><span><strong>{place.facts?.price?.level?['','Lower price range','Mid price range','Higher price range','Premium price range'][place.facts.price.level]:'Prices to confirm'}</strong><small>{place.facts?.price?.level?'Relative price band, not a quote':'No price band provided'}</small></span></div><small className="pg-note">Check the venue’s menu for current prices.</small></section>
        {view==='overview'&&!!place.practicalTags?.length&&<section className="pg-detail-section"><h3>Reported features</h3><div className="pg-tags">{place.practicalTags.map((tag,i)=><span key={`${tag}-${i}`}>{tag}</span>)}</div></section>}
        <button className="pl-button" onClick={()=>setView('booking')}>Booking options</button>
        {report?.place&&<details className="pg-source"><summary>Sources & freshness</summary><p>Place details supplied by Qloo. Retrieved {new Date(place.provenance.retrievedAt).toLocaleString()}. Its last update time is unknown; holidays and private events may differ.</p></details>}
        </>}
      </div>
    </div>

  </dialog>;
}
