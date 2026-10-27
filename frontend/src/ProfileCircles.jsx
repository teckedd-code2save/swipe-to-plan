import {useEffect,useRef,useState} from 'react';
import {Icon} from './PlannerIcons.jsx';
import CircleInviteLink,{circleInviteUrl} from './CircleInviteLink.jsx';

export default function ProfileCircles({account,onClose}){
  const dialog=useRef(null);
  const [name,setName]=useState('');
  const [creating,setCreating]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  useEffect(()=>{dialog.current?.showModal();},[]);
  async function perform(fn){setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <dialog ref={dialog} className="pl-dialog cs-account-dialog cs-profile-circles" onCancel={onClose} aria-labelledby="profile-circles-title">
    <header className="cs-pc-header">
      <div><span className="cs-pc-eyebrow">Your people</span><h2 id="profile-circles-title">Circles</h2></div>
      <button type="button" className="cs-pc-close" onClick={onClose} aria-label="Close circles"><Icon name="close" size={18}/></button>
    </header>
    <div className="cs-pc-body">
      <div className="cs-pc-intro"><span>{account.circles.length} {account.circles.length===1?'circle':'circles'}</span><button type="button" disabled={busy||account.circles.length>=12} onClick={()=>setCreating(v=>!v)}><Icon name={creating?'close':'plus'} size={15}/>{creating?'Cancel':'New circle'}</button></div>
      {creating&&<form className="cs-pc-create" onSubmit={e=>{e.preventDefault();perform(async()=>{await account.createCircle({name,people:[account.user.profile]});setName('');setCreating(false);setNotice('Circle created.');});}}><label htmlFor="pc-circle-name">Circle name</label><div><input id="pc-circle-name" autoFocus required maxLength={40} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Sunday people"/><button disabled={busy||!name.trim()}>Create</button></div></form>}
      <div className="cs-pc-list">{account.circles.map(circle=><div key={circle.id}><CircleInviteLink compact name={circle.name} url={circleInviteUrl(circle)}/><details className="cs-pc-circle">
        <summary><span className="cs-pc-faces" aria-hidden="true">{circle.people.slice(0,3).map((person,i)=><i key={person.id} className={`cs-pc-face face-${i%3}`}>{person.name.charAt(0).toUpperCase()}</i>)}</span><span className="cs-pc-identity"><strong>{circle.name}</strong><small>{circle.people.length} {circle.people.length===1?'member':'members'}</small></span><Icon name="chevron-down" size={17}/></summary>
        <div className="cs-pc-expanded">
          <div className="cs-pc-section-label">Members</div>
          {circle.people.map(person=><div key={person.id} className="cs-pc-member"><span className="cs-pc-member-avatar">{person.name.charAt(0).toUpperCase()}</span><span>{person.name}{person.id===account.user?.id&&<small> You</small>}</span>{circle.owner&&person.id!==account.user?.id&&<button type="button" disabled={busy} aria-label={`Remove ${person.name} from ${circle.name}`} onClick={()=>{if(window.confirm(`Remove ${person.name} from ${circle.name}?`))perform(async()=>{await account.removeCircleMember(circle.id,person.id);setNotice('Member removed.');});}}>Remove</button>}</div>)}
          <CircleInviteLink name={circle.name} url={circleInviteUrl(circle)}/>
          <button type="button" className="cs-pc-leave" disabled={busy} onClick={()=>{if(window.confirm(circle.owner?`Delete ${circle.name} for everyone?`:`Leave ${circle.name}?`))perform(async()=>{await account.removeCircle(circle.id);setNotice(circle.owner?'Circle deleted.':'You left the circle.');});}}>{circle.owner?'Delete circle':'Leave circle'}</button>
        </div>
      </details></div>)}</div>
      {!account.circles.length&&!creating&&<div className="cs-pc-empty"><Icon name="users" size={27}/><strong>Keep your favorite people close.</strong><p>Create a circle, share its invite link, and plan together whenever you like.</p></div>}
      {notice&&<p role="status" className="cs-pc-feedback">{notice}</p>}{error&&<p role="alert" className="cs-inline-error">{error}</p>}
    </div>
  </dialog>;
}

