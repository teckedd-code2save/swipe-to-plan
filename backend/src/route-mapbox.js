import { RouteActionError, navigationUrl } from './route-contract.js';
import { routeMeasurement, validRouteGeometry } from '../../shared/route-provider.js';

const DIRECTIONS_URL='https://api.mapbox.com/directions/v5/mapbox/';
const MAX_BODY_BYTES=1024*1024;
// No credentials, provider response text, road names or instructions leave this adapter.
async function readPayload(response,signal){
  try {
    const length=response.headers?.get?.('content-length');
    if(length!==null&&length!==undefined&&Number(length)>MAX_BODY_BYTES)throw Error('body bound');
    if(response.body?.getReader){
      const reader=response.body.getReader();const chunks=[];let total=0;
      const cancel=()=>{reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
      try{
        while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;
          if(total>MAX_BODY_BYTES){await reader.cancel();throw Error('body bound');}chunks.push(value);}
      }finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
      const body=new Uint8Array(total);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
      return JSON.parse(new TextDecoder().decode(body));
    }
    // Minimal transports used by tests. Native fetch follows the bounded stream path.
    return await response.json();
  } catch {throw new RouteActionError(signal.aborted?'routes_timeout':'routes_bad_response');}
}
export function createMapboxRouteAdapter({token,fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=12000}={}){
  function validate(brief){
    if(!['DRIVE','WALK'].includes(brief.mode))throw new RouteActionError('routes_unsupported_mode');
    if(!brief.origin.coordinates||!brief.stops[0].coordinates)throw new RouteActionError('routes_coordinates_required');
    if(brief.departureAt)throw new RouteActionError('routes_departure_unsupported');
  }
  return {validate,async estimate(brief){
    validate(brief);
    const profile=brief.mode==='DRIVE'?'driving-traffic':'walking';
    const coords=[brief.origin,...brief.stops].map(point=>`${point.coordinates.lng},${point.coordinates.lat}`).join(';');
    const url=new URL(`${DIRECTIONS_URL}${profile}/${coords}`);
    for(const [name,value] of Object.entries({access_token:token,alternatives:'false',steps:'false',geometries:'geojson',overview:'simplified',radiuses:'1000;1000'}))url.searchParams.set(name,value);
    const controller=new AbortController();let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new RouteActionError('routes_timeout'));},timeoutMs);});
    let payload,providerResponse;
    try{
      // Exactly one request, never retry, redirect, geocode or fall back to a billed profile.
      payload=await Promise.race([timeout,(async()=>{
        let response;
        try{response=await fetchImpl(url.toString(),{method:'GET',redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});}
        catch{throw new RouteActionError(controller.signal.aborted?'routes_timeout':'routes_unreachable');}
        providerResponse=response;
        if(controller.signal.aborted){
          try{response?.body?.cancel()?.catch(()=>{});}catch{/* A late transport must not retain a body. */}
          throw new RouteActionError('routes_timeout');
        }
        if(response?.status===429)throw new RouteActionError('routes_rate_limited');
        if(!response?.ok)throw new RouteActionError('routes_provider_error');
        return readPayload(response,controller.signal);
      })()]);
    }finally{
      clearTimeout(timer);controller.abort();
      // Close rejected/oversized bodies too; they must not outlive the deadline.
      try{providerResponse?.body?.cancel()?.catch(()=>{});}catch{/* Consumed/locked native bodies are closed by abort. */}
    }
    if(payload?.code==='NoRoute'||payload?.code==='NoSegment')throw new RouteActionError('route_not_found');
    if(payload?.code!=='Ok'||!Array.isArray(payload.routes))throw new RouteActionError('routes_bad_response');
    if(payload.routes.length===0)throw new RouteActionError('route_not_found');
    const route=payload.routes[0],leg=route?.legs?.[0];
    if(payload.routes.length!==1||!routeMeasurement(route?.distance)||!routeMeasurement(route?.duration)||
       !Array.isArray(route?.legs)||route.legs.length!==1||!routeMeasurement(leg?.distance)||!routeMeasurement(leg?.duration)||
       !validRouteGeometry(route.geometry,brief.origin.coordinates,brief.stops[0].coordinates))throw new RouteActionError('routes_bad_response');
    const measuredAt=new Date(now()).toISOString();
    return {
      source:'mapbox',measuredAt,mode:brief.mode,
      ...(brief.requestId!==undefined?{requestId:brief.requestId}:{}),
      ...(brief.itineraryRevision!==undefined?{itineraryRevision:brief.itineraryRevision}:{}),
      selectedStops:brief.stops,distanceMeters:route.distance,durationSeconds:route.duration,
      legs:[{from:brief.origin,to:brief.stops[0],source:'mapbox',measuredAt,mode:brief.mode,departureAt:null,distanceMeters:leg.distance,durationSeconds:leg.duration}],
      geometry:{type:'LineString',coordinates:route.geometry.coordinates.map(point=>[point[0],point[1]])},
      scheduleFeasibility:'not_evaluated',includesVisitDurations:false,includesPlanningBuffers:false,
      // Profile requested, not a claim that live traffic exists on every road.
      trafficAware:brief.mode==='DRIVE',trafficBasis:brief.mode==='DRIVE'?'live_and_typical_where_available':'not_applicable',
      navigationUrl:navigationUrl(brief),
      warning:'Travel estimate only. Traffic availability varies by road and time. Not a guaranteed arrival or outing feasibility check.',
    };
  }};
}
