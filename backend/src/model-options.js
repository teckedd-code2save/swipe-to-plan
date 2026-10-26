// Provider-specific request fields stay server-side and apply to every model call.
export function modelOptions(model,baseUrl){
  const origin=new URL(baseUrl).origin;
  if(origin==='https://api.deepseek.com')return {thinking:{type:'disabled'}};
  if(origin==='https://generativelanguage.googleapis.com'&&model==='gemini-3.5-flash-lite')return {reasoning_effort:'minimal'};
  return {};
}
