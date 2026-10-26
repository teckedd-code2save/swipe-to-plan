// Read-only discovery from confirmed state. Never infer changes from a failed chat message.
export function outageRequest(brief,confirmed){
  if(!confirmed||!brief.area)return null;
  // A shared outing needs its per-person ranking; do not silently replace it with solo results.
  if(brief.people?.length!==1)return null;
  const person=brief.people[0];
  return {intent:'any',location:{area:brief.area,...(brief.locationId?{id:brief.locationId}:{})},taste:{artists:person.artists||[],vibes:person.vibes||[],...(person.context?{context:person.context}:{})},constraints:{excludeHotels:true,excludeIds:brief.excludeIds||[],excludeTags:['market','marketplace','nutritionist','nutrition_store','vitamin_supplements_store',...(brief.party?.children?['nightclub','night_club','dance_club','adult_entertainment']:[])],...(brief.maxPriceLevel?{maxPriceLevel:brief.maxPriceLevel}:{})},limit:5};
}
export function isChatOutage(error){return error?.code==='agent_unavailable'||error?.name==='TimeoutError'||error?.message==='Failed to fetch';}
export async function discoverDuringOutage({request,load,isCurrent,publish}){
  if(!request)return false;
  try{const result=await load(request);if(!isCurrent())return false;publish(result);return true;}catch{return false;}
}

export function outageRequests(brief,confirmed){
  if(!confirmed||!brief.area||!brief.people?.length)return [];
  return brief.people.map(person=>outageRequest({...brief,people:[person]},true));
}
export async function loadOutageResults(requests,load){
  const results=await Promise.all(requests.map(load));
  const candidates=new Map();
  results.forEach(result=>result.items.forEach((item,index)=>{
    const old=candidates.get(item.id)||{item,score:0};old.score+=1/(index+1);candidates.set(item.id,old);
  }));
  return {...results[0],items:[...candidates.values()].sort((a,b)=>b.score-a.score||a.item.id.localeCompare(b.item.id)).slice(0,5).map(value=>value.item)};
}
