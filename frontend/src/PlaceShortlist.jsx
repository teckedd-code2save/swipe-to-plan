import {Stop} from './PlanDetails.jsx';
import {useEffect,useState} from 'react';
import {Icon} from './PlannerIcons.jsx';
import {shortlistCandidates} from './shortlist.js';

export default function PlaceShortlist({plan,busy,editable,onChoose,onDetails,onMenus,onSwipes}){
  const choices=shortlistCandidates(plan),key=choices.map(c=>c.item.id).join('|');
  const [selected,setSelected]=useState(()=>plan.request.route?.map(s=>s.placeId)||[]);
  const [expanded,setExpanded]=useState(false),[arranging,setArranging]=useState(false);
  const currentIds=plan.stops.filter(s=>s.item).map(s=>s.item.id);
  function arrange(){setSelected(plan.request.route?.map(s=>s.placeId)||currentIds);setArranging(true);}
  useEffect(()=>setSelected(values=>values.filter(id=>choices.some(c=>c.item.id===id))),[key]);
  const local=choices.filter(c=>!c.item.nearby),nearby=choices.filter(c=>c.item.nearby);
  function toggle(id){setSelected(values=>values.includes(id)?values.filter(v=>v!==id):values.length<3?[...values,id]:values);}
  function move(id,direction){setSelected(values=>{const next=[...values],index=next.indexOf(id),to=index+direction;if(index>=0&&to>=0&&to<next.length)[next[index],next[to]]=[next[to],next[index]];return next;});}
  function rows(values){return (expanded?values:values.slice(0,5)).map(({intent,item})=>{
    const index=selected.indexOf(item.id);
    const stop={id:'shortlist-place',intent,item,start:null,end:null,connections:[]};
    return <div className="cs-place-option" key={item.id}>
      {arranging&&<label className="outing-route-choice"><input type="checkbox" aria-label={`Include ${item.name}`} checked={index>=0} disabled={!editable||busy||index<0&&selected.length>=3} onChange={()=>toggle(item.id)}/><span>{index>=0?`Stop ${index+1}`:'Add to route'}</span></label>}
      <Stop discovery stop={stop} plan={plan} busy={busy} onDetails={(_,view)=>onDetails(item,view)}/>
      {arranging&&index>=0&&<div className="cs-starters"><button aria-label={`Move ${item.name} earlier`} disabled={index===0||busy} onClick={()=>move(item.id,-1)}>Move earlier</button><button aria-label={`Move ${item.name} later`} disabled={index===selected.length-1||busy} onClick={()=>move(item.id,1)}>Move later</button></div>}
    </div>;
  });}
  return <section className="cs-place-shortlist cs-tool" aria-label="Places for your outing" aria-busy={busy}>
    <div className="cs-tool-head"><span><Icon name="map" size={18}/>Your options</span>{busy&&<small>{plan.qualityReview?.status==='pending'?'Checking the fit…':'Updating places…'}</small>}</div>
    {arranging&&<p>Adjust the stops or their order. You can also tell me what to change in chat.</p>}
    {!choices.length&&<p>{plan.nearbyStatus==='unavailable'?'The nearby search could not finish. Your original area is unchanged.':'I looked in your area and further out but couldn’t find a match. Tell me what you’d like to change.'}</p>}
    {rows(local)}
    {!!nearby.length&&<><h3>{plan.searchScope?.kind==='nearby'?'Around your selected area':'A little further out'}</h3><p>{local.length?'These are wider-area options.':'I found no matches in the selected area. These are nearby suggestions.'} Distances are approximate straight lines, not driving distances. Selecting one includes the wider search area.</p>{rows(nearby)}</>}
    {Math.max(local.length,nearby.length)>5&&<button className="pl-text-button" onClick={()=>setExpanded(v=>!v)}>{expanded?'Show fewer places':`See all ${choices.length} places`}</button>}
    <div className="cs-shortlist-actions">{arranging?<><button className="cs-review-plan" disabled={busy||!editable||!selected.length} onClick={()=>{onChoose(selected);setArranging(false);}}>Update the route<Icon name="arrow" size={14}/></button><button onClick={()=>setArranging(false)}>Done</button></>:<>{plan.stops.some(s=>s.item)&&<button onClick={onMenus}>Explore menus</button>}{editable&&<button disabled={busy} onClick={arrange}>Adjust stops</button>}</>}</div>
    {arranging&&!!selected.length&&<small>{selected.map((id,i)=>`${i+1}. ${choices.find(c=>c.item.id===id)?.item.name}`).join(' → ')}</small>}
  </section>;
}
