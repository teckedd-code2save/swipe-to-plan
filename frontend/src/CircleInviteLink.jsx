import {useState} from 'react';
import {Icon} from './PlannerIcons.jsx';

export function circleInviteUrl(circle){
  return circle?.inviteToken?`${location.origin}/#/circle/${encodeURIComponent(circle.id)}?invite=${encodeURIComponent(circle.inviteToken)}`:null;
}

export default function CircleInviteLink({name,url,compact=false}){
  const [notice,setNotice]=useState('');
  if(!url)return null;
  async function copy(){try{await navigator.clipboard.writeText(url);setNotice('Link copied');}catch{setNotice('Select and copy the link below.');}}
  async function share(){try{await navigator.share({title:`Join ${name} on Unstressed`,text:`Join ${name} and plan our next outing together.`,url});}catch(e){if(e.name!=='AbortError')await copy();}}
  return <section className={`cs-invite-link${compact?' cs-invite-compact':''}`} aria-label={`Invite to ${name}`}>{!compact&&<><strong>Invite to {name}</strong><p>Open the link and join the circle.</p></>}<div className="cs-invite-link-actions"><button type="button" className="pl-button" aria-label={`Share invite to ${name}`} title="Share invite" onClick={typeof navigator.share==='function'?share:copy}><Icon name="share" size={20}/></button><button type="button" className="pl-button" aria-label={`Copy invite link for ${name}`} title="Copy invite link" onClick={copy}><Icon name="copy" size={20}/></button></div>{(!compact||notice==='Select and copy the link below.')&&<input aria-label={`Invite link for ${name}`} readOnly value={url} onFocus={e=>e.target.select()}/>} {!compact&&<small>Anyone with this link can join after signing in.</small>}{notice&&<p role="status">{notice}</p>}</section>;
}
