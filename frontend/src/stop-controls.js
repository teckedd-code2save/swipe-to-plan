import {pinKey,pinnedPlace,stopIntents} from '../../shared/stop-intents.js';

export const stopIndex = (plan,stop) => plan.stops.findIndex(value=>value.id===stop.id);
export const isStopPinned = (plan,stop) => pinnedPlace(plan.request,stopIndex(plan,stop))===stop.item?.id;
export const rememberStops = plan => Object.fromEntries(plan.stops.flatMap((stop,index)=>stop.item?[[pinKey(plan.request,index),stop.item.id]]:[]));
function normalizedPins(request){
  return Object.fromEntries(stopIntents(request).flatMap((intent,index)=>{const place=pinnedPlace({...request,route:undefined},index);return place?[[pinKey(request,index),place]]:[];}));
}
export function toggleStopPin(plan,stop){
  // Migrate legacy category or slot aliases before toggling one stop.
  const index=stopIndex(plan,stop),pins=normalizedPins(plan.request);
  const key=pinKey(plan.request,index);
  if(isStopPinned(plan,stop))delete pins[key];else pins[key]=stop.item.id;
  return pins;
}
export function menuChoicePins(plan,choices){
  const pins=normalizedPins(plan.request),intents=stopIntents(plan.request);
  for(const choice of choices){
    const selectedIndex=plan.stops.findIndex(stop=>stop.item?.id===choice.placeId);
    const index=selectedIndex>=0?selectedIndex:intents.filter(intent=>intent===choice.intent).length===1?intents.indexOf(choice.intent):-1;
    // An alternative venue cannot choose which repeated slot to replace for you.
    if(index>=0)pins[pinKey(plan.request,index)]=choice.placeId;
  }
  return pins;
}
