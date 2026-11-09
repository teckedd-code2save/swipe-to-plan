import {withSelectedRoute,preservedVisitRoute} from '../../shared/selected-route.js';

export function shortlistCandidates(plan){
  if(!plan)return [];
  const direct=[...plan.stops.filter(s=>s.item).map(s=>({intent:s.intent,item:s.item})),...(plan.shortlist||[])];
  return [...new Map([...direct,...(plan.nearbySuggestions||[])].map(choice=>[choice.item.id,choice])).values()];
}
export function routeFromChoices(plan,ids){
  const pool=new Map(shortlistCandidates(plan).map(c=>[c.item.id,c]));
  if(!Array.isArray(ids)||!ids.length||ids.length>3||ids.some(id=>!pool.has(id)))throw Error('Choose one to three visits from the shortlist.');
  return routeFromStops(plan,preservedVisitRoute(ids,plan.stops.filter(s=>s.item).map(s=>({id:s.item.id,intent:s.intent})),[...pool].map(([id,choice])=>({id,intent:choice.intent}))));
}
export function routeFromStops(plan,route,request=plan.request){
  const candidates=[...plan.stops.filter(s=>s.item),...(plan.shortlist||[]),...(plan.nearbySuggestions||[])];
  if(!Array.isArray(route)||!route.length||route.length>3)throw Error('Choose one to three visits from the shortlist.');
  const choices=route.map(stop=>{const choice=candidates.find(c=>c.item.id===stop?.placeId);if(!choice)throw Error('A selected stop is no longer in the current results.');return choice;});
  // Check identity here, not the old discovery bucket. The server reruns the
  // provider category, hours and hard-constraint checks for the requested role.
  return {...withSelectedRoute(request,route),searchRadiusKm:choices.some(c=>c.item.nearby)?Math.max(...choices.filter(c=>c.item.nearby).map(c=>c.item.nearby.radiusKm||20)):request.searchRadiusKm||0};
}
export function alternativeCandidates(plan){
  const current=new Set(plan?.stops.filter(stop=>stop.item).map(stop=>stop.item.id)||[]);
  return shortlistCandidates(plan).filter(choice=>!current.has(choice.item.id));
}


export function currentVisitRoute(plan){
  if(!plan?.stops?.length||plan.stops.some(stop=>!stop.item))throw Error('Some requested visits are still unfilled. Resolve them before editing individual visits, or explicitly keep only the found places.');
  return plan.stops.map(stop=>({intent:stop.intent,placeId:stop.item.id}));
}
