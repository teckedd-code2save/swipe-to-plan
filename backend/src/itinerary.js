import {locationId as parseLocationId} from './locations.js';
import { parseArea, InputError, parseRequest } from './contract.js';
import { byId,matchesTasteTag } from './deck.js';
import { mergeGroup } from './plan.js';
import { schedulePlaces } from './scheduling.js';
import {rerankForExperience} from './experience.js';

export const ACTIVITIES = ['coffee', 'activity', 'dinner', 'drinks'];
const DEFAULT_MINUTES = { coffee: 45, activity: 90, dinner: 75, drinks: 60 };
const MIN_MINUTES = { coffee: 30, activity: 45, dinner: 45, drinks: 30 };
const WEIGHTS = { coffee: 1, activity: 2, dinner: 3, drinks: 2 };
const LABELS = { coffee: 'A place to pause', activity: 'A little discovery', dinner: 'Gather around the table', drinks: 'Stay a little longer' };
const object = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new InputError(`Unsupported ${label}.`);
  return value;
};
const integer = (value, min, max, label) => { if (!Number.isInteger(value) || value < min || value > max) throw new InputError(`${label} must be a whole number from ${min} to ${max}.`); return value; };
const text = (value, max, label) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new InputError(`Provide ${label} in at most ${max} characters.`); return value.trim(); };
const clock = (value) => { if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new InputError('Use a time in HH:MM format.'); return value; };
const minutes = (time) => Number(time.slice(0,2)) * 60 + Number(time.slice(3));
const time = (value) => `${String(Math.floor(value / 60)).padStart(2,'0')}:${String(value % 60).padStart(2,'0')}`;

export function parseItinerary(body = {}, {allowMissingLocation=false}={}) {
  object(body, ['title','area','locationId','currencyMode','timing','date','party','people','budget','currency','startTime','endTime','pace','activities','pins','excludeIds','maxPriceLevel','experience'], 'planning field');
  const area = allowMissingLocation&&body.area===''?'':parseArea(body.area);
  const locationId=body.locationId?parseLocationId(body.locationId):undefined;
  const currencyMode=body.currencyMode??(body.currency?'custom':'local');
  if(!['local','custom'].includes(currencyMode))throw new InputError('Choose local currency or a custom currency.');
  const date = body.date === undefined ? new Date().toISOString().slice(0,10) : body.date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new InputError('Choose a valid date.');
  const timing=object(body.timing??{dateConfirmed:true,timeConfirmed:true,mode:'fixed'},['dateConfirmed','timeConfirmed','mode','window'],'timing');
  if(typeof timing.dateConfirmed!=='boolean'||typeof timing.timeConfirmed!=='boolean'||!['fixed','flexible'].includes(timing.mode))throw new InputError('Choose a date and whether your start time is flexible.');
  if(timing.window!==undefined&&!['any','morning','afternoon','evening','custom'].includes(timing.window))throw new InputError('Choose a supported time window.');
  const party = object(body.party ?? {}, ['adults','children'], 'party');
  const adults = integer(party.adults ?? 2,1,8,'Adults'), children = integer(party.children ?? 0,0,6,'Children');
  const people = body.people ?? [{ name: 'You', artists: [], vibes: [] }];
  if (!Array.isArray(people) || !people.length || people.length > Math.min(6, adults + children)) throw new InputError('Add one to six taste profiles, no more than the number of people going.');
  const profiles = people.map((person, index) => {
    object(person,['id','name','artists','vibes','spending'],'taste profile');
    if (person.id !== undefined && (typeof person.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(person.id))) throw new InputError('Invalid taste profile ID.');
    const parsed = parseRequest({ taste: { artists: person.artists ?? [], vibes: person.vibes ?? [] } });
    if (parsed.taste.artists.length > 6) throw new InputError('Use up to six artists per person.');
    let spending;
    if (person.spending !== undefined) {
      object(person.spending,['style','priority'],'spending preferences');
      const style=person.spending.style??'balanced', priority=person.spending.priority??'even';
      if (!['mindful','balanced','treat'].includes(style) || !['even',...ACTIVITIES].includes(priority)) throw new InputError('Choose a supported spending style and priority.');
      spending={style,priority};
    }
    return { ...(person.id ? {id:person.id} : {}), name: text(person.name,24,'a name'), artists: parsed.taste.artists, vibes: parsed.taste.vibes, ...(spending?{spending}:{}) };
  });
  if (new Set(profiles.filter(p=>p.id).map(p=>p.id)).size !== profiles.filter(p=>p.id).length) throw new InputError('Taste profile IDs must be distinct.');
  const activities = body.activities ?? [];
  // An omitted allowance remains unknown through parsing, revisions and saving.
  const budget = body.budget == null ? null : integer(body.budget,1,10000000,'Budget');
  const currency=body.currency??'GHS';
  if(typeof currency!=='string'||!Intl.supportedValuesOf('currency').includes(currency))throw new InputError('Choose a valid three-letter currency code, such as USD, EUR or GHS.');
  const startTime = clock(body.startTime ?? '11:00'), endTime = clock(body.endTime ?? '18:00');
  if (minutes(endTime) <= minutes(startTime)) throw new InputError('End time must be after start time on the same day.');
  const pace = body.pace ?? 'easy';
  if (!['easy','balanced'].includes(pace)) throw new InputError('Choose an easy or balanced pace.');
  // An unfinished brief has no activities until the person chooses them.
  if (!Array.isArray(activities) || activities.length > 3 || activities.some((item) => !ACTIVITIES.includes(item)) || new Set(activities).size !== activities.length) throw new InputError('Choose one to three different activities.');
  if (children && activities.includes('drinks')) throw new InputError('Choose coffee, discovery or a meal for a family outing with children.');
  const pins = object(body.pins ?? {}, activities, 'kept stops');
  Object.values(pins).forEach((id) => text(id,160,'a kept place ID'));
  if (new Set(Object.values(pins)).size !== Object.values(pins).length) throw new InputError('Keep a different place for each stop.');
  const constraints = parseRequest({ constraints: { excludeIds: body.excludeIds ?? [], ...(body.maxPriceLevel !== undefined ? { maxPriceLevel: body.maxPriceLevel } : {}) } }).constraints;
  const experienceInput=body.experience===undefined?null:object(body.experience,['cuisine','atmosphere','occasion','notes'],'experience');
  const experience=experienceInput?Object.fromEntries(Object.entries(experienceInput).map(([key,value])=>[key,text(value,key==='notes'?220:80,key)])):{};
  const request = { title: text((typeof body.title==='string'&&!body.title.trim()||body.title==null ? null : body.title) || (activities.length ? `${activities.map(item=>({coffee:'Coffee',activity:'Something fun',dinner:'Dinner',drinks:'Drinks'}[item])).join(' & ')}${area?' in '+area.split(',')[0]:''}` : children ? 'Family day' : adults > 2 ? 'A day together' : 'A day out'),80,'a title'), area,...(locationId?{locationId}:{}),currencyMode, timing:{...timing}, date, party:{ adults, children }, people:profiles, budget, currency, startTime, endTime, pace, activities, ...(Object.keys(experience).length?{experience}:{}), pins:{...pins}, excludeIds:constraints.excludeIds, ...(body.maxPriceLevel !== undefined ? { maxPriceLevel:body.maxPriceLevel } : {}) };
  makeSchedule(request); // Fail an impossible time window before any provider calls.
  return request;
}

export function makeSchedule(request) {
  const buffer = request.pace === 'easy' ? 30 : 20;
  const available = minutes(request.endTime) - minutes(request.startTime) - buffer * (request.activities.length - 1);
  const minimum = request.activities.reduce((sum, intent) => sum + MIN_MINUTES[intent], 0);
  if (available < minimum) throw new InputError('There is not enough time for these stops and travel buffers. Extend the time window or choose fewer stops.');
  const ideal = request.activities.reduce((sum, intent) => sum + DEFAULT_MINUTES[intent],0);
  let remaining = available;
  let cursor = minutes(request.startTime);
  return request.activities.map((intent,index) => {
    const remainingMinimum = request.activities.slice(index+1).reduce((sum,key) => sum + MIN_MINUTES[key],0);
    const duration = Math.min(DEFAULT_MINUTES[intent], Math.max(MIN_MINUTES[intent],Math.floor(DEFAULT_MINUTES[intent] * Math.min(1,available/ideal))), remaining - remainingMinimum);
    remaining -= duration;
    const slot = { intent, start:time(cursor), end:time(cursor+duration), durationMinutes:duration, bufferAfterMinutes:index < request.activities.length-1 ? buffer : 0, status:'suggested' };
    cursor += duration + slot.bufferAfterMinutes;
    return slot;
  });
}

export function allocateBudget(request, filledIntents) {
  const influences=request.people.map((person,index)=>({personId:person.id||`person-${index}`,name:person.name,style:person.spending?.style||'balanced',priority:person.spending?.priority||'even',explicit:!!person.spending}));
  if(request.budget==null)return {currency:request.currency||'GHS',total:null,reserve:null,transport:null,allocations:request.activities.map(intent=>({intent,amount:null,perPerson:null,assigned:filledIntents.includes(intent)})),influences,basis:'not_set',quotedTotal:null,note:'No budget was specified. Check venue prices before deciding what to spend.'};
  const reserveRates={mindful:.2,balanced:.1,treat:.05};
  const reserve = Math.round(request.budget * influences.reduce((sum,p)=>sum+reserveRates[p.style],0)/influences.length), transport = Math.round(request.budget * .15);
  const available = request.budget-reserve-transport;
  // Each person's normalized allocation gets an equal vote. A priority gets
  // extra room inside the same total; no preference invents a venue price.
  const shares=Object.fromEntries(request.activities.map(intent=>[intent,influences.reduce((sum,p)=>{
    const weight=key=>WEIGHTS[key]*(p.priority===key?1.75:1);
    return sum+weight(intent)/request.activities.reduce((n,key)=>n+weight(key),0);
  },0)/influences.length]));
  let remaining = available;
  const allocations = request.activities.map((intent,index) => {
    const amount = index === request.activities.length-1 ? remaining : Math.floor(available * shares[intent]);
    remaining -= amount;
    return { intent, amount, perPerson:Math.floor(amount/(request.party.adults+request.party.children)), assigned:filledIntents.includes(intent) };
  });
  return { currency:request.currency||'GHS', total:request.budget, reserve, transport, allocations, influences, basis:'spending_allowances', quotedTotal:null, note:'These are spending envelopes from your budget, not venue prices or a verified cost estimate.' };
}

function buildTasteMap(request, members, stops) {
  const nodes = [], edges = [];
  request.people.forEach((person,index) => {
    const personId = person.id || `person-${index}`;
    nodes.push({id:personId,kind:'person',label:person.name,personId});
    const taste = members[index][0].taste;
    const preferences = [
      ...person.artists.map((label,i) => ({id:`${personId}-artist-${i}`,kind:'artist',label,entityId:taste.resolved.find((a) => a.requested === label)?.entityId ?? null})),
      ...person.vibes.map((id,i) => ({id:`${personId}-vibe-${i}`,kind:'vibe',label:byId[id].label,vibeId:id})),
    ];
    for (const preference of preferences) {
      nodes.push({...preference,personId,status:preference.kind==='artist'&&!preference.entityId?'unresolved':'considered'});
      edges.push({id:`owns-${preference.id}`,from:personId,to:preference.id,kind:'preference',source:'user',label:'Selected preference'});
      stops.forEach((stop,stopIndex) => {
        if (!stop.item) return;
        const item = members[index][stopIndex].ranked.find((candidate) => candidate.id === stop.item.id);
        if (!item) return;
        const affinity = preference.entityId && item.affinityEvidence?.find((entry) => entry.entityId.toLowerCase() === preference.entityId.toLowerCase());
        const tagReason = preference.kind==='vibe' && item.reasons.find((reason) => reason.code==='vibe_match' && reason.evidence.some((e) => matchesTasteTag(byId[preference.vibeId],e.value)));
        if (preference.kind==='artist' && !preference.entityId || preference.kind==='vibe' && !tagReason) return;
        const evidence = affinity ? [{field:affinity.sourceField,entityId:affinity.entityId,value:affinity.contribution}] : tagReason ? tagReason.evidence.filter((e) => matchesTasteTag(byId[preference.vibeId],e.value)) : [{field:'signal.interests.entities',value:preference.entityId}];
        edges.push({id:`match-${preference.id}-${stopIndex}`,from:preference.id,to:`stop-${stopIndex}`,personId,kind:affinity?'affinity':tagReason?'tag_match':'search_signal',source:affinity?'qloo_explainability':tagReason?'qloo_tags':'qloo_request',label:affinity?'Reported connection to this artist':tagReason?'Place tags match this preference':'Used in the search; individual contribution unavailable',evidence,...(affinity?{contribution:affinity.contribution}:{})});
      });
    }
  });
  stops.forEach((stop,index) => nodes.push({id:`stop-${index}`,kind:'stop',label:stop.item?.name ?? `Unfilled ${stop.intent} stop`,intent:stop.intent,entityId:stop.item?.entityId??null,candidateId:stop.item?.id??null}));
  return { nodes,edges,legend:'Solid paths are provider-reported contributions or matched place tags. Dotted paths are search inputs without individual contribution evidence. Contributions are not probabilities.' };
}

function resultTitle(request,stops){
  const filled=stops.filter(stop=>stop.item);
  const area=request.area.split(',')[0];
  const defaultNames={coffee:'Coffee',activity:'Something fun',dinner:'Dinner',drinks:'Drinks'};
  const generated=request.activities.map(intent=>defaultNames[intent]).join(' & ');
  const defaults=new Set(['','A day out','Family day','A day together','A little day',generated,`${generated} in ${area}`]);
  const staleStatus=request.title.startsWith('Places still to find in ');
  // Search status belongs to the result state, never the outing's identity.
  // Preserve meaningful user/model titles across empty results and revisions.
  if(!staleStatus&&!defaults.has(request.title))return request.title;
  if(filled.length===1&&filled[0].intent==='coffee')return filled[0].item.name.slice(0,80);
  const names={coffee:'Cafés',activity:'Time out',dinner:'A meal',drinks:'Drinks'};
  const intents=filled.length?[...new Set(filled.map(stop=>stop.intent))]:request.activities;
  const cuisine=request.experience?.cuisine;
  const hasCuisineSignal=intents.includes('dinner')&&filled.some(stop=>stop.intent==='dinner'&&stop.item?.experienceFit?.cuisine?.status==='provider_text_signal');
  const terms=intents.map(intent=>intent==='dinner'&&hasCuisineSignal?`${cuisine} food`:names[intent]);
  return `${terms.join(' & ')||'Your outing'} in ${area}`.slice(0,80);
}

export async function buildItinerary(discovery, request) {
  if(!request.activities.length)throw new InputError('Choose what you’d like to do before finding places.');
  if(!request.timing.dateConfirmed||!request.timing.timeConfirmed)throw new InputError('Choose when you want to go before planning.');
  if(request.locationId){
    if(!discovery.location)throw new InputError('Location search is unavailable on this server.');
    const location=await discovery.location(request.locationId);
    if(request.currencyMode==='local'&&!location.currency)throw new InputError('Choose a budget currency for this area.');
    request={...request,area:location.label,currency:request.currencyMode==='local'?location.currency:request.currency};
  }
  const schedule = makeSchedule(request);
  const voters=request.people.map((person,index)=>({person,index})).filter(({person})=>person.artists.length||person.vibes.length);
  const participating=voters.length?voters:request.people.map((person,index)=>({person,index}));
  const fetched = await Promise.all(participating.map(async({person,index}) => {
    const constraints = { excludeHotels:true,excludeIds:request.excludeIds,excludeTags:request.party.children ? ['nightclub','night_club','dance_club','adult_entertainment'] : [],...(request.maxPriceLevel?{maxPriceLevel:request.maxPriceLevel}:{}) };
    return {index,results:await discovery.byIntents(parseRequest({location:{area:request.area,...(request.locationId?{id:request.locationId}:{})},taste:{artists:person.artists,vibes:person.vibes},constraints}),request.activities)};
  }));
  // A person without food/music/activity tastes has no ranking vote yet. Their
  // budget and participation remain included, without a generic search drowning
  // out another member's explicit preferences or creating false taste evidence.
  const members=request.people.map((_,index)=>fetched.find(m=>m.index===index)?.results||request.activities.map(()=>({ranked:[],taste:{mode:'discovery',resolved:[],unresolved:[],vibes:[]},provenance:fetched[0].results[0].provenance,fetched:0})));
  const ranked = request.activities.map((intent,index) => rerankForExperience(fetched.length === 1 ? fetched[0].results[index].ranked : mergeGroup(fetched.map(({results,index:i}) => ({...results[index],id:request.people[i].id || `person-${i}`,name:request.people[i].name})),50).items,request.experience,intent));
  const reserved = new Set(Object.values(request.pins));
  const makePools=(limit)=>ranked.map((items,index) => request.pins[request.activities[index]] ? items.filter((item) => item.id===request.pins[request.activities[index]]) : items.filter((item) => !reserved.has(item.id)).slice(0,limit));
  const pools=makePools(8);
  const timeZone=members[0][0].provenance.locality?.timeZone||(['Accra','Osu','East Legon','Cantonments','Labone','Airport Residential'].includes(request.area)?'Africa/Accra':null);
  let fitted=await schedulePlaces(pools,schedule,request,{details:discovery.placeDetails,timeZone,now:discovery.now?.()});
  // Expand only when an initial shortlist cannot fill the outing. Preserve hard
  // constraints, pinned venues, and the previous result if the retry is no better.
  if(fitted.stops.some(stop=>!stop.item)&&fitted.stops.some(stop=>stop.reason!=='time_in_past')&&ranked.some((items,index)=>items.length>pools[index].length)){
    const expanded=await schedulePlaces(makePools(14),schedule,request,{details:discovery.placeDetails,timeZone,now:discovery.now?.()});
    if(expanded.stops.filter(stop=>stop.item).length>fitted.stops.filter(stop=>stop.item).length)fitted=expanded;
  }
  const selected=fitted.stops.map(s=>s.item);
  const stops = fitted.stops.map((slot,index) => ({...slot,id:`stop-${index}`,label:LABELS[slot.intent],item:selected[index],status:selected[index]?'matched':'unfilled',alternatives:ranked[index].filter((item) => !selected.some((chosen) => chosen?.id===item.id)).slice(0,2),...(selected[index]?{}:{reason:slot.reason|| (request.pins[slot.intent]?'kept_place_unavailable':pools[index].length?'no_distinct_place':'no_eligible_places')})}));
  const filled = stops.filter((stop) => stop.item);
  const tasteMap = buildTasteMap(request,members,stops);
  stops.forEach((stop) => {stop.connections=tasteMap.edges.filter((edge) => edge.to===stop.id);});
  const directions = new URL('https://www.google.com/maps/dir/');
  const query = (item) => item.coordinates ? `${item.coordinates.lat},${item.coordinates.lng}` : `${item.name} ${item.address}`;
  if (filled.length >= 1) {directions.searchParams.set('api','1');if(filled.length>=2)directions.searchParams.set('origin',query(filled[0].item));directions.searchParams.set('destination',query(filled.at(-1).item));if(filled.length>2)directions.searchParams.set('waypoints',filled.slice(1,-1).map((stop)=>query(stop.item)).join('|'));}
  const provider = members[0][0].provenance.provider;
  const unresolved = members.flatMap((results,index) => results[0].taste.unresolved.map((entry) => ({...entry,person:request.people[index].name})));
  return {
    version:'1.0',status:filled.length===stops.length?'complete':'partial',request:{...request,title:resultTitle(request,stops)},stops,tasteMap,
    budget:allocateBudget(request,filled.map((stop)=>stop.intent)),
    people:request.people.map((person,index)=>({id:person.id || `person-${index}`,name:person.name,taste:members[index][0].taste})),
    provenance:{provider,retrievedAt:members[0][0].provenance.retrievedAt,...(members[0][0].provenance.locality?{locality:members[0][0].provenance.locality}:{})},
    timeZone,timingNotes:fitted.notes,
    links:{directions:provider!=='demo'&&filled.length>=1?directions.href:null},
    checks:[{label:'Distinct stops',status:'passed'},{label:'Time window',status:'passed'},{label:'Budget allocated',status:request.budget==null?'not_set':'passed'},{label:'Opening hours',status:filled.length&&filled.every(s=>s.hours?.status==='fits_reported_hours')?'checked':'unverified'},{label:'Travel time',status:'unverified'},...(request.party.children?[{label:'Child suitability',status:'unverified'}]:[])],
    activity:[{label:'Preferences resolved',detail:`${members.reduce((sum,r)=>sum+r[0].taste.resolved.length,0)} artist signals across ${members.length} taste profile${members.length===1?'':'s'}`},{label:'Qloo places considered',detail:`${members.reduce((sum,r)=>sum+r[0].fetched,0)} candidate appearances before activity and area checks`},{label:'A day assembled',detail:`${filled.length} of ${stops.length} stops filled; no filters widened`},{label:'Budget and time checked',detail:request.budget==null?'Suggested time slots calculated; no budget specified':'Spending allowances and suggested time slots calculated'}],
    warnings:[...fitted.notes,...(provider==='demo'?['Sample plan with synthetic places.']:[]),...(unresolved.length?[`Unresolved artists: ${unresolved.map((entry)=>`${entry.requested} (${entry.person})`).join(', ')}.`]:[]),...(filled.length<stops.length?['Some stops could not be filled without changing your preferences.']:[]),
      ...(request.experience?.cuisine&&request.activities.includes('dinner')&&!stops.some(stop=>stop.intent==='dinner'&&stop.item?.experienceFit?.cuisine?.status==='provider_text_signal')?[`I couldn't verify ${request.experience.cuisine} cuisine among the available places. The current alternatives may not meet that request.`]:[]),'Suggested times do not verify opening hours. Travel buffers are not route estimates.','Budget figures are allowances, not venue quotes. Confirm prices and availability before going.',...(request.party.children?['Check child suitability directly with the venues.']:[])],
  };
}

