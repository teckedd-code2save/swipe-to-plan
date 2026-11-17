// Read-only visual transport. Frames are screenshots, never remote-control URLs.
export async function startReservationScreencast(page,emit,{now=Date.now}={}){
 const cdp=await page.createCDPSession();let stopped=false,last=-Infinity,count=0,bytes=0;
 const frame=async event=>{
  try{
   if(!stopped&&typeof event.data==='string'&&event.data.length<=500000&&/^[A-Za-z0-9+/=]+$/.test(event.data)&&now()-last>=500&&count<90&&bytes+event.data.length<=8000000){
    last=now();count++;bytes+=event.data.length;emit({type:'frame',imageDataUrl:`data:image/jpeg;base64,${event.data}`});
   }
  }catch{/* Closed clients must not cause unhandled event rejections. */}finally{await cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});}
 };
 cdp.on('Page.screencastFrame',frame);
 try{await cdp.send('Page.startScreencast',{format:'jpeg',quality:55,maxWidth:1000,maxHeight:800,everyNthFrame:2});}
 catch(error){cdp.off('Page.screencastFrame',frame);await cdp.detach().catch(()=>{});throw error;}
 return async()=>{if(stopped)return;stopped=true;cdp.off('Page.screencastFrame',frame);await cdp.send('Page.stopScreencast').catch(()=>{});await cdp.detach().catch(()=>{});};
}
export function reservationTransport(req,res){
 const streamed=(req.get('accept')||'').includes('application/x-ndjson');
 const abort=new AbortController();let ended=false;
 const timer=setTimeout(()=>{if(!ended){abort.abort();res.destroy();}},60000);timer.unref?.();
 const close=()=>{clearTimeout(timer);if(!ended)abort.abort();};res.on('close',close);
 res.set({'Cache-Control':'no-store'});
 if(streamed){res.status(200).set({'Content-Type':'application/x-ndjson','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.flushHeaders();}
 const send=event=>{if(!streamed||ended||abort.signal.aborted||res.destroyed)return false;const line=JSON.stringify(event)+'\n';if(res.writableLength+Buffer.byteLength(line)>2000000){abort.abort();res.destroy();return false;}try{res.write(line);return true;}catch{abort.abort();res.destroy();return false;}};
 return {
  options:{signal:abort.signal,...(streamed?{emit:send}: {})},
  result:async(value,cleanup)=>{if(ended)return;if(abort.signal.aborted||res.destroyed){if(value?.previewId)await cleanup?.(value.previewId);return;}if(streamed&&!send({type:'result',result:value})){if(value?.previewId)await cleanup?.(value.previewId);return;}ended=true;clearTimeout(timer);res.off('close',close);if(streamed)res.end();else res.json(value);},
  error:value=>{if(ended||abort.signal.aborted||res.destroyed)return;if(streamed)send({type:'error',...value});ended=true;clearTimeout(timer);res.off('close',close);if(streamed)res.end();else res.status(422).json(value);}
 };
}
