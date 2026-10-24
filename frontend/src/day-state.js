export const identity = () => crypto.randomUUID();
export const withPeopleIds = brief => ({...brief, people:brief.people.map(p=>({...p,id:p.id||identity()}))});
export const personInput = ({name,artists,vibes,spending}) => ({name,artists,vibes,...(spending?{spending}:{})});
export const hasTaste = person => !!(person.artists.length + person.vibes.length || person.spending);
export function updateRoster(brief, people) {
  return {...brief,people,party:{...brief.party,adults:Math.max(brief.party.adults,people.length-brief.party.children)}};
}
export function tasteFromSwipe(person, card, like) {
  const key=card.kind==='artist'?'artists':'vibes', value=card.kind==='artist'?card.label:card.id;
  const values=person[key].filter(v=>v!==value);
  if(like) values.push(value);
  if(values.length>(key==='artists'?6:18)) throw new Error(key==='artists'?'Keep up to six artists. Remove one to make room.':'Keep up to eighteen food, activity and mood preferences.');
  return {...person,[key]:values};
}
export function planChanges(before, after) {
  if(!before)return after.stops.filter(s=>s.item).map(s=>({intent:s.intent,label:'Found',to:s.item.name}));
  return after.stops.flatMap(stop=>{
    const old=before.stops.find(s=>s.intent===stop.intent);
    if(old?.item?.id===stop.item?.id)return [];
    return [{intent:stop.intent,label:stop.item?'Updated':'Still looking',from:old?.item?.name,to:stop.item?.name}];
  });
}
export const readContacts = () => {try {const value=JSON.parse(localStorage.getItem('outing.people.v1')||'[]');return Array.isArray(value)?value.filter(p=>p.id&&typeof p.name==='string'&&Array.isArray(p.artists)&&Array.isArray(p.vibes)).slice(0,30):[];}catch{return [];}};
export function saveContacts(people) {
  const previous=readContacts();
  const next=[...people.filter(p=>p.name!=='You'||hasTaste(p)),...previous.filter(p=>!people.some(n=>n.id===p.id))].slice(0,30);
  localStorage.setItem('outing.people.v1',JSON.stringify(next));
  return next;
}

// A late response can never replace the result for a newer brief. One network call
// runs at a time and intermediate swipes collapse into the latest request.
export function createLatestPlanner({run,onStart,onResult,onError,onIdle}) {
  let pending=null, running=false, version=0, disposed=false;
  async function drain() {
    if(running||disposed)return;
    running=true;onStart?.();
    try {
      while(pending&&!disposed) {
        const job=pending;pending=null;
        try {const result=await run(job.value);if(!disposed&&job.version===version)onResult(result,job.value);}
        catch(error){if(!disposed&&job.version===version)onError(error);}
      }
    } finally {running=false;if(!disposed)onIdle?.();}
  }
  return {enqueue(value){if(disposed)return;pending={value,version:++version};drain();},invalidate(){version++;pending=null;},dispose(){disposed=true;pending=null;}};
}
