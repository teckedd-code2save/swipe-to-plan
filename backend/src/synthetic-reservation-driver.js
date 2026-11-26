// Internal test-only coordinator for a future authorized provider adapter.
// Deliberately not mounted on HTTP or imported by the production entry point.
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {createExecutionProtocol,executionHash} from './execution-ledger.js';

const syntheticProvider='synthetic-reservation-v1';
const blocking=new Set(['submission_pending','submission_unknown','submitted_awaiting_response','provider_confirmed']);
const fail=message=>Object.assign(Error(message),{status:409,code:'execution_conflict'});
const command=(record,key,extra={})=>({key,version:record.version,hash:record.hash,...extra});
const fakeRecipient = record => {
  try{
    const contact=record.snapshot.contact,url=new URL(contact.destination);
    return record.snapshot.operation==='reservation'&&contact.channel==='website'&&url.protocol==='https:'&&url.hostname.endsWith('.example');
  }catch{return false;}
};

export function createSyntheticReservationDriver({store,now=Date.now,outcome='accepted'}={}){
  if(!store?.transact||!store?.read||!['accepted','confirmed','ambiguous'].includes(outcome))throw fail('Configure a supported synthetic reservation outcome.');
  const secret=randomBytes(32);
  const sign=event=>createHmac('sha256',secret).update(executionHash(event)).digest();
  const apply=createExecutionProtocol({now,simulation:true});
  // Owner and plan IDs come only from the trusted test harness. Future HTTP
  // authorization would need its own reviewed integration, not these methods.
  function plan(data,ownerId,planId){
    const owner=Object.hasOwn(data.users,ownerId)?data.users[ownerId]:null;
    if(!owner||!Object.hasOwn(owner.savedPlans||{},planId))throw fail('Execution not found.');
    return {owner,entry:owner.savedPlans[planId]};
  }
  function current(entry,ownerId,id){
    const record=apply(entry,ownerId,'list').find(item=>item.id===id);
    if(!record)throw fail('Execution not found.');
    if(record.authorityScope!=='simulation_only'||!fakeRecipient(record))throw fail('Only an isolated synthetic reservation recipient is supported.');
    return record;
  }
  function exact(record,input){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['key','version','hash'].includes(k))||typeof input.key!=='string'||input.key.trim()!==input.key||!/^[a-zA-Z0-9_-]{1,48}$/.test(input.key)||input.version!==record.version||input.hash!==record.hash)throw fail('Review the current action details before submitting.');
  }
  function duplicate(owner,entry,id,entityId){
    return Object.values(owner.savedPlans).some(p=>p.executionLedger?.records.some(a=>(
      p.id!==entry.id||a.id!==id
    )&&a.snapshot.venue.entityId===entityId&&blocking.has(a.status)));
  }
  function receipt(record,result){
    const s=record.snapshot,event={eventId:executionHash({claim:record.outbox.claim.id,outcome:result}),actionId:record.id,idempotencyKey:record.outbox.key,snapshotHash:record.hash,
      provider:syntheticProvider,reference:'SIMULATION-'+record.outbox.claim.id,outcome:result,
      venue:s.venue,date:s.date,localTime:s.localTime,timeZone:s.timeZone,party:s.party,occurredAt:now()};
    return {event,signature:sign(event).toString('hex')};
  }
  async function applyReceipt(ownerId,planId,id,envelope){
    const {event,signature}=envelope||{};
    if(!event||typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(sign(event),Buffer.from(signature,'hex')))throw fail('Unauthenticated synthetic receipt.');
    return store.transact(data=>{
      const {entry}=plan(data,ownerId,planId),r=current(entry,ownerId,id);
      const claim=r.outbox?.claim;
      if(!claim||event.provider!==syntheticProvider||event.reference!=='SIMULATION-'+claim.id||event.occurredAt<claim.claimedAt)throw fail('Synthetic receipt does not match the claimed submission.');
      const verified=createExecutionProtocol({now,simulation:true,verifyEvidence:candidate=>executionHash(candidate)===executionHash(event)});
      return verified(entry,ownerId,'reconcile',command(r,'receipt-'+event.eventId,{event}),id);
    });
  }
  const read=(ownerId,planId,id)=>store.read(data=>current(plan(data,ownerId,planId).entry,ownerId,id));
  return {
    async change(ownerId,planId,operation,body,id=null){
      if(!['prepare','review','approve','revoke','recover'].includes(operation))throw fail('Unsupported synthetic action.');
      return store.transact(data=>{
        const {entry}=plan(data,ownerId,planId);
        if(operation!=='prepare')current(entry,ownerId,id);
        const r=apply(entry,ownerId,operation,body,id);
        if(!fakeRecipient(r))throw fail('Only an isolated synthetic reservation recipient is supported.');
        return r;
      });
    },
    read,
    async dispatch(ownerId,planId,id,input){
      // Confirm/version + reserve + claim in one durable commit, before the
      // adapter receives data. Repeat requests cannot acquire a fresh claim.
      const claimed=await store.transact(data=>{
        const {owner,entry}=plan(data,ownerId,planId),r=current(entry,ownerId,id);
        exact(r,input);
        if(duplicate(owner,entry,id,r.snapshot.venue.entityId))throw fail('Reconcile the existing venue action before another submission.');
        const pending=apply(entry,ownerId,'reserve',command(r,'reserve:'+input.key),id);
        return apply(entry,ownerId,'claim',command(pending,'claim:'+input.key),id);
      });
      try{
        // No HTTP, no recipient contact and no external side effects. An
        // ambiguous simulation covers a timeout after a provider may have acted.
        if(outcome==='ambiguous')throw fail('Synthetic provider response was uncertain.');
        return {simulationOnly:true,record:await applyReceipt(ownerId,planId,id,receipt(claimed,outcome))};
      }catch{
        try{
          const record=await store.transact(data=>{
            const {entry}=plan(data,ownerId,planId),r=current(entry,ownerId,id);
            if(r.status!=='submission_pending')return r;
            return apply(entry,ownerId,'recover',command(r,'recover:'+input.key),id);
          });
          return {simulationOnly:true,record};
        }catch{
          // If storage acknowledgement fails after a claim, never retry the
          // adapter or invent a terminal outcome. Durable state needs review.
          throw fail('Synthetic receipt could not be recorded. Reconcile the existing action before retrying.');
        }
      }
    },
    // Synthetic follow-up is deliberately not public API. It exercises an
    // authenticated provider-confirmation event independently of send/accept.
    async confirmAccepted(ownerId,planId,id){
      const r=await read(ownerId,planId,id);
      if(r.status!=='submitted_awaiting_response'||!r.outbox?.claim)throw fail('No accepted synthetic request to confirm.');
      return {simulationOnly:true,record:await applyReceipt(ownerId,planId,id,receipt(r,'confirmed'))};
    },
    applyReceipt
  };
}
