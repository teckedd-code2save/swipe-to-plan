// Provider/display rules are explicit. A generic key can never enable a provider.
export const ROUTE_PROVIDERS = Object.freeze({
  mapbox: Object.freeze({name:'Mapbox Directions',modes:['DRIVE','WALK'],displays:['osm'],coordinatesRequired:true,geometry:true}),
  google_routes: Object.freeze({name:'Google Routes',modes:['DRIVE','WALK','TRANSIT'],displays:['google_map'],coordinatesRequired:false,geometry:false}),
});
export const MAX_ROUTE_POINTS=5000;
export function providerSupportsDisplay(provider,display){return !!ROUTE_PROVIDERS[provider]?.displays?.includes(display);}
export function coordinatePair(value){return Array.isArray(value)&&value.length===2&&Number.isFinite(value[0])&&Math.abs(value[0])<=180&&Number.isFinite(value[1])&&Math.abs(value[1])<=90;}
function distanceMeters(a,b){
  const radians=value=>value*Math.PI/180,lat=radians(b[1]-a[1]),lng=radians(b[0]-a[0]);
  const h=Math.sin(lat/2)**2+Math.cos(radians(a[1]))*Math.cos(radians(b[1]))*Math.sin(lng/2)**2;
  return 6371000*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
export function validRouteGeometry(geometry,origin,destination){
  const coords=geometry?.coordinates,from=[origin?.lng,origin?.lat],to=[destination?.lng,destination?.lat];
  return geometry?.type==='LineString'&&Array.isArray(coords)&&coords.length>=2&&coords.length<=MAX_ROUTE_POINTS&&
    coords.every(coordinatePair)&&coordinatePair(from)&&coordinatePair(to)&&
    // Mapbox snaps to roads within the requested 1000 m radius. Never connect missing points.
    distanceMeters(coords[0],from)<=1001&&distanceMeters(coords.at(-1),to)<=1001;
}
export const routeMeasurement=value=>Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER;
