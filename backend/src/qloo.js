// Only the live entrypoint loads dotenv. Tests inject fetch/key and never read credentials.
import {locationId as parseLocationId,locationOption,nearbyRequest,areaDistanceKm} from './locations.js';
import {AUDIENCE_FAMILIES,validAudience} from './context.js';
import {INTEREST_TYPES} from '../../shared/research-context.js';
import {byId,matchesTasteTag} from './deck.js';
import {find as findTimeZones} from 'geo-tz';
const accraAreas=['Osu','East Legon','Cantonments','Labone','Airport Residential'];
const locationQuery=area=>area==='Accra'?'Accra, Ghana':accraAreas.includes(area)?`${area}, Accra, Ghana`:area;
export class ProviderError extends Error {
  constructor(code = "provider_unavailable") {
    super(({ location_not_found:"I couldn’t resolve that location. Try the city or neighborhood with its country.", location_ambiguous:"That location could mean more than one place. Add the city, region or country.", provider_not_configured: "Qloo is not configured on this server.", provider_auth_error: "Qloo could not authorize this request. Check the existing server configuration.", provider_rate_limited: "Qloo has reached its request limit. Please wait before trying again." })[code] || "Discovery is temporarily unavailable. Please retry.");
    this.code = code; this.status = code.startsWith("location_")?400:503;
  }
}
const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
function entities(data) {
  const items = Array.isArray(data) ? data : data?.results?.entities ?? data?.results?.tags ?? data?.results?.audiences ?? data?.results ?? data?.entities;
  if (!Array.isArray(items)) throw new ProviderError("provider_response_invalid");
  return items.filter((e) => e && typeof e === "object");
}
export function createQlooClient({ fetchImpl = globalThis.fetch, getKey = () => process.env.QLOO_API_KEY, baseUrl = process.env.QLOO_API_URL || "https://hackathon.api.qloo.com", now = Date.now } = {}) {
  const cache = new Map();
  let audienceCache;
  const tagsCache=new Map(), locationCache=new Map(), searchCache=new Map();
  async function call(path, params, area) {
    const key = getKey();
    if (!key) throw new ProviderError("provider_not_configured");
    const url = new URL(path, baseUrl);
    for (const [k, v] of Object.entries(params)) if (v !== "") url.searchParams.set(k, String(v));
    try {
      const res = await fetchImpl(url, { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(path==='/v2/insights'?15000:8000) });
      if ([401, 403].includes(res.status)) throw new ProviderError("provider_auth_error");
      if (res.status === 429) throw new ProviderError("provider_rate_limited");
      if(res.status===404&&path==='/search')return [];
      if (!res.ok) {
        if(res.status===400&&area){const problem=JSON.stringify(await res.json()).toLowerCase();if(/localit|location/.test(problem))throw new ProviderError('location_not_found');}
        throw new ProviderError();
      }
      const data=await res.json(),items=entities(data);
      if(area){
        const raw=data.query?.localities?.filter??data.query?.locality?.signal;
        const matches=Array.isArray(raw)?raw:raw?[raw]:[];
        if(matches.length>1)throw new ProviderError('location_ambiguous');
        const match=matches[0];
        if(match?.entity_id&&match?.name){
          const label=match.disambiguation||match.name;
          const aliases={uk:'unitedkingdom',usa:'unitedstates',us:'unitedstates',uae:'unitedarabemirates'};
          const parts=locationQuery(area).split(',').map(s=>norm(s)).filter(Boolean);
          if(parts.some(part=>!norm(label+' '+match.name).includes(aliases[part]||part)))throw new ProviderError('location_ambiguous');
          const lat=match.location?.lat,lng=match.location?.lon??match.location?.lng;
          let timeZone=null;try{const zones=findTimeZones(lat,lng);if(zones.length===1)timeZone=zones[0];}catch{}
          items.locality={query:area,id:match.entity_id,name:match.name,label,method:'qloo_locality_filter',radius:0,timeZone};
        }
      }
      return items;
    } catch (e) { if (e instanceof ProviderError) throw e; throw new ProviderError(); }
  }
  async function tasteTags(id){
    const card=byId[id];if(!card?.tagQuery)return [];
    const hit=tagsCache.get(id);if(hit&&now()-hit.at<86400000)return hit.value;
    const value=call('/v2/tags',{'filter.query':card.tagQuery,take:30}).then(tags=>tags.filter(t=>typeof t.id==='string'&&/^urn:tag:(category|genre|cuisine|culinary_style):(place|qloo):/.test(t.id)&&!/:hotel:/.test(t.id)&&matchesTasteTag(card,t.id)).slice(0,4).map(t=>t.id));
    tagsCache.set(id,{at:now(),value});try{return await value;}catch(e){tagsCache.delete(id);throw e;}
  }
  async function getLocation(id){
    id=parseLocationId(id);
    const cached=locationCache.get(id);if(cached&&now()-cached.at<86400000)return cached.value;
    const value=locationOption((await call('/entities',{entity_ids:id})).find(e=>e.entity_id?.toUpperCase()===id));
    if(!value)throw new ProviderError('location_not_found');
    if(locationCache.size>=512)locationCache.delete(locationCache.keys().next().value);
    locationCache.set(id,{value,at:now()});return value;
  }
  return {
    name: "qloo",
    getLocation,
    async audienceCatalog(){
      if(audienceCache&&now()-audienceCache.at<86400000)return audienceCache.value;
      const value=Promise.all(AUDIENCE_FAMILIES.map(family=>call('/v2/audiences',{'filter.parents.types':`urn:audience:${family}`,take:50}))).then(groups=>groups.flat().filter(a=>validAudience(a.id)&&a.name&&!/political|religio/i.test(a.id)).map(a=>({id:a.id,name:a.name,family:a.id.split(':')[2]})));
      audienceCache={at:now(),value};try{return await value;}catch(e){audienceCache=undefined;throw e;}
    },
    async resolveContext(context){
      if(!context)return {audiences:[],interests:[],unresolved:[]};
      const catalog=context.audiences?.length?await this.audienceCatalog():[];
      const audiences=(context.audiences||[]).map(id=>catalog.find(a=>a.id===id)).filter(Boolean);
      const interests=[],unresolved=[];
      await Promise.all((context.interests||[]).map(async interest=>{
        if(!INTEREST_TYPES.includes(interest.type))return;
        const key=`${interest.type}:${norm(interest.name)}`;
        let match=cache.get(key);
        if(!match||now()-match.at>=86400000){
          const rows=await call('/search',{query:interest.name,types:`urn:entity:${interest.type}`,take:5});
          const exact=[...new Map(rows.filter(e=>norm(e.name)===norm(interest.name)&&(e.types||[e.type]).includes(`urn:entity:${interest.type}`)).map(e=>[e.entity_id||e.id,e])).values()];
          match={at:now(),value:exact.length===1?{type:interest.type,name:exact[0].name,entityId:exact[0].entity_id||exact[0].id}:null};
          if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(key,match);
        }
        if(match.value?.entityId)interests.push(match.value);else unresolved.push({type:interest.type,name:interest.name,reason:'no_unambiguous_exact_match'});
      }));
      return {audiences,interests,unresolved};
    },
    async nearbyLocations(point,radiusKm=20){
      ({point,radiusKm}=nearbyRequest({...point,radiusKm}));
      const {latitude,longitude}=point;
      // Search uses lat,lon (not the WKT lon,lat order of Insights).
      // No coordinate-keyed cache: only public locality entities are retained.
      const rows=(await call('/search',{types:'urn:entity:locality','filter.location':`${latitude},${longitude}`,'filter.radius':radiusKm/1.609344,sort_by:'distance',take:20})).map(entity=>({option:locationOption(entity),distanceKm:areaDistanceKm(point,entity.location)})).filter(row=>row.option&&!['country','continent'].includes(row.option.kind.toLowerCase()));
      // A named town is a more useful choice than an entire region. Keep broad
      // areas available, labelled as such, after the nearby towns/neighborhoods.
      const broad=kind=>['state','region','county','province'].includes(kind.toLowerCase());
      rows.sort((a,b)=>Number(broad(a.option.kind))-Number(broad(b.option.kind))||(a.distanceKm??Infinity)-(b.distanceKm??Infinity));
      for(const {option} of rows){if(locationCache.size>=512)locationCache.delete(locationCache.keys().next().value);locationCache.set(option.id,{value:option,at:now()});}
      // Distance belongs only to this response. Never cache it with an area.
      return rows.slice(0,12).map(({option,distanceKm})=>({...option,...(distanceKm===null?{}:{distanceKm}),broadArea:broad(option.kind)}));
    },
    async getPlace(id) {
      id = parseLocationId(id);
      const place = (await call('/entities', {entity_ids:id})).find(e => e.entity_id?.toUpperCase() === id && (e.types || []).includes('urn:entity:place'));
      if (!place) throw new ProviderError('provider_response_invalid');
      return place;
    },
    async searchLocations(query){
      const key=norm(query),cached=searchCache.get(key);if(cached&&now()-cached.at<3600000)return cached.value;
      const value=(await call('/search',{query,types:'urn:entity:locality',take:8})).map(locationOption).filter(Boolean);
      for(const option of value){if(locationCache.size>=512)locationCache.delete(locationCache.keys().next().value);locationCache.set(option.id,{value:option,at:now()});}
      if(searchCache.size>=100)searchCache.delete(searchCache.keys().next().value);
      searchCache.set(key,{value,at:now()});return value;
    },
    async resolveExperienceTags(experience={}){
      return (await Promise.all(['atmosphere','cuisine'].filter(field=>experience[field]).map(async field=>{
        const label=experience[field],key=`experience:${field}:${norm(label)}`;
        let hit=tagsCache.get(key);
        if(!hit||now()-hit.at>=86400000){
          const value=call('/v2/tags',{'filter.query':label,take:20}).then(tags=>tags.filter(tag=>norm(tag.name)===norm(label)&&(field==='atmosphere'?/^urn:tag:(ambience|setting):(place|qloo):/.test(tag.id):/^urn:tag:(cuisine|culinary_style):(place|qloo):/.test(tag.id))).slice(0,3).map(tag=>tag.id));
          hit={at:now(),value};tagsCache.set(key,hit);try{await value;}catch(e){tagsCache.delete(key);throw e;}
        }
        return {preferenceId:`experience:${field}`,label,tagIds:await hit.value};
      }))).filter(signal=>signal.tagIds.length);
    },
    async resolveTasteTags(ids){return (await Promise.all(ids.filter(id=>byId[id]?.tagQuery).map(async id=>({preferenceId:id,tagIds:await tasteTags(id)})))).filter(s=>s.tagIds.length);},
    async resolveArtist(name) {
      const key = norm(name);
      const hit = cache.get(key);
      if (hit && now() - hit.at < 86400000) return hit.value;
      const matches = (await call("/search", { query: name, take: 5 })).filter((e) => {
        const types = Array.isArray(e.types) ? e.types : [e.type];
        return norm(e.name) === key && types.includes("urn:entity:artist") && typeof (e.entity_id ?? e.id) === "string";
      });
      const unique = [...new Map(matches.map((e) => [e.entity_id ?? e.id, e])).values()];
      if (unique.length !== 1) return { status: "unresolved", reason: unique.length ? "ambiguous" : "no_exact_artist_match" };
      const value = { status: "resolved", entityId: unique[0].entity_id ?? unique[0].id, name: unique[0].name };
      if (cache.size >= 256) cache.delete(cache.keys().next().value);
      cache.set(key, { at: now(), value });
      return value;
    },
    async discover({ signalIds, area,locationId,tagSignals=[],contextSignals,includeActivity=false,includeDrinks=false,radiusKm=0 }) {
      const chosen=locationId?await getLocation(locationId):null;
      if(radiusKm&&(!chosen?.center||radiusKm!==20))throw new ProviderError('provider_response_invalid');
      const parameters={
        "filter.type": "urn:entity:place", "signal.interests.entities": signalIds.join(","),
        'signal.interests.tags':[...new Set(tagSignals.flatMap(s=>s.tagIds))].join(','),
        ...(contextSignals?.audiences?.length?{'signal.demographics.audiences':contextSignals.audiences.map(a=>a.id).join(','),'signal.demographics.audiences.weight':0.35}:{}),
        "feature.explainability": true,
        ...(radiusKm?{'filter.location':`POINT(${chosen.center.longitude} ${chosen.center.latitude})`}:chosen?{'filter.location':chosen.id}:{'filter.location.query':locationQuery(area)}), "filter.location.radius":radiusKm*1000, take: 50,
      };
      const retrieve=async params=>{const items=await call('/v2/insights',params,chosen?undefined:area);if(chosen)items.locality={...chosen,query:area,method:'qloo_locality_filter',radius:radiusKm*1000,...(radiusKm?{scope:'nearby',center:chosen.center,radiusKm}:{} )};return items;};
      if(!includeActivity&&!includeDrinks)return retrieve(parameters);
      // Retrieve the requested venue types as well as the taste-led pool, so a
      // dining-heavy result cannot hide eligible bars or discovery venues.
      const categories=[];
      if(includeActivity){
        const requested=tagSignals.filter(s=>byId[s.preferenceId]?.group==='activity').flatMap(s=>s.tagIds);
        categories.push(...(requested.length?requested:[...await tasteTags('v-history'),...await tasteTags('v-nature')]).filter(id=>/^urn:tag:category:place:[^:]+$/.test(id)));
      }
      if(includeDrinks)categories.push(...await tasteTags('v-bar'),...await tasteTags('v-club'));
      const results=await Promise.all([retrieve(parameters),...(categories.length?[retrieve({...parameters,'filter.tags':[...new Set(categories)].join(','),'operator.filter.tags':'union'})]:[])]);
      return Object.assign([...new Map(results.flat().map(place=>[place.entity_id,place])).values()],{locality:results[0].locality});
    },
  };
}

