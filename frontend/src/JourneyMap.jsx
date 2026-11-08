import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import RouteAttribution from './RouteAttribution.jsx';
import {journeyPoints,journeyRouteGeometry} from './journey-map.js';
const loadMap=()=>import('./journey-map-leaflet.js');

// CSS lives in journey-map.css; import once from the app stylesheet/entrypoint.
export default function JourneyMap({plan,origin,selectedStopId,onSelectStop,routeScope='',routeEstimate=null,loadMapLibrary=loadMap,showKey=true,onSelectStart}) {
  const points=journeyPoints(plan,origin),signature=JSON.stringify(points),scope=routeScope;
  const geometry=journeyRouteGeometry(routeEstimate,points,selectedStopId),geometrySignature=JSON.stringify(geometry);
  const [status,setStatus]=useState('loading'),[attempt,setAttempt]=useState(0);
  const container=useRef(null),instance=useRef(null),select=useRef(onSelectStop),selectStart=useRef(onSelectStart),selected=useRef(selectedStopId),current=useRef('');
  const generation=JSON.stringify([scope,signature,attempt,geometrySignature]);current.current=generation;
  selected.current=selectedStopId;select.current=onSelectStop;selectStart.current=onSelectStart;
  const located=points.filter(point=>point.coordinates),missing=points.filter(point=>!point.isOrigin&&!point.coordinates);
  // Remove prior geometry before a changed leg/scope can paint.
  useLayoutEffect(()=>{instance.current?.clearRoute?.();},[generation]);
  useEffect(()=>{
    if(!located.length)return;
    let live=true,created;const isCurrent=()=>live&&current.current===generation;setStatus('loading');
    const timeout=setTimeout(()=>{if(isCurrent())setStatus(value=>value==='loading'?'tiles-error':value);},12000);
    loadMapLibrary().then(({createJourneyMap})=>{
      if(!isCurrent())return;
      created=createJourneyMap(container.current,JSON.parse(signature),{geometry:JSON.parse(geometrySignature),onSelectStop:id=>{if(isCurrent())select.current?.(id);},onSelectStart:()=>{if(isCurrent())selectStart.current?.();},onTileError:()=>{if(isCurrent())setStatus('tiles-error');},onTileReady:()=>{if(isCurrent()){clearTimeout(timeout);setStatus('ready');}}});
      instance.current=created;created.select?.(selected.current);
    }).catch(()=>{if(isCurrent())setStatus('error');});
    return()=>{live=false;clearTimeout(timeout);created?.destroy();instance.current=null;};
  },[scope,signature,generation,geometrySignature,loadMapLibrary,located.length]);
  useLayoutEffect(()=>{instance.current?.select?.(selectedStopId);},[selectedStopId,generation,status]);
  return <section className="journey-map" aria-label="Journey map">
    <div className="journey-map-stage">
      {located.length>0?<><div className="journey-map-tools"><button type="button" className="journey-map-fit" onClick={()=>instance.current?.fit()}>Show all stops</button></div>
        <div className="journey-map-canvas" ref={container} role="region" aria-label="Interactive map of your start and outing stops"/>
        {status==='loading'&&<span className="journey-map-status" role="status">Loading map…</span>}
        {(status==='error'||status==='tiles-error')&&<span className="journey-map-status" role="status">{status==='error'?'Map unavailable.':'Some map tiles are unavailable.'} <button type="button" onClick={()=>setAttempt(value=>value+1)}>Retry map</button> or use Google Maps below.</span>}
      </>:<div className="journey-map-cover"><span className="journey-map-symbol" aria-hidden="true">↗</span><h4>Your outing, on the map</h4>
        <p>Map pins aren’t available for these places yet. Open Google Maps directions below.</p>
      </div>}
    </div>
    {showKey&&<div className="journey-map-stops" aria-label="Map stop key">
      {points.map(point=>point.isOrigin?<div key={point.key} className="journey-map-stop journey-map-start"><b aria-hidden="true">S</b><span>{point.label}<small>{point.approximate?'Approximate area, not your exact position':point.coordinates?'Starting point':'Start not pinned'}</small></span></div>:<button type="button" key={point.key} className="journey-map-stop" aria-pressed={point.stopId===selectedStopId} onClick={()=>onSelectStop?.(point.stopId)}><b aria-hidden="true">{point.badge}</b><span>{point.label}{!point.coordinates&&<small>Pin unavailable · use directions</small>}</span></button>)}
    </div>}
    {geometry&&<p className="journey-map-caption"><RouteAttribution/></p>}
    <p className="journey-map-caption">{missing.length?`${missing.length} ${missing.length===1?'stop has':'stops have'} no map pin. `:''}{geometry?'Line shows the estimated route for the selected journey only. Other pins are places, not routes.':'Pins show places, not a calculated route.'} <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Report a map issue</a> · <a href="https://osmfoundation.org/wiki/Privacy_Policy" target="_blank" rel="noreferrer">Map privacy</a><span className="pg-sr-only"> OpenStreetMap receives your IP, browser and viewed area.</span></p>
  </section>;
}
