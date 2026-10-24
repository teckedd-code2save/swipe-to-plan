// Suggestions reflect the current plan and provider checks, never model-made facts.
export function nextPlanSteps(plan,checks={}) {
  if(!plan)return null;
  const filled=plan.stops.filter(s=>s.item);
  const reports=checks.data?.stops||[];
  const flags=reports.filter(s=>['outside_reported_hours','reported_closed'].includes(s.hours?.status)).length;
  const fits=reports.filter(s=>s.hours?.status==='fits_reported_hours').length;
  const missing=plan.request.people.filter(p=>!p.artists.length&&!p.vibes.length);
  const note=!filled.length?'I haven’t found the places yet. Let’s adjust the plan.':checks.status==='loading'?'I’m checking reported hours. Menus and venue details are next.':checks.status==='error'?'The hours check couldn’t finish. Let’s try it again.':flags?`${flags===1?'One stop needs':`${flags} stops need`} a timing check before you go.`:fits===filled.length?'Your times fit reported weekly hours. Let’s look at menus and practical details.':'Some hours are unlisted. I’ve gathered the venue details to help you check.';
  const primary=filled.length?{id:'checks',label:flags?'Review hours & menus':checks.status==='error'?'Retry the place checks':'Check hours & menus',icon:'clock'}:{id:'review',label:'Adjust this plan',icon:'edit'};
  const secondary=missing.length?{id:'tastes',label:missing.length===1?`Add ${missing[0].name==='You'?'your':`${missing[0].name}’s`} tastes`:'Fill in our tastes',personId:missing[0].id,icon:'music'}:{id:'share',label:plan.request.people.length>1?'Share with our people':'Keep my daybook',icon:'download'};
  return {note,attention:flags>0,actions:[primary,secondary]};
}

export const autopilotPhaseText = {
  thinking:'Bringing your request and saved tastes together…',
  location:'Choose the area, then I’ll take it from here.',
  tastes:'A few favorites will make this yours. I’ll continue when you’re done.',
  planning:'Finding places through Qloo and shaping your day…',
  checking:'Your plan is here. Checking reported hours…',
};
