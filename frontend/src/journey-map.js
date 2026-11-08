import {validRouteGeometry} from '../../shared/route-provider.js';
// Geographic inputs only. No geocoding, inferred origin, or fabricated geometry.
export function mapCoordinates(value) {
  const {lat,lng}=value||{};
  return Number.isFinite(lat)&&Math.abs(lat)<=90&&Number.isFinite(lng)&&Math.abs(lng)<=180?[lat,lng]:null;
}
export function journeyPoints(plan,origin) {
  const stops=(Array.isArray(plan?.stops)?plan.stops:[]).map((stop,index)=>({stop,index})).filter(({stop})=>stop?.item);
  const start={key:'origin',label:typeof origin==='string'?(origin.trim()||'Choose a starting point'):(origin?.label||(origin?.kind==='current'?'Current location':'Choose a starting point')),badge:'S',coordinates:mapCoordinates(origin?.coordinates),approximate:origin?.kind==='area',isOrigin:true};
  return [start,...stops.map(({stop,index})=>({key:`stop:${index}:${stop.id}`,stopId:stop.id,label:stop.item.name||`Stop ${index+1}`,badge:String(index+1),coordinates:mapCoordinates(stop.item.coordinates),isOrigin:false}))];
}
export function markerGroups(points) {
  const groups=new Map();
  for(const point of points){
    if(!point.coordinates)continue;
    const key=point.coordinates.join(',');
    if(!groups.has(key))groups.set(key,{coordinates:point.coordinates,points:[]});
    groups.get(key).points.push(point);
  }
  return [...groups.values()];
}

// Only a verified selected-leg result can add a line. Pins never imply a route.
export function journeyRouteGeometry(estimate,points,selectedStopId){
  if(estimate?.source!=='mapbox'||!['DRIVE','WALK'].includes(estimate.mode))return null;
  const index=points.findIndex(point=>!point.isOrigin&&point.stopId===selectedStopId),leg=estimate.legs?.[0];
  const from=points[index-1],to=points[index];
  if(index<1||!from?.coordinates||!to?.coordinates||leg?.to?.id!==selectedStopId||
     (!from.isOrigin&&leg?.from?.id!==from.stopId)||estimate.selectedStops?.[0]?.id!==selectedStopId)return null;
  const equal=(value,point)=>value?.lat===point[0]&&value?.lng===point[1];
  if(!equal(leg.from?.coordinates,from.coordinates)||!equal(leg.to?.coordinates,to.coordinates))return null;
  return validRouteGeometry(estimate.geometry,leg.from.coordinates,leg.to.coordinates)?estimate.geometry:null;
}
