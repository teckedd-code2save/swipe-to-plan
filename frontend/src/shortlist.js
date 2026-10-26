export function shortlistCandidates(plan){
  if(!plan)return [];
  const direct=plan.shortlist||plan.stops.filter(s=>s.item).map(s=>({intent:s.intent,item:s.item}));
  return [...new Map([...direct,...(plan.nearbySuggestions||[])].map(choice=>[choice.item.id,choice])).values()];
}
export function routeFromChoices(plan,ids){
  const pool=new Map(shortlistCandidates(plan).map(c=>[c.item.id,c]));
  if(!Array.isArray(ids)||!ids.length||ids.length>3||new Set(ids).size!==ids.length||ids.some(id=>!pool.has(id)))throw Error('Choose one to three different places from the shortlist.');
  const choices=ids.map(id=>pool.get(id));
  return {...plan.request,activities:[...new Set(choices.map(c=>c.intent))],route:choices.map(c=>({intent:c.intent,placeId:c.item.id})),pins:{},searchRadiusKm:choices.some(c=>c.item.nearby)?20:plan.request.searchRadiusKm||0};
}
export function alternativeCandidates(plan){
  const current=new Set(plan?.stops.filter(stop=>stop.item).map(stop=>stop.item.id)||[]);
  return shortlistCandidates(plan).filter(choice=>!current.has(choice.item.id));
}
