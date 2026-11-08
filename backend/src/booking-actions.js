import {contactForItem} from '../../shared/venue-contact.js';
// Lifecycle concepts selectively adapted from Outing Actions (MIT), revision 16b1c63.
// Copyright (c) 2026 Outing Actions contributors; see ../licenses/outing-actions-MIT.txt.
// Deliberately no provider adapter, network submission or authority to spend/send.
import {randomUUID,createHash} from 'node:crypto';
import {InputError} from './contract.js';
const fail=(message,status=409)=>Object.assign(new Error(message),{status,code:'booking_conflict'});
const fields=(body,allowed)=>{if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))throw new InputError('Unsupported booking fields.');};
const text=(value,max)=>{if(typeof value!=='string'||value.length>max||/[\x00-\x1f\x7f<>]/.test(value))throw new InputError('Check the booking text.');return value.trim();};
const message=value=>{if(typeof value!=='string'||value.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw new InputError('Message must be at most 2000 characters without unsafe control characters.');return value;};
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
// Evidence timestamps describe retrieval, not a change in the approved destination.
// Legacy snapshots without visit roles remain readable; their first revalidation
// conservatively requires fresh preparation instead of guessing old purpose.
const snapshotDigest = snapshot => { const {contactEvidence, ...identity} = snapshot; return digest(identity); };
export function bookingSnapshot(plan,selection){
  const stop=plan?.stops?.find(s=>s.id===selection.stopId);
  if(!stop?.item||stop.item.id!==selection.itemId||stop.item.entityId!==selection.entityId)throw fail('The selected place changed. Review the current day.');
  const contact = contactForItem(stop.item);
  return {stopId:stop.id,intent:stop.intent??null,itemId:stop.item.id,entityId:stop.item.entityId,name:stop.item.name,address:stop.item.address||null,
    orderedStops:plan.stops.map(s=>({stopId:s.id,intent:s.intent??null,itemId:s.item?.id??null,entityId:s.item?.entityId??null})),
    date:plan.request?.timing?.dateConfirmed===true?plan.request.date:null,localTime:plan.request?.timing?.timeConfirmed===true?stop.start||null:null,endTime:stop.end||null,timeZone:plan.timeZone||null,
    timing:structuredClone(plan.request?.timing||{dateConfirmed:false,timeConfirmed:false}),
    party:structuredClone(plan.request?.party||{}),contacts:{website:contact.website.url,phone:contact.phone.dialUrl},contactEvidence:contact};
}
function reservation(snapshot,now){
  const {date,localTime,timeZone,party}=snapshot;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime||'')||!timeZone)throw new InputError('Choose a date, local time and destination time zone before preparing a reservation.');
  const base=Date.parse(`${date}T${localTime}:00Z`);
  if(!Number.isFinite(base)||new Date(base).toISOString().slice(0,10)!==date)throw new InputError('Choose a real visit date.');
  let formatter;try{formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});}catch{throw new InputError('Choose a valid destination time zone.');}
  const matches=[];
  for(let offset=-14*60;offset<=14*60;offset+=15){const instant=base+offset*60000,p=Object.fromEntries(formatter.formatToParts(instant).map(x=>[x.type,x.value]));if(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`===`${date}T${localTime}`)matches.push(instant);}
  if(matches.length!==1)throw new InputError('This local time is missing or ambiguous during a clock change. Choose another time.');
  if(matches[0]<=now())throw new InputError('Choose a future visit time.');
  if(!Number.isInteger(party.adults)||party.adults<1||!Number.isInteger(party.children)||party.children<0||party.adults>100||party.children>100)throw new InputError('Check the party size.');
}
// Called inside the same transaction as any plan edit. Staleness is sticky across undo.
export function invalidateBookings(entry,plan=entry.plan){
  for(const record of entry.bookingActions?.records||[]){
    let changed=true;try{changed=snapshotDigest(bookingSnapshot(plan,record.snapshot))!==record.snapshotHash;}catch{/* Removed/replaced occurrence. */}
    if(changed&&!record.stale){record.stale=true;if(record.userReport)record.userReport.stale=true;record.handoff=null;record.bookingVersion++;if(!record.userReport)record.status='draft';}
  }
}
export function bookingOperation(entry,operation,body={},id=null,{now=Date.now,revision=entry.revision,ready=true}={}){
  if(operation==='list')return {planRevision:revision,bookings:structuredClone(entry.bookingActions?.records||[])};
  const common=['planRevision','idempotencyKey'];
  fields(body,[...common,...(operation==='create'?['stopId','itemId','entityId','kind','notes']:['bookingVersion']),...(operation==='patch'?['kind','notes']:[]),...(operation==='handoff'?['channel','reviewed']:[]),...(operation==='report'?['outcome','reference']:[])]);
  const key=text(body.idempotencyKey,100);if(!key)throw new InputError('An idempotency key is required.');
  const state=entry.bookingActions??={records:[],requests:[]},hash=digest({operation,id,body});
  const previous=state.requests.find(r=>r.key===key);
  if(previous){if(previous.hash!==hash)throw fail('This request key was used for different booking details.');const current=state.records.find(r=>r.id===previous.bookingId);if(!current||current.bookingVersion!==previous.bookingVersion)throw fail('This booking changed after that request. Reload it.');return {planRevision:previous.planRevision,booking:structuredClone(current)};}
  if(!ready||!Number.isSafeInteger(body.planRevision)||body.planRevision!==revision)throw fail('The day changed. Reload it before preparing a booking.');
  let record,changed=true;
  if(operation==='create'){
    if(state.records.length>=50||state.requests.length>=500)throw fail('This day has reached its booking tracking limit.');
    for(const field of ['stopId','itemId','entityId'])if(!text(body[field],200))throw new InputError('Select a current place.');
    const snapshot=bookingSnapshot(entry.plan,body);
    record={id:randomUUID(),bookingVersion:1,kind:body.kind,notes:message(body.notes??''),snapshot,snapshotHash:snapshotDigest(snapshot),stale:false,status:'draft',handoff:null,userReport:null,verifiedByService:false,submission:{status:'not_submitted',provider:null},payment:{status:'not_requested'},createdAt:new Date(now()).toISOString()};
    state.records.push(record);
  }else{
    record=state.records.find(r=>r.id===id);if(!record)throw fail('Booking not found.',404);
    if(!Number.isSafeInteger(body.bookingVersion)||body.bookingVersion!==record.bookingVersion)throw fail('This booking changed. Reload it before continuing.');
    if(state.requests.length>=500)throw fail('This day has reached its booking tracking limit.');
    if(operation==='patch'){
      const snapshot=bookingSnapshot(entry.plan,record.snapshot),snapshotHash=snapshotDigest(snapshot);
      const kind=body.kind===undefined?record.kind:body.kind,notes=body.notes===undefined?record.notes:message(body.notes);
      changed=record.stale||snapshotHash!==record.snapshotHash||kind!==record.kind||notes!==record.notes;
      if(changed){
        Object.assign(record,{snapshot,snapshotHash,kind,notes,stale:false,handoff:null,status:'draft'});
        if(record.userReport)record.userReport.stale=true;
      }
    }else if(operation==='handoff'){
      if(record.stale)throw fail('Review the changed booking details first.');
      if(body.reviewed!==true||!['copy','website','phone'].includes(body.channel))throw new InputError('Review the details and choose how you will contact the venue.');
      const safeContact=contactForItem({entityId:record.snapshot.entityId,links:record.snapshot.contacts});
      if(body.channel==='phone'&&!safeContact.phone.dialUrl || body.channel==='website'&&!safeContact.website.url)throw new InputError('No sourced contact is available for that channel.');
      record.handoff={channel:body.channel,reviewedAt:new Date(now()).toISOString(),scope:'user_contact_only',bookingVersion:record.bookingVersion+1,snapshotHash:record.snapshotHash,messageHash:digest(record.notes)};record.status=record.userReport&&!record.userReport.stale?`user_reported_${record.userReport.outcome}`:'ready_for_contact';
    }else if(operation==='report'){
      if(!['awaiting_reply','confirmed','unavailable','cancelled'].includes(body.outcome))throw new InputError('Choose a supported user-reported outcome.');
      if(record.userReport){record.reportHistory??=[];if(record.reportHistory.length>=50)throw fail('This booking has reached its report history limit.');record.reportHistory.push(record.userReport);}
      record.userReport={outcome:body.outcome,stale:record.stale,snapshot:structuredClone(record.snapshot),notes:record.notes,bookingVersion:record.bookingVersion+1,reference:text(body.reference??'',160),reportedAt:new Date(now()).toISOString()};record.status=`user_reported_${body.outcome}`;
    }else throw new InputError('Unsupported booking operation.');
    if(changed)record.bookingVersion++;
  }
  if(!['enquiry','reservation'].includes(record.kind))throw new InputError('Choose enquiry or reservation.');
  if(changed&&record.kind==='reservation'&&operation!=='report')reservation(record.snapshot,now);
  if(changed)record.updatedAt=new Date(now()).toISOString();
  const result={planRevision:revision,booking:structuredClone(record)};
  state.requests.push({key,hash,bookingId:record.id,bookingVersion:record.bookingVersion,planRevision:revision});return result;
}
