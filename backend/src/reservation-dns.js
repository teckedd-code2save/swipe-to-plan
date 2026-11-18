import {lookup} from 'node:dns/promises';
import {setTimeout as waitFor} from 'node:timers/promises';
const failures=new WeakMap();
export const reservationGuardFailure=page=>failures.get(page);
export function recordReservationGuardFailure(page,code){if(code)failures.set(page,code);else failures.delete(page);}
// Retry only transient resolver failure, using the same resolver and security
// policy. The entire lookup (including retry) remains bounded to eight seconds.
export async function resolveReservationHost(host,{resolve=lookup,signal,wait=waitFor,timeoutMs=8000}={}){
 let timer,onAbort,finished=false;
 const work=(async()=>{
  for(let attempt=0;attempt<2;attempt++){
   if(finished)throw Object.assign(Error('DNS timeout'),{code:'DNS_TIMEOUT'});
   signal?.throwIfAborted();
   try{return await resolve(host,{all:true});}
   catch(error){if(finished||error?.code!=='EAI_AGAIN'||attempt)throw error;await wait(300,undefined,{signal});}
  }
 })();
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('DNS timeout'),{code:'DNS_TIMEOUT'})),timeoutMs);});
 const cancelled=new Promise((_,reject)=>{onAbort=()=>reject(signal.reason||Object.assign(Error('Cancelled'),{name:'AbortError'}));if(signal?.aborted)onAbort();else signal?.addEventListener('abort',onAbort,{once:true});});
 try{return await Promise.race([work,timeout,cancelled]);}
 finally{finished=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}
