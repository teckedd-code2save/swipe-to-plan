// Explicit requirements are only matched against text actually supplied by a venue
// provider. Missing text means unverified, not a negative venue review.
const normalize=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const cues={
  ghanaian:['ghanaian','ghana cuisine','fufu','banku','kenkey','waakye','kelewele','kontomire','groundnut soup','light soup','red red','t z','tuo zaafi'],
  nigerian:['nigerian','suya','egusi','efo riro','amala','moi moi'],
  italian:['italian','pasta','risotto','trattoria','pizza'],
  indian:['indian','masala','biryani','tandoori'],
  chinese:['chinese','dim sum','szechuan','sichuan'],
  japanese:['japanese','sushi','ramen','udon'],
  mexican:['mexican','taco','quesadilla','burrito'],
};
function words(place){
  return [place.name,place.description,...(place.cuisineTags||[]),...(place.tagNames||[])].filter(Boolean).map(normalize);
}
function isMentioned(values,term){
  const query=normalize(term).trim();
  if(!query)return null;
  const alternatives=cues[query]||[query];
  return values.some(value=>alternatives.some(word=>value.includes(word)));
}
export function assessExperience(place,experience={},intent){
  if(!experience||!Object.keys(experience).length)return null;
  const texts=words(place);
  const fit={};
  if(experience.cuisine&&intent==='dinner'){
    const supported=isMentioned(texts,experience.cuisine);
    fit.cuisine={requested:experience.cuisine,status:supported?'provider_text_signal':'unverified',evidence:supported?'Venue description or category mentions a relevant dish/cuisine. Menu not verified.':null};
  }
  if(experience.atmosphere){
    const supported=isMentioned(texts,experience.atmosphere);
    fit.atmosphere={requested:experience.atmosphere,status:supported?'provider_text_signal':'unverified'};
  }
  return Object.keys(fit).length?fit:null;
}
export function rerankForExperience(places,experience,intent){
  if(!experience||!Object.keys(experience).length)return places;
  return places.map(place=>{
    const fit=assessExperience(place,experience,intent);
    const cuisineSignal=fit?.cuisine?.status==='provider_text_signal'?1:0;
    const atmosphereSignal=fit?.atmosphere?.status==='provider_text_signal'?1:0;
    const score=+(place.score+cuisineSignal*.9+atmosphereSignal*.18).toFixed(4);
    return {...place,...(fit?{experienceFit:fit}:{}),score,scoreComponents:{...place.scoreComponents,cuisineSignal,atmosphereSignal}};
  }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
}
