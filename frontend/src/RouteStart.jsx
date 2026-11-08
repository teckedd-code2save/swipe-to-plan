import {useEffect,useRef,useState} from 'react';
import {roundedAreaPoint} from './nearby-location.js';
import {api} from './api.js';
import {areaStartingPoint,currentRoutePoint,resolvedAreaStartingPoint} from './route-start.js';

export default function RouteStart({value,onChange,savedAreas=[],planningArea,inputId,noteId,inputRef,onSaveArea,signedIn,compact=false}) {
  const [locating,setLocating]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState(false),[query,setQuery]=useState(''),[results,setResults]=useState([]),[searching,setSearching]=useState(false);
  const [nearbyResults,setNearbyResults]=useState([]),[saving,setSaving]=useState(false),[saved,setSaved]=useState('');
  const [resolvingArea,setResolvingArea]=useState(false);
  const generation=useRef(0),mounted=useRef(true),areaLookup=useRef(null);
  function cancelAreaLookup(){areaLookup.current?.controller.abort();areaLookup.current=null;setResolvingArea(false);}
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;areaLookup.current?.controller.abort();};},[]);
  function choose(next){generation.current++;cancelAreaLookup();setLocating(false);setError('');setSaved('');setNearbyResults([]);onChange(next);}
  async function chooseArea(area){
    if(areaLookup.current?.id===area.id)return;
    const point=areaStartingPoint(area);choose(point);
    if(point.coordinates||typeof area.id!=='string'||!area.id.trim())return;
    // Resolve only a chosen catalog ID. No address geocoder or inferred location.
    const run=generation.current,controller=new AbortController();areaLookup.current={id:area.id,controller};setResolvingArea(true);
    try{
      const resolved=await api.location(area.id,controller.signal);
      if(!mounted.current||generation.current!==run)return;
      const enriched=resolvedAreaStartingPoint(area,resolved);
      if(enriched){choose(enriched);}
      if(!enriched?.coordinates)setError('This area has no verified map centre. Use current location, choose another area, or open Maps.');
    }catch{
      if(mounted.current&&generation.current===run)setError('The area map centre is unavailable. Use current location, choose another area, or open Maps.');
    }finally{if(mounted.current&&generation.current===run){setResolvingArea(false);areaLookup.current=null;}}
  }
  async function locate(){
    cancelAreaLookup();
    const run=++generation.current;setLocating(true);setError('');
    try{const point=await currentRoutePoint();if(mounted.current&&generation.current===run){if(point.kind==='nearby')await findAreas(point.point,run);else choose(point);}}
    catch(e){if(mounted.current&&generation.current===run)setError(e.message);}
    finally{if(mounted.current&&generation.current===run)setLocating(false);}
  }
  async function findAreas(point,run=++generation.current){
    cancelAreaLookup();setLocating(true);setError('');setNearbyResults([]);
    try{const data=await api.nearbyLocations({...point,radiusKm:20});if(mounted.current&&generation.current===run){setNearbyResults((Array.isArray(data?.locations)?data.locations:[]).filter(area=>typeof area?.id==='string'&&typeof area?.label==='string'&&area.label.trim()));if(!data?.locations?.length)setError('No nearby areas found. Search for your town or neighbourhood.');}}
    catch(e){if(mounted.current&&generation.current===run)setError(e.message);}
    finally{if(mounted.current&&generation.current===run)setLocating(false);}
  }
  async function saveArea(){const run=generation.current;setSaving(true);setError('');try{await onSaveArea(value.area);if(mounted.current&&generation.current===run)setSaved('Area saved as your default for new outings. This journey stays unchanged.');}catch(e){if(mounted.current&&generation.current===run)setError(e.message);}finally{if(mounted.current)setSaving(false);}}
  useEffect(()=>{
    if(!search||query.trim().length<2){setResults([]);setSearching(false);return;}
    const controller=new AbortController();setSearching(true);setError('');setResults([]);
    const timer=setTimeout(()=>api.locations(query.trim(),controller.signal).then(data=>{if(!controller.signal.aborted)setResults((Array.isArray(data?.locations)?data.locations:[]).filter(area=>area&&typeof area.id==='string'&&typeof area.label==='string'&&area.label.trim()).slice(0,20));}).catch(()=>{if(!controller.signal.aborted)setError('Area search is unavailable. Enter a place name below or use Maps.');}).finally(()=>{if(!controller.signal.aborted)setSearching(false);}),400);
    return()=>{clearTimeout(timer);controller.abort();};
  },[search,query]);
  const areas=[...savedAreas,...(planningArea?[planningArea]:[])].filter((area,index,all)=>area?.label&&all.findIndex(other=>other.id===area.id&&other.label===area.label)===index);
  if(compact)return <div className="pg-route-start gr-start-choices">
    {!!areas.length&&<div className="pg-saved-areas">{areas.map(area=><button className="gr-area-choice" type="button" aria-label={`Use ${area.label} · approximate area`} key={`${area.id}:${area.label}`} onClick={()=>chooseArea(area)} aria-pressed={value?.kind==='area'&&value.area?.id===area.id}><strong>{area.label}</strong><small>{savedAreas.some(saved=>saved.id===area.id)?'Saved area':'Planning area'} · approximate start</small></button>)}</div>}
    <div className="pg-links"><button className="pl-secondary-button" type="button" disabled={locating} onClick={locate}>{locating?'Finding your location…':'Use current location'}</button><button className="pl-secondary-button" type="button" onClick={()=>{generation.current++;cancelAreaLookup();setLocating(false);setNearbyResults([]);setSearch(v=>!v);setError('');}}>Choose another area</button></div>
    {search&&<div><label>Town or neighbourhood<input autoFocus aria-label="Search starting areas" onKeyDown={e=>{if(e.key==='Enter')e.preventDefault();}} value={query} maxLength={160} autoComplete="off" onChange={e=>setQuery(e.target.value)}/></label><div className="pg-saved-areas">{results.map(area=><button className="gr-area-choice" type="button" key={area.id} onClick={()=>chooseArea(area)}>{area.label}<small>Approximate area</small></button>)}</div><p role="status" className="pg-note">{searching?'Finding areas…':query.trim().length>=2&&!results.length?'No matching areas. Try a landmark below.':''}</p></div>}
    {nearbyResults.length>0&&<div className="pg-saved-areas">{nearbyResults.map(area=><button className="gr-area-choice" key={area.id} type="button" onClick={()=>chooseArea(area)}>{area.label}<small>Nearby area · approximate start</small></button>)}</div>}
    <label htmlFor={inputId}>Or a landmark or place<input ref={inputRef} id={inputId} type="text" autoComplete="off" maxLength={300} value={typeof value==='string'?value:''} placeholder="Hotel or landmark and city" aria-describedby={noteId} onChange={e=>choose(e.target.value)}/></label>
    <p className="pg-note" id={noteId}>{value?.kind==='area'?`Near ${value.label}. Approximate area${value.coordinates?' centre':''}, not your exact position.`:value?.kind==='current'?`Device location · reported accuracy about ${Math.ceil(value.accuracyMeters)} m.`:'Location is requested only when you tap. Your start is not saved.'}</p>
    {value&&<button type="button" className="pg-link" onClick={()=>choose('')}>Clear starting point</button>}
    {value?.kind==='current'&&onSaveArea&&<button className="pg-link" type="button" disabled={locating} onClick={()=>findAreas(roundedAreaPoint({latitude:value.coordinates.lat,longitude:value.coordinates.lng}))}>Find a nearby area to save as default</button>}
    {value?.kind==='area'&&value.area?.id&&onSaveArea&&<div className="gr-save-area"><button className="pg-link" type="button" disabled={saving||resolvingArea} onClick={saveArea}>{saving?'Saving area…':'Save area as default'}</button><small>For new outings {signedIn?'on your account':'on this device'}. No exact location saved.</small></div>}
    {resolvingArea&&<p role="status" className="pg-note">Finding the area’s map centre…</p>}{saved&&<p role="status" className="pg-note">{saved}</p>}{error&&<p className="pg-note" role="alert">{error}</p>}
    <details className="gr-more"><summary>Location privacy</summary><p>Your start stays in this view only. GPS needs your permission; nearby-area search sends a rounded location. Saving a default stores the area, never GPS. Routes from an area are approximate.</p></details>
  </div>;
  return <div className="pg-route-start">
    <strong>Where are you starting?</strong>
    <div className="pg-links"><button className="pl-secondary-button" type="button" disabled={locating} onClick={locate}>{locating?'Finding your location…':'Use current location'}</button><button className="pl-secondary-button" type="button" onClick={()=>{generation.current++;cancelAreaLookup();setLocating(false);setNearbyResults([]);setSearch(v=>!v);setError('');}}>Choose another area</button></div>
    <p className="pg-note">Location permission only on tap. Nearby search sends a rounded location. No tracking.</p>
    {nearbyResults.length>0&&<div><p className="pg-note">Choose a nearby area. Routes are approximate; GPS is never saved.</p>{nearbyResults.map(area=><button className="pg-link" key={area.id} type="button" onClick={()=>chooseArea(area)}>{area.label} · approximate area</button>)}</div>}
    {value?.kind==='current'&&onSaveArea&&<button className="pg-link" type="button" disabled={locating} onClick={()=>findAreas(roundedAreaPoint({latitude:value.coordinates.lat,longitude:value.coordinates.lng}))}>Find a nearby area to save as default</button>}
    {value?.kind==='area'&&value.area?.id&&onSaveArea&&<div><p className="pg-note">Save this area {signedIn?'to your account':'on this device'} for new outings. Exact position is not saved.</p><button className="pg-link" type="button" disabled={saving||resolvingArea} onClick={saveArea}>{saving?'Saving area…':'Save area as default'}</button></div>}
    {saved&&<p role="status" className="pg-note">{saved}</p>}
    {!!areas.length&&<div className="pg-links pg-saved-areas">{areas.map(area=><button className="pg-link" key={`${area.id}:${area.label}`} type="button" onClick={()=>chooseArea(area)}>Use {area.label} · approximate area</button>)}</div>}
    {search&&<div><label>Town or neighbourhood<input aria-label="Search starting areas" onKeyDown={e=>{if(e.key==='Enter')e.preventDefault();}} value={query} maxLength={160} autoComplete="off" onChange={e=>setQuery(e.target.value)}/></label><div className="pg-links">{results.map(area=><button className="pg-link" type="button" key={area.id} onClick={()=>chooseArea(area)}>{area.label} · approximate area</button>)}</div><p role="status" className="pg-note">{searching?'Finding areas…':query.trim().length>=2&&!results.length?'No matching areas yet. You can enter a place name below.':''}</p></div>}
    <label htmlFor={inputId}>Or name a landmark or place</label><input ref={inputRef} id={inputId} type="text" autoComplete="off" maxLength={300} value={typeof value==='string'?value:''} placeholder="Hotel or landmark and city" aria-describedby={noteId} onChange={e=>choose(e.target.value)}/>
    <p className="pg-note" id={noteId}>{value?.kind==='area'?`Near ${value.label}: approximate ${value.coordinates?'area centre':'area'}, not your exact position.`:value?.kind==='current'?`Device location (reported accuracy about ${Math.ceil(value.accuracyMeters)} m). Not saved. Refresh if you move.`:'Used for this journey only. Your start is not saved.'}</p>
    {value&&<button type="button" className="pg-link" onClick={()=>choose('')}>Clear starting point</button>}
    {resolvingArea&&<p role="status" className="pg-note">Finding the selected area’s map centre… Maps is available now.</p>}
    {error&&<p className="pg-note" role="alert">{error}</p>}
  </div>;
}
