import {useLayoutEffect,useRef,useState} from 'react';
import {Icon,dateLabel} from './PlannerIcons.jsx';
import JourneyMap from './JourneyMap.jsx';
import RouteGuide from './RouteGuide.jsx';
import ReadySheet from './ReadySheet.jsx';
import TimingAction from './TimingAction.jsx';
import BookingAction from './BookingAction.jsx';
import VenueContact from './VenueContact.jsx';
import {checkedVisit,reportedPrice} from './decision-evidence.js';
import {startingLocation} from './route-start.js';
import {routeLink} from './route-links.js';
import {needsTiming} from './timing.js';
import {journeyPoints} from './journey-map.js';
import {safeContactWebsite} from '../../shared/venue-contact.js';

const tone=report=>['outside_reported_hours','reported_closed'].includes(report?.hours?.status)?'attention':report?.hours?.status==='fits_reported_hours'?'found':'unknown';
const hoursLabel=report=>({fits_reported_hours:'Fits reported hours',outside_reported_hours:'Review visit time',reported_closed:'Reported closed'})[report?.hours?.status]||'Hours to confirm';
const visitTime=stop=>stop.start&&stop.end?`${stop.start}–${stop.end}`:'Time to choose';
const intervals=rows=>!Array.isArray(rows)?'Not listed':rows.length?rows.map(row=>`${row.opens}–${row.closes}${row.overnight?' (+1 day)':''}`).join(' · '):'Closed';
const modeLabel=mode=>({driving:'Drive',walking:'Walk',transit:'Transit'})[mode]||'Compare';

export default function GettingReady(props) {
  if(!props.plan.stops.some(stop=>stop.item))return <section className="gr-empty"><Icon name="map" size={32}/><h3>No stops to get ready for yet</h3><p>Choose places in your outing first. Unfilled stops stay in your plan.</p></section>;
  return <RouteGuide {...props}>{route=><ReadyExperience {...props} route={route}/>}</RouteGuide>;
}
function ReadyExperience({plan,checks,route,routeScope,bookingScope,onApplyTiming,timingBrief,timingHistory=[],loadMapLibrary}) {
  const contextKey=JSON.stringify([routeScope,plan.request,plan.stops]);
  const hub=useRef(null),dismiss=useRef(null),focusContext=useRef(contextKey);focusContext.current=contextKey;
  const [trail,setTrail]=useState([]),[viewScope,setViewScope]=useState(contextKey);
  const filled=route.legs.map(leg=>leg.stop),selected=route.leg.stop,report=checkedVisit(checks,selected),place=report?.place||selected.item;
  const pendingTime=needsTiming(plan.request)||filled.some(stop=>!stop.start),hasStart=!!startingLocation(route.origin);
  const flagged=filled.find(stop=>tone(checkedVisit(checks,stop))==='attention');
  const current=viewScope===contextKey?trail.at(-1):null,view=current?.view;
  useLayoutEffect(()=>{setTrail([]);setViewScope(contextKey);},[contextKey]);
  function open(next){setViewScope(contextKey);setTrail([{view:next}]);}
  function next(nextView){setTrail(previous=>[...previous,{view:nextView}]);}
  function close(){route.cancelPending();setTrail([]);}
  function openStop(id){route.selectStop(id);open('stop');}
  function openGroup(points){setViewScope(contextKey);setTrail([{view:'group',coordinates:points[0]?.coordinates}]);}
  // Resolve choices from current data, not a stale marker snapshot. In
  // particular, editing a co-located start must remove its old choice on Back.
  const pin=trail.find(entry=>entry.view==='group')?.coordinates;
  const pinChoices=pin?journeyPoints(plan,route.origin).filter(point=>point.coordinates?.[0]===pin[0]&&point.coordinates?.[1]===pin[1]):[];
  const startLabel=typeof route.origin==='string'?(route.origin.trim()||'Choose start'):route.origin?.label||'Choose start';
  const timeLabel=pendingTime?'Choose time':`${dateLabel(plan.request.date)} · ${plan.request.startTime}`;
  const stopNumber=stop=>plan.stops.findIndex(item=>item.id===stop.id)+1;
  const selectedIndex=stopNumber(selected);
  const title=({group:'At this map pin',start:'Your starting point',timing:'When to go',contacts:place.name,booking:'Prepare an enquiry',journey:'Getting there',contactList:'Contact your stops',stop:place.name})[view];
  const subtitle=['stop','contacts','booking','journey'].includes(view)?`Stop ${selectedIndex} · ${visitTime(selected)}`:view==='group'?(pinChoices.some(point=>point.isOrigin)?'START & VISITS':'CHOOSE A VISIT'):view==='start'?'THIS JOURNEY ONLY':view==='contactList'?'NOTHING SENT OR BOOKED':'YOUR OUTING';
  let primary;
  if(pendingTime&&onApplyTiming)primary=<button className="pl-button" onClick={()=>open('timing')}>Choose a time<Icon name="clock" size={17}/></button>;
  else if(!hasStart)primary=<button className="pl-button" onClick={()=>open('start')}>Choose your starting point<Icon name="pin" size={17}/></button>;
  else if(flagged)primary=<button className="pl-button" onClick={()=>openStop(flagged.id)}>Review visit timing<Icon name="clock" size={17}/></button>;
  else primary=<a className="pl-button" href={routeLink(route.leg,route.mode,route.origin)} target="_blank" rel="noreferrer">Directions to stop {selectedIndex}<Icon name="arrowUpRight" size={17}/></a>;
  return <section className="gr-hub" ref={hub} tabIndex={-1} aria-label="Get ready for your outing">
    <div className="gr-readiness" aria-label="Outing readiness">
      <button type="button" onClick={()=>open('timing')}><Icon name="clock" size={17}/><span><small>Time</small><strong>{timeLabel}</strong></span><Icon name="edit" size={12}/></button>
      <button type="button" onClick={()=>open('start')}><Icon name="pin" size={17}/><span><small>Start</small><strong>{startLabel}</strong></span><Icon name="edit" size={12}/></button>
      <button type="button" onClick={()=>open('contactList')}><Icon name="people" size={17}/><span><small>Contact</small><strong>{filled.length} {filled.length===1?'stop':'stops'}</strong></span><Icon name="arrow" size={12}/></button>
    </div>
    <JourneyMap {...route.mapProps} showKey={false} loadMapLibrary={loadMapLibrary} onSelectStart={()=>open('start')} onSelectStop={openStop} onSelectGroup={openGroup}/>
    <div className="gr-itinerary-heading"><h3>Your stops</h3><button type="button" onClick={()=>open('journey')} className="gr-text-button">{modeLabel(route.mode)}<Icon name="edit" size={13}/></button></div>
    {checks.status==='error'&&<p className="gr-inline-notice" role="alert">Place details couldn’t load. <button type="button" onClick={checks.refresh}>Retry</button></p>}
    <ol className="gr-stops">{plan.stops.map((stop,index)=>{if(!stop.item)return <li className="gr-unfilled" key={stop.id}><span className="gr-stop-number">{index+1}</span><span><strong>Place still to find</strong><small>This visit stays in your outing.</small></span></li>;const visit=checkedVisit(checks,stop);return <li key={stop.id}><button type="button" className={`gr-stop ${stop.id===selected.id?'selected':''}`} aria-label={`Stop ${index+1}: ${stop.item.name}, ${visitTime(stop)}. ${hoursLabel(visit)}`} onClick={()=>openStop(stop.id)}><span className="gr-stop-number">{index+1}</span><span className="gr-stop-copy"><small>{visitTime(stop)}</small><strong>{stop.item.name}</strong><span className={`gr-status ${tone(visit)}`}>{checks.status==='loading'?'Checking hours…':hoursLabel(visit)}</span></span><Icon name="arrow" size={17}/></button></li>;})}</ol>
    {plan.stops.length>filled.length&&<p className="gr-inline-notice">{plan.stops.length-filled.length} {plan.stops.length-filled.length===1?'stop still needs':'stops still need'} a place. Your chosen visits are shown here.</p>}
    <div className="gr-next"><span>{pendingTime?'Set the timing, then check each visit.':!hasStart?'An area or landmark is enough.':flagged?'One or more visits may not fit reported hours.':`Next: ${selected.item.name}`}</span>{primary}</div>
    {current&&<ReadySheet dismissRef={dismiss} returnFocusRef={hub} canRestoreFocus={()=>focusContext.current===contextKey} title={title} subtitle={subtitle} viewKey={`${view}:${selected.id}`} onClose={close} onBack={trail.length>1?()=>setTrail(previous=>previous.slice(0,-1)):undefined} footer={view==='start'?({dismiss})=><button className="pl-button" onClick={dismiss}>Back to map<Icon name="check" size={16}/></button>:view==='stop'?<button className="pl-button" onClick={()=>next('journey')}>Directions to this stop<Icon name="arrow" size={16}/></button>:null}>
      {view==='group'&&<div className="gr-pin-choices">{pinChoices.map(point=><button className="gr-action-row" key={point.key} type="button" onClick={()=>{if(point.isOrigin)next('start');else{route.selectStop(point.stopId);next('stop');}}}><span className="gr-stop-number">{point.badge}</span><span><strong>{point.label}</strong><small>{point.isOrigin?`Starting point${point.approximate?' · Approximate area':''}`:`Stop ${point.badge} · ${visitTime(plan.stops.find(stop=>stop.id===point.stopId))}`}</small></span><Icon name="arrow" size={17}/></button>)}</div>}
      {view==='start'&&route.startControl}
      {view==='timing'&&(onApplyTiming?<TimingAction embedded brief={timingBrief||plan.request} history={timingHistory} timeZone={plan.timeZone} onClose={close} onApply={async request=>{await new Promise(resolve=>dismiss.current?dismiss.current(resolve):(close(),resolve()));await onApplyTiming(request);}}/>:<p>{timeLabel}. Only the outing owner can change its timing.</p>)}
      {view==='stop'&&<>
        <div className="gr-venue-address"><Icon name="pin" size={18}/><p>{place.address||'Street address not supplied.'}</p></div>
        <section className={`gr-hours ${tone(report)}`} aria-label="Visit hours"><strong><Icon name="clock" size={17}/>{checks.status==='loading'?'Checking hours…':hoursLabel(report)}</strong><p>{report?.hours?.summary||report?.error||'No usable hours supplied for this visit.'}</p>{report?.hours?.intervals&&<p>{dateLabel(plan.request.date)} · {intervals(report.hours.intervals)}</p>}<small>Reported weekly hours. Special dates and availability may differ.</small>{onApplyTiming&&<button type="button" className="gr-text-button" onClick={()=>next('timing')}>{pendingTime?'Choose time':'Change timing'}<Icon name="arrow" size={14}/></button>}</section>
        <button type="button" className="gr-action-row" onClick={()=>next('contacts')}><Icon name="people" size={19}/><span><strong>Contact & booking</strong><small>Venue details, enquiry and your reports</small></span><Icon name="arrow" size={17}/></button>
        <div className="gr-venue-links">{safeContactWebsite(place.links?.menu)&&<a href={safeContactWebsite(place.links.menu)} target="_blank" rel="noreferrer">Venue menu<Icon name="arrowUpRight" size={14}/></a>}{safeContactWebsite(place.links?.website)&&<a href={safeContactWebsite(place.links.website)} target="_blank" rel="noreferrer">Website<Icon name="arrowUpRight" size={14}/></a>}</div>
        <details className="gr-more"><summary>More about this place</summary>{place.description&&<p>{place.description}</p>}<p>{reportedPrice(place)}. Not a quote or verified menu price.</p>{place.hours&&<dl className="pg-week">{Object.entries(place.hours).map(([day,rows])=><div key={day}><dt>{day}</dt><dd>{intervals(rows)}</dd></div>)}</dl>}{place.highlights?.length>0&&<p>{place.highlights.join(' · ')}</p>}{place.provenance?.provider&&<p>Place evidence: {place.provenance.provider}{place.provenance.retrievedAt&&` · retrieved ${new Date(place.provenance.retrievedAt).toLocaleString()}`}. Provider update time unknown.</p>}</details>
      </>}
      {view==='contactList'&&<div className="gr-contact-list"><p>Choose a visit to see its contact details or prepare an enquiry.</p>{filled.map((stop,index)=><button className="gr-action-row" key={stop.id} type="button" onClick={()=>{route.selectStop(stop.id);next('contacts');}}><span className="gr-stop-number">{stopNumber(stop)}</span><span><strong>{stop.item.name}</strong><small>{visitTime(stop)}</small></span><Icon name="arrow" size={16}/></button>)}</div>}
      {view==='contacts'&&<><button type="button" className="gr-action-row" onClick={()=>next('booking')}><Icon name="edit" size={18}/><span><strong>Prepare enquiry & track reply</strong><small>You review the details and make contact.</small></span><Icon name="arrow" size={16}/></button><VenueContact compact place={place} scope={bookingScope} context={[routeScope,selected.id,plan.request.date]}/></>}
      {view==='booking'&&<BookingAction compact scope={bookingScope} context={routeScope} plan={plan} stop={selected} place={place}/>}
      {view==='journey'&&<><div className="gr-journey-path"><span>{route.leg.from?`Stop ${stopNumber(route.leg.from)} · ${route.leg.from.item.name}`:startLabel}</span><Icon name="arrow" size={17}/><strong>{selectedIndex} · {selected.item.name}</strong></div>{!route.leg.from&&<button type="button" className="gr-text-button" onClick={()=>next('start')}>{hasStart?'Change start':'Choose a starting point'}<Icon name="pin" size={15}/></button>}<div className="pg-modes" role="group" aria-label="Travel mode">{[['driving','Drive'],['walking','Walk'],['transit','Transit'],['','Compare']].map(([value,label])=><button type="button" key={value} aria-pressed={route.mode===value} onClick={()=>route.changeMode(value)}>{label}</button>)}</div>{route.journeyForm}</>}
    </ReadySheet>}
  </section>;
}
