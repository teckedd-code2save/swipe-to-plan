import {useEffect,useRef,useState} from 'react';
import {api} from './api.js';
export default function useBookingActions(scope) {
  const [records,setRecords]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[blocked,setBlocked]=useState(false);
  const generation=useRef(0),controller=useRef(null),mounted=useRef(true),locked=useRef(false);
  const durable=scope.allowed&&scope.type!=='guest';
  useEffect(()=>{
    mounted.current=true;
    const abort=new AbortController(),version=++generation.current;controller.current=abort;
    if(durable){setBusy(true);api.bookings(scope,abort.signal).then(result=>{if(mounted.current&&version===generation.current&&!abort.signal.aborted)setRecords(result.bookings);}).catch(e=>{if(!abort.signal.aborted&&mounted.current&&version===generation.current){setBlocked(true);setError(`Could not load private tracking. Close and reopen this panel before preparing details. ${e.message}`);}}).finally(()=>{if(mounted.current&&version===generation.current)setBusy(false);});}
    return()=>{mounted.current=false;generation.current++;controller.current?.abort();};
  },[]);
  async function mutate(method,record,body) {
    if(!mounted.current||!durable||busy||blocked||locked.current)return null;
    locked.current=true;
    controller.current?.abort();const abort=new AbortController();controller.current=abort;const version=++generation.current;
    setBusy(true);setError('');
    try{
      const payload={planRevision:scope.planRevision,...(record?{bookingVersion:record.bookingVersion}:{}),idempotencyKey:crypto.randomUUID(),...body};
      const result=record?await api[method](scope,record.id,payload,abort.signal):await api[method](scope,payload,abort.signal);
      if(!mounted.current||version!==generation.current||abort.signal.aborted)return null;
      setRecords(items=>[result.booking,...items.filter(item=>item.id!==result.booking.id)]);return result.booking;
    }catch(e){if(mounted.current&&version===generation.current&&!abort.signal.aborted){setBlocked(true);setError(`Could not confirm whether the change was saved. Close and reopen this panel to reload private tracking before trying again. ${e.message}`);}return null;}
    finally{locked.current=false;if(mounted.current&&version===generation.current)setBusy(false);}
  }
  return {records,busy,blocked,error,durable,mutate};
}
