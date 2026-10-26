import {byId} from './deck.js';
// Model judgments can filter/reorder an allowlisted provider pool, never create
// venues, relax constraints or change the user's selected route.
export async function reviewCandidatePools(pools,request,review){
  const candidates=pools.map((items,index)=>({index,intent:request.activities[index],places:items.slice(0,12).map(({id,name,description,tagNames})=>({id,name,description,tags:tagNames}))}));
  if(!candidates.some(pool=>pool.places.length))return {pools,status:'not_needed'};
  try{
    const choices=await review({experience:request.experience||{},people:request.people.map(({vibes,context})=>({vibes:vibes.map(id=>({id,label:byId[id]?.label})),context})),candidates});
    if(!Array.isArray(choices)||choices.length!==pools.length||new Set(choices.map(c=>c?.index)).size!==pools.length)throw new Error('Invalid candidate review');
    const revised=pools.map((items,index)=>{
      const choice=choices.find(c=>c?.index===index),allowed=new Set(candidates[index].places.map(p=>p.id));
      if(!Array.isArray(choice?.ids)||new Set(choice.ids).size!==choice.ids.length||choice.ids.some(id=>!allowed.has(id)))throw new Error('Unknown reviewed place');
      const pins=request.route?.[index]?.placeId?[request.route[index].placeId]:request.pins?.[request.activities[index]]?[request.pins[request.activities[index]]]:[];
      const ids=[...new Set([...pins,...choice.ids])];
      return ids.map(id=>items.find(item=>item.id===id)).filter(Boolean);
    });
    return {pools:revised,status:'reviewed'};
  }catch{return {pools,status:'unavailable'};}
}
