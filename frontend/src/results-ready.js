export function resultsReady(plan,discovery){
  const items=discovery?.items||plan?.stops?.flatMap(stop=>stop.item?[stop.item]:[])||[];
  if(!plan&&!discovery)return {key:'',count:0,label:''};
  const request=discovery?.brief||plan.request;
  return {key:JSON.stringify([discovery?'discovery':'plan',request.area,request.date,request.budget,request.timing,items.map(item=>item.id)]),count:items.length,label:items.length?`${items.length} ${items.length===1?'place':'places'} ready`:'Search complete'};
}
