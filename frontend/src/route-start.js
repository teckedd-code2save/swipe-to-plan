// Origin choices stay in the route view, never in an account or saved day.
export function startingLocation(value) {
  if(typeof value==='string')return value.trim()?{address:value.trim()}:null;
  const {lat,lng}=value?.coordinates||{};
  if(Number.isFinite(lat)&&Math.abs(lat)<=90&&Number.isFinite(lng)&&Math.abs(lng)<=180)return {coordinates:{lat,lng}};
  return value?.kind==='area'&&value.label?.trim()?{address:value.label.trim()}:null;
}
export function areaStartingPoint(area) {
  const coordinates=startingLocation({coordinates:{lat:area.center?.latitude,lng:area.center?.longitude}})?.coordinates;
  return {kind:'area',label:area.label||area.name,...(coordinates?{coordinates}:{})};
}
export function currentRoutePoint(geolocation=globalThis.navigator?.geolocation) {
  return new Promise((resolve,reject)=>{
    if(!geolocation){reject(Error('Location is unavailable. Choose an area or enter a place name instead.'));return;}
    geolocation.getCurrentPosition((position)=>{
      const {latitude:lat,longitude:lng,accuracy}=position?.coords||{};
      if(!startingLocation({coordinates:{lat,lng}})||!Number.isFinite(accuracy)||accuracy<0||accuracy>1000){reject(Error('Your location is too broad for a useful route. Choose an area or enter a place name instead.'));return;}
      resolve({kind:'current',label:'Current location',coordinates:{lat,lng},accuracyMeters:accuracy});
    },error=>reject(Error(error?.code===1?'Location access was declined. Choose an area or enter a place name instead.':'Couldn’t find your location. Try again, choose an area or enter a place name.')),{enableHighAccuracy:true,timeout:10000,maximumAge:0});
  });
}
