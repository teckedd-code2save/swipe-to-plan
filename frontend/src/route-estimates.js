import {startingLocation} from './route-start.js';
// Route estimates are ephemeral travel evidence, never saved itinerary data.
export const routeModes = {driving:'DRIVE',walking:'WALK',transit:'TRANSIT'};

export function routeLocation(stop) {
  const item=stop?.item;
  if(!item)return null;
  const {lat,lng}=item.coordinates||{};
  const coordinates=Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null;
  if(!coordinates&&!item.address?.trim())return null;
  return {id:stop.id.trim(),...(item.entityId?{entityId:item.entityId.trim()}:{}),...(item.name?{name:item.name.trim()}:{}),...(coordinates?{coordinates}:{address:item.address.trim()})};
}

export function routeEstimateRequest(leg,mode,startingPoint) {
  const origin=leg?.from?routeLocation(leg.from):startingLocation(startingPoint);
  const destination=routeLocation(leg?.stop);
  if(!origin)throw Error(leg?.from?'The previous place has no verified address or coordinates. Try Maps instead.':'Choose your starting point before estimating this journey.');
  if(!destination)throw Error('This place has no verified address or coordinates. Try Maps instead.');
  if(!routeModes[mode])throw Error('Choose Drive, Walk or Transit for an estimate. Compare opens Maps only.');
  return {origin,stops:[destination],mode:routeModes[mode]};
}

// Include all plan edits, ordered slot IDs, item IDs, venue IDs, date/time/zone and
// the caller's account/day/draft identity. This key stays on the device.
export function routeEstimateFingerprint(plan,scope,leg,mode,startingPoint) {
  return JSON.stringify({plan,scope,selectedStopId:leg?.stop.id,fromStopId:leg?.from?.id,mode,startingPoint});
}

const measurement=value=>Number.isSafeInteger(value?.distanceMeters)&&value.distanceMeters>=0&&Number.isFinite(value?.durationSeconds)&&value.durationSeconds>=0;
const samePoint=(left,right)=>!!left&&!!right&&['id','entityId','name','address'].every(key=>left[key]===right[key])&&left.coordinates?.lat===right.coordinates?.lat&&left.coordinates?.lng===right.coordinates?.lng;
export function validRouteEstimate(result,request) {
  const leg=result?.legs?.[0];
  return result?.source==='google_routes'&&result.requestId===request.requestId&&result.itineraryRevision===request.itineraryRevision&&result.mode===request.mode&&
    measurement(result)&&typeof result.measuredAt==='string'&&Number.isFinite(Date.parse(result.measuredAt))&&
    (request.mode!=='DRIVE'||result.trafficAware===true)&&result.departureAt==null&&leg?.departureAt==null&&
    result.scheduleFeasibility==='not_evaluated'&&result.includesVisitDurations===false&&result.includesPlanningBuffers===false&&
    result.selectedStops?.length===1&&samePoint(result.selectedStops[0],request.stops[0])&&result.legs?.length===1&&measurement(leg)&&
    leg.source==='google_routes'&&leg.mode===request.mode&&leg.measuredAt===result.measuredAt&&samePoint(leg.from,request.origin)&&samePoint(leg.to,request.stops[0]);
}

export function routeEstimateError(error) {
  const message={
    provider_not_configured:'Route estimates are unavailable here. Open directions in Maps.',
    route_not_found:'No route was found for this mode. Try another mode or open Maps.',
    routes_rate_limited:'Route estimates have reached their request limit. Try again later or use Maps.',
    rate_limited:'Too many requests. Try again later or use Maps.',
    routes_timeout:'The route estimate timed out. Try again or use Maps.',
    routes_traffic_unavailable:'A traffic-aware driving estimate is unavailable. Try Maps or another travel mode.',
  }[error.code]||(error.name==='TimeoutError'?'The route estimate timed out. Try again or use Maps.':'Couldn’t estimate this journey. Try again or use Maps.');
  return `${message} Your places and schedule are unchanged.`;
}

export function routeDistance(meters) {return meters<1000?`${Math.round(meters)} m`:`${(meters/1000).toLocaleString(undefined,{maximumFractionDigits:1})} km`;}
export function routeDuration(seconds) {
  if(seconds<60)return 'Less than 1 min';
  const minutes=Math.ceil(seconds/60);
  return minutes<60?`${minutes} min`:`${Math.floor(minutes/60)} hr${minutes%60?` ${minutes%60} min`:''}`;
}
