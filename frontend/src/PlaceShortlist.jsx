import {useEffect,useState} from 'react';
import {Icon} from './PlannerIcons.jsx';
import {shortlistCandidates} from './shortlist.js';

export default function PlaceShortlist({plan,busy,editable,onChoose,onDetails,onMenus,onSwipes}){
  const choices=shortlistCandidates(plan),key=choices.map(c=>c.item.id).join('|');
  const [selected,setSelected]=useState(()=>plan.request.route?.map(s=>s.placeId)||[]);
  const [expanded,setExpanded]=useState(false);
  useEffect(()=>setSelected(values=>values.filter(id=>choices.some(c=>c.item.id===id))),[key]);
  const local=choices.filter(c=>!c.item.nearby),nearby=choices.filter(c=>c.item.nearby);
  function toggle(id){setSelected(values=>values.includes(id)?values.filter(v=>v!==id):values.length<3?[...values,id]:values);}
  function move(id,direction){setSelected(values=>{const next=[...values],index=next.indexOf(id),to=index+direction;if(index>=0&&to>=0&&to<next.length)[next[index],next[to]]=[next[to],next[index]];return next;});}
  function rows(values){return (expanded?values:values.slice(0,5)).map(({intent,item})=>{
    const index=selected.indexOf(item.id);
    return <article className="cs-place-option" key={item.id}>
      <label><input type="checkbox" aria-label={`Include ${item.name}`} checked={index>=0} disabled={!editable||busy||index<0&&selected.length>=3} onChange={()=>toggle(item.id)}/><span><strong>{item.name}</strong><small>{item.nearby?`About ${item.nearby.distanceKm} km from the selected area’s centre · wider-area suggestion`:item.address||'In the selected search area'}</small></span></label>
      <p>{item.description||item.tagNames?.slice(0,4).join(' · ')||`Provider category matches ${intent==='dinner'?'a meal':intent==='coffee'?'cafés':intent}.`}</p>
      {!!item.matchedVibes?.length&&<small>Matches your chosen tastes: {item.matchedVibes.join(' · ')}</small>}
      <div className="cs-starters"><button onClick={()=>onDetails(item)}>Details & contact</button>{index>=0&&<><span>Stop {index+1}</span><button aria-label={`Move ${item.name} earlier`} disabled={index===0||busy} onClick={()=>move(item.id,-1)}>↑</button><button aria-label={`Move ${item.name} later`} disabled={index===selected.length-1||busy} onClick={()=>move(item.id,1)}>↓</button></>}</div>
    </article>;
  });}
  return <section className="cs-place-shortlist cs-tool" aria-label="Places for your outing" aria-busy={busy}>
    <div className="cs-tool-head"><span><Icon name="map" size={18}/>{plan.request.activities.includes('drinks')?'Shape your night':'Places for your outing'}</span>{busy&&<small>Updating places…</small>}</div>
    <p>Choose up to three places. Your selection order becomes the route; you can move each stop earlier or later. Opening hours, prices and travel still need checking.</p>
    {!choices.length&&<p>{plan.nearbyStatus==='unavailable'?'The nearby search could not finish. Your original area is unchanged.':'No matching places returned in this area or the nearby search. Try another area or steer the request in chat.'}</p>}
    {rows(local)}
    {!!nearby.length&&<><h3>{plan.searchScope?.kind==='nearby'?'Around your selected area':'A little further out'}</h3><p>{local.length?'These are wider-area options.':'I found no matches in the selected area. These are suggestions within 20 km of its centre.'} Distances are approximate straight lines, not driving distances. Selecting one includes the wider search area.</p>{rows(nearby)}</>}
    {Math.max(local.length,nearby.length)>5&&<button className="pl-text-button" onClick={()=>setExpanded(v=>!v)}>{expanded?'Show fewer places':`See all ${choices.length} places`}</button>}
    <div className="cs-starters">{!!selected.length&&<button className="cs-review-plan" disabled={busy||!editable} onClick={()=>onChoose(selected)}>{selected.length===1?'Choose this place':`Build a ${selected.length}-stop outing`}<Icon name="arrow" size={14}/></button>}<button disabled={busy} onClick={onSwipes}>Refine with swipes</button>{plan.stops.some(s=>s.item)&&<button onClick={onMenus}>Menus for current day</button>}</div>
    {!!selected.length&&<small>{selected.map((id,i)=>`${i+1}. ${choices.find(c=>c.item.id===id)?.item.name}`).join(' → ')}</small>}
  </section>;
}
