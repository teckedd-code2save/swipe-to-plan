import {stopIntents} from './stop-intents.js';
import {titleSource} from './plan-title.js';

// Preserve occurrences, not a deduplicated venue's last discovery bucket.
// For genuinely new visits the existing option category remains the default.
export function preservedVisitRoute(ids,visits,options){
  const remaining=visits.map(visit=>({...visit}));
  return ids.map(placeId=>{
    const index=remaining.findIndex(visit=>visit.id===placeId);
    const visit=index<0?options.find(option=>option.id===placeId):remaining.splice(index,1)[0];
    return {intent:visit?.intent,placeId};
  });
}

// A requested visit role is not a claim about a venue. The planner must still
// check each selected ID against current provider evidence for that role.
export function withSelectedRoute(request,route){
  if(!Array.isArray(route)||!route.length||route.length>3||route.some(stop=>!stop||Object.keys(stop).some(key=>!['intent','placeId'].includes(key))||!['coffee','activity','dinner','drinks'].includes(stop.intent)||typeof stop.placeId!=='string'||!stop.placeId.trim()))throw Error('Choose one to three places with supported visit roles.');
  const sequence=route.map(stop=>stop.intent);
  const changed=JSON.stringify(sequence)!==JSON.stringify(stopIntents(request));
  return {...request,...(changed&&titleSource(request)==='auto'?{title:'',titleSource:'auto'}:{}),activities:[...new Set(sequence)],stopIntents:sequence,route:route.map(stop=>({...stop})),pins:{}};
}
