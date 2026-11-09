import {randomUUID} from 'node:crypto';
import {lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createAccountStore} from './account-store.js';
export const validInvitationEpoch=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

// Runtime is read-only. No default epoch, lazy repair, or rebinding of grants.
// A release may rotate this sidecar ONLY after conclusively stopping the writer.
export async function readInvitationEpoch(file){
 try{
  try{await lstat(`${file}.intent`);return null;}catch(e){if(e.code!=='ENOENT')throw e;}
  const value=await createAccountStore({file}).read(data=>data.planInvitationEpoch);
  return validInvitationEpoch(value)?value:null;
 }catch{return null;}
}

// Quiesced deployment helper, never an HTTP endpoint. The same serialized,
// fsync-backed journal protocol protects creation/rotation and ambiguous writes.
export async function prepareInvitationEpoch(file,operation,{io}={}){
 if(!['ensure','rotate'].includes(operation))throw Error('Choose ensure or rotate for the invitation epoch.');
 await createAccountStore({file,io}).transact(data=>{
  if(data.planInvitationEpoch!==undefined&&!validInvitationEpoch(data.planInvitationEpoch))throw Error('Invitation epoch is invalid; reconcile it before release.');
  if(operation==='rotate'||data.planInvitationEpoch===undefined)data.planInvitationEpoch=randomUUID();
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await prepareInvitationEpoch('/data/plan-invitation-epoch.json',process.argv[2]);process.stdout.write('Invitation access epoch prepared.\n');}
 catch{process.stderr.write('Invitation epoch preparation failed. Keep writers stopped and reconcile protected recovery evidence before retrying.\n');process.exitCode=1;}
}
