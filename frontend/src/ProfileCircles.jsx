import {useEffect,useRef,useState} from 'react';
import {Icon} from './PlannerIcons.jsx';

export default function ProfileCircles({account,onClose}){
  const dialog=useRef(null);
  const [email,setEmail]=useState({});
  const [name,setName]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  useEffect(()=>{dialog.current?.showModal();},[]);
  async function perform(fn){setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <dialog ref={dialog} className="pl-dialog cs-account-dialog cs-profile-circles" onCancel={onClose} aria-labelledby="profile-circles-title">
    <div className="pl-dialog-heading"><h2 id="profile-circles-title">My circles</h2><button className="pl-icon-button" onClick={onClose} aria-label="Close circles"><Icon name="close"/></button></div>
    <div className="pl-dialog-body">
      <p>Manage your people here, separately from any plan. People join only after accepting an email invitation.</p>
      {account.circles.map(circle=><section key={circle.id} className="cs-profile-circle">
        <details className="cs-profile-circle-details"><summary><strong>{circle.name}</strong><small>{circle.people.length} members</small></summary><div className="cs-circle-members">{circle.people.map(person=><div key={person.id} className="cs-circle-member"><span>{person.name}{person.id===account.user?.id?' · you':''}</span>{circle.owner&&person.id!==account.user?.id&&<button type="button" disabled={busy} aria-label={`Remove ${person.name} from ${circle.name}`} onClick={()=>{if(window.confirm(`Remove ${person.name} from ${circle.name}?`))perform(async()=>{await account.removeCircleMember(circle.id,person.id);setNotice('Member removed from the circle.');});}}>Remove</button>}</div>)}</div>
        <form onSubmit={e=>{e.preventDefault();perform(async()=>{await account.inviteCircleByEmail(circle.id,email[circle.id]);setEmail(previous=>({...previous,[circle.id]:''}));setNotice('Invitation sent. Membership begins on acceptance.');});}}>
          <label>Invite by email<input type="email" required value={email[circle.id]||''} onChange={e=>setEmail(v=>({...v,[circle.id]:e.target.value}))} placeholder="friend@example.com"/></label>
          <button type="submit" disabled={busy||!email[circle.id]?.trim()}>Send invite</button>
        </form>
        <button type="button" disabled={busy} onClick={()=>perform(async()=>{await account.removeCircle(circle.id);setNotice(circle.owner?'Circle deleted.':'You left the circle.');})}>{circle.owner?'Delete circle':'Leave circle'}</button></details>
      </section>)}
      {!account.circles.length&&<p>No circles yet. Create one to get started.</p>}
      <form className="cs-profile-create" onSubmit={e=>{e.preventDefault();perform(async()=>{await account.createCircle({name,people:[account.user.profile]});setName('');setNotice('Circle created. Invite a member using its email form.');});}}>
        <label>New circle<input required maxLength={40} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Sunday people"/></label>
        <button disabled={busy||!name.trim()||account.circles.length>=12}>Create circle</button>
      </form>
      {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="cs-inline-error">{error}</p>}
    </div>
  </dialog>;
}
