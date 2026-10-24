import {useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {ACTIVITY_NAMES,Icon,PERSON_COLORS,dateLabel} from './PlannerIcons.jsx';
import {formatMoney} from './money.js';

export function usePlaceChecks(plan) {
  const stops = plan?.stops.filter(s=>s.item?.entityId&&s.item?.provenance?.provider==='qloo').map(s=>({entityId:s.item.entityId,start:s.start,end:s.end})) || [];
  const payload = stops.length ? JSON.stringify({date:plan.request.date,stops}) : '';
  const [state,setState] = useState({key:'',status:'idle'}), [revision,setRevision] = useState(0);
  useEffect(()=>{
    if(!payload || !JSON.parse(payload).stops.length) return;
    const abort = new AbortController();
    setState({key:payload,status:'loading'});
    api.placeChecks(JSON.parse(payload),abort.signal).then(data=>{if(!abort.signal.aborted)setState({key:payload,status:'ready',data});}).catch(e=>{if(!abort.signal.aborted)setState({key:payload,status:'error',error:e.message});});
    return ()=>abort.abort();
  },[payload,revision]);
  return {...(state.key===payload?state:{status:payload?'loading':'idle'}),refresh:()=>setRevision(v=>v+1)};
}
const checkedStop = (checks,stop) => checks.data?.stops.find(s=>s.entityId===stop.item?.entityId&&s.start===stop.start&&s.end===stop.end);
const hourTone = status => status==='fits_reported_hours'?'found':['outside_reported_hours','reported_closed'].includes(status)?'attention':'unknown';
const hourLabel = status => ({fits_reported_hours:'Fits reported hours',outside_reported_hours:'Timing needs a look',reported_closed:'Reported closed'})[status] || 'Hours to confirm';
const periods = rows => rows === null || rows === undefined ? 'Not listed' : rows.length ? rows.map(row=>`${row.opens}–${row.closes}${row.overnight?' (+1 day)':''}`).join(' · ') : 'Closed';
function routeLink(plan, mode) {
  const places=plan.stops.filter(s=>s.item).map(s=>s.item);
  if(!places.length)return null;
  const point=p=>p.coordinates?`${p.coordinates.lat},${p.coordinates.lng}`:`${p.name}, ${p.address}`;
  const url=new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api','1');url.searchParams.set('destination',point(places.at(-1)));url.searchParams.set('travelmode',mode);
  if(places.length>1)url.searchParams.set('origin',point(places[0]));
  if(places.length>2)url.searchParams.set('waypoints',places.slice(1,-1).map(point).join('|'));
  return url.href;
}
function VenueLinks({place}) {
  return <div className="pg-links">{place.links?.website&&<a href={place.links.website} target="_blank" rel="noreferrer">Venue website <Icon name="arrowUpRight" size={14}/></a>}{place.links?.menu&&<a href={place.links.menu} target="_blank" rel="noreferrer">Menu <Icon name="arrowUpRight" size={14}/></a>}{place.links?.phone&&<a href={place.links.phone}>Call venue <Icon name="arrowUpRight" size={14}/></a>}{place.links?.map&&<a href={place.links.map} target="_blank" rel="noreferrer">Google Maps <Icon name="arrowUpRight" size={14}/></a>}</div>;
}
export function BeforeGoing({plan,checks,done,setDone,onDetails}) {
  const [mode,setMode]=useState('walking');
  const filled=plan.stops.filter(s=>s.item), reports=checks.data?.stops||[];
  const fits=reports.filter(s=>s.hours?.status==='fits_reported_hours').length;
  const flags=reports.filter(s=>hourTone(s.hours?.status)==='attention').length;
  const unknown=filled.length-fits-flags;
  const summary=[fits?`${fits} stop${fits===1?'':'s'} ${fits===1?'fits':'fit'} reported hours`:'',flags?`${flags} timing issue${flags===1?'':'s'} to review`:'',unknown?`${unknown} with hours to confirm`:''].filter(Boolean).join(' · ');
  return <section className="pg-preflight">
    <div className="pg-intro"><span className="pg-eyebrow">A LITTLE LESS HOMEWORK</span><h2>Let’s get you ready.</h2><p>I’m checking your times against reported hours and gathering the useful details for each stop.</p></div>
    <div className={`pg-progress ${flags?'attention':''}`} role="status"><Icon name={checks.status==='loading'?'clock':flags||unknown?'info':'check'} size={18}/><span>{checks.status==='loading'?'Checking your places…':checks.status==='error'?'The place check needs another try.':summary}</span><button onClick={checks.refresh} disabled={checks.status==='loading'}>Refresh</button></div>
    {checks.error&&<p className="pg-note" role="alert">{checks.error}</p>}
    <div className="pg-check-places">{filled.map(stop=>{const report=checkedStop(checks,stop);return <button className="pg-check-place" key={stop.id} onClick={()=>onDetails(stop)}><span className="pg-check-time">{stop.start}</span><span><strong>{stop.item.name}</strong><span className={`pg-badge ${hourTone(report?.hours?.status)}`}>{checks.status==='loading'?'Checking hours…':hourLabel(report?.hours?.status)}</span><small>{report?.error||report?.hours?.summary||'Open the place to see its details.'}</small></span><Icon name="arrow" size={18}/></button>;})}</div>
    <p className="pg-note">Weekly hours are a useful first check. Special dates, kitchen hours and availability still need the venue’s confirmation.</p>
    <div className="pg-route"><Icon name="map" size={25}/><div><h3>Your route, ready to open.</h3><p>{filled.length>1?'Your stops are already in order. Choose how you’ll travel.':'Choose how you’ll get there. Maps will ask for your starting point.'}</p><div className="pg-modes" aria-label="Travel mode">{[['walking','Walk'],['transit','Transit'],['driving','Drive']].map(([value,label])=><button key={value} aria-pressed={mode===value} onClick={()=>setMode(value)}>{label}</button>)}</div><a className="pg-link" href={routeLink(plan,mode)} target="_blank" rel="noreferrer">See route & travel times <Icon name="arrowUpRight" size={15}/></a><small>Maps supplies the route estimate. Your plan’s travel buffers haven’t been adjusted.</small></div></div>
    <div className="pg-human"><h3>The final human touch</h3><p>Each place has an editable enquiry ready for you—your date, group and time included. Open a place to copy it or call the venue.</p><label><input type="checkbox" checked={!!done.book} onChange={e=>setDone(d=>({...d,book:e.target.checked}))}/><span>I’ve confirmed bookings, prices and any specific needs with the venues.</span></label><small>This is your confirmation. Unstressed hasn’t contacted or booked a venue.</small></div>
  </section>;
}
export function PlaceCheckNotice({checks,onOpen}) {
  const issues=checks.data?.stops.filter(s=>hourTone(s.hours?.status)==='attention').length||0;
  if(!issues)return null;
  return <button className="pg-plan-alert" onClick={onOpen}><Icon name="clock" size={17}/><span>{issues===1?'One stop needs a timing check.':`${issues} stops need a timing check.`}<small>I found a mismatch with reported opening hours.</small></span><Icon name="arrow" size={17}/></button>;
}
function enquiry(plan,stop) {
  return `Hello ${stop.item.name},\n\nWe’re planning to visit on ${dateLabel(plan.request.date)} ${plan.request.date.slice(0,4)}, around ${stop.start}–${stop.end}, with ${plan.request.party.adults} adult${plan.request.party.adults===1?'':'s'}${plan.request.party.children?` and ${plan.request.party.children} ${plan.request.party.children===1?'child':'children'}`:''}.\n\nCould you confirm you’ll be open, whether we need a reservation, and any deposits or entry fees? Please share your current menu or prices${stop.intent==='dinner'||stop.intent==='coffee'?' and the kitchen’s serving hours':''}.\n\nWe’ll confirm any dietary, accessibility or other specific needs with you before visiting.\n\nThank you!`;
}
export function PlaceDetails({stop,plan,checks,onClose,onSwap,canSwap}) {
  const dialog=useRef(null),[imageFailed,setImageFailed]=useState(false),[draft,setDraft]=useState(()=>enquiry(plan,stop)),[copyState,setCopyState]=useState('');
  const report=checkedStop(checks,stop),place=report?.place||stop.item,allowance=plan.budget.allocations.find(a=>a.intent===stop.intent);
  useEffect(()=>{const element=dialog.current,trigger=document.activeElement;element.showModal();return()=>{element.close();if(trigger?.isConnected)trigger.focus({preventScroll:true});};},[]);
  async function copy(){try{await navigator.clipboard.writeText(draft);setCopyState('Copied. Ready to send yourself.');}catch{setCopyState('Select and copy the enquiry below.');}}
  return <dialog className="pl-dialog pg-dialog" ref={dialog} onCancel={onClose} aria-labelledby="place-details-title">
    <div className="pg-dialog-top"><span>{ACTIVITY_NAMES[stop.intent]} · {stop.start}–{stop.end}</span><button type="button" className="pl-dialog-close" aria-label="Close place details" onClick={onClose}>Close<Icon name="close" size={18}/></button></div>
    <div className="pg-dialog-scroll">
      <div className={`pg-photo ${!place.image||imageFailed?'empty':''}`}>{place.image&&!imageFailed?<img src={place.image} alt={place.name} onError={()=>setImageFailed(true)}/>:<Icon name={stop.intent} size={56}/>}<span>{plan.provenance.provider==='qloo'?'DISCOVERED THROUGH QLOO':'YOUR PLACE'}</span></div>
      <div className="pg-detail-body"><div className="pg-place-heading"><h2 id="place-details-title">{place.name}</h2><p><Icon name="pin" size={16}/>{place.address}</p></div>
        {place.description&&<p className="pg-description">{place.description}</p>}
        {!!place.tagNames?.length&&<div className="pg-tags">{place.tagNames.map(tag=><span key={tag}>{tag}</span>)}</div>}
        <VenueLinks place={place}/>
        <section className={`pg-hours ${hourTone(report?.hours?.status)}`}><div className="pg-section-title"><Icon name="clock" size={20}/><h3>{checks.status==='loading'?'Checking your timing…':hourLabel(report?.hours?.status)}</h3></div><p>{report?.hours?.summary||report?.error||'No usable weekly hours were supplied for this place.'}</p>{report?.hours?.intervals&&<strong>{dateLabel(plan.request.date)} · {periods(report.hours.intervals)}</strong>}<small>Qloo’s reported weekly schedule, not confirmation for this date.</small>{place.hours&&<details><summary>See the weekly hours</summary><dl className="pg-week">{Object.entries(place.hours).map(([day,rows])=><div key={day}><dt>{day}</dt><dd>{periods(rows)}</dd></div>)}</dl></details>}{hourTone(report?.hours?.status)==='attention'&&canSwap&&<button className="pg-link" onClick={onSwap}>Find another place <Icon name="arrow" size={15}/></button>}</section>
        <section className="pg-detail-section"><span className="pg-eyebrow">THE FOOD & THE SPEND</span><h3>A feel for the place.</h3>{!!place.highlights?.length&&<p>{place.highlights.join(' · ')}</p>}<div className="pg-spend"><span><strong>{formatMoney(allowance?.amount||0,plan.request.currency)}</strong><small>Your group allowance</small></span><span><strong>{place.facts?.price?.level?['','Lower price range','Mid price range','Higher price range','Premium price range'][place.facts.price.level]:'Prices to confirm'}</strong><small>{place.facts?.price?.level?'Relative Qloo price band, not a quote':'No price band provided'}</small></span></div><p className="pg-note">{place.links?.menu?'Open the menu above for current dishes and prices.':place.links?.website?'The venue website above is the best next step for its current menu and prices.':'Use the Maps or contact link to ask for current prices.'} Your allowance is not an estimate of the bill.</p></section>
        {!!stop.connections.length&&<section className="pg-detail-section"><span className="pg-eyebrow">THE PEOPLE BEHIND THIS PICK</span><h3>A few familiar threads.</h3><div className="pg-connections">{plan.people.map((person,index)=>{const edges=stop.connections.filter(e=>e.personId===person.id);return edges.length?<div key={person.id}><span className="cs-person-dot" style={{background:PERSON_COLORS[index%6]}}>{person.name[0]}</span><div><strong>{person.name}</strong>{edges.map(edge=><p key={edge.id}><b>{plan.tasteMap.nodes.find(n=>n.id===edge.from)?.label}</b><span>{edge.kind==='search_signal'?'Used to discover this place; not a confirmed individual match.':edge.label}</span></p>)}</div></div>:null;})}</div></section>}
        {!!place.practicalTags?.length&&<section className="pg-detail-section"><h3>Reported features</h3><div className="pg-tags">{place.practicalTags.map((tag,i)=><span key={`${tag}-${i}`}>{tag}</span>)}</div><p className="pg-note">Provider descriptions don’t establish suitability. Ask the venue about your specific dietary or access needs.</p></section>}
        <details className="pg-enquiry"><summary><span><Icon name="edit" size={19}/><strong>Your enquiry, already drafted.</strong></span><Icon name="plus" size={18}/></summary><p>Edit anything you’d like to ask, then copy it or call the venue. Nothing is sent automatically.</p><label htmlFor="venue-enquiry">Message to {place.name}</label><textarea id="venue-enquiry" value={draft} onChange={e=>{setDraft(e.target.value);setCopyState('');}} rows={10}/><div><button className="pl-button" onClick={copy}><Icon name="copy" size={15}/>Copy enquiry</button>{place.links?.phone&&<a className="pl-secondary-button" href={place.links.phone}>Call venue</a>}</div><p role="status">{copyState}</p></details>
        {report?.place&&<p className="pg-source">Details retrieved from Qloo {new Date(place.provenance.retrievedAt).toLocaleString()}. {place.sourceNote}</p>}
      </div>
    </div>
    <div className="pg-dialog-bottom"><span>{formatMoney(allowance?.amount||0,plan.request.currency)}<small>group allowance</small></span><button className="pl-button" onClick={onClose}>Back to your day <Icon name="arrow" size={16}/></button></div>
  </dialog>;
}
