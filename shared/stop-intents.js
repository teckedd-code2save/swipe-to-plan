// Retrieval categories are unique; outing slots are ordered and may repeat.
export const stopIntents = request => request.route?.map(stop=>stop.intent) || request.stopIntents || request.activities || [];
export const pinKey = (request,index) => {
  const intents=stopIntents(request),intent=intents[index];
  return intents.filter(value=>value===intent).length>1?`stop-${index}`:intent;
};
export const pinnedPlace = (request,index) => {
  const intents=stopIntents(request),intent=intents[index];
  return request.route?.[index]?.placeId || request.pins?.[`stop-${index}`] || (intents.indexOf(intent)===index?request.pins?.[intent]:undefined);
};
export function reviseStops(brief,changes){
  const activities=changes.activities!==undefined?changes.activities:(Array.isArray(changes.stopIntents)?[...new Set(changes.stopIntents)]:brief.activities);
  const categoryChange=changes.activities!==undefined&&JSON.stringify([...(Array.isArray(changes.activities)?changes.activities:[])].sort())!==JSON.stringify([...(brief.activities||[])].sort());
  const previous=stopIntents(brief);
  let sequence=changes.stopIntents!==undefined?changes.stopIntents:brief.stopIntents??brief.route?.map(stop=>stop.intent);
  if(changes.stopIntents===undefined&&categoryChange){
    sequence=sequence&&Array.isArray(activities)?[...previous.filter(intent=>activities.includes(intent)),...activities.filter(intent=>!previous.includes(intent))]:undefined;
    if(sequence?.length===0)sequence=undefined;
  }
  const next=Array.isArray(sequence)?sequence:Array.isArray(activities)?activities:[];
  const reset=JSON.stringify(next)!==JSON.stringify(previous);
  const pins=reset?{}:{...brief.pins};
  if(reset){
    next.forEach((intent,index)=>{
      const occurrence=next.slice(0,index).filter(value=>value===intent).length;
      const oldIndex=previous.map((value,i)=>value===intent?i:-1).filter(i=>i>=0)[occurrence];
      // Keep user-selected identities at matching occurrences when adding/removing slots.
      const id=oldIndex===undefined?undefined:pinnedPlace(brief,oldIndex);
      if(id)pins[pinKey({activities,stopIntents:next},index)]=id;
    });
  }
  return {activities,stopIntents:sequence,route:reset?undefined:brief.route,pins};
}
