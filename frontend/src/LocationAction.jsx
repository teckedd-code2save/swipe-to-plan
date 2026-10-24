import {useEffect,useId,useState,useRef} from 'react';
import {api} from './api.js';
import {currentAreaPoint} from './nearby-location.js';
import {Icon} from './PlannerIcons.jsx';
import {CURRENCIES} from './money.js';

export default function LocationAction({brief,preferred,query:initialQuery='',scope:initialScope='plan',signedIn,nearMe=false,onApply,onForget,onDone}){
  const initial=!nearMe&&!initialQuery&&preferred&&(!brief.locationId||brief.locationId===preferred.id)?preferred:null;
  const [selected,setSelected]=useState(initial),[query,setQuery]=useState(initial?.label||initialQuery||brief.area||'');
  const [results,setResults]=useState([]),[searching,setSearching]=useState(false),[searched,setSearched]=useState(false),[active,setActive]=useState(-1);
  const [scope,setScope]=useState(initialScope),[mode,setMode]=useState(brief.currencyMode||'local'),[custom,setCustom]=useState(brief.currency||'USD');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const edited=useRef(false),nearbyRun=useRef(0),nearbyAbort=useRef(null);
  const [locating,setLocating]=useState(false),[nearby,setNearby]=useState(nearMe);
  function cancelNearby(){nearbyRun.current++;nearbyAbort.current?.abort();setLocating(false);setNearby(false);}
  async function findNearby(){
    const run=++nearbyRun.current;nearbyAbort.current?.abort();const abort=new AbortController();nearbyAbort.current=abort;
    edited.current=true;setLocating(true);setError('');setNearby(true);setSelected(null);setQuery('');setResults([]);setActive(-1);
    try{const point=await currentAreaPoint();if(run!==nearbyRun.current)return;const data=await api.nearbyLocations(point,abort.signal);if(run!==nearbyRun.current)return;setResults(data.locations);setSearched(true);}
    catch(e){if(run===nearbyRun.current&&e.name!=='AbortError')setError(e.message);}
    finally{if(run===nearbyRun.current)setLocating(false);}
  }
  useEffect(()=>{let mounted=true;if(nearMe)queueMicrotask(()=>{if(mounted)findNearby();});return()=>{mounted=false;nearbyRun.current++;nearbyAbort.current?.abort();};},[]);
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
  async function submit(e){e.preventDefault();if(!selected||!currency)return;setBusy(true);setError('');try{await onApply({area:selected.label,locationId:selected.id,currency,currencyMode:mode},scope,selected);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section className="cs-tool cs-location-tool" aria-label="Planning area">
    <div className="cs-tool-head"><span><Icon name="pin" size={17}/>{selected&&preferred&&selected.id===preferred.id?'Use your usual area?':'Where should I plan?'}</span><button onClick={onDone} aria-label="Close location"><Icon name="close" size={15}/></button></div>
    <p className="cs-muted">Choose the area for recommendations. A city, town or neighborhood.</p>
    <div className="cs-nearby-choice"><button type="button" disabled={busy||locating} onClick={findNearby}><Icon name="pin" size={17}/><span>{locating?'Finding nearby areas…':'Use my current location'}</span></button><small>With your permission, we use an approximate location to suggest areas. No live tracking.</small></div>
    <form onSubmit={submit}>
      <label className="cs-location-label">Search for an area<input role="combobox" aria-label="Search planning areas" aria-autocomplete="list" aria-expanded={!selected&&results.length>0} aria-controls={listId} aria-activedescendant={active>=0?`${listId}-${active}`:undefined} autoComplete="off" maxLength={160} value={query} placeholder="Search anywhere…" onChange={e=>{cancelNearby();edited.current=true;setQuery(e.target.value);setSelected(null);setError('');}} onKeyDown={e=>{if(e.key==='ArrowDown'&&results.length){e.preventDefault();setActive(i=>(i+1)%results.length);}else if(e.key==='ArrowUp'&&results.length){e.preventDefault();setActive(i=>(i-1+results.length)%results.length);}else if(e.key==='Enter'&&!selected){e.preventDefault();if(active>=0)choose(results[active]);}else if(e.key==='Escape'){setResults([]);setActive(-1);}}}/></label>
      {!selected&&<><div className="cs-location-results" role="listbox" id={listId} aria-label={nearby?'Areas near you':'Matching planning areas'}>{results.map((place,i)=><button type="button" role="option" id={`${listId}-${i}`} aria-selected={active===i} key={place.id} onClick={()=>choose(place)}><Icon name="pin" size={17}/><span><strong>{place.name}</strong><small>{place.label}</small></span><span className="cs-location-kind">{place.kind}</span></button>)}</div><p className="cs-location-status" role="status">{locating?'Checking your location and finding nearby areas…':searching&&!nearby?'Finding areas…':nearby&&results.length?'Areas near your approximate location. Choose where you’d like to plan.':searched&&!results.length?'No areas found. Try a nearby town or add the country.':query.trim().length<2?'Start typing to search worldwide.':results.length?'Choose a result to confirm the area.':''}</p></>}
      {selected&&<><div className="cs-location-selected"><Icon name="check" size={15}/><span><strong>{selected.name}</strong><small>{selected.country}{preferred?.id===selected.id?' · Your saved area':''}</small></span><span>{selected.currency||'Choose currency'}</span></div>
        {!currency&&<label className="cs-location-label">Planning currency<select aria-label="Planning currency" value="" onChange={e=>{setMode('custom');setCustom(e.target.value);}}><option value="" disabled>Choose a currency</option>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></label>}
        <p className="cs-location-money-note">{currency?`${mode==='local'?`${currency} for this area`:`Your chosen ${currency} currency`}. Set the budget in Review plan.`:'Choose a currency to continue.'}</p>
        <fieldset className="cs-location-scope"><legend>Use this area</legend><label className={scope==='plan'?'selected':''}><input type="radio" name={`scope-${listId}`} value="plan" checked={scope==='plan'} onChange={()=>setScope('plan')}/><span>Just this plan</span></label><label className={scope==='default'?'selected':''}><input type="radio" name={`scope-${listId}`} value="default" checked={scope==='default'} onChange={()=>setScope('default')}/><span>Always use this</span></label></fieldset>
        <p className="cs-location-memory">{scope==='default'?`I’ll offer this area next time. ${signedIn?'Saved to your account.':'Remembered on this device.'}`:preferred?`Your usual area stays ${preferred.name}.`:'Your next plan can be somewhere else.'}</p>
        <button className="cs-location-apply" disabled={busy||!currency}>{busy?'Setting your area…':'Use this area'}<Icon name="arrow" size={15}/></button>
      </>}
    </form>
    {error&&<p className="cs-inline-error" role="alert">{error}</p>}
    <div className="cs-location-foot"><small>{nearby?'Nearby areas · confirm before planning':'Area search · no place search yet'}</small>{preferred&&<button disabled={busy} onClick={async()=>{setBusy(true);try{await onForget();setScope('plan');}catch(e){setError(e.message);}finally{setBusy(false);}}}>Forget saved area</button>}</div>
  </section>;
}
