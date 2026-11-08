import {currentDevicePoint,roundedAreaPoint} from './nearby-location.js';
// Origin choices stay in the route view, never in an account or saved day.
export function startingLocation(value) {
  if(typeof value==='string')return value.trim()?{address:value.trim()}:null;
  const {lat,lng}=value?.coordinates||{};
  if(Number.isFinite(lat)&&Math.abs(lat)<=90&&Number.isFinite(lng)&&Math.abs(lng)<=180)return {coordinates:{lat,lng}};
  return value?.kind==='area'&&value.label?.trim()?{address:value.label.trim()}:null;
}
export function areaStartingPoint(area) {
  const coordinates=startingLocation({coordinates:{lat:area.center?.latitude,lng:area.center?.longitude}})?.coordinates;
  return {kind:'area',label:area.label||area.name,area,...(coordinates?{coordinates}:{})};
}
export async function currentRoutePoint(geolocation=globalThis.navigator?.geolocation) {
  const point=await currentDevicePoint(geolocation,{maximumAge:0});
  if(point.accuracy>1000)return {kind:'nearby',point:roundedAreaPoint(point)};
  return {kind:'current',label:'Current location',coordinates:{lat:point.latitude,lng:point.longitude},accuracyMeters:point.accuracy};
}

export function resolvedAreaStartingPoint(area,resolved){
  if(resolved?.id!==area.id)return null;
  const catalog={...area};
  for(const key of ['name','label','country','currency','timeZone','kind']){
    if(typeof resolved[key]==='string'&&resolved[key].trim()&&resolved[key].length<=300)catalog[key]=resolved[key].trim();
  }
  const point=startingLocation({coordinates:{lat:resolved.center?.latitude,lng:resolved.center?.longitude}});
  if(point?.coordinates)catalog.center={latitude:point.coordinates.lat,longitude:point.coordinates.lng};
  return areaStartingPoint(catalog);
}
