import {useEffect,useRef,useState} from 'react';
import {Icon,PERSON_COLORS} from './PlannerIcons.jsx';
import {dayLink} from './useSharedDay.js';
import {downloadDay} from './daybook.js';

export default function ShareDay({plan,brief,shared,onEnsure,onClose,embedded=false}) {
  const dialog=useRef(null),[error,setError]=useState(''),[copied,setCopied]=useState(''),[creating,setCreating]=useState(false),[manualLink,setManualLink]=useState(null);
  useEffect(()=>{if(!embedded)dialog.current.showModal();},[embedded]);
  async function ensure(){setCreating(true);setError('');try{return await onEnsure(brief);}catch(e){setError(e.message);return null;}finally{setCreating(false);}}
  async function copyLink(personId) {
    const result=shared.day?{day:shared.day}:await ensure();if(!result)return;
    const key=personId?result.day.participantLinks?.find(p=>p.id===personId)?.token:result.day.inviteToken;
    if(!key)return setError('Only the organizer can create these invitation links.');
    const link=dayLink(result.day.id,key);setManualLink({label:personId?'Personal invitation':'Group invitation',url:link});
    try{await navigator.clipboard.writeText(link);setCopied(personId||'all');}catch{setError('Copy is unavailable. Select and copy the invitation link below.');}
  }
  function download(...args){try{downloadDay(...args);setError('');}catch(e){setError(e.message);}}
  const owner=!shared.day||shared.day.access.role==='owner';
  const people=shared.day?.request.people||brief.people;
  const exportPlan=shared.day&&shared.day.planRevision===shared.day.revision?shared.day?.plan:plan;
  const current=shared.day?.access.memberId;
  const Container=embedded?'section':'dialog';
  return <Container ref={dialog} className={embedded?'cs-tool cs-share-tool':'pl-dialog gs-share-dialog'} onCancel={onClose} aria-labelledby="share-title">
    <div className="pl-dialog-heading"><h2 id="share-title">Share your day.</h2><button className="pl-icon-button" aria-label="Close sharing" onClick={onClose}><Icon name="close"/></button></div>
    <div className="pl-dialog-body">
      <div className="gs-share-options">
        <button disabled={!exportPlan} onClick={()=>download(exportPlan,owner?null:current)}><Icon name="download" size={20}/><span><strong>Download the daybook</strong><small>Printable · works offline</small></span><Icon name="arrow" size={16}/></button>
        <button disabled={!exportPlan} onClick={()=>download(exportPlan,null,true)}><Icon name="calendar" size={20}/><span><strong>Add to your calendar</strong><small>Suggested times · no bookings</small></span><Icon name="arrow" size={16}/></button>
      </div>
      {owner&&<>
        <button className="gs-invite-everyone" disabled={creating} onClick={()=>copyLink()}><Icon name="people" size={19}/><div><strong>{copied==='all'?'Invitation link copied':'Invite the group'}</strong><small>They add their tastes. The day adapts.</small></div><Icon name={copied==='all'?'check':'copy'} size={17}/></button>
        {manualLink&&<label className="gs-link-field">{manualLink.label}<input readOnly aria-label="Invitation link" value={manualLink.url} onFocus={e=>e.target.select()}/></label>}
        <details className="cs-person-share"><summary>Personal links & daybooks <span>{people.length} {people.length===1?'person':'people'}</span></summary><div className="gs-person-delivery">{people.map((p,i)=><div key={p.id}><span className="gs-avatar" style={{background:PERSON_COLORS[i%PERSON_COLORS.length]}}>{p.name.slice(0,2).toUpperCase()}</span><span><strong>{p.name}</strong><small>The day, with their taste threads.</small></span><button disabled={creating} aria-label={`Copy ${p.name}'s personal link`} title="Copy personal link" onClick={()=>copyLink(p.id)}><Icon name={copied===p.id?'check':'copy'} size={17}/></button><button disabled={!exportPlan?.people.some(member=>member.id===p.id)} aria-label={`Download ${p.name}'s daybook`} title="Download personal daybook" onClick={()=>download(exportPlan,p.id)}><Icon name="download" size={18}/></button></div>)}</div></details>
        {['localhost','127.0.0.1'].includes(location.hostname)&&<p className="pl-help cs-local-note">Local preview · invitation links work on this computer.</p>}
        <details className="cs-sharing-info"><summary>Who can see this day?</summary><p className="pl-help">Invitation holders can see the group and its tastes. Personal links let that participant edit only their own preferences. Links expire after seven days. A published app address is needed for invitations to work on other devices.</p></details>
      </>}
      {shared.day?.status==='updating'&&<p className="pl-help">The day is updating. Downloads use the last completed plan.</p>}
      {error&&<p className="pl-error" role="alert">{error}</p>}
    </div>
  </Container>;
}
