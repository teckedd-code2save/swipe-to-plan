export async function readPlanStream(response,onDiscovery){
  if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||`Couldn’t update the places (${response.status}).`);}
  if(!response.headers.get('content-type')?.includes('application/x-ndjson'))return response.json();
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result;
  function consume(line){if(!line.trim())return;const event=JSON.parse(line);if(event.type==='discovery')onDiscovery?.(event.plan);else if(event.type==='complete')result=event.plan;else if(event.type==='error')throw new Error(event.error||'The review could not finish. Your places are still here.');}
  while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let end;while((end=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,end));buffer=buffer.slice(end+1);}if(done)break;}
  if(buffer.trim())consume(buffer);if(!result)throw new Error('The review was interrupted. Your places are still here.');return result;
}
