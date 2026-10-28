// Suggestions reflect the current plan and provider checks, never model-made facts.
export function partialPlanSummary(plan){
  const found=plan.stops.filter(s=>s.item).length;
  if(found===plan.stops.length)return null;
  if(!found&&plan.nearbySuggestions?.length)return 'I looked a little further and found places nearby.';
  return `I found ${found} of ${plan.stops.length} requested stops. ${found?'The day isn’t complete yet.':'I haven’t found a usable plan yet.'}`;
}
// Suggestions reflect the current plan and provider checks, never model-made facts.
export function nextPlanSteps(plan,checks={}) {
  if(!plan)return null;
  const filled=plan.stops.filter(s=>s.item);
  const reports=checks.data?.stops||[];
  const flags=reports.filter(s=>['outside_reported_hours','reported_closed'].includes(s.hours?.status)).length;
  const fits=reports.filter(s=>s.hours?.status==='fits_reported_hours').length;
  
  const timingGap=plan.stops.some(s=>!s.item&&['no_open_place','time_in_past'].includes(s.reason));
  const coverageGap=plan.stops.some(s=>!s.item&&['no_eligible_places','no_distinct_place'].includes(s.reason));
  const unmatched=plan.stops.filter(s=>!s.item).map(s=>({coffee:'coffee',activity:'discovery',dinner:'a meal',drinks:'drinks'})[s.intent]||'an activity').join(', ');
  const note=coverageGap?`I couldn’t find a match for ${unmatched} in this area. ${filled.length?'Your itinerary shows the places I did find. ':''}There may be local spots we don’t cover yet. Try another area or change the activities.`:timingGap?'The requested time window doesn’t fit the places I found. Change the time or try another day.':!filled.length?'I haven’t found the places yet. Let’s adjust the plan.':checks.status==='loading'?'I’m checking reported opening hours and available venue details.':checks.status==='error'?'The hours check couldn’t finish. Let’s try it again.':flags?`${flags===1?'One stop needs':`${flags} stops need`} a timing check before you go.`:fits===filled.length?'Your times fit reported weekly hours. Available menu highlights and links are shown with each place; meal service hours and prices still need confirmation.':'Some hours are unlisted. I’ve gathered the venue details to help you check.';
  if(plan.nearbySuggestions?.length)return {note:'I looked beyond your chosen area and found these nearby places. Distances are approximate.',attention:false,actions:[{id:'shortlist',label:'See nearby places',icon:'map'}]};
  if(coverageGap){
    const names=stops=>stops.map(s=>({coffee:'coffee',activity:'discovery',dinner:'a meal',drinks:'drinks'})[s.intent]||'an activity').join(' and ');
    const missing=plan.stops.filter(s=>!s.item&&['no_eligible_places','no_distinct_place'].includes(s.reason));
    const timeMissing=plan.stops.filter(s=>!s.item&&['no_open_place','time_in_past'].includes(s.reason));
    return {note:`I couldn’t find ${names(missing)} in this area.${timeMissing.length?` I also couldn’t fit ${names(timeMissing)} into your time window.`:''} ${filled.length?`I found ${filled.length} of ${plan.stops.length} requested stops. Keep those places, or adjust the missing parts.`:'Try different activities or another area.'}`,attention:true,actions:[...(!plan.request.searchRadiusKm?[{id:'nearby',label:'Look within 20 km',icon:'map'}]:[]),{id:'review',label:'Adjust activities',icon:'edit'},{id:'location',label:'Try another area',icon:'pin'},...(filled.length?[{id:'keep_found',label:filled.length===1?'Keep just this place':'Keep these places',icon:'check'}]:[]),...(timeMissing.length?[{id:'timing',label:'Adjust time',icon:'clock'}]:[])]};
  }
  const elapsed=plan.stops.some(s=>s.reason==='time_in_past');
  if(filled.length&&!coverageGap&&!timingGap)return {note:plan.phase==='needs_timing'?'These places match the outing; the visit time still needs adjusting. Explore their menus or choose another time.':plan.phase==='discovery'?'Explore the menus and compare your places, then choose a time.':'Choose menu highlights, compare options, or confirm the visit details.',attention:flags>0,actions:[{id:plan.phase==='discovery'?'menus':'checks',label:plan.phase==='discovery'?'Compare menus & prices':'View hours & menus',icon:'list'},{id:'compare',label:'Compare places',icon:'nodes'},{id:'routes',label:'Plan the journey',icon:'map'},{id:'timing',label:plan.phase==='discovery'?'Choose visit time':'Adjust visit time',icon:'clock'}]};
  const primary=timingGap?{id:elapsed?'tomorrow':'timing',label:elapsed?'Try tomorrow':'Change time',icon:'clock'}:coverageGap?{id:'location',label:'Change area',icon:'pin'}:filled.length?{id:'checks',label:flags?'Review hours & menus':checks.status==='error'?'Retry the place checks':'Check hours & menus',icon:'clock'}:{id:'review',label:'Adjust this plan',icon:'edit'};
  const secondary=coverageGap||timingGap?{id:'retry',label:'Retry search',icon:'undo'}:{id:'share',label:plan.request.people.length>1?'Share with our people':'Keep my daybook',icon:'download'};
  return {note,attention:flags>0,actions:[primary,secondary]};
}

export const autopilotPhaseText = {
  thinking:'Bringing your request and saved tastes together…',
  timing:'Choosing when to go…',
  location:'Your outing is saved. Choose where to explore.',
  tastes:'A few favorites will make this yours. I’ll continue when you’re done.',
  planning:'Finding places from your tastes and request…',
  checking:'Your plan is here. Checking reported hours…',
};

