import {decisionStops} from './decision-evidence.js';
export function agentPlanContext(plan,checks={},picks=[],venues=new Map(),menus=new Map()) {
  if(!plan)return undefined;
  const options=decisionStops(plan).slice(0,12).map(stop=>{
    const report=checks.data?.stops.find(s=>s.entityId===stop.item.entityId),place=venues.get(stop.item.entityId)||report?.place||stop.item;
    return {id:stop.item.id,intent:stop.intent,name:place.name,connections:(stop.connections||[]).map(e=>({personId:e.personId,kind:e.kind,label:e.label,preference:plan.tasteMap?.nodes.find(n=>n.id===e.from)?.label})),practical:JSON.stringify({description:place.description?.slice(0,240),connectionCoverage:(stop.connections||[]).length?'supplied links':'not computed; not negative evidence',tags:(place.tagNames||[]).slice(0,6),start:stop.start,end:stop.end,hours:report?.hours?.summary||'Unconfirmed',weeklyHours:place.hours||null,menu:(place.highlights||report?.menu?.highlights||[]).slice(0,4),selectedMenuItems:picks.filter(p=>p.placeId===stop.item.id).map(p=>p.label),publishedMenuPrices:(menus.get(stop.item.entityId)?.items||[]).slice(0,4).map(i=>({name:i.name.slice(0,50),price:i.price,currency:i.currency})),menuPriceSource:menus.get(stop.item.entityId)?.sourceUrl?.slice(0,160),relativePriceBand:place.facts?.price?.level??null,priceVerified:false,menuLinkAvailable:!!place.links?.menu,phoneAvailable:!!place.links?.phone,source:'provider data; current availability unverified'}).slice(0,1200)};
  });
  const selected=new Set(plan.stops.filter(s=>s.item).map(s=>s.item.id));
  return {stops:options.filter(s=>selected.has(s.id)).slice(0,3),options,warnings:plan.warnings||[]};
}
