// Compare a bounded set of provider-suggested areas using the same grounded
// discovery and constraints as an ordinary outing. Scores are relative signals,
// not a guarantee of venue quality, price, hours, or a worldwide optimum.
export async function compareOpenAreas({brief,findAreas,build}) {
  if(Object.keys(brief.pins||{}).length || brief.route?.length) throw Object.assign(new Error('Release kept places before searching in different areas.'),{status:400});
  const person=brief.people[0];
  const areas=(await findAreas({locationId:null,artists:person.artists,vibes:person.vibes,experience:brief.experience,activities:brief.activities})).slice(0,4);
  const usable=areas.filter(area=>area.id&&area.label&&(brief.currencyMode==='custom'?brief.currency:area.currency));
  const settled=await Promise.allSettled(usable.map(async area=>{
    const request={...brief,area:area.label,locationId:area.id,currency:brief.currencyMode==='custom'?brief.currency:area.currency,searchRadiusKm:0};
    const plan=await build(request);
    const items=(plan.shortlist||[]).map(entry=>entry.item).filter(Boolean);
    const filled=(plan.stops||[]).filter(stop=>stop.item).length;
    const topicMatches=items.filter(item=>(item.scoreComponents?.requestTopicBoost||0)>0).length;
    const best=items.reduce((value,item)=>Math.max(value,Number(item.score)||0),0);
    return {area,filled,topicMatches,count:items.length,best};
  }));
  const candidates=settled.filter(result=>result.status==='fulfilled').map(result=>result.value).filter(candidate=>candidate.count>0||candidate.filled>0);
  candidates.sort((a,b)=>b.filled-a.filled||b.topicMatches-a.topicMatches||b.best-a.best||b.count-a.count);
  return {area:candidates[0]?.area||null,areasCompared:settled.filter(result=>result.status==='fulfilled').length,areasUnavailable:settled.filter(result=>result.status==='rejected').length};
}
