// Offline protocol. No networking, credentials, live driver, or payment authority.
import {createHash,randomUUID} from 'node:crypto';
import {bookingSnapshot} from './booking-actions.js';
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const executionHash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const clone=value=>structuredClone(value);
const fail=message=>Object.assign(new Error(message),{status:409,code:'execution_conflict'});
const text=(v,max=2000)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const fields=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw fail('Unsupported execution fields.');};
const pending=new Set(['submission_pending','submitted_awaiting_response','submission_unknown','provider_confirmed']);
export function executionCapabilities(){return {
 calls:{enabled:false,mode:'manual_only',reason:'No live calling adapter is configured.'},
 messages:{enabled:false,mode:'unconfigured',reason:'Provider eligibility, recipient permission and total pricing need verification.'},
 reservations:{enabled:false,mode:'unconfigured',reason:'Venue execution and authenticated confirmation are not connected.'},
 payments:{enabled:false,mode:'unsupported',reason:'Payment approval and processing are separate and unavailable.'},
 approval:{enabled:false,reason:'Preparation and handoff review do not authorize sending, booking or spending.'},
};}
export function executionSnapshot(entry,input){
 fields(input,['stopId','itemId','entityId','operation','channel','message','personalData','cost','terms','expiresAt']);
 if(!['enquiry','reservation'].includes(input.operation)||!['phone','sms','whatsapp','website'].includes(input.channel))throw fail('Unsupported operation or channel. Payments are separate.');
 if(!text(input.message))throw fail('An exact message is required.');
 fields(input.personalData??{},['name','email','phone']);
 if(Object.values(input.personalData??{}).some(v=>!text(v,200)))throw fail('Check the exact personal data to share.');
 for(const key of ['stopId','itemId','entityId'])if(!text(input[key],200))throw fail('Select an exact venue occurrence and entity.');
 const p=bookingSnapshot(entry.plan,input),contact=p.contactEvidence[input.channel==='website'?'website':'phone'];
 let cost=null;
 if(input.cost!=null){
  fields(input.cost,['limitMinor','currency','evidence','effectiveAt','expiresAt','includesAllFees']);
  if(!Number.isSafeInteger(input.cost.limitMinor)||input.cost.limitMinor<0||!/^([A-Z]{3})$/.test(input.cost.currency)||!text(input.cost.evidence)||!Number.isSafeInteger(input.cost.effectiveAt)||!Number.isSafeInteger(input.cost.expiresAt)||input.cost.includesAllFees!==true)throw fail('A sourced total cost limit including all fees and currency is required. Unknown is not free.');
  cost=clone(input.cost);
 }
 if(input.terms!=null&&!text(input.terms,4000))throw fail('Check applicable terms and risk evidence.');
 if(!Number.isSafeInteger(input.expiresAt))throw fail('An exact approval expiry is required.');
 return {planId:entry.id,planRevision:entry.revision,venue:{stopId:p.stopId,itemId:p.itemId,entityId:p.entityId,name:p.name,address:p.address},contact:{channel:input.channel,destination:input.channel==='website'?contact.url:contact.dialUrl,source:clone(contact.source),ownership:contact.ownership},date:p.date,localTime:p.localTime,timeZone:p.timeZone,party:clone(p.party),operation:input.operation,message:input.message,personalData:clone(input.personalData??{}),cost,terms:input.terms??null,expiresAt:input.expiresAt};
}
function visitInstant(s){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s.date||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.localTime||'')||!s.timeZone)return null;
 const base=Date.parse(`${s.date}T${s.localTime}:00Z`);if(!Number.isFinite(base)||new Date(base).toISOString().slice(0,10)!==s.date)return null;
 let f;try{f=new Intl.DateTimeFormat('en-CA',{timeZone:s.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});}catch{return null;}
 const matches=[];for(let offset=-840;offset<=840;offset+=15){const at=base+offset*60000,p=Object.fromEntries(f.formatToParts(at).map(x=>[x.type,x.value]));if(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`===`${s.date}T${s.localTime}`)matches.push(at);}
 return matches.length===1?matches[0]:null;
}
// Provider descriptor evidence is trusted server configuration, not user/model
// assertions. Published contacts establish neither recipient permission nor cost.
export function executionBlockers(s,{now=Date.now(),descriptor=null}={}){
 const reasons=['live_execution_disabled'];
 if(!s.contact.destination)reasons.push('recipient_missing');
 if(!s.contact.destination||!s.contact.source.provider||s.contact.source.entityId!==s.venue.entityId||s.contact.ownership!=='verified')reasons.push('recipient_not_verified');
 if(!s.cost)reasons.push('cost_unknown');
 else if(s.cost.effectiveAt>now||s.cost.expiresAt<=now)reasons.push('cost_evidence_expired');
 if(!s.terms)reasons.push('terms_unreviewed');
 const visit=visitInstant(s);if(!visit||visit<=now)reasons.push('visit_time_invalid');
 if(!Number.isSafeInteger(s.party.adults)||s.party.adults<1||!Number.isSafeInteger(s.party.children)||s.party.children<0)reasons.push('party_invalid');
 if(s.expiresAt<=now)reasons.push('approval_expired');
 if(!descriptor?.id||descriptor.policy?.status!=='eligible'||!text(descriptor.policy?.evidence)||descriptor.policy?.expiresAt<=now||!Number.isSafeInteger(descriptor.policy?.expiresAt))reasons.push('provider_policy_unknown');
 const permission=descriptor?.recipientPermission;
 if(!permission||permission.status!=='granted'||permission.destination!==s.contact.destination||permission.channel!==s.contact.channel||permission.sender!==descriptor?.sender||!text(permission.sender,200)||!text(permission.evidence)||!Number.isSafeInteger(permission.expiresAt)||permission.expiresAt<=now)reasons.push('recipient_permission_unknown');
 if(s.contact.channel==='phone'&&permission?.callPermission!==true)reasons.push('call_permission_unknown');
 if(!descriptor?.pricing||descriptor.pricing.snapshotCostHash!==executionHash(s.cost)||descriptor.pricing.status!=='verified'||!text(descriptor.pricing.evidence)||!Number.isSafeInteger(descriptor.pricing.expiresAt)||descriptor.pricing.expiresAt<=now)reasons.push('total_price_unverified');
 if(!descriptor?.channels?.includes(s.contact.channel)||!descriptor?.operations?.includes(s.operation))reasons.push('operation_unsupported');
 // A customer mandate never opens a venue service window. A future adapter must
 // independently verify the selected message category/window and template rules.
 if(s.contact.channel==='whatsapp'&&(descriptor?.messagePolicy?.status!=='eligible'||descriptor.messagePolicy.destination!==s.contact.destination||descriptor.messagePolicy.sender!==descriptor.sender||!text(descriptor.messagePolicy.evidence)||!Number.isSafeInteger(descriptor.messagePolicy.expiresAt)||descriptor.messagePolicy.expiresAt<=now))reasons.push('message_policy_unknown');
 return reasons;
}
export function invalidateExecution(entry){
 for(const r of entry.executionLedger?.records||[]){if(r.stale)continue;r.stale=true;r.version++;r.approval=null;if(r.status==='provider_confirmed'){r.status='submission_unknown';r.reconciliationRequired='The plan changed after provider confirmation. Resolve the historical reservation before any replacement.';}else if(!pending.has(r.status))r.status='cancelled';}
}
function current(entry,r,now){
 if(r.stale||r.snapshot.planId!==entry.id||r.snapshot.planRevision!==entry.revision||r.snapshot.expiresAt<=now||executionHash(r.snapshot)!==r.hash)throw fail('Execution details changed or expired. Prepare a new action.');
 const s=r.snapshot,input={stopId:s.venue.stopId,itemId:s.venue.itemId,entityId:s.venue.entityId,operation:s.operation,channel:s.contact.channel,message:s.message,personalData:s.personalData,cost:s.cost,terms:s.terms,expiresAt:s.expiresAt};
 if(executionHash(executionSnapshot(entry,input))!==r.hash)throw fail('Execution source or plan changed. Prepare a new action.');
}
// Mutations MUST run in the account transaction. A simulation outbox never grants
// live authority. verifyEvidence is injected trusted code, never a request field.
// No adapter is called here; future live dispatch requires a separately reviewed driver.
export function createExecutionProtocol({now=Date.now,simulation=false,verifyEvidence=()=>false}={}){
 return function apply(entry,ownerId,operation,body={},id=null){
  if(!text(ownerId,200))throw fail('Authenticated account ownership is required.');
  if(operation==='list')return clone((entry.executionLedger?.records||[]).filter(r=>r.ownerId===ownerId));
  fields(body,['key','version','hash','snapshot','event']);if(!text(body.key,100))throw fail('A scoped idempotency key is required.');
  const state=entry.executionLedger??={records:[],requests:[]},requestHash=executionHash({ownerId,planId:entry.id,operation,body,id});
  const previous=state.requests.find(x=>x.key===body.key);
  if(previous){const r=state.records.find(x=>x.id===previous.id);if(previous.hash!==requestHash||!r||r.version!==previous.version)throw fail('Request replay conflicts with the current action.');return clone(r);}
  const safetyOperation=['revoke','recover'].includes(operation)||operation==='reconcile'&&['confirmed','rejected','cancelled'].includes(body.event?.outcome);
  if(state.requests.length>=500&&!safetyOperation||state.records.length>=50&&operation==='prepare')throw fail('Execution history limit reached.');
  let r=state.records.find(x=>x.id===id&&x.ownerId===ownerId);
  if(operation==='prepare'){
   const snapshot=executionSnapshot(entry,body.snapshot);if(snapshot.expiresAt<=now())throw fail('Approval expiry must be in the future.');
   if(state.records.some(x=>(x.snapshot.venue.stopId===snapshot.venue.stopId||x.snapshot.venue.entityId===snapshot.venue.entityId)&&pending.has(x.status)))throw fail('Reconcile the existing venue action before preparing another channel.');
   r={id:randomUUID(),ownerId,version:1,snapshot,hash:executionHash(snapshot),status:'prepared',stale:false,approval:null,outbox:null,evidence:[],userReport:null,authorityScope:simulation?'simulation_only':'disabled',createdAt:now()};state.records.push(r);
  }else{
   if(!r)throw Object.assign(fail('Execution not found.'),{status:404});
   if(body.version!==r.version||body.hash!==r.hash)throw fail('Review the current action version and hash.');
   if(operation==='revoke'){
    if(r.status==='cancelled')throw fail('This action is already cancelled.');
    if(pending.has(r.status))throw fail('Submission may already have occurred. Reconcile before cancellation.');
    r.approval=null;r.status='cancelled';r.stale=true;
   }else if(operation==='recover'){
    if(r.status!=='submission_pending')throw fail('Only an interrupted submission can be marked unknown.');r.status='submission_unknown';r.approval=null;
   }else if(operation==='reconcile'){
    const e=body.event;fields(e,['eventId','actionId','idempotencyKey','snapshotHash','outcome','venue','date','localTime','timeZone','party','provider','reference','occurredAt']);
    const terminal=['rejected','cancelled'].includes(r.status);
    if(!pending.has(r.status)&&!terminal||!r.outbox||!text(e.eventId,200)||!text(e.provider,200)||!text(e.reference,500)||!['accepted','confirmed','rejected','cancelled'].includes(e.outcome)||!Number.isSafeInteger(e.occurredAt)||e.occurredAt<r.outbox.createdAt||e.occurredAt>now())throw fail('Invalid provider evidence.');
    const s=r.snapshot;
    if(executionHash(s)!==r.hash||e.actionId!==r.id||e.idempotencyKey!==r.outbox.key||e.snapshotHash!==r.hash||canonical(e.venue)!==canonical(s.venue)||e.date!==s.date||e.localTime!==s.localTime||e.timeZone!==s.timeZone||canonical(e.party)!==canonical(s.party)||verifyEvidence(clone(e),clone(r.outbox))!==true)throw fail('Provider evidence is not authenticated or does not match the action.');
    if(r.evidence.some(x=>x.provider===e.provider&&x.eventId===e.eventId))throw fail('Provider event already reconciled.');
    if(terminal&&e.outcome!=='confirmed')throw fail('Terminal provider state requires manual reconciliation.');
    const resolvedHistoricalConfirmation=r.status==='cancelled'&&r.evidence.some(x=>x.outcome==='cancelled'&&x.occurredAt>e.occurredAt);
    const outOfOrder=r.evidence.some(x=>x.occurredAt>e.occurredAt),alreadyConfirmed=r.status==='provider_confirmed';
    if(alreadyConfirmed&&!['cancelled','confirmed'].includes(e.outcome)||outOfOrder&&e.outcome!=='confirmed')throw fail('Out-of-order provider evidence requires manual reconciliation.');
    let late=false;
    if(e.outcome==='confirmed'){try{current(entry,r,now());}catch{late=true;}}
    // A real external fact cannot be erased by a later edit or expired mandate.
    // Keep the exact historical evidence, never confirm the current plan, and
    // retain the duplicate-send block until explicit provider reconciliation.
    r.evidence.push(clone(e));
    r.status=resolvedHistoricalConfirmation?'cancelled':terminal||late||outOfOrder?(alreadyConfirmed&&!r.stale?'provider_confirmed':'submission_unknown'):({accepted:'submitted_awaiting_response',confirmed:'provider_confirmed',rejected:'rejected',cancelled:'cancelled'})[e.outcome];
    if(e.outcome==='cancelled'||e.outcome==='rejected')delete r.reconciliationRequired;
    if((terminal||late||outOfOrder)&&!resolvedHistoricalConfirmation)r.reconciliationRequired='Provider confirmed an older, expired or out-of-order action. Resolve the external reservation before any replacement.';
    r.approval=null;
   }else{
    current(entry,r,now());
    if(!simulation||r.authorityScope!=='simulation_only')throw fail('Live execution and approval are disabled.');
    // Simulations exercise the protocol only. Missing total price/terms/time is
    // never silently approved, even for fake adapters. All real gates stay closed.
    const missing=executionBlockers(r.snapshot,{now:now()}).filter(x=>!['live_execution_disabled','recipient_not_verified','provider_policy_unknown','recipient_permission_unknown','call_permission_unknown','total_price_unverified','operation_unsupported','message_policy_unknown'].includes(x));
    if(missing.length)throw fail('Execution details need review.');
    if(operation==='review'&&r.status==='prepared')r.status='awaiting_review';
    else if(operation==='approve'&&r.status==='awaiting_review'){r.status='approved';r.approval={ownerId,version:r.version+1,hash:r.hash,expiresAt:r.snapshot.expiresAt,scope:'simulation_only',approvedAt:now()};}
    else if(operation==='reserve'&&r.status==='approved'){
     if(!r.approval||r.approval.ownerId!==ownerId||r.approval.hash!==r.hash||r.approval.version!==r.version||r.approval.expiresAt<=now())throw fail('Approval no longer authorizes this action.');
     if(state.records.some(x=>x.id!==r.id&&(x.snapshot.venue.stopId===r.snapshot.venue.stopId||x.snapshot.venue.entityId===r.snapshot.venue.entityId)&&pending.has(x.status)))throw fail('Another action for this venue needs reconciliation.');
     r.outbox={key:executionHash({ownerId,planId:entry.id,actionId:r.id,hash:r.hash}),actionId:r.id,snapshotHash:r.hash,createdAt:now(),payload:clone(r.snapshot),scope:'simulation_only'};r.status='submission_pending';
    }else throw fail('Unsupported execution transition.');
   }
   r.version++;
  }
  state.requests.push({key:body.key,hash:requestHash,id:r.id,version:r.version,operation,at:now()});return clone(r);
 };
}
