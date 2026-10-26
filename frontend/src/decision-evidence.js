import {shortlistCandidates} from './shortlist.js';
export function decisionStops(plan) {
  if (!plan) return [];
  const selected=plan.stops.filter(s=>s.item);
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
