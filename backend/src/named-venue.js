import {InputError} from './contract.js';
import {ProviderError} from './qloo.js';
import {locationId} from './locations.js';
const words=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
const tokens=value=>words(value).filter(word=>word!=='and');
const streetSuffixes={st:'street',rd:'road',ave:'avenue',av:'avenue',blvd:'boulevard',ln:'lane',dr:'drive',ct:'court',pl:'place',ter:'terrace'};
// Normalize common street suffixes only after a street-name word. In particular,
// a leading St (Saint) or Dr (Doctor) is not treated as a street suffix. This is
// textual address evidence, not geocoding or confirmation of venue identity.
function addressWords(value){return words(value).map((word,index,all)=>index>0&&!/^\d+$/.test(all[index-1])?(streetSuffixes[word]||word):word);}
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
  const seen=new Set(),matches=[],areaTokens=addressWords(area);
  const areaScore=address=>{const actual=addressWords(address);return areaTokens.filter(word=>actual.includes(word)).length;};
  for(const raw of rows.slice(0,20)){
   if(!raw||!Array.isArray(raw.types)||!raw.types.includes('urn:entity:place'))continue;
   let id;try{id=locationId(raw.entity_id);}catch{continue;}
   if(seen.has(id))continue;seen.add(id);
   // Provider search aliases may include broad/address terms. Only a matching
   // primary venue name qualifies; hydration below checks the current name too.
   const nameMatch=venueNameMatch(query,raw.name);
   if(nameMatch)matches.push({id,nameMatch,areaScore:areaScore(raw.properties?.address||raw.disambiguation)});
  }
  matches.sort((a,b)=>b.areaScore-a.areaScore||Number(b.nameMatch==='exact')-Number(a.nameMatch==='exact'));
  let failed=0;
  const candidates=(await Promise.all(matches.slice(0,8).map(async({id})=>{
   try{
    const detail=await places.details(id);
    if(locationId(detail.entityId)!==id||detail.provenance?.provider!==provider.name||!detail.name)throw new ProviderError('provider_response_invalid');
    const nameMatch=venueNameMatch(query,detail.name);
    if(!nameMatch)return null;
    const addressTokens=addressWords(detail.address);
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
