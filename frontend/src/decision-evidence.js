import {shortlistCandidates} from './shortlist.js';
export function decisionStops(plan) {
  if (!plan) return [];
  // Comparison options are physical venues. The itinerary and agent's selected
  // context retain every visit occurrence separately.
  const selected=plan.stops.filter((stop,index,stops)=>stop.item&&stops.findIndex(s=>s.item?.id===stop.item.id)===index);
  const seen=new Set(selected.map(s=>s.item.id));
  return [...selected,...shortlistCandidates(plan).filter(c=>!seen.has(c.item.id)).map(({item,intent})=>({id:'shortlist-place',item,intent,start:null,end:null,connections:[]}))];
}
export function spendingSummary(plan) {
  const suggested=plan.request.budget==null;
  return {suggested,amount:suggested?plan.allowance?.amount:plan.request.budget,currency:plan.request.currency,people:(plan.request.party?.adults||0)+(plan.request.party?.children||0)};
}
export function reportedPrice(place) {
  const level=place.facts?.price?.level;
  return [null,'Lower price band','Mid price band','Higher price band','Premium price band'][level]||'Prices unavailable';
}
export function reportedHours(place) {
  if(place.isClosed)return 'Reported closed';
  return Object.entries(place.hours||{}).filter(([,rows])=>Array.isArray(rows)).map(([day,rows])=>({day:day.slice(0,3),label:rows.length?rows.map(r=>`${r.opens}–${r.closes}${r.overnight?' (+1 day)':''}`).join(', '):'Closed'}));
}

export const checkedVisit = (checks,stop) => checks?.data?.stops.find(report=>report.entityId===stop.item?.entityId&&report.start===stop.start&&report.end===stop.end);

// Commentary belongs to this exact ordered itinerary, not just its unique places.
export function comparisonKey(plan,shown){
  return JSON.stringify([shown.map(stop=>stop.item.id),plan.request,plan.stops.map(stop=>({stopId:stop.id,intent:stop.intent,itemId:stop.item?.id,entityId:stop.item?.entityId,start:stop.start,end:stop.end}))]);
}
