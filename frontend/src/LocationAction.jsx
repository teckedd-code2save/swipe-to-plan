import {useEffect,useId,useState,useRef} from 'react';
import {api} from './api.js';
import {currentAreaPoint} from './nearby-location.js';
import {Icon} from './PlannerIcons.jsx';
import {CURRENCIES} from './money.js';

export default function LocationAction({brief,preferred,query:initialQuery='',scope:initialScope='plan',signedIn,nearMe=false,onApply,onForget,onDone,prompt='',savedAreas=[]}){
  const dialog=useRef(null);
  useEffect(()=>{const node=dialog.current;const previous=document.activeElement;node.showModal();return()=>{node.close();requestAnimationFrame(()=>{const input=document.querySelector('textarea[aria-label="Message Unstressed"]');if(input)input.focus({preventScroll:true});else previous?.focus?.();});};},[]);
  const initial=null;
  const [selected,setSelected]=useState(initial),[query,setQuery]=useState(initial?.label||initialQuery||brief.area||'');
  const [results,setResults]=useState([]),[searching,setSearching]=useState(false),[searched,setSearched]=useState(false),[active,setActive]=useState(-1);
  const [scope,setScope]=useState(initialScope),[mode,setMode]=useState(brief.currencyMode||'local'),[custom,setCustom]=useState(brief.currency||'USD');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [suggestedAreas,setSuggestedAreas]=useState([]);
  const edited=useRef(false),nearbyRun=useRef(0),nearbyAbort=useRef(null),nearbyPoint=useRef(null);
  const [radiusKm,setRadiusKm]=useState(20);
  const [locating,setLocating]=useState(false),[nearby,setNearby]=useState(nearMe);
  function cancelNearby(){nearbyRun.current++;nearbyAbort.current?.abort();setLocating(false);setNearby(false);}
  async function findNearby(distance=20){
    const run=++nearbyRun.current;nearbyAbort.current?.abort();const abort=new AbortController();nearbyAbort.current=abort;
    edited.current=true;setLocating(true);setError('');setNearby(true);setSelected(null);setQuery('');setResults([]);setActive(-1);setRadiusKm(distance);setSearched(false);
    try{const point=distance>20&&nearbyPoint.current?nearbyPoint.current:await currentAreaPoint();if(run!==nearbyRun.current)return;nearbyPoint.current=point;const data=await api.nearbyLocations({...point,radiusKm:distance},abort.signal);if(run!==nearbyRun.current)return;setResults(data.locations);setSearched(true);}
    catch(e){if(run===nearbyRun.current&&e.name!=='AbortError')setError(e.message);}
    finally{if(run===nearbyRun.current)setLocating(false);}
  }
  useEffect(()=>{let mounted=true;if(nearMe)queueMicrotask(()=>{if(mounted)findNearby();});return()=>{mounted=false;nearbyRun.current++;nearbyAbort.current?.abort();nearbyPoint.current=null;};},[]);
  useEffect(()=>{if(!preferred?.id||nearMe||initialQuery)return;const abort=new AbortController();api.suggestLocations(preferred.id,brief,abort.signal).then(data=>{if(!abort.signal.aborted)setSuggestedAreas(data.locations||[]);}).catch(()=>{});return()=>abort.abort();},[]);
  useEffect(()=>{if(initialQuery){cancelNearby();edited.current=true;setSelected(null);setQuery(initialQuery);setError('');}},[initialQuery]);
  const listId=useId(),currency=mode==='local'?selected?.currency:custom;
  useEffect(()=>{let live=true;if(!nearMe&&!initialQuery&&!initial&&brief.locationId){setSearching(true);api.location(brief.locationId).then(value=>{if(live&&!edited.current){setSelected(value);setQuery(value.label);}}).catch(e=>live&&setError(e.message)).finally(()=>live&&setSearching(false));}return()=>{live=false;};},[]);
  useEffect(()=>{
    if(nearby)return;
    if(selected||query.trim().length<2){setResults([]);setSearched(false);return;}
    const abort=new AbortController();setSearching(true);setError('');setActive(-1);
    const timer=setTimeout(()=>api.locations(query.trim(),abort.signal).then(data=>{if(!abort.signal.aborted){setResults(data.locations);setSearched(true);}}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setSearching(false);}),400);
    return()=>{clearTimeout(timer);abort.abort();};
  },[query,selected,nearby]);
  function choose(place){cancelNearby();edited.current=true;setSelected(place);setQuery(place.label);setResults([]);setActive(-1);setError('');}
  async function submit(e){e.preventDefault();if(!selected||!currency)return;setBusy(true);setError('');try{await onApply({area:selected.label,locationId:selected.id,currency,currencyMode:mode},scope,Object.fromEntries(Object.entries(selected).filter(([key])=>!['distanceKm','broadArea','example'].includes(key))));}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <dialog ref={dialog} className="cs-location-dialog" aria-label="Planning area" onCancel={onDone}><section className="cs-tool cs-location-tool">
    <div className="cs-tool-head"><span>Your outing</span><button onClick={onDone} aria-label="Close location"><Icon name="close" size={15}/></button></div>
    {prompt&&<p className="cs-location-context">{prompt}</p>}
    {!prompt.trim().endsWith('?')&&<h2 className="cs-location-question">Where should I look?</h2>}
    {!selected&&!query&&!nearby&&savedAreas.map(area=><div className="cs-saved-area" key={area.id}><button type="button" className="cs-location-usual" onClick={()=>choose(area)}><Icon name="pin" size={17}/><span><strong>{area.name}</strong><small>Saved area</small></span><Icon name="arrow" size={16}/></button><button type="button" className="cs-forget-area" aria-label={`Forget ${area.name}`} disabled={busy} onClick={async()=>{setBusy(true);try{await onForget(area.id);}catch(e){setError(e.message);}finally{setBusy(false);}}}><Icon name="close" size={14}/></button></div>)}
    {!selected&&!query&&!nearby&&suggestedAreas.length>0&&<div className="cs-location-suggestions"><p>Or explore somewhere nearby</p>{suggestedAreas.filter(area=>!savedAreas.some(saved=>saved.id===area.id)).map(area=><button type="button" key={area.id} className="cs-location-usual" onClick={()=>choose(area)}><Icon name="pin" size={17}/><span><strong>{area.name}</strong><small>Explore places like {area.example}</small></span><Icon name="arrow" size={16}/></button>)}</div>}
    <div className="cs-nearby-choice"><button type="button" disabled={busy||locating} onClick={()=>findNearby()}><Icon name="pin" size={17}/><span>{locating?'Finding nearby areas…':'Use my location'}</span></button><small>With your permission. No live tracking.</small></div>
    <form onSubmit={submit}>
      <label className="cs-location-label">Or choose a town or neighbourhood<input role="combobox" aria-label="Search planning areas" aria-autocomplete="list" aria-expanded={!selected&&results.length>0} aria-controls={listId} aria-activedescendant={active>=0?`${listId}-${active}`:undefined} autoComplete="off" maxLength={160} value={query} placeholder="Town or neighbourhood" onChange={e=>{cancelNearby();edited.current=true;setQuery(e.target.value);setSelected(null);setError('');}} onKeyDown={e=>{if(e.key==='ArrowDown'&&results.length){e.preventDefault();setActive(i=>(i+1)%results.length);}else if(e.key==='ArrowUp'&&results.length){e.preventDefault();setActive(i=>(i-1+results.length)%results.length);}else if(e.key==='Enter'&&!selected){e.preventDefault();if(active>=0)choose(results[active]);}else if(e.key==='Escape'){setResults([]);setActive(-1);}}}/></label>
      {!selected&&<><div className="cs-location-results" role="listbox" id={listId} aria-label={nearby?'Areas near you':'Matching planning areas'}>{results.map((place,i)=><button type="button" role="option" id={`${listId}-${i}`} aria-selected={active===i} key={place.id} onClick={()=>choose(place)}><Icon name="pin" size={17}/><span><strong>{place.name}</strong><small>{place.label}</small>{nearby&&<small>{place.broadArea?'Wider region':place.distanceKm!==undefined?`About ${place.distanceKm} km to area centre`:place.kind}</small>}</span><span className="cs-location-kind">{place.kind}</span></button>)}</div><p className="cs-location-status" role="status">{locating?'Checking your location and finding nearby areas…':searching&&!nearby?'Finding areas…':nearby&&results.length?`Areas within about ${radiusKm} km. Distances are straight-line to area centres, not driving distances.`:searched&&!results.length?(nearby?'I couldn’t find an area in this range. You can look a little further or search for your nearest town.':'No areas found. Try a nearby town or add the country.'):query.trim().length<2?'':results.length?'Choose an area.':''}</p>{nearby&&searched&&!locating&&!error&&<div className="cs-nearby-expand"><p>{results.filter(p=>!p.broadArea).length<3?'There are only a few mapped areas here. That doesn’t mean there aren’t good places nearby.':'Not the area you had in mind?'} {radiusKm<100?'You can include towns a little further away.':'Try searching for a town or district you know.'}</p>{radiusKm<100&&<button type="button" onClick={()=>findNearby(radiusKm===20?50:100)}>Look within {radiusKm===20?50:100} km<Icon name="arrow" size={14}/></button>}</div>}</>}
      {selected&&<><div className="cs-location-selected"><Icon name="check" size={15}/><span><strong>{selected.name}</strong><small>{selected.country}{savedAreas.some(area=>area.id===selected.id)?' · Your saved area':''}</small></span><span>{selected.currency||'Choose currency'}</span></div>
        {!currency&&<label className="cs-location-label">Planning currency<select aria-label="Planning currency" value="" onChange={e=>{setMode('custom');setCustom(e.target.value);}}><option value="" disabled>Choose a currency</option>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></label>}
        <p className="cs-location-money-note">{currency?`${mode==='local'?`${currency} for this area`:`Your chosen ${currency} currency`}. You can adjust spending in chat.`:'Choose a currency to continue.'}</p>
        <fieldset className="cs-location-scope"><legend>Remember this area?</legend><label className={scope==='plan'?'selected':''}><input type="radio" name={`scope-${listId}`} value="plan" checked={scope==='plan'} onChange={()=>setScope('plan')}/><span>Just this outing</span></label><label className={scope==='default'?'selected':''}><input type="radio" name={`scope-${listId}`} value="default" checked={scope==='default'} onChange={()=>setScope('default')}/><span>Remember for later</span></label></fieldset>
        <p className="cs-location-memory">{scope==='default'?`I’ll save this ${signedIn?'to your account':'on this device'}. You can change it anytime.`:'You can choose somewhere different next time.'}</p>
        <button className="cs-location-apply" disabled={busy||!currency}>{busy?'One moment…':'Let’s go'}<Icon name="arrow" size={15}/></button>
      </>}
    </form>
    {error&&<p className="cs-inline-error" role="alert">{error}</p>}

  </section></dialog>;
}

