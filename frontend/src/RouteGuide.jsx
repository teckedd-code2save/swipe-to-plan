import RouteStart from './RouteStart.jsx';
import JourneyMap from './JourneyMap.jsx';
import {startingLocation} from './route-start.js';
import {DialerLink} from './VenueContact.jsx';
import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {Icon} from './PlannerIcons.jsx';
import {routeLegs,routeLink} from './route-links.js';
import {routeDistance,routeDuration,routeEstimateError,routeEstimateFingerprint,routeEstimateRequest,routeModes,validRouteEstimate} from './route-estimates.js';

export default function RouteGuide({plan,checks,initialStopId,onTiming,routeScope='',savedAreas=[],onSaveArea,signedIn}) {
  const legs=routeLegs(plan),[selected,setSelected]=useState(initialStopId||legs[0]?.stop.id),[mode,setMode]=useState('driving'),[problem,setProblem]=useState(false);
  const [startingPoint,setStartingPoint]=useState({scope:routeScope,value:''}),[capability,setCapability]=useState({status:'loading'}),[estimate,setEstimate]=useState({status:'idle'});
  const origin=startingPoint.scope===routeScope?startingPoint.value:'',leg=legs.find(item=>item.stop.id===selected)||legs[0];
  const inputId=useId(),noteId=useId(),estimateNoteId=useId(),optionsId=useId(),inputRef=useRef(null),request=useRef({generation:0,controller:null}),current=useRef('');
  const fingerprint=routeEstimateFingerprint(plan,routeScope,leg,mode,origin);
  // The render-time key and generation check reject late responses even when a
  // transport ignores abort, including before an effect cleanup has run.
  current.current=fingerprint;
  const state=estimate.key===fingerprint?estimate:{status:'idle'};
  function invalidate(){request.current.generation++;request.current.controller?.abort();request.current.controller=null;}
  useLayoutEffect(()=>{invalidate();setEstimate({status:'idle'});return invalidate;},[fingerprint]);
  useLayoutEffect(()=>{setStartingPoint({scope:routeScope,value:''});},[routeScope]);
  useEffect(()=>{
    const controller=new AbortController();let live=true;
    api.actionCapabilities(controller.signal).then(data=>{if(live)setCapability({status:'ready',...data});}).catch(()=>{if(live)setCapability({status:'unavailable'});});
    return()=>{live=false;controller.abort();};
  },[]);
  const enabled=capability.status==='ready'&&capability.routeEstimates===true&&capability.routeProvider==='google_routes';
  const supported=enabled&&Array.isArray(capability.modes)&&capability.modes.includes(routeModes[mode]);
  function change(update){invalidate();setEstimate({status:'idle'});update();}
  async function estimateJourney(event){
    event.preventDefault();
    if(!supported||request.current.controller||state.status==='loading')return;
    invalidate();const generation=request.current.generation,key=fingerprint;
    let payload;
    try{payload={...routeEstimateRequest(leg,mode,origin),requestId:crypto.randomUUID(),itineraryRevision:generation};}
    catch(error){setEstimate({key,status:'error',error:error.message});if(!leg.from&&!startingLocation(origin))inputRef.current?.focus();return;}
    const controller=new AbortController();request.current.controller=controller;
    const isCurrent=()=>request.current.generation===generation&&current.current===key;
    setEstimate({key,status:'loading'});
    try{
      const data=await api.routeEstimate(payload,controller.signal);
      if(!isCurrent())return;
      if(!validRouteEstimate(data,payload))throw Error('The route response could not be verified. Try again or use Maps.');
      setEstimate({key,status:'ready',data});
    }catch(error){if(isCurrent())setEstimate({key,status:'error',error:routeEstimateError(error)});}
    finally{if(isCurrent())request.current.controller=null;}
  }
  if(!leg)return null;
  const place=checks?.data?.stops.find(s=>s.entityId===leg.stop.item.entityId)?.place||leg.stop.item;
  return <section className="pg-route-guide" aria-label="Travel options"><span className="pg-eyebrow">GETTING THERE</span><h3>Your journey</h3>
    <JourneyMap plan={plan} origin={origin} selectedStopId={leg.stop.id} onSelectStop={id=>change(()=>{setSelected(id);setProblem(false);})} routeScope={routeScope}/>
    {legs.length>1?<label>Journey leg<select value={leg.stop.id} onChange={e=>change(()=>{setSelected(e.target.value);setProblem(false);})}>{legs.map((item,index)=><option key={item.stop.id} value={item.stop.id}>{index+1}. {item.label}</option>)}</select></label>:<p>To {leg.stop.item.name}.</p>}
    <div className="pg-modes" role="group" aria-label="Travel mode">{[['','Compare'],['driving','Drive'],['walking','Walk'],['transit','Transit']].map(([value,label])=><button type="button" key={value} aria-pressed={mode===value} onClick={()=>change(()=>setMode(value))}>{label}</button>)}</div>
    <form className="pg-estimate-form" onSubmit={estimateJourney} noValidate>
      {!leg.from?<RouteStart onSaveArea={onSaveArea} signedIn={signedIn} key={JSON.stringify([routeScope,plan,leg.stop.id,mode])} value={origin} onChange={value=>change(()=>setStartingPoint({scope:routeScope,value}))} savedAreas={savedAreas} planningArea={plan.request?.area?{id:plan.request.locationId,label:plan.request.area}:null} inputId={inputId} noteId={noteId} inputRef={inputRef}/>:<p className="pg-note">From {leg.from.item.name}, your previous stop.</p>}
      <p className="pg-note pg-estimate-availability" id={estimateNoteId} role={capability.status==='loading'?'status':undefined}>{capability.status==='loading'?'Checking estimates. Maps is available below.':!enabled?'In-app estimates are unavailable. Get routes and travel times in Maps.':!mode?'Compare routes in Maps, or choose a mode to estimate here.':!supported?'No in-app estimate for this mode. Try Maps.':<>Estimate for leaving now, not your scheduled outing. Sends your start and destination to Google Routes; your start is not saved.</>}</p>
      <div className="pg-journey-actions">
        {supported&&<button className="pl-secondary-button" type="submit" aria-describedby={estimateNoteId} disabled={(!leg.from&&!startingLocation(origin))||state.status==='loading'}>{state.status==='loading'?'Estimating journey…':'Estimate this journey'}</button>}
        <a className="pl-button" href={routeLink(leg,mode,origin)} target="_blank" rel="noreferrer">{!mode?'Compare routes in Maps':'Open in Maps'}<Icon name="arrowUpRight" size={16}/></a>
      </div>
      {state.status==='loading'&&<span className="pg-sr-only" role="status">Estimating journey…</span>}
      <p className="pg-note pg-maps-note">Maps receives your selected start and destination. Your outing stays unchanged.</p>
      {state.status==='error'&&<p className="pg-note" role="alert">{state.error}</p>}
      {state.status==='ready'&&<div className="pg-route-estimate" role="status"><strong>{routeDuration(state.data.durationSeconds)} travel · {routeDistance(state.data.distanceMeters)}</strong><p>{({driving:'Driving · departure at the measured time.',walking:'Walking · requested at the measured time.',transit:'Transit · departure at the measured time.'})[mode]}</p><p>Google Routes · <time dateTime={state.data.measuredAt}>{new Date(state.data.measuredAt).toLocaleString(undefined,{timeZoneName:'short'})}</time>.</p><p><strong>Travel only.</strong> {origin?.kind==='area'&&!leg.from?'Approximate route from your selected area. ':''} Schedule feasibility has not been checked. Estimate again before leaving.</p></div>}
    </form>
    <button className="pg-link" type="button" aria-expanded={problem} aria-controls={optionsId} onClick={()=>setProblem(v=>!v)}>More route options</button>
    {problem&&<div className="pg-route-options" id={optionsId}><p>No transit route? Local services may be unlisted. Try another mode or ask the venue.</p><div className="pg-links"><a href={routeLink(leg,'driving',origin)} target="_blank" rel="noreferrer">Try driving <Icon name="arrowUpRight" size={14}/></a><a href={routeLink(leg,'walking',origin)} target="_blank" rel="noreferrer">Compare walking <Icon name="arrowUpRight" size={14}/></a>{place.links?.phone?<DialerLink place={place}/>:place.links?.map&&<a href={place.links.map} target="_blank" rel="noreferrer">Find venue contact <Icon name="arrowUpRight" size={14}/></a>}</div><p className="pg-note">Check walking distance and road conditions. Driving directions don’t confirm taxi availability or fares.</p>{onTiming&&<button className="pl-secondary-button" type="button" onClick={onTiming}>Allow more time in the plan <Icon name="clock" size={15}/></button>}</div>}
  </section>;
}
