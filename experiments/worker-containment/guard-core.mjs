// Shared by the executable probe and deterministic MOCK tests. Not production.
export async function armTarget(send,state,isFrozen){
 if(!['page','iframe','worker'].includes(state.type))throw Error(`unsupported target ${state.type}`);
 if(!state.paused)throw Error('target did not pause');
 await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true},state.id);
 await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]},state.id);
 state.ready=true;
 if(isFrozen())throw Error('created after freeze');
 await send('Runtime.runIfWaitingForDebugger',{},state.id);
 state.paused=false;
}
export async function allowFixtureRequest(request,state,isFrozen,origin,check=async()=>true){
 const url=new URL(request.url);
 if(isFrozen()||!state?.ready||request.method!=='GET'||url.origin!==origin)return false;
 const epoch=state.epoch||0;
 const checked=await check();
 // Critical post-await recheck. Production also needs real destination pinning.
 return checked&&!isFrozen()&&state.ready&&(state.epoch||0)===epoch;
}
export async function acknowledgeOffline(send,states){
 await Promise.all(states.filter(s=>s.ready).map(async s=>{
  await send('Network.enable',{},s.id);
  await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},s.id);
 }));
}

// Recheck synchronously at the exact send boundary, not only inside async policy.
export function dispatchRequest(send,requestId,sessionId,proposed,state,epoch,isFrozen){
 const allow=proposed&&!isFrozen()&&state?.ready&&(state.epoch||0)===epoch;
 return send(allow?'Fetch.continueRequest':'Fetch.failRequest',{requestId,...(allow?{}:{errorReason:'BlockedByClient'})},sessionId);
}
