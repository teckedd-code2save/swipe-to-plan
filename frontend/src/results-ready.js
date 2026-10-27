import {shortlistCandidates} from './shortlist.js';
export function resultsReady(plan,discovery){
  const items=discovery?.items||shortlistCandidates(plan).map(choice=>choice.item);
  if(!plan&&!discovery)return {key:'',count:0,label:''};
  const request=discovery?.brief||plan.request;
  return {key:JSON.stringify([discovery?'discovery':'plan',request.area,request.date,request.budget,request.timing,items.map(item=>item.id)]),count:items.length,label:items.length?`${items.length} ${items.length===1?'place':'places'} ready`:plan?.qualityReview?.status==='pending'?'Still looking nearby':'Search complete'};
}
