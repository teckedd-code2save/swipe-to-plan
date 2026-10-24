import {useEffect,useRef,useState} from 'react';
import {Icon,PERSON_COLORS} from './PlannerIcons.jsx';
import {dayLink} from './useSharedDay.js';
import {downloadDay,googleCalendarLink} from './daybook.js';

export default function ShareDay({plan,brief,shared,onEnsure,onClose,embedded=false,accountUser,onAccountRequired,updating=false}) {
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
  function openCalendar(){
    if(!accountUser){onAccountRequired('calendar');return;}
    try{window.open(googleCalendarLink(exportPlan),'_blank','noopener,noreferrer');setError('');}catch(e){setError(e.message);}
  }
  const current=shared.day?.access.memberId;
  const Container=embedded?'section':'dialog';
  return <Container ref={dialog} className={embedded?'cs-tool cs-share-tool':'pl-dialog gs-share-dialog'} onCancel={onClose} aria-labelledby="share-title">
    <div className="pl-dialog-heading"><h2 id="share-title">Share your day.</h2><button className="pl-icon-button" aria-label="Close sharing" onClick={onClose}><Icon name="close"/></button></div>
    <div className="pl-dialog-body">
      <div className="gs-share-options">
        <button disabled={!exportPlan||updating} onClick={()=>download(exportPlan,owner?null:current)}><Icon name="download" size={20}/><span><strong>Download the daybook</strong><small>Printable · works offline</small></span><Icon name="arrow" size={16}/></button>
        <button disabled={!exportPlan||updating} onClick={openCalendar}><Icon name="calendar" size={20}/><span><strong>Add to Google Calendar</strong><small>{accountUser?'Review the filled-in event, then Save':'Sign in to continue · your day stays here'}</small></span><Icon name={accountUser?'arrowUpRight':'lock'} size={16}/></button>
      </div>
      <p className="cs-calendar-note">One event for the outing, with every stop included. Nothing is added until you save in Google Calendar.</p>
      <details className="cs-calendar-download"><summary>Use another calendar</summary><button disabled={!exportPlan||updating} className="cs-text-button" onClick={()=>download(exportPlan,null,true)}><Icon name="download" size={14}/>Download calendar file (.ics)</button><small>Import into Apple Calendar, Outlook or another calendar. Suggested times; updates won’t sync.</small></details>
      {owner&&<>
        <button className="gs-invite-everyone" disabled={creating||updating} onClick={()=>copyLink()}><Icon name="people" size={19}/><div><strong>{copied==='all'?'Invitation link copied':'Invite the group'}</strong><small>They add their tastes. The day adapts.</small></div><Icon name={copied==='all'?'check':'copy'} size={17}/></button>
        {manualLink&&<label className="gs-link-field">{manualLink.label}<input readOnly aria-label="Invitation link" value={manualLink.url} onFocus={e=>e.target.select()}/></label>}
        <details className="cs-person-share"><summary>Personal links & daybooks <span>{people.length} {people.length===1?'person':'people'}</span></summary><div className="gs-person-delivery">{people.map((p,i)=><div key={p.id}><span className="gs-avatar" style={{background:PERSON_COLORS[i%PERSON_COLORS.length]}}>{p.name.slice(0,2).toUpperCase()}</span><span><strong>{p.name}</strong><small>The day, with their taste threads.</small></span><button disabled={creating||updating} aria-label={`Copy ${p.name}'s personal link`} title="Copy personal link" onClick={()=>copyLink(p.id)}><Icon name={copied===p.id?'check':'copy'} size={17}/></button><button disabled={updating||!exportPlan?.people.some(member=>member.id===p.id)} aria-label={`Download ${p.name}'s daybook`} title="Download personal daybook" onClick={()=>download(exportPlan,p.id)}><Icon name="download" size={18}/></button></div>)}</div></details>
        {['localhost','127.0.0.1'].includes(location.hostname)&&<p className="pl-help cs-local-note">Local preview · invitation links work on this computer.</p>}
        <details className="cs-sharing-info"><summary>Who can see this day?</summary><p className="pl-help">Invitation holders can see the group and its tastes. Personal links let that participant edit only their own preferences. Links expire after seven days. A published app address is needed for invitations to work on other devices.</p></details>
      </>}
      {updating&&<p className="pl-help" role="status">The day is updating. Sharing and calendar actions will be ready when it finishes.</p>}
      {error&&<p className="pl-error" role="alert">{error}</p>}
    </div>
  </Container>;
}
