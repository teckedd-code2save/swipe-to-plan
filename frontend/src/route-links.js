const point=place=>place.coordinates?`${place.coordinates.lat},${place.coordinates.lng}`:`${place.name}, ${place.address||''}`;
export function routeLegs(plan) {
  const stops=plan.stops.filter(stop=>stop.item);
  return stops.map((stop,index)=>({stop,from:index?stops[index-1]:null,label:index?`${stops[index-1].item.name} → ${stop.item.name}`:`Your starting point → ${stop.item.name}`}));
}
// Open one leg at a time so transit never depends on multi-stop routing.
export function routeLink(leg,mode='') {
  if(!leg?.stop?.item)return null;
  const url=new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api','1');url.searchParams.set('destination',point(leg.stop.item));
  if(leg.from)url.searchParams.set('origin',point(leg.from.item));
  if(['walking','driving','transit'].includes(mode))url.searchParams.set('travelmode',mode);
  return url.href;
}
