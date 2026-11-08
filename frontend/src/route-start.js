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
