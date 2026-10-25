import {useState} from 'react';
import {Icon} from './PlannerIcons.jsx';
import {routeLegs,routeLink} from './route-links.js';

export default function RouteGuide({plan,checks,initialStopId,onTiming}) {
  const legs=routeLegs(plan),[selected,setSelected]=useState(initialStopId||legs[0]?.stop.id),[mode,setMode]=useState(''),[problem,setProblem]=useState(false);
  const leg=legs.find(item=>item.stop.id===selected)||legs[0];
  if(!leg)return null;
  const place=checks?.data?.stops.find(s=>s.entityId===leg.stop.item.entityId)?.place||leg.stop.item;
  return <section className="pg-route-guide" aria-label="Travel options"><span className="pg-eyebrow">GETTING THERE</span><h3>Let’s make the journey work.</h3>
    {legs.length>1?<label>Which part of your journey?<select value={leg.stop.id} onChange={e=>{setSelected(e.target.value);setProblem(false);}}>{legs.map(item=><option key={item.stop.id} value={item.stop.id}>{item.label}</option>)}</select></label>:<p>To {leg.stop.item.name}. Choose your starting point in Maps.</p>}
    <div className="pg-modes" aria-label="Travel mode">{[['','Compare'],['driving','Drive'],['walking','Walk'],['transit','Transit']].map(([value,label])=><button type="button" key={value} aria-pressed={mode===value} onClick={()=>setMode(value)}>{label}</button>)}</div>
    <a className="pl-button" href={routeLink(leg,mode)} target="_blank" rel="noreferrer">{mode==='driving'?'Open driving directions':mode==='walking'?'Open walking directions':mode==='transit'?'Try transit directions':'Compare routes in Maps'}<Icon name="arrowUpRight" size={16}/></a>
    <p className="pg-note">Maps supplies travel times. Unstressed can’t see its result or change your schedule from it automatically.</p>
    <button className="pg-link" type="button" aria-expanded={problem} onClick={()=>setProblem(v=>!v)}>No route, or longer than expected?</button>
    {(problem||mode==='transit')&&<div className="pg-route-options"><h4>{problem?'Let’s try another way.':'If transit has no result…'}</h4><p>A missing transit route doesn’t mean the venue is unreachable. Local services may not be listed. Compare a drive or ask the venue how people usually get there.</p><div className="pg-links"><a href={routeLink(leg,'driving')} target="_blank" rel="noreferrer">Try driving <Icon name="arrowUpRight" size={14}/></a><a href={routeLink(leg,'walking')} target="_blank" rel="noreferrer">Compare walking <Icon name="arrowUpRight" size={14}/></a>{place.links?.phone?<a href={place.links.phone}>Call about access <Icon name="arrowUpRight" size={14}/></a>:place.links?.map&&<a href={place.links.map} target="_blank" rel="noreferrer">Find venue contact <Icon name="arrowUpRight" size={14}/></a>}</div><p className="pg-note">Check distance and road conditions before choosing a walk. Driving directions don’t confirm taxi availability or fares.</p>{onTiming&&<button className="pl-secondary-button" type="button" onClick={onTiming}>Allow more time in the plan <Icon name="clock" size={15}/></button>}</div>}
  </section>;
}
