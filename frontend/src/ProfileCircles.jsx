import {Button,Card,Flex,IconButton,Text,TextField} from '@radix-ui/themes';
import {useEffect,useRef,useState} from 'react';
import {Icon} from './PlannerIcons.jsx';
import CircleInviteLink,{circleInviteUrl} from './CircleInviteLink.jsx';

export default function ProfileCircles({account,onClose,onPlans}){
  const dialog=useRef(null);
  const [name,setName]=useState(''),[creating,setCreating]=useState(false),[renaming,setRenaming]=useState(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{dialog.current?.showModal();},[]);
  async function perform(fn){setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <dialog ref={dialog} className="pl-dialog cs-account-dialog cs-profile-circles" onCancel={onClose} aria-labelledby="profile-circles-title">
    <header className="cs-pc-header"><div><span className="cs-pc-eyebrow">Your people</span><h2 id="profile-circles-title">Circles</h2></div><IconButton type="button" variant="ghost" color="gray" onClick={onClose} aria-label="Close circles"><Icon name="close" size={18}/></IconButton></header>
    <div className="cs-pc-body">
      <Flex align="center" justify="between" gap="3" pb="3"><Text size="2" color="gray">{account.circles.length} {account.circles.length===1?'circle':'circles'}</Text><Button type="button" variant="soft" disabled={busy||account.circles.length>=12} onClick={()=>{setCreating(v=>!v);setName('');}}><Icon name={creating?'close':'plus'} size={15}/>{creating?'Cancel':'New circle'}</Button></Flex>
      {creating&&<form onSubmit={e=>{e.preventDefault();perform(async()=>{await account.createCircle({name,people:[account.user.profile]});setName('');setCreating(false);setNotice('Circle created.');});}}><Flex gap="2" mb="3"><TextField.Root aria-label="Circle name" autoFocus required maxLength={40} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Sunday people" style={{flex:1}}/><Button disabled={busy||!name.trim()}>Create</Button></Flex></form>}
      <Flex direction="column" gap="3">{account.circles.map(circle=><Card key={circle.id} size="2" variant="surface"><details className="cs-pc-circle" style={{border:0,background:'transparent'}}>
        <summary><span className="cs-pc-faces" aria-hidden="true">{circle.people.slice(0,3).map((person,i)=><i key={person.id} className={`cs-pc-face face-${i%3}`}>{person.name.charAt(0).toUpperCase()}</i>)}</span><span className="cs-pc-identity"><strong>{circle.name}</strong><small>{circle.people.length} {circle.people.length===1?'member':'members'}</small></span><Icon name="chevron-down" size={17}/></summary>
        <div className="cs-pc-expanded"><Button type="button" size="2" variant="soft" mt="3" onClick={()=>onPlans(circle)}><Icon name="bookmark" size={15}/>View circle plans</Button><Flex align="center" justify="between" mt="3" mb="2"><Text size="2" weight="medium">Members</Text><Button type="button" size="1" variant="ghost" onClick={()=>{setRenaming(circle.id);setName(circle.name);}}><Icon name="edit" size={14}/> Edit name</Button></Flex>
          {renaming===circle.id&&<form onSubmit={e=>{e.preventDefault();perform(async()=>{await account.renameCircle(circle.id,name);setRenaming(null);setNotice('Circle name updated.');});}}><Flex gap="2" mb="3"><TextField.Root aria-label="Circle name" autoFocus required maxLength={40} value={name} onChange={e=>setName(e.target.value)} style={{flex:1}}/><Button disabled={busy||!name.trim()}>Save</Button><Button type="button" variant="ghost" onClick={()=>setRenaming(null)}>Cancel</Button></Flex></form>}
          {circle.people.map(person=><div key={person.id} className="cs-pc-member"><span className="cs-pc-member-avatar">{person.name.charAt(0).toUpperCase()}</span><span>{person.name}{person.id===account.user?.id&&<small> You</small>}</span>{circle.owner&&person.id!==account.user?.id&&<Button type="button" size="1" variant="ghost" color="red" disabled={busy} aria-label={`Remove ${person.name} from ${circle.name}`} onClick={()=>{if(window.confirm(`Remove ${person.name} from ${circle.name}?`))perform(async()=>{await account.removeCircleMember(circle.id,person.id);setNotice('Member removed.');});}}>Remove</Button>}</div>)}
          <Flex align="center" justify="between" gap="3" mt="3" wrap="wrap"><CircleInviteLink compact name={circle.name} url={circleInviteUrl(circle)}/><Button type="button" size="1" variant="ghost" color="red" disabled={busy} onClick={()=>{if(window.confirm(circle.owner?`Delete ${circle.name} for everyone?`:`Leave ${circle.name}?`))perform(async()=>{await account.removeCircle(circle.id);setNotice(circle.owner?'Circle deleted.':'You left the circle.');});}}>{circle.owner?'Delete circle':'Leave circle'}</Button></Flex>
        </div>
      </details></Card>)}</Flex>
      {!account.circles.length&&!creating&&<div className="cs-pc-empty"><Icon name="users" size={27}/><strong>Keep your favorite people close.</strong><p>Create a circle, share its invite link, and plan together whenever you like.</p></div>}
      {notice&&<p role="status" className="cs-pc-feedback">{notice}</p>}{error&&<p role="alert" className="cs-inline-error">{error}</p>}
    </div>
  </dialog>;
}
