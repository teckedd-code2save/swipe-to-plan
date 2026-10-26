import {Icon} from './PlannerIcons.jsx';
import {Stop} from './PlanDetails.jsx';
import {PlaceDetails} from './PlaceGuide.jsx';
import {useState} from 'react';

export function discoveryView(result){
  // Presentation context only: never saved or used as a scheduled itinerary.
  return {request:result.brief,stops:[],shortlist:(result.items||[]).map(item=>({intent:'activity',item})),budget:{allocations:[]},people:result.brief.people,tasteMap:{nodes:[],edges:[]}};
}
export function DiscoveryReceipt({result,onOpen}){
  return <div className="cs-discovery-receipt"><button className="cs-result-card" onClick={onOpen}>
    <span className="cs-result-icon"><Icon name="map" size={22}/></span><span><strong>Places around {result.brief.area.split(',')[0]}</strong><small>{result.items?.length||0} options · menus, hours & contact</small></span><Icon name="arrow" size={17}/>
  </button><small>Chat is temporarily busy. These use existing preferences; your latest message is kept for retry.</small></div>;
}
export default function OutageDiscovery({result,onClose,onPeople}){
  const [selected,setSelected]=useState(null),view=discoveryView(result);
  const stop=selected?{id:'shortlist-place',intent:'activity',item:selected.item,start:null,end:null,connections:[]}:null;
  return <><div className="cs-day-header"><div><span className="cs-eyebrow">YOUR OPTIONS · QLOO</span><h2>Places around {result.brief.area.split(',')[0]}</h2><p>{result.brief.area}</p><button className="cs-day-people" onClick={onPeople}><Icon name="people" size={14}/><span>{result.brief.people.length===1?'Your preferences':`${result.brief.people.length} people’s preferences`}</span><Icon name="arrowUpRight" size={12}/></button></div><button className="cs-icon-button cs-close-day" onClick={onClose} aria-label="Back to chat"><Icon name="close" size={19}/></button></div>
    <div className="cs-day-content cs-discovery-content"><p className="cs-discovery-status">Chat is temporarily busy. These options use your existing preferences and area. Your latest request hasn’t been applied.</p>
      <section aria-label="Places for your outing">{(result.items||[]).map(item=><Stop key={item.id} discovery stop={{id:item.id,intent:'activity',item,start:null,end:null,label:item.name,connections:[],bufferAfterMinutes:0}} plan={view} busy={false} onDetails={()=>setSelected({item,initialView:'overview'})} onMenus={()=>setSelected({item,initialView:'practical'})}/>)}</section>
    </div><div className="cs-day-footer"><small>Hours, menus and prices need confirmation.</small></div>
    {stop&&<PlaceDetails key={`${stop.item.id}-${selected.initialView}`} stop={stop} plan={view} checks={{status:'idle'}} initialView={selected.initialView} onClose={()=>setSelected(null)} canSwap={false}/>}
  </>;
}
