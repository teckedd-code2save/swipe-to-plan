import {useState} from 'react';
import {Icon,ACTIVITY_NAMES} from './PlannerIcons.jsx';
import {resultsReady} from './results-ready.js';
import {resultPreview,comparisonPreviewText} from './result-preview.js';
import {decisionStops} from './decision-evidence.js';
import AgentReply from './AgentReply.jsx';
import {selectedPlaceGap} from '../../shared/selection-evidence.js';

function PreviewPlace({stop,index,onPlace}) {
  const [failed,setFailed]=useState(false),item=stop.item;
  const content=<><span className="cs-preview-image">{item?.image&&!failed?<img src={item.image} alt="" loading="lazy" onError={()=>setFailed(true)}/>:<Icon name={stop.intent||'pin'} size={20}/>}</span><span className="cs-preview-place-copy"><small>{index+1} · {ACTIVITY_NAMES[stop.intent]||'Place'}</small><strong>{item?.name||'Still to find'}</strong>{item?.address&&<span>{item.address}</span>}{!item&&<span>{selectedPlaceGap(stop)||(stop.reason==='time_in_past'?'Requested time has passed.':stop.reason==='no_open_place'?'No place fits the requested time.':'No matching place returned.')}</span>}</span>{item&&<Icon name="arrowUpRight" size={15}/>}</>;
  return <li>{item?<button type="button" onClick={()=>onPlace(stop,'practical')} aria-label={`Explore stop ${index+1}: ${item.name}`}>{content}</button>:<div className="cs-preview-unfilled">{content}</div>}</li>;
}

export default function RecommendationPreview({plan,onPlace,onMore,comparisonText='',previous=false,current=false}) {
  const preview=resultPreview(plan);
  if(!preview)return null;
  const filled=preview.stops.filter(stop=>stop.item).length,total=preview.stops.length,options=resultsReady(plan,null).count;
  const lead=comparisonPreviewText(comparisonText,plan);
  return <section className="cs-recommendation-preview" aria-label="Outing recommendation preview">
    <div className="cs-preview-heading"><Icon name="leaf" size={17}/><strong>{previous?'Previous results':current?'Current results':preview.title}</strong>{comparisonText&&<span>Compared</span>}</div>
    {lead&&<div className="cs-preview-lead"><AgentReply text={lead} stops={decisionStops(plan)} onPlace={onPlace}/></div>}
    <p className="cs-preview-count">{filled===total?`${total} planned ${total===1?'stop':'stops'}`:`${filled} of ${total} stops found`} · {options} {options===1?'place':'places'} to explore</p>
    <ol className="cs-preview-places">{preview.stops.map((stop,index)=><PreviewPlace key={`${stop.id}:${index}:${stop.item?.id||'missing'}`} stop={stop} index={index} onPlace={onPlace}/>)}</ol>
    {preview.alternatives.length>0&&<p className="cs-preview-caution">{preview.alternatives.length} nearby alternatives are available in results. They are not selected visits.</p>}
    {preview.warnings.map((warning,index)=><p className="cs-preview-caution" key={index}>{warning}</p>)}
    <p className="cs-preview-limits">Hours, prices and availability need confirmation.</p>
    <button type="button" className="cs-preview-more" onClick={onMore}>More · View results<Icon name="arrow" size={16}/></button>
  </section>;
}
