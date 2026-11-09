import {randomUUID} from 'node:crypto';
import {InputError} from './contract.js';
import {validInvitationEpoch} from './invitation-epoch.js';

const fail=(message='Invitation not found.',status=404)=>Object.assign(new Error(message),{status,code:'invitation_error'});
const fields=(body,allowed)=>{if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!allowed.includes(key)))throw new InputError('Check the invitation request.');};
const active=record=>['pending','interested','going'].includes(record.status);
const accepted=record=>['interested','going'].includes(record.status);
const member=(circle,id)=>circle?.members?.some(m=>m.userId===id);
const connected=(data,ownerId,recipientId)=>ownerId!==recipientId&&Object.hasOwn(data.users,recipientId)&&Object.values(data.circles).some(c=>member(c,ownerId)&&member(c,recipientId));
const ownEntry=(user,id)=>{if(!Object.hasOwn(user.savedPlans||{},id))throw fail();return user.savedPlans[id];};
const allRecords=data=>Object.values(data.planInvitations||{});
const records=(data,ownerId,planId)=>allRecords(data).filter(record=>record.ownerId===ownerId&&record.planId===planId);
const live=(data,record,epoch)=>{const owner=data.users[record.ownerId],entry=Object.hasOwn(owner?.savedPlans||{},record.planId)?owner.savedPlans[record.planId]:null;return validInvitationEpoch(epoch)&&record.epoch===epoch&&!!entry&&entry.planInvitationGeneration===record.generation&&entry.revision>=record.revision;};
const effective=(data,record,epoch)=>live(data,record,epoch)?record:{...record,status:'unavailable',...(priorResponse(record)?{previousResponse:priorResponse(record)}:{})};
const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';
const priorResponse=record=>record&&['interested','going','declined','left'].includes(record.status)?{revision:record.revision,status:record.status,respondedAt:record.respondedAt}:record?.previousResponse;

// Explicit allowlist. No request, party/member identities, profiles, explanations,
// taste graphs, budgets, free-form warnings, booking/contact records, or links.
// A new field on a saved plan must NEVER automatically become invitation data.
function snapshot(plan,revision,organizerName){
 const date=plan.request?.timing?.dateConfirmed?text(plan.request.date,10):null;
 const timed=!!(date&&plan.request?.timing?.timeConfirmed);
 return {organizerName:text(organizerName,24),title:text(plan.request?.title,80),date,revision,
  itinerary:{title:text(plan.request?.title,80),date,revision,area:text(plan.request?.area,200),timeZone:text(plan.timeZone,100)||null,
   stops:(plan.stops||[]).filter(s=>s.item).slice(0,12).map(s=>({id:text(s.id,64),intent:text(s.intent,32),name:text(s.item.name,200),address:text(s.item.address,400),start:timed?text(s.start,5)||null:null,end:timed?text(s.end,5)||null:null}))}};
}
const preview=record=>({id:record.id,title:record.snapshot.title,date:record.snapshot.date,revision:record.revision,status:record.status,viewedAt:record.viewedAt||null,updatedAt:record.updatedAt,...(record.previousResponse?{previousResponse:record.previousResponse}:{})});
const recipientView=record=>({...preview(record),organizerName:record.snapshot.organizerName,unread:record.unread,muted:record.muted});
const ownerView=record=>({...preview(record),recipientId:record.recipientId,recipientName:record.recipientName});
function recipientRecords(data,user,epoch){return allRecords(data).filter(record=>record.recipientId===user.id&&live(data,record,epoch)&&connected(data,record.ownerId,user.id)).map(record=>({record}));}
const recipientRecord=(data,user,id,epoch)=>{const found=recipientRecords(data,user,epoch).find(({record})=>record.id===id);if(!found)throw fail();return found.record;};

export function createPlanInvitations({now=Date.now,epoch=null}={}){
 const timestamp=()=>new Date(now()).toISOString();
 return {
  available:validInvitationEpoch(epoch),
  assertEnabled(){if(!validInvitationEpoch(epoch))throw fail('Plan invitations are temporarily unavailable. Your other plans are unaffected.',503);},
  list(data,user,id){const entry=ownEntry(user,id);return {revision:entry.revision,invitations:records(data,user.id,id).map(record=>ownerView({...effective(data,record,epoch),...(!connected(data,user.id,record.recipientId)&&active(record)?{status:'disconnected'}:{})}))};},
  invite(data,user,id,body){
   fields(body,['recipientId','revision','replaceInvitationId']);const entry=ownEntry(user,id);
   if(typeof body.recipientId!=='string'||!connected(data,user.id,body.recipientId))throw fail();
   if(!Number.isSafeInteger(body.revision)||body.revision!==entry.revision)throw fail('This day changed. Reopen it and review the current version before inviting.',409);
   // Bearer-shared archives are independent copies, not an authority to invite.
   if(entry.sourceDayId)throw fail('Rework this shared day into your own saved plan before inviting.',409);
   const key=JSON.stringify([user.id,id,body.recipientId]),existing=Object.hasOwn(data.planInvitations||{},key)?data.planInvitations[key]:null;
   // Exact unavailable-record replacement is a distinct, reviewed operation.
   // An original request or previously committed replacement replay cannot
   // re-notify after a rollback epoch changes, even at the same plan revision.
   if(body.replaceInvitationId!==undefined&&(!existing||typeof body.replaceInvitationId!=='string'||![existing.id,existing.replacesInvitationId].includes(body.replaceInvitationId)))throw fail('This invitation changed. Review it again before sending an update.',409);
   if(existing?.revision===body.revision&&(live(data,existing,epoch)||body.replaceInvitationId!==existing.id))return ownerView(effective(data,existing,epoch));
   if(!existing&&(records(data,user.id,id).length>=20||allRecords(data).filter(record=>record.ownerId===user.id).length>=2000))throw fail('This day has reached its invitation limit.',429);
   const events=(user.planInvitationEvents||[]).filter(at=>at>now()-86400000);
   if(events.length>=50||existing&&now()-Date.parse(existing.updatedAt)<60000)throw fail('Please wait before sending another invitation update.',429);
   entry.planInvitationGeneration??=randomUUID();
   const saved=snapshot(entry.plan,entry.revision,user.profile.name),previousResponse=priorResponse(existing),at=timestamp();
   const record={id:randomUUID(),epoch,...(body.replaceInvitationId?{replacesInvitationId:body.replaceInvitationId}:{}),ownerId:user.id,planId:id,generation:entry.planInvitationGeneration,recipientId:body.recipientId,recipientName:text(data.users[body.recipientId].profile.name,24),revision:entry.revision,snapshot:saved,status:'pending',viewedAt:null,respondedAt:null,unread:true,muted:existing?.muted||false,updatedAt:at,...(previousResponse?{previousResponse}:{})};
   data.planInvitations??={};data.planInvitations[key]=record;user.planInvitationEvents=[...events,now()];return ownerView(record);
  },
  withdraw(data,user,id,invitationId){
   ownEntry(user,id);const record=records(data,user.id,id).find(record=>record.id===invitationId);if(!record)throw fail();
   if(record.status==='withdrawn')return ownerView(record);
   const previousResponse=priorResponse(record);if(previousResponse)record.previousResponse=previousResponse;
   record.status='withdrawn';record.unread=false;record.updatedAt=timestamp();delete record.snapshot.itinerary;return ownerView(record);
  },
  inbox(data,user){return {badgeEnabled:user.invitationSettings?.badgeEnabled!==false,invitations:recipientRecords(data,user,epoch).map(({record})=>recipientView(record)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))};},
  unreadCount(data,user){if(user.invitationSettings?.badgeEnabled===false)return 0;return recipientRecords(data,user,epoch).filter(({record})=>active(record)&&record.unread&&!record.muted).length;},
  update(data,user,id,body){
   fields(body,['action']);if(!['view','read','unread','mute','unmute','interested','going','decline','leave'].includes(body.action))throw new InputError('Choose a supported invitation action.');
   const record=recipientRecord(data,user,id,epoch),action=body.action;
   if(['interested','going','decline','leave'].includes(action)){
    const status={decline:'declined',leave:'left'}[action]||action;
    if(status===record.status)return recipientView(record);
    if(!active(record))throw fail('This invitation has ended. Ask the organizer for a new version.',409);
    if(action==='leave'&&!accepted(record))throw fail('Decline this invitation if you do not want to join.',409);
    record.status=status;record.respondedAt=timestamp();record.viewedAt??=timestamp();record.unread=false;
    if(!active(record))delete record.snapshot.itinerary;
   }else if(action==='view'){record.viewedAt??=timestamp();record.unread=false;}
   else if(action==='read'||action==='unread')record.unread=action==='unread';
   else record.muted=action==='mute';
   // Sending/update time stays stable for ordering and throttling; recipients
   // cannot reset the sender cooldown merely by toggling read or mute.
   return recipientView(record);
  },
  plan(data,user,id){const record=recipientRecord(data,user,id,epoch);if(!accepted(record)||!record.snapshot.itinerary)throw fail();return record.snapshot.itinerary;},
  settings(data,user,body){fields(body,['badgeEnabled']);if(typeof body.badgeEnabled!=='boolean')throw new InputError('Choose whether to show invitation badges.');user.invitationSettings={badgeEnabled:body.badgeEnabled};return user.invitationSettings;},
  // Called within every circle membership-removal transaction. Rejoining a
  // circle must not silently restore an old accepted invitation or plan access.
  remove(data,user,id){for(const [key,record] of Object.entries(data.planInvitations||{}))if(record.ownerId===user.id&&record.planId===id)delete data.planInvitations[key];},
  disconnect(data){for(const record of allRecords(data))if(active(record)&&!connected(data,record.ownerId,record.recipientId)){const previousResponse=priorResponse(record);if(previousResponse)record.previousResponse=previousResponse;record.status='disconnected';record.unread=false;record.updatedAt=timestamp();delete record.snapshot.itinerary;}},
 };
}
