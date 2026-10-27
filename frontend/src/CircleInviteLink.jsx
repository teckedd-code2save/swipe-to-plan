import {useState} from 'react';
import {Icon} from './PlannerIcons.jsx';

export function circleInviteUrl(circle){
  return circle?.inviteToken?`${location.origin}/#/circle/${encodeURIComponent(circle.id)}?invite=${encodeURIComponent(circle.inviteToken)}`:null;
}

export default function CircleInviteLink({name,url}){
  const [notice,setNotice]=useState('');
  if(!url)return null;
  async function copy(){try{await navigator.clipboard.writeText(url);setNotice('Link copied. Send it to your people.');}catch{setNotice('Select and copy the link below.');}}
  async function share(){try{await navigator.share({title:`Join ${name} on Unstressed`,text:`Join ${name} and plan our next outing together.`,url});}catch(e){if(e.name!=='AbortError')await copy();}}
  return <section className="cs-invite-link" aria-label={`Invite to ${name}`}><strong>Bring your people</strong><p>Share this link. They open it and tap Join to become part of {name}.</p><div className="cs-invite-link-actions">{typeof navigator.share==='function'&&<button type="button" className="pl-button" onClick={share}>Share invite <Icon name="arrow" size={16}/></button>}<button type="button" className="pl-button" onClick={copy}>Copy invite link <Icon name="copy" size={16}/></button></div><input aria-label={`Invite link for ${name}`} readOnly value={url} onFocus={e=>e.target.select()}/><small>Anyone with this link can join. New members sign in with Google to keep their circle and tastes.</small>{notice&&<p role="status">{notice}</p>}</section>;
}
