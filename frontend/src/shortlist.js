export function shortlistCandidates(plan){
  if(!plan)return [];
  const direct=[...plan.stops.filter(s=>s.item).map(s=>({intent:s.intent,item:s.item})),...(plan.shortlist||[])];
  return [...new Map([...direct,...(plan.nearbySuggestions||[])].map(choice=>[choice.item.id,choice])).values()];
}
export function routeFromChoices(plan,ids){
  const pool=new Map(shortlistCandidates(plan).map(c=>[c.item.id,c]));
  if(!Array.isArray(ids)||!ids.length||ids.length>3||ids.some(id=>!pool.has(id)))throw Error('Choose one to three visits from the shortlist.');
  return routeFromStops(plan,ids.map(id=>({intent:pool.get(id).intent,placeId:id})));
}
export function routeFromStops(plan,route){
  const candidates=[...plan.stops.filter(s=>s.item),...(plan.shortlist||[]),...(plan.nearbySuggestions||[])];
  if(!Array.isArray(route)||!route.length||route.length>3)throw Error('Choose one to three visits from the shortlist.');
  const choices=route.map(stop=>{const choice=candidates.find(c=>c.item.id===stop.placeId&&c.intent===stop.intent);if(!choice)throw Error('A selected stop is no longer in the current results.');return choice;});
  return {...plan.request,activities:[...new Set(choices.map(c=>c.intent))],stopIntents:choices.map(c=>c.intent),route:choices.map(c=>({intent:c.intent,placeId:c.item.id})),pins:{},searchRadiusKm:choices.some(c=>c.item.nearby)?Math.max(...choices.filter(c=>c.item.nearby).map(c=>c.item.nearby.radiusKm||20)):plan.request.searchRadiusKm||0};
}
export function alternativeCandidates(plan){
  const current=new Set(plan?.stops.filter(stop=>stop.item).map(stop=>stop.item.id)||[]);
  return shortlistCandidates(plan).filter(choice=>!current.has(choice.item.id));
}


export function currentVisitRoute(plan){
  if(!plan?.stops?.length||plan.stops.some(stop=>!stop.item))throw Error('Some requested visits are still unfilled. Resolve them before editing individual visits, or explicitly keep only the found places.');
  return plan.stops.map(stop=>({intent:stop.intent,placeId:stop.item.id}));
}
