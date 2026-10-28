import {Stop} from './PlanDetails.jsx';
import {alternativeCandidates} from './shortlist.js';
import {Icon} from './PlannerIcons.jsx';
export default function MorePlaces({plan,onDetails,onChoose,busy}){
 const alternatives=alternativeCandidates(plan);
 if(!alternatives.length)return null;
 return <section aria-label="Alternative places"><h3 className="cs-more-options-heading">{plan.stops.some(stop=>stop.item)?'Other places to consider':'A little further out'}</h3>{!plan.stops.some(stop=>stop.item)&&<p className="cs-muted">I looked beyond your chosen area to find these places.</p>}{alternatives.map(({intent,item})=>{
  const stop={id:'shortlist-place',intent,item,start:null,end:null,label:item.name,connections:[],bufferAfterMinutes:0};
  return <div className="cs-place-option" key={item.id}><Stop discovery stop={stop} plan={plan} busy={busy} onDetails={onDetails} onMenus={()=>onDetails(stop,'practical')}/>{item.nearby&&<p className="cs-muted">About {item.nearby.distanceKm} km from the selected area’s centre · wider-area option</p>}{onChoose&&<button className="cs-alternative-choice" disabled={busy} onClick={()=>onChoose({intent,item})}>Choose {item.name}<Icon name="arrow" size={14}/></button>}</div>;
 })}</section>;
}
