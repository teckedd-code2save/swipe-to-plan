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
  const elapsed=plan.stops.some(s=>s.reason==='time_in_past');
  if(filled.length&&!coverageGap)return {note:plan.phase==='needs_timing'?'These places match the outing; the visit time still needs adjusting. Explore their menus or choose another time.':plan.phase==='discovery'?'Explore the menus and compare your places, then choose a time.':'Choose menu highlights, compare options, or confirm the visit details.',attention:flags>0,actions:[{id:'menus',label:'Menus & choices',icon:'list'},{id:'compare',label:'Compare places',icon:'nodes'},{id:'timing',label:plan.phase==='discovery'?'Choose visit time':'Adjust visit time',icon:'clock'}]};
  const primary=timingGap?{id:elapsed?'tomorrow':'timing',label:elapsed?'Try tomorrow':'Change time',icon:'clock'}:coverageGap?{id:'location',label:'Change area',icon:'pin'}:filled.length?{id:'checks',label:flags?'Review hours & menus':checks.status==='error'?'Retry the place checks':'Check hours & menus',icon:'clock'}:{id:'review',label:'Adjust this plan',icon:'edit'};
  const secondary=coverageGap||timingGap?{id:'retry',label:'Retry search',icon:'undo'}:{id:'share',label:plan.request.people.length>1?'Share with our people':'Keep my daybook',icon:'download'};
  return {note,attention:flags>0,actions:[primary,secondary]};
}

export const autopilotPhaseText = {
  thinking:'Bringing your request and saved tastes together…',
  timing:'Choosing when to go…',
  location:'Choose the area, then I’ll take it from here.',
  tastes:'A few favorites will make this yours. I’ll continue when you’re done.',
  planning:'Finding places from your tastes and request…',
  checking:'Your plan is here. Checking reported hours…',
};

