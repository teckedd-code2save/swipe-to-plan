import {useState} from 'react';
import {Icon} from './PlannerIcons.jsx';

export default function ConnectedPeople({people,connections,circles,onAdd,onInvite,onEmailInvite,initialQuery=''}){
  const [email,setEmail]=useState(''),[sent,setSent]=useState(false),[query,setQuery]=useState(initialQuery),[inviting,setInviting]=useState(!!initialQuery),[circleId,setCircleId]=useState('new'),[name,setName]=useState('My people'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const matches=[...new Map([...people,...connections].filter(p=>p.name.toLowerCase().includes(query.trim().toLowerCase())).map(p=>[p.id,p])).values()];
  const available=circles.filter(c=>c.owner&&c.people.length<6);
  async function run(fn){setError('');setBusy(true);try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <div className="cs-connected-people">
    <label className="cs-field-label" htmlFor="circle-people-search">Find someone in your circles</label>
    <div className="cs-inline-form"><input id="circle-people-search" aria-label="Search your circles" autoComplete="off" placeholder="Search your circles by name…" maxLength={80} value={query} onChange={e=>setQuery(e.target.value)}/><Icon name="people" size={17}/></div>
    <p className="cs-people-privacy"><Icon name="lock" size={12}/>Only people who have joined a circle with you.</p>
    <div className="cs-connection-results">{matches.slice(0,6).map(person=>{const here=people.some(p=>p.id===person.id);return <button className="cs-saved-person" key={person.id} disabled={busy||here||people.length>=6} onClick={()=>run(()=>onAdd(person))}><span><strong>{person.name}</strong><small>{circles.filter(c=>c.accountIds?.includes(person.id)).map(c=>c.name).join(' · ')}</small></span><span>{here?'In this day':'Add'}<Icon name={here?'check':'plus'} size={14}/></span></button>;})}</div>
    {!matches.length&&<p className="cs-muted">{query?`No matching person in this plan or your joined circles.`:'Your people will appear here after they accept a circle invitation.'}</p>}
    {!inviting?<button className="cs-text-button" onClick={()=>setInviting(true)}><Icon name="plus" size={14}/>Invite someone by email</button>:<div className="cs-circle-invitation">
      <div className="cs-tool-head"><span><Icon name="people" size={16}/>A place in your circle</span><button aria-label="Close invitation" onClick={()=>{setInviting(false);}}><Icon name="close" size={14}/></button></div>
      <p>Enter their email. They will only appear in your circle after accepting the invitation.</p>
      <label>Invite into<select value={circleId} onChange={e=>setCircleId(e.target.value)} aria-label="Circle for this invitation"><option value="new">A new circle</option>{available.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
      {circleId==='new'&&<label>Circle name<input aria-label="New circle name" maxLength={40} value={name} onChange={e=>setName(e.target.value)}/></label>}
      <form onSubmit={e=>{e.preventDefault();run(async()=>{const createdId=await onEmailInvite(circleId==='new'?null:circleId,name,email.trim());if(createdId)setCircleId(createdId);setSent(true);});}}>
        <label>Email address<input type="email" required maxLength={254} autoComplete="email" value={email} onChange={e=>{setEmail(e.target.value);setSent(false);}} placeholder="friend@example.com"/></label>
        <button type="submit" className="cs-invite-primary" disabled={busy||sent||!email.trim()||circleId==='new'&&!name.trim()}>{busy?'Sending…':sent?'Invitation requested':'Send email invitation'}<Icon name={sent?'check':'arrow'} size={15}/></button>
      </form>
      {sent&&<p role="status">If delivery succeeds, the recipient can accept using the email you entered. No account information is disclosed.</p>}
    </div>}{error&&<p className="cs-inline-error" role="alert">{error}</p>}
  </div>;
}
