const stages=new Set(['waiting','connecting','loading','inspecting','freezing','filling','ready']);
export function reservationStreamEvent(event){
 if(event?.type==='progress'&&stages.has(event.stage))return {type:'progress',stage:event.stage};
 if(event?.type==='frame'&&typeof event.imageDataUrl==='string'&&event.imageDataUrl.length<=12000000&&/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(event.imageDataUrl))return {type:'frame',imageDataUrl:event.imageDataUrl};
 throw Error('Invalid browser progress response.');
}
export async function readReservationStream(response,onEvent){
 if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(typeof body.error==='string'?body.error.slice(0,500):`Could not open the booking form (${response.status}).`);}
 if(!response.headers.get('content-type')?.includes('application/x-ndjson'))return response.json();
 if(!response.body)throw Error('Browser preview stream unavailable.');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result,received=false,count=0,total=0;
 function consume(line){
  if(!line.trim())return;
  if(++count>400)throw Error('Browser preview exceeded its progress limit.');
  const event=JSON.parse(line);
  if(received)throw Error('Unexpected data after browser result.');
  if(event.type==='error')throw Object.assign(Error(typeof event.error==='string'?event.error.slice(0,500):'The browser preview could not finish.'),{code:event.code});
  if(event.type==='result'){if(!event.result||typeof event.result!=='object')throw Error('Invalid browser result.');result=event.result;received=true;return;}
  onEvent?.(reservationStreamEvent(event));
 }
 try{
  while(true){const {value,done}=await reader.read();total+=value?.byteLength||0;if(total>100000000)throw Error('Browser preview exceeded its size limit.');buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let end;while((end=buffer.indexOf('\n'))>=0){if(end>14000000)throw Error('Browser preview frame too large.');consume(buffer.slice(0,end));buffer=buffer.slice(end+1);}if(buffer.length>14000000)throw Error('Browser preview frame too large.');if(done)break;}
  if(buffer.trim())consume(buffer);if(!received)throw Error('Browser preview was interrupted. Try again.');return result;
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
