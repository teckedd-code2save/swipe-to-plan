import {Button,Card,Flex,Heading,IconButton,Text} from '@radix-ui/themes';
import {useEffect,useId,useState,useRef} from 'react';
import {api} from './api.js';
import {currentAreaPoint} from './nearby-location.js';
import {Icon} from './PlannerIcons.jsx';
import {CURRENCIES} from './money.js';

export default function LocationAction({brief,preferred,query:initialQuery='',scope:initialScope='plan',signedIn,nearMe=false,manageUsual=false,onApply,onForget,onDone,prompt='',savedAreas=[]}){
  const dialog=useRef(null),openSearch=useRef(null);
  const opening=prompt.replace(/(?:^|\s)(?:where (?:should|would|do|are|can|shall|is)[^?]*\?)\s*$/i,'').trim();
  useEffect(()=>{const node=dialog.current;const previous=document.activeElement;node.showModal();return()=>{openSearch.current?.abort();node.close();requestAnimationFrame(()=>{const input=document.querySelector('textarea[aria-label="Message Unstressed"]');if(input)input.focus({preventScroll:true});else previous?.focus?.();});};},[]);
  const initial=null;
  const [selected,setSelected]=useState(initial),[query,setQuery]=useState(initialQuery||'');
  const [results,setResults]=useState([]),[searching,setSearching]=useState(false),[searched,setSearched]=useState(false),[active,setActive]=useState(-1);
  const [scope,setScope]=useState(initialScope),[mode,setMode]=useState(brief.currencyMode||'local'),[custom,setCustom]=useState(brief.currency||'USD');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[savedNotice,setSavedNotice]=useState('');
  const [suggestedAreas,setSuggestedAreas]=useState([]);
  const [specific,setSpecific]=useState(!!initialQuery),[findingIdeas,setFindingIdeas]=useState(false),[ideas,setIdeas]=useState([]);
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
  useEffect(()=>{
    if(nearby)return;
    if(selected||query.trim().length<2){setResults([]);setSearched(false);return;}
    const abort=new AbortController();setSearching(true);setError('');setActive(-1);
    const timer=setTimeout(()=>api.locations(query.trim(),abort.signal).then(data=>{if(!abort.signal.aborted){setResults(data.locations);setSearched(true);}}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setSearching(false);}),400);
    return()=>{clearTimeout(timer);abort.abort();};
  },[query,selected,nearby]);
  function choose(place){cancelNearby();edited.current=true;setSelected(place);setQuery(place.label);setResults([]);setActive(-1);setError('');}
  async function findIdeas(){const abort=new AbortController();openSearch.current?.abort();openSearch.current=abort;setFindingIdeas(true);setError('');try{const data=await api.compareLocations(brief,abort.signal);if(abort.signal.aborted)return;const area=data.area;if(!area){setError(data.areasUnavailable?'I couldn’t finish comparing areas. Please try again.':'I couldn’t find matching places yet. Try near you or name a place.');return;}const currency=brief.currencyMode==='custom'?brief.currency:area.currency;await onApply({area:area.label,locationId:area.id,currency,currencyMode:brief.currencyMode||'local'},'plan',{...area,openMatch:true,areasCompared:data.areasCompared,areasUnavailable:data.areasUnavailable});}catch(e){if(e.name!=='AbortError')setError(e.message);}finally{if(openSearch.current===abort)openSearch.current=null;setFindingIdeas(false);}}
  async function submit(e){e.preventDefault();if(!selected||!currency)return;setBusy(true);setError('');try{await onApply({area:selected.label,locationId:selected.id,currency,currencyMode:mode},scope,Object.fromEntries(Object.entries(selected).filter(([key])=>!['distanceKm','broadArea','example'].includes(key))));if(manageUsual&&scope==='default'){setSavedNotice(`${selected.name} saved. Add another area if you like.`);setSelected(null);setQuery('');setSpecific(false);setResults([]);setSearched(false);}}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <dialog ref={dialog} className="cs-location-dialog" aria-label="Planning area" onCancel={onDone}><section className="cs-tool cs-location-tool">
    <div className="cs-tool-head"><span>{manageUsual?'Your usual areas':'Let’s pin the location'}</span><button onClick={onDone} aria-label="Close location"><Icon name="close" size={15}/></button></div>
    {opening&&<Text as="p" size="2" color="gray" mb="3">{opening}</Text>}
    <Heading as="h2" size="5" mb="3">{manageUsual?'Places you often enjoy':'Where should I look?'}</Heading>{!manageUsual&&<Text as="p" size="2" color="gray" mb="3">Choose a place, or let me find a promising area for this outing. You can change it anytime.</Text>}{manageUsual&&<Text as="p" size="2" color="gray" mb="3">Save up to 8 areas. You can add or remove them anytime.</Text>}{savedNotice&&<Text as="p" size="2" color="green" role="status" mb="3">{savedNotice}</Text>}
    {!selected&&<Flex gap="2" wrap="wrap" mb="4"><Button type="button" size="2" variant="soft" disabled={busy||locating} onClick={()=>findNearby()}><Icon name="pin" size={16}/>{locating?'Finding nearby areas…':'Near me'}</Button><Button type="button" size="2" variant="outline" onClick={()=>{cancelNearby();setSpecific(true);requestAnimationFrame(()=>dialog.current?.querySelector('input[role=combobox]')?.focus());}}>A specific place</Button>{!manageUsual&&<Button type="button" size="2" variant="outline" disabled={findingIdeas||busy} onClick={findIdeas}>{findingIdeas?'Comparing places…':'Anywhere that fits'}</Button>}</Flex>}
    {!selected&&ideas.length>0&&<Flex direction="column" gap="2" mb="4"><Text size="2" color="gray">Ideas to explore</Text>{ideas.map(area=><Card key={area.id} asChild><button type="button" onClick={()=>choose(area)}><Flex align="center" gap="3"><Icon name="pin" size={17}/><Flex direction="column" gap="1" flexGrow="1"><Text weight="medium">{area.name}{area.country?`, ${area.country}`:''}</Text><Text size="1" color="gray">Explore places like {area.example}</Text></Flex><Icon name="arrow" size={16}/></Flex></button></Card>)}</Flex>}
    {!selected&&!query&&!nearby&&savedAreas.map(area=><Flex key={area.id} gap="2" align="center" mb="2"><Card asChild flexGrow="1"><button type="button" onClick={()=>choose(area)}><Flex align="center" gap="3"><Icon name="pin" size={17}/><Flex direction="column" gap="1" flexGrow="1"><Text weight="medium">{area.name}</Text><Text size="1" color="gray">Saved area</Text></Flex><Icon name="arrow" size={16}/></Flex></button></Card><IconButton type="button" variant="ghost" aria-label={`Forget ${area.name}`} disabled={busy} onClick={async()=>{setBusy(true);try{await onForget(area.id);}catch(e){setError(e.message);}finally{setBusy(false);}}}><Icon name="close" size={14}/></IconButton></Flex>)}
    {!selected&&!query&&!nearby&&suggestedAreas.length>0&&<Flex direction="column" gap="2" mb="4"><Text size="2" color="gray">Or explore somewhere nearby</Text>{suggestedAreas.filter(area=>!savedAreas.some(saved=>saved.id===area.id)).map(area=><Card key={area.id} asChild><button type="button" onClick={()=>choose(area)}><Flex align="center" gap="3"><Icon name="pin" size={17}/><Flex direction="column" gap="1" flexGrow="1"><Text weight="medium">{area.name}</Text><Text size="1" color="gray">Explore places like {area.example}</Text></Flex><Icon name="arrow" size={16}/></Flex></button></Card>)}</Flex>}
    {nearby&&<p className="cs-location-memory">Your location is used with permission. No live tracking.</p>}
    <form onSubmit={submit}>
      {(specific||initialQuery||selected)&&<label className="cs-location-label">Town or neighbourhood<input role="combobox" aria-label="Search planning areas" aria-autocomplete="list" aria-expanded={!selected&&results.length>0} aria-controls={listId} aria-activedescendant={active>=0?`${listId}-${active}`:undefined} autoComplete="off" maxLength={160} value={query} placeholder="Town or neighbourhood" onChange={e=>{cancelNearby();edited.current=true;setQuery(e.target.value);setSelected(null);setError('');}} onKeyDown={e=>{if(e.key==='ArrowDown'&&results.length){e.preventDefault();setActive(i=>(i+1)%results.length);}else if(e.key==='ArrowUp'&&results.length){e.preventDefault();setActive(i=>(i-1+results.length)%results.length);}else if(e.key==='Enter'&&!selected){e.preventDefault();if(active>=0)choose(results[active]);}else if(e.key==='Escape'){setResults([]);setActive(-1);}}}/></label>}
      {!selected&&<><div className="cs-location-results" role="listbox" id={listId} aria-label={nearby?'Areas near you':'Matching planning areas'}>{results.map((place,i)=><button type="button" role="option" id={`${listId}-${i}`} aria-selected={active===i} key={place.id} onClick={()=>choose(place)}><Icon name="pin" size={17}/><span><strong>{place.name}</strong><small>{place.label}</small>{nearby&&<small>{place.broadArea?'Wider region':place.distanceKm!==undefined?`About ${place.distanceKm} km to area centre`:place.kind}</small>}</span><span className="cs-location-kind">{place.kind}</span></button>)}</div><p className="cs-location-status" role="status">{locating?'Checking your location and finding nearby areas…':searching&&!nearby?'Finding areas…':nearby&&results.length?`Areas within about ${radiusKm} km. Distances are straight-line to area centres, not driving distances.`:searched&&!results.length?(nearby?'I couldn’t find an area in this range. You can look a little further or search for your nearest town.':'No areas found. Try a nearby town or add the country.'):query.trim().length<2?'':results.length?'Choose an area.':''}</p>{nearby&&searched&&!locating&&!error&&<div className="cs-nearby-expand"><p>{results.filter(p=>!p.broadArea).length<3?'There are only a few mapped areas here. That doesn’t mean there aren’t good places nearby.':'Not the area you had in mind?'} {radiusKm<100?'You can include towns a little further away.':'Try searching for a town or district you know.'}</p>{radiusKm<100&&<button type="button" onClick={()=>findNearby(radiusKm===20?50:100)}>Look within {radiusKm===20?50:100} km<Icon name="arrow" size={14}/></button>}</div>}</>}
      {selected&&<><div className="cs-location-selected"><Icon name="check" size={15}/><span><strong>{selected.name}</strong><small>{selected.country}{savedAreas.some(area=>area.id===selected.id)?' · Your saved area':''}</small></span><span>{selected.currency||'Choose currency'}</span></div>
        {!currency&&<label className="cs-location-label">Planning currency<select aria-label="Planning currency" value="" onChange={e=>{setMode('custom');setCustom(e.target.value);}}><option value="" disabled>Choose a currency</option>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></label>}
        <p className="cs-location-money-note">{currency?`${mode==='local'?`${currency} for this area`:`Your chosen ${currency} currency`}. You can adjust spending in chat.`:'Choose a currency to continue.'}</p>
        {!manageUsual&&<fieldset className="cs-location-scope"><legend>Remember this area?</legend><label className={scope==='plan'?'selected':''}><input type="radio" name={`scope-${listId}`} value="plan" checked={scope==='plan'} onChange={()=>setScope('plan')}/><span>Just this outing</span></label><label className={scope==='default'?'selected':''}><input type="radio" name={`scope-${listId}`} value="default" checked={scope==='default'} onChange={()=>setScope('default')}/><span>Remember for later</span></label></fieldset>}
        <p className="cs-location-memory">{scope==='default'?`I’ll save this ${signedIn?'to your account':'on this device'}. You can change it anytime.`:'You can choose somewhere different next time.'}</p>
        <button className="cs-location-apply" disabled={busy||!currency}>{busy?'One moment…':manageUsual?'Save area':'Let’s go'}<Icon name="arrow" size={15}/></button>
      </>}
    </form>
    {manageUsual&&<Flex justify="end" mt="4"><Button type="button" variant="soft" onClick={onDone} disabled={busy}>Done</Button></Flex>}
    {error&&<p className="cs-inline-error" role="alert">{error}</p>}

  </section></dialog>;
}

