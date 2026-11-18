import {InputError} from './contract.js';
import {ProviderError} from './qloo.js';
import {locationId} from './locations.js';
const words=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
const tokens=value=>words(value).filter(word=>word!=='and');
export function venueNameMatch(query,name){
 const wanted=tokens(query),actual=tokens(name);
 if(!wanted.length||!actual.length)return null;
 if(wanted.join(' ')===actual.join(' '))return 'exact';
 return wanted.every(word=>actual.includes(word))?'partial':null;
}
function bounded(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f<>]/.test(value))throw new InputError(`Provide ${label}.`);return value.trim();}
// Named lookup never invokes taste/category discovery or mutates a plan. Search
// hits are provider evidence, not confirmation of which branch/person meant.
export function createNamedVenueLookup({provider,places,now=Date.now}){
 return async({query,area})=>{
  query=bounded(query,160,'a venue name');area=bounded(area,160,'the city or area');
  if(!provider.searchPlaces||!provider.getPlace)throw new ProviderError('provider_unavailable');
  const rows=await provider.searchPlaces(query);
  if(!Array.isArray(rows))throw new ProviderError('provider_response_invalid');
  const seen=new Set(),matches=[],areaTokens=words(area);
  const areaScore=address=>{const actual=words(address);return areaTokens.filter(word=>actual.includes(word)).length;};
  for(const raw of rows.slice(0,20)){
   if(!raw||!Array.isArray(raw.types)||!raw.types.includes('urn:entity:place'))continue;
   let id;try{id=locationId(raw.entity_id);}catch{continue;}
   if(seen.has(id))continue;seen.add(id);
   const names=[raw.name,...(Array.isArray(raw.properties?.akas)?raw.properties.akas.map(alias=>typeof alias==='string'?alias:alias?.value):[])];
   const kinds=names.map(name=>venueNameMatch(query,name));
   const nameMatch=kinds.includes('exact')?'exact':kinds.includes('partial')?'partial':null;
   if(nameMatch)matches.push({id,nameMatch,areaScore:areaScore(raw.properties?.address||raw.disambiguation)});
  }
  matches.sort((a,b)=>b.areaScore-a.areaScore||Number(b.nameMatch==='exact')-Number(a.nameMatch==='exact'));
  let failed=0;
  const candidates=(await Promise.all(matches.slice(0,8).map(async({id,nameMatch})=>{
   try{
    const detail=await places.details(id);
    if(locationId(detail.entityId)!==id||detail.provenance?.provider!==provider.name||!detail.name)throw new ProviderError('provider_response_invalid');
    const addressTokens=words(detail.address);
    // Missing or differing location evidence is surfaced for explicit review,
    // never turned into an automatic same-name match in another city.
    const locationMatch=areaTokens.length&&areaTokens.every(word=>addressTokens.includes(word))?'matched':'needs_review';
    return {...detail,nameMatch,locationMatch};
   }catch{failed++;return null;}
  }))).filter(Boolean).sort((a,b)=>Number(b.locationMatch==='matched')-Number(a.locationMatch==='matched')||Number(b.nameMatch==='exact')-Number(a.nameMatch==='exact'));
  if(matches.length&&!candidates.length&&failed)throw new ProviderError('provider_unavailable');
  return {status:'action',action:'find_venue',query,area,candidates,matchStatus:candidates.length?'candidates':'not_found',source:provider.name,retrievedAt:new Date(now()).toISOString()};
 };
}
