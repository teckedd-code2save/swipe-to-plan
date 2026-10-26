// Read-only discovery from confirmed state. Never infer changes from a failed chat message.
export function outageRequest(brief,confirmed){
  if(!confirmed||!brief.area)return null;
  // A shared outing needs its per-person ranking; do not silently replace it with solo results.
  if(brief.people?.length!==1)return null;
  const person=brief.people[0];
  return {intent:'any',location:{area:brief.area,...(brief.locationId?{id:brief.locationId}:{})},taste:{artists:person.artists||[],vibes:person.vibes||[],...(person.context?{context:person.context}:{})},constraints:{excludeHotels:true,excludeIds:brief.excludeIds||[],excludeTags:brief.party?.children?['nightclub','night_club','dance_club','adult_entertainment']:[],...(brief.maxPriceLevel?{maxPriceLevel:brief.maxPriceLevel}:{})},limit:5};
}
export function isChatOutage(error){return error?.code==='agent_unavailable'||error?.name==='TimeoutError'||error?.message==='Failed to fetch';}
export async function discoverDuringOutage({request,load,isCurrent,publish}){
  if(!request)return false;
  try{const result=await load(request);if(!isCurrent())return false;publish(result);return true;}catch{return false;}
}
