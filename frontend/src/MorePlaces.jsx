import {Button} from '@radix-ui/themes';
import {Stop} from './PlanDetails.jsx';
import {alternativeCandidates} from './shortlist.js';
import {Icon} from './PlannerIcons.jsx';
export default function MorePlaces({plan,onDetails,onReplace,onAdd,busy}){
 const alternatives=alternativeCandidates(plan),count=plan.stops.filter(stop=>stop.item).length;
 if(!alternatives.length)return null;
 return <section aria-label="Alternative places"><h3 className="cs-more-options-heading">{count?'Other places to consider':'A little further out'}</h3>{!count&&<p className="cs-muted">I looked beyond your chosen area to find these places.</p>}{alternatives.map(({intent,item})=>{
  const stop={id:'shortlist-place',intent,item,start:null,end:null,label:item.name,connections:[],bufferAfterMinutes:0};
  const actions=<>{onReplace&&count<=1&&<button className="place-view" disabled={busy} onClick={()=>onReplace(item.id)}>{count?'Choose instead':'Choose this place'}<Icon name="arrow" size={15}/></button>}{onAdd&&count>0&&count<3&&<button disabled={busy} onClick={()=>onAdd(item.id)} aria-label={`Add ${item.name} as a stop`} title="Add stop"><Icon name="plus" size={18}/></button>}</>;
  return <div className="cs-place-option" key={item.id}><Stop discovery stop={stop} plan={plan} busy={busy} onDetails={onDetails} actions={actions}/>{item.nearby&&<p className="cs-muted">About {item.nearby.distanceKm} km from the selected area’s centre · wider-area option</p>}</div>;
 })}</section>;
}
