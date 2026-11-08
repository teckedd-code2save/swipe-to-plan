import {InputError} from './contract.js';

// A visit is an occurrence, not a venue. Apply one explicit edit and carry all
// other occurrences forward in code instead of asking a model to rewrite them.
export function editSelectedStops(plan,args){
  const fields={insert:['operation','placeId','afterStopId'],replace:['operation','placeId','stopId'],remove:['operation','stopId'],move:['operation','stopId','afterStopId']};
  const allowed=Object.hasOwn(fields,args?.operation)?fields[args.operation]:null;
  const fail=message=>{const error=new InputError(message);error.modelFeedback='Use edit_stops with exact stopId occurrence references and place IDs from planContext. Do not rebuild or drop unaffected stops. If the edit cannot fit one to three grounded visits, ask one clarification.';throw error;};
  if(!allowed||Object.keys(args).some(key=>!allowed.includes(key)&&key!=='intent')||allowed.some(key=>!Object.hasOwn(args,key)))fail('Provide the fields for this stop edit.');
  if(args.intent!=null&&(!['insert','replace'].includes(args.operation)||!['coffee','activity','dinner','drinks'].includes(args.intent)))fail('Choose a supported role for the inserted or replaced visit.');
  const stops=plan?.stops?.map((stop,index)=>({...stop,stopId:stop.stopId||`stop-${index}`}))||[];
  if(!stops.length||plan.requestedStopCount!==undefined&&plan.requestedStopCount!==stops.length)fail('Resolve the unfilled stops before editing selected visits.');
  const ids=new Set(stops.map(stop=>stop.stopId));
  if(ids.size!==stops.length)fail('The current stop references are ambiguous.');
  if('stopId' in args&&!ids.has(args.stopId))fail('Choose a current stop occurrence.');
  if('afterStopId' in args&&args.afterStopId!==null&&!ids.has(args.afterStopId))fail('Choose where this visit should go in the current route.');
  const place='placeId' in args?(plan.options||[]).find(option=>option.id===args.placeId):null;
  if('placeId' in args&&!place)fail('Choose a place from the current results.');
  if(args.operation==='move'&&args.stopId===args.afterStopId)fail('Choose a different stop to move this visit after.');
  let next=[...stops];
  if(args.operation==='replace')next=next.map(stop=>stop.stopId===args.stopId?{...place,intent:args.intent??stop.intent,stopId:stop.stopId}:stop);
  if(args.operation==='remove')next=next.filter(stop=>stop.stopId!==args.stopId);
  if(['insert','move'].includes(args.operation)){
    const added=args.operation==='insert'?{...place,intent:args.intent??place.intent}:next.find(stop=>stop.stopId===args.stopId);
    if(args.operation==='move')next=next.filter(stop=>stop.stopId!==args.stopId);
    const index=args.afterStopId===null?0:next.findIndex(stop=>stop.stopId===args.afterStopId)+1;
    next.splice(index,0,added);
  }
  if(!next.length||next.length>3)fail('An outing supports one to three visits; do not drop an existing stop to make room.');
  return next.map(stop=>({intent:stop.intent,placeId:stop.id}));
}
