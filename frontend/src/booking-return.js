// Capture a visit occurrence, never its old form, message, or personal fields.
export const timingReturnKey=request=>JSON.stringify([request?.date,request?.startTime,request?.endTime,request?.timing]);
export function resolveBookingReturn(target,plan,context){
 if(!target||target.account!==context.account||target.epoch!==context.epoch||target.version!==context.version||target.timing!==timingReturnKey(plan?.request))return null;
 return plan?.stops?.find(stop=>stop.id===target.stopId&&stop.item?.id===target.itemId&&stop.item?.entityId===target.entityId)||null;
}
