import RouteGuide from './RouteGuide.jsx';
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
const checkedStop = (checks,stop) => checks.data?.stops.find(s=>s.entityId===stop.item?.entityId&&s.start===stop.start&&s.end===stop.end);
const hourTone = status => status==='fits_reported_hours'?'found':['outside_reported_hours','reported_closed'].includes(status)?'attention':'unknown';
const hourLabel = status => ({fits_reported_hours:'Fits reported hours',outside_reported_hours:'Timing needs a look',reported_closed:'Reported closed'})[status] || 'Hours to confirm';
const periods = rows => rows === null || rows === undefined ? 'Not listed' : rows.length ? rows.map(row=>`${row.opens}–${row.closes}${row.overnight?' (+1 day)':''}`).join(' · ') : 'Closed';
function VenueLinks({place}) {
  return <div className="pg-links">{place.links?.website&&<a href={place.links.website} target="_blank" rel="noreferrer">Venue website <Icon name="arrowUpRight" size={14}/></a>}{place.links?.menu&&<a href={place.links.menu} target="_blank" rel="noreferrer">Menu <Icon name="arrowUpRight" size={14}/></a>}{place.links?.phone&&<a href={place.links.phone}>Call venue <Icon name="arrowUpRight" size={14}/></a>}{place.links?.map&&<a href={place.links.map} target="_blank" rel="noreferrer">Google Maps <Icon name="arrowUpRight" size={14}/></a>}</div>;
}
export function BeforeGoing({plan,checks,done,setDone,onDetails,onTiming}) {
  const filled=plan.stops.filter(s=>s.item), reports=checks.data?.stops||[];
  const fits=reports.filter(s=>s.hours?.status==='fits_reported_hours').length;
  const flags=reports.filter(s=>hourTone(s.hours?.status)==='attention').length;
  const unknown=filled.length-fits-flags;
  const summary=[fits?`${fits} stop${fits===1?'':'s'} ${fits===1?'fits':'fit'} reported hours`:'',flags?`${flags} timing issue${flags===1?'':'s'} to review`:'',unknown?`${unknown} with hours to confirm`:''].filter(Boolean).join(' · ');
  return <section className="pg-preflight">
    <div className="pg-intro"><span className="pg-eyebrow">A LITTLE LESS HOMEWORK</span><h2>Let’s get you ready.</h2><p>Open a place for its reported hours, available menu links and contact details. Check each leg of your journey below.</p></div>
    <div className={`pg-progress ${flags?'attention':''}`} role="status"><Icon name={checks.status==='loading'?'clock':flags||unknown?'info':'check'} size={18}/><span>{checks.status==='loading'?'Checking your places…':checks.status==='error'?'The place check needs another try.':summary}</span><button onClick={checks.refresh} disabled={checks.status==='loading'}>Refresh</button></div>
    {checks.error&&<p className="pg-note" role="alert">{checks.error}</p>}
    <div className="pg-check-places">{filled.map(stop=>{const report=checkedStop(checks,stop);return <button className="pg-check-place" key={stop.id} onClick={()=>onDetails(stop)}><span className="pg-check-time">{stop.start}</span><span><strong>{stop.item.name}</strong><span className={`pg-badge ${hourTone(report?.hours?.status)}`}>{checks.status==='loading'?'Checking hours…':hourLabel(report?.hours?.status)}</span><small>{report?.error||report?.hours?.summary||'Open the place to see its details.'}</small></span><Icon name="arrow" size={18}/></button>;})}</div>
    <p className="pg-note">Weekly hours are a useful first check. Special dates, kitchen hours and availability still need the venue’s confirmation.</p>
    <RouteGuide plan={plan} checks={checks} onTiming={onTiming}/>
    <div className="pg-human"><h3>The final human touch</h3><p>Each place has an editable enquiry ready for you—your chosen visit details included. Open a place to copy it or call the venue.</p><label><input type="checkbox" checked={!!done.book} onChange={e=>setDone(d=>({...d,book:e.target.checked}))}/><span>I’ve confirmed bookings, prices and any specific needs with the venues.</span></label><small>This is your confirmation. Unstressed hasn’t contacted or booked a venue.</small></div>
  </section>;
}
export function PlaceCheckNotice({checks,onOpen}) {
  const issues=checks.data?.stops.filter(s=>hourTone(s.hours?.status)==='attention').length||0;
  if(!issues)return null;
  return <button className="pg-plan-alert" onClick={onOpen}><Icon name="clock" size={17}/><span>{issues===1?'One stop needs a timing check.':`${issues} stops need a timing check.`}<small>I found a mismatch with reported opening hours.</small></span><Icon name="arrow" size={17}/></button>;
}
function enquiry(plan,stop) {
  if(!stop.start||!stop.end)return `Hello ${stop.item.name},\n\nWe’re considering a visit. Could you share your current menu, prices, opening hours and reservation process?\n\nThank you!`;
  return `Hello ${stop.item.name},\n\nWe’re planning to visit on ${dateLabel(plan.request.date)} ${plan.request.date.slice(0,4)}, around ${stop.start}–${stop.end}, with ${plan.request.party.adults} adult${plan.request.party.adults===1?'':'s'}${plan.request.party.children?` and ${plan.request.party.children} ${plan.request.party.children===1?'child':'children'}`:''}.\n\nCould you confirm you’ll be open, whether we need a reservation, and any deposits or entry fees? Please share your current menu or prices${stop.intent==='dinner'||stop.intent==='coffee'?' and the kitchen’s serving hours':''}.\n\nWe’ll confirm any dietary, accessibility or other specific needs with you before visiting.\n\nThank you!`;
}
export function PlaceDetails({stop,plan,checks,onClose,onSwap,canSwap,initialView='overview',onSelect,onTiming}) {
  const [view,setView]=useState(initialView);
  const filled=plan.stops.filter(s=>s.item);
  const dialog=useRef(null),[imageFailed,setImageFailed]=useState(false),[draft,setDraft]=useState(()=>enquiry(plan,stop)),[copyState,setCopyState]=useState('');
  const report=checkedStop(checks,stop),place=report?.place||stop.item,allowance=plan.budget.allocations.find(a=>a.intent===stop.intent);
  useEffect(()=>{const element=dialog.current,trigger=document.activeElement;element.showModal();return()=>{element.close();if(trigger?.isConnected)trigger.focus({preventScroll:true});};},[]);
  async function copy(){try{await navigator.clipboard.writeText(draft);setCopyState('Copied. Ready to send yourself.');}catch{setCopyState('Select and copy the enquiry below.');}}
  return <dialog className="pl-dialog pg-dialog" ref={dialog} onCancel={onClose} aria-labelledby="place-details-title">
    <div className="pg-dialog-top"><span>{ACTIVITY_NAMES[stop.intent]} · {stop.start&&stop.end?`${stop.start}–${stop.end}`:"Time to choose"}</span><button type="button" className="pl-dialog-close" aria-label="Close place details" onClick={onClose}>Close<Icon name="close" size={18}/></button></div>
    {filled.length>1&&<label className="pg-stop-picker">Place in your day<select aria-label="Place to review" value={stop.item.entityId} onChange={e=>onSelect?.(e.target.value,view)}>{filled.map(s=><option key={s.id} value={s.item.entityId}>{s.start||'Time to choose'} · {s.item.name}</option>)}</select></label>}
    <nav className="pg-detail-tabs" aria-label="Place details sections">{[['overview','Overview'],['practical','Hours & menu'],['route','Getting there']].map(([id,label])=><button type="button" key={id} aria-pressed={view===id} onClick={()=>setView(id)}>{label}</button>)}</nav>
    <div className="pg-dialog-scroll" key={view}>
      {view==='overview'&&<div className={`pg-photo ${!place.image||imageFailed?'empty':''}`}>{place.image&&!imageFailed?<img src={place.image} alt={place.name} onError={()=>setImageFailed(true)}/>:<Icon name={stop.intent} size={56}/>}<span>YOUR KIND OF PLACE</span></div>}
      <div className="pg-detail-body"><div className="pg-place-heading"><h2 id="place-details-title">{place.name}</h2><p><Icon name="pin" size={16}/>{place.address}</p></div>
        {view==='overview'&&place.description&&<p className="pg-description">{place.description}</p>}
        {view==='overview'&&!!place.tagNames?.length&&<div className="pg-tags">{place.tagNames.map(tag=><span key={tag}>{tag}</span>)}</div>}
        {view==='route'?<RouteGuide plan={plan} checks={checks} initialStopId={stop.id} onTiming={onTiming}/>:<>
        <VenueLinks place={place}/>
        {checks.status==='error'&&<p className="pg-note" role="alert">Details couldn’t load. <button className="pg-link" onClick={checks.refresh}>Try again</button></p>}
        {stop.item?.experienceFit&&<section className="pg-detail-section pg-experience-fit"><span className="pg-eyebrow">HOW IT FITS YOUR REQUEST</span>
          {stop.item.experienceFit.cuisine&&<p><strong>{stop.item.experienceFit.cuisine.requested} cuisine:</strong> {stop.item.experienceFit.cuisine.status==='provider_text_signal'?'Mentioned in provider text, but dishes and menu are not confirmed.':'Not verified from available venue information.'}</p>}
          {stop.item.experienceFit.atmosphere&&<p><strong>{stop.item.experienceFit.atmosphere.requested} atmosphere:</strong> {stop.item.experienceFit.atmosphere.status==='provider_text_signal'?'Mentioned by the provider; confirm the current setting.':'Not verified from available venue information.'}</p>}
        </section>}
        <section className={`pg-hours ${hourTone(report?.hours?.status)}`}><div className="pg-section-title"><Icon name="clock" size={20}/><h3>{checks.status==='loading'?'Checking your timing…':hourLabel(report?.hours?.status)}</h3></div><p>{report?.hours?.summary||report?.error||'No usable weekly hours were supplied for this place.'}</p>{report?.hours?.intervals&&<strong>{dateLabel(plan.request.date)} · {periods(report.hours.intervals)}</strong>}<small>Reported weekly schedule. Special dates may differ.</small>{place.hours&&<details><summary>See the weekly hours</summary><dl className="pg-week">{Object.entries(place.hours).map(([day,rows])=><div key={day}><dt>{day}</dt><dd>{periods(rows)}</dd></div>)}</dl></details>}{(hourTone(report?.hours?.status)==='attention'||!stop.start)&&onTiming&&<button className="pg-link" onClick={onTiming}>Adjust the visiting time <Icon name="clock" size={15}/></button>}{hourTone(report?.hours?.status)==='attention'&&canSwap&&<button className="pg-link" onClick={onSwap}>Find another place <Icon name="arrow" size={15}/></button>}</section>
        <section className="pg-detail-section pg-menu-context"><span className="pg-eyebrow">MENU AT YOUR VISIT</span><h3>What's known for this stop</h3>
          {report?.menu?.highlights?.length>0?<><p>Provider-reported dishes and highlights (not a full menu):</p><div className="pg-tags">{report.menu.highlights.map((item,i)=><span key={`${item}-${i}`}>{item}</span>)}</div></>:<p>No itemized menu was supplied for this venue.</p>}
          {report?.menu?.link&&<p><a href={report.menu.link} target="_blank" rel="noreferrer">View venue menu <Icon name="arrowUpRight" size={13}/></a></p>}
          <p className="pg-note">Prices, meal-specific menu hours and item availability haven't been verified. {stop.start&&stop.end?`Your planned stop is ${stop.start}–${stop.end}.`:'Choose a visit time after exploring the options.'}</p>

        </section>
        <section className="pg-detail-section"><span className="pg-eyebrow">THE FOOD & THE SPEND</span><h3>A feel for the place.</h3>{!!place.highlights?.length&&<p>{place.highlights.join(' · ')}</p>}<div className="pg-spend"><span><strong>{formatMoney(allowance?.amount,plan.request.currency)}</strong><small>{allowanceLabel(plan.request)}</small></span><span><strong>{place.facts?.price?.level?['','Lower price range','Mid price range','Higher price range','Premium price range'][place.facts.price.level]:'Prices to confirm'}</strong><small>{place.facts?.price?.level?'Relative price band, not a quote':'No price band provided'}</small></span></div><p className="pg-note">{place.links?.menu?"The venue’s menu link may provide current dishes and prices; availability at your visit is unverified.":place.links?.website?'The venue website above is the best next step for its current menu and prices.':'Use the Maps or contact link to ask for current prices.'} Your allowance is not an estimate of the bill.</p></section>
        {view==='overview'&&!!stop.connections.length&&<section className="pg-detail-section"><span className="pg-eyebrow">THE PEOPLE BEHIND THIS PICK</span><h3>A few familiar threads.</h3><div className="pg-connections">{plan.people.map((person,index)=>{const edges=stop.connections.filter(e=>e.personId===person.id);return edges.length?<div key={person.id}><span className="cs-person-dot" style={{background:PERSON_COLORS[index%6]}}>{person.name[0]}</span><div><strong>{person.name}</strong>{edges.map(edge=><p key={edge.id}><b>{plan.tasteMap.nodes.find(n=>n.id===edge.from)?.label}</b><span>{edge.kind==='search_signal'?'Used to discover this place; not a confirmed individual match.':edge.label}</span></p>)}</div></div>:null;})}</div></section>}
        {view==='overview'&&!!place.practicalTags?.length&&<section className="pg-detail-section"><h3>Reported features</h3><div className="pg-tags">{place.practicalTags.map((tag,i)=><span key={`${tag}-${i}`}>{tag}</span>)}</div><p className="pg-note">Provider descriptions don’t establish suitability. Ask the venue about your specific dietary or access needs.</p></section>}
        <details className="pg-enquiry"><summary><span><Icon name="edit" size={19}/><strong>Your enquiry, already drafted.</strong></span><Icon name="plus" size={18}/></summary><p>Edit anything you’d like to ask, then copy it or call the venue. Nothing is sent automatically.</p><label htmlFor="venue-enquiry">Message to {place.name}</label><textarea id="venue-enquiry" value={draft} onChange={e=>{setDraft(e.target.value);setCopyState('');}} rows={10}/><div><button className="pl-button" onClick={copy}><Icon name="copy" size={15}/>Copy enquiry</button>{place.links?.phone&&<a className="pl-secondary-button" href={place.links.phone}>Call venue</a>}</div><p role="status">{copyState}</p></details>
        {report?.place&&<details className="pg-source"><summary>Sources & freshness</summary><p>Place details supplied by Qloo. Retrieved {new Date(place.provenance.retrievedAt).toLocaleString()}. Its last update time is unknown; holidays and private events may differ.</p></details>}
        </>}
      </div>
    </div>
    <div className="pg-dialog-bottom"><span>{formatMoney(allowance?.amount,plan.request.currency)}<small>{allowanceLabel(plan.request).toLowerCase()}</small></span><button className="pl-button" onClick={onClose}>Back to your day <Icon name="arrow" size={16}/></button></div>
  </dialog>;
}
