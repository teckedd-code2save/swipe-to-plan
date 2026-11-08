import {useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {areaStartingPoint,currentRoutePoint} from './route-start.js';

export default function RouteStart({value,onChange,savedAreas=[],planningArea,inputId,noteId,inputRef}) {
  const [locating,setLocating]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState(false),[query,setQuery]=useState(''),[results,setResults]=useState([]),[searching,setSearching]=useState(false);
  const generation=useRef(0),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  function choose(next){generation.current++;setLocating(false);setError('');onChange(next);}
  async function locate(){
    const run=++generation.current;setLocating(true);setError('');
    try{const point=await currentRoutePoint();if(mounted.current&&generation.current===run)choose(point);}
    catch(e){if(mounted.current&&generation.current===run)setError(e.message);}
    finally{if(mounted.current&&generation.current===run)setLocating(false);}
  }
  useEffect(()=>{
    if(!search||query.trim().length<2){setResults([]);setSearching(false);return;}
    const controller=new AbortController();setSearching(true);setError('');setResults([]);
    const timer=setTimeout(()=>api.locations(query.trim(),controller.signal).then(data=>{if(!controller.signal.aborted)setResults((Array.isArray(data?.locations)?data.locations:[]).filter(area=>area&&typeof area.id==='string'&&typeof area.label==='string'&&area.label.trim()).slice(0,20));}).catch(()=>{if(!controller.signal.aborted)setError('Area search is unavailable. Enter a place name below or use Maps.');}).finally(()=>{if(!controller.signal.aborted)setSearching(false);}),400);
    return()=>{clearTimeout(timer);controller.abort();};
  },[search,query]);
  const areas=[...savedAreas,...(planningArea?[planningArea]:[])].filter((area,index,all)=>area?.label&&all.findIndex(other=>other.id===area.id&&other.label===area.label)===index);
  return <div className="pg-route-start">
    <strong>Where are you starting?</strong>
    <p className="pg-note">No street address needed. Choose an area for a rough route, use your device location, or name a place you know.</p>
    <div className="pg-links"><button className="pl-secondary-button" type="button" disabled={locating} onClick={locate}>{locating?'Finding your location…':'Use current location'}</button><button className="pl-secondary-button" type="button" onClick={()=>{generation.current++;setLocating(false);setSearch(v=>!v);setError('');}}>Choose another area</button></div>
    <p className="pg-note">Current location asks for permission only when you tap. It stays in this view and is shared with Google only when you estimate or open Maps.</p>
    {areas.map(area=><button className="pg-link" key={`${area.id}:${area.label}`} type="button" onClick={()=>choose(areaStartingPoint(area))}>Use {area.label} · approximate area</button>)}
    {search&&<div><label>Town or neighbourhood<input aria-label="Search starting areas" onKeyDown={e=>{if(e.key==='Enter')e.preventDefault();}} value={query} maxLength={160} autoComplete="off" onChange={e=>setQuery(e.target.value)}/></label><div className="pg-links">{results.map(area=><button className="pg-link" type="button" key={area.id} onClick={()=>choose(areaStartingPoint(area))}>{area.label} · approximate area</button>)}</div><p role="status" className="pg-note">{searching?'Finding areas…':query.trim().length>=2&&!results.length?'No matching areas yet. You can enter a place name below.':''}</p></div>}
    <label htmlFor={inputId}>Or enter a place, landmark or address</label><input ref={inputRef} id={inputId} type="text" autoComplete="off" maxLength={300} value={typeof value==='string'?value:''} placeholder="A hotel, landmark or address and city" aria-describedby={noteId} onChange={e=>choose(e.target.value)}/>
    <p className="pg-note" id={noteId}>{value?.kind==='area'?`Starting near ${value.label}. This is an approximate ${value.coordinates?'area centre':'area'}, not your exact position.`:value?.kind==='current'?`Using your device location (reported accuracy about ${Math.ceil(value.accuracyMeters)} m). This is not live tracking. Refresh it if you move.`:'Your starting point is used only for this journey view and is not saved.'}</p>
    {value&&<button type="button" className="pg-link" onClick={()=>choose('')}>Clear starting point</button>}
    {error&&<p className="pg-note" role="alert">{error}</p>}
  </div>;
}
