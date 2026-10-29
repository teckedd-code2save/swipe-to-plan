// The result card always opens the current plan, so it must describe that plan.
export function resultPlaceLabel(plan){
  const count=plan.stops.filter(stop=>stop.item).length;
  const nearby=plan.nearbySuggestions?.length||0;
  if(!count&&nearby)return `${nearby} nearby ${nearby===1?'place':'places'} to explore`;
  if(!count)return 'No stops found yet';
  return `${count} ${count===1?'stop':'stops'}`;
}
export function updateResultReceipt(turns,update){
  const index=turns.findLastIndex(turn=>turn.result);
  if(index<0)return turns;
  return turns.map((turn,i)=>i===index?{...turn,...update}:turn);
}
