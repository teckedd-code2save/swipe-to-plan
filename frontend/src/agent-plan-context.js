import {decisionStops} from './decision-evidence.js';

// Keep the evidence valid JSON even for long opening-hours or menu data.
function practicalEvidence(stop,place,report,picks,menu,request){
  const days=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const day=request?.timing?.dateConfirmed&&request.date?new Date(`${request.date}T12:00:00Z`).getUTCDay():null;
  const evidence={
    description:place.description?.slice(0,180),
    connectionCoverage:(stop.connections||[]).length?'supplied links':'not computed; not negative evidence',
    start:stop.start,end:stop.end,hours:report?.hours?.summary||'Not checked for this visit',
    ...(Number.isInteger(day)&&place.hours?{reportedHoursForDate:{day:days[day],intervals:place.hours[days[day]]??null,previousDay:place.hours[days[(day+6)%7]]??null}}:{}),
    selectedMenuItems:picks.filter(p=>p.placeId===stop.item.id).map(p=>p.label).slice(0,4),
    menu:(place.highlights||report?.menu?.highlights||[]).slice(0,4),
    publishedMenuPrices:(menu?.items||[]).slice(0,4).map(i=>({name:i.name.slice(0,50),price:i.price,currency:i.currency})),
    menuPriceSource:menu?.sourceUrl?.slice(0,160),
    menuEvidence:menu?'lookup completed; absence of prices is not evidence of affordability':'not available or not checked',
    relativePriceBand:stop.item.facts?.price?.level??place.facts?.price?.level??null,
    priceVerified:false,source:'provider data; current availability unverified'
  };
  let encoded=JSON.stringify(evidence);
  for(const key of ['description','menuPriceSource','reportedHoursForDate','menu','publishedMenuPrices','selectedMenuItems']){
    if(encoded.length<=1200)break;
    delete evidence[key];encoded=JSON.stringify(evidence);
  }
  return encoded;
}
export function agentPlanContext(plan,checks={},picks=[],venues=new Map(),menus=new Map(),optionIds) {
  if(!plan)return undefined;
  const allowed=optionIds?new Set(optionIds):null;
  const options=decisionStops(plan).filter(stop=>!allowed||allowed.has(stop.item.id)).slice(0,12).map(stop=>{
    const report=checks.data?.stops.find(s=>s.entityId===stop.item.entityId),place=venues.get(stop.item.entityId)||report?.place||stop.item;
    return {id:stop.item.id,intent:stop.intent,name:place.name,connections:(stop.connections||[]).map(e=>({personId:e.personId,kind:e.kind,label:e.label,preference:plan.tasteMap?.nodes.find(n=>n.id===e.from)?.label})),practical:practicalEvidence(stop,place,report,picks,menus.get(stop.item.entityId),plan.request)};
  });
  const selected=new Set(plan.stops.filter(s=>s.item).map(s=>s.item.id));
  return {stops:options.filter(s=>selected.has(s.id)).slice(0,3),options,warnings:plan.warnings||[]};
}

