import {contactForItem} from '../../shared/venue-contact.js';
// Private booking tracking is separate from itinerary, exports and browser storage.
export function bookingScope(account,shared,plan,owner=true) {
  if(!owner||shared?.linked&&!shared.day||shared?.day?.access.role&&shared.day.access.role!=='owner')return {allowed:false};
  if(shared?.day)return {allowed:true,type:'day',id:shared.day.id,token:shared.credential?.token,planRevision:shared.day.planRevision};
  if(account?.user&&plan?.savedPlan&&!plan.saveError)return {allowed:true,type:'account',id:plan.savedPlan.id,planRevision:plan.savedPlan.revision};
  return {allowed:true,type:'guest'};
}
export function bookingSnapshot(plan,stop,place=stop.item) {
  const contactEvidence=contactForItem(place),website=contactEvidence.website.url,phone=contactEvidence.phone.dialUrl;
  return {stopId:stop.id,itemId:stop.item.id,entityId:stop.item.entityId,name:stop.item.name,date:plan.request.timing?.dateConfirmed===true?plan.request.date||null:null,localTime:plan.request.timing?.timeConfirmed===true?stop.start||null:null,timeZone:plan.timeZone||null,party:plan.request.party,contacts:{website,phone},contactEvidence};
}
export function bookingMessage(snapshot) {
  const timed=snapshot.date&&snapshot.localTime&&snapshot.timeZone;
  const party=snapshot.party;
  return `Hello ${snapshot.name},\n\n${timed?`We’re considering a visit on ${snapshot.date} at ${snapshot.localTime} (${snapshot.timeZone})${party?` with ${party.adults} adults${party.children?` and ${party.children} children`:''}`:''}. Could you confirm availability and the reservation process?`:'We’re considering a visit. Could you share your opening hours and reservation process?'} Please share current menu or prices, any deposits or entry fees, and how to discuss dietary or accessibility needs.\n\nThank you!`;
}
export const bookingStatus = value => ({draft:'Draft',ready_for_contact:'Ready for you to contact',user_reported_awaiting_reply:'You reported awaiting reply',user_reported_confirmed:'You reported confirmed',user_reported_unavailable:'You reported unavailable',user_reported_cancelled:'You reported cancelled'})[value]||'Draft';
// Do not offer a reservation for placeholders, past times or ambiguous clock changes.
export function reservationEligible(snapshot,now=Date.now()) {
  const {date,localTime,timeZone,party}=snapshot;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime||'')||!timeZone)return false;
  if(!Number.isInteger(party?.adults)||party.adults<1||party.adults>100||!Number.isInteger(party.children)||party.children<0||party.children>100)return false;
  const base=Date.parse(`${date}T${localTime}:00Z`);
  if(!Number.isFinite(base)||new Date(base).toISOString().slice(0,10)!==date)return false;
  try{const formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),matches=[];
    for(let offset=-14*60;offset<=14*60;offset+=15){const instant=base+offset*60000,p=Object.fromEntries(formatter.formatToParts(instant).map(x=>[x.type,x.value]));if(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`===`${date}T${localTime}`)matches.push(instant);}
    return matches.length===1&&matches[0]>now;
  }catch{return false;}
}
