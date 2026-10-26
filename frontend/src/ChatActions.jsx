import {CURRENCIES} from './money.js';
import {useEffect,useRef,useState} from 'react';
import SwipeDeck from './SwipeDeck.jsx';
import {tailorTasteCards,contextualCardCopy} from './taste-context.js';
import {Icon,PERSON_COLORS} from './PlannerIcons.jsx';
import {CircleFaces} from './Circles.jsx';
import {circlePeople} from './circles.js';
import {tasteFromSwipe} from './day-state.js';
import {bringCardToFront} from './taste-order.js';
import ConnectedPeople from './ConnectedPeople.jsx';

export function TasteAction({person,people,deck,onChange,onPerson,onDone,editable,personal=false,focus=null,suggestedIds=[],prompts=[]}){
  const decisionLock=useRef(false);
  const [orders,setOrders]=useState({}),[histories,setHistories]=useState({}),[category,setCategory]=useState(focus||'food'),[error,setError]=useState(''),[custom,setCustom]=useState(''),[name,setName]=useState(person.name);
  const current=useRef(person);current.current=person;
  useEffect(()=>setName(person.name),[person.id,person.name]);
  const scope=`${person.id}:${category}`;
  const original=tailorTasteCards(contextualCardCopy(deck,prompts),person,category,suggestedIds);
  const byId=new Map(original.map(card=>[card.id,card]));
  const ordered=[...(orders[scope]||[]).map(id=>byId.get(id)).filter(Boolean),...original.filter(card=>!(orders[scope]||[]).includes(card.id))];
  const history=histories[scope]||[];
  useEffect(()=>{decisionLock.current=false;},[scope,history.length]);
  const setHistory=update=>setHistories(state=>({...state,[scope]:update(state[scope]||[])}));
  function change(value){onChange(value);setError('');}
  function addArtist(event){event.preventDefault();const label=custom.trim();if(!label)return;try{change(tasteFromSwipe(current.current,{kind:'artist',label},true));setCustom('');}catch(e){setError(e.message);}}
  function decideCard(id,like){
    const index=ordered.findIndex(card=>card.id===id);
    if(index<history.length||!editable||decisionLock.current)return;
    decisionLock.current=true;
    const card=ordered[index];
    try{
      const key=card.kind==='artist'?'artists':'vibes',before=[...current.current[key]];
      change(tasteFromSwipe(current.current,card,like));
      const arranged=bringCardToFront(ordered,history.length,id);
      setOrders(old=>({...old,[scope]:arranged.map(item=>item.id)}));
      setHistory(list=>[...list,{id:card.id,like,key,before}]);
    }catch(e){decisionLock.current=false;setError(e.message);}
  }
  function decide(like){const card=ordered[history.length];if(card)decideCard(card.id,like);}
  function undo(){const last=history.at(-1);if(last){change({...current.current,[last.key]:last.before});setHistory(list=>list.slice(0,-1));}}
  function toggleVibe(card){try{change(tasteFromSwipe(current.current,card,!current.current.vibes.includes(card.id)));}catch(e){setError(e.message);}}
  function spending(patch){change({...current.current,spending:{style:'balanced',priority:'even',...current.current.spending,...patch}});}
  const style=person.spending?.style||'balanced',priority=person.spending?.priority||'even',favorites=person.artists.length+person.vibes.length;
  return <section className="cs-tool cs-tastes cs-tastes-open" aria-label={`${person.name}'s tastes`}>
    <div className="cs-tool-head"><span><Icon name="music" size={18}/>{personal?'My tastes':focus?({food:'Food for this outing',activity:'What would you enjoy?',mood:'The setting you want',music:'Music you enjoy',request:'Your kind of outing'})[focus]:'Shape the tastes'}</span><button type="button" className="cs-icon-button" aria-label="Close taste choices" onClick={onDone}><Icon name="close" size={17}/></button></div>
    <div className="cs-taste-person">{personal?<strong>{person.name}</strong>:<select aria-label="Whose tastes" value={person.id} onChange={e=>onPerson?.(e.target.value)}>{people.map(p=><option key={p.id} value={p.id}>{p.name==='You'?'Your tastes':`${p.name}’s tastes`}</option>)}</select>}<small>{favorites} favorites · changes saved as you go</small></div>
    <div className="cs-tastes-open-layout" style={focus?{display:'block'}:undefined}>
      <div className="cs-tastes-discover"><div className="cs-taste-section-heading"><h3>{focus?'What fits today?':'Discover'}</h3></div>
        {!focus&&<div className="cs-taste-categories" role="group" aria-label="Explore taste categories">{[['food','Food'],['activity','Things to do'],['mood','Mood'],['music','Music']].map(([id,label])=><button key={id} type="button" aria-pressed={category===id} onClick={()=>setCategory(id)}>{label}</button>)}</div>}
        {editable?<SwipeDeck key={scope} deck={ordered} history={history} onDecide={decide} onDecideCard={decideCard} onUndo={undo} onDone={onDone} doneLabel="Done exploring" onAddMissing={category==='music'?(label)=>{try{change(tasteFromSwipe(current.current,{kind:'artist',label},true));}catch(e){setError(e.message);}}:undefined} completeText="Your favorites are saved. Explore another category or continue chatting."/>:<p className="cs-muted">Only this person can edit their own tastes.</p>}
      </div>
      {!focus&&<div className="cs-tastes-preferences">
        <section className="cs-taste-picked" aria-label="Selected favorites">
          <div className="cs-taste-section-heading"><h3>Your favorites</h3><span>{favorites} saved</span></div>
          {editable&&<label className="cs-name-edit">Name<input aria-label="Person’s name" maxLength={24} value={name} onChange={e=>setName(e.target.value)} onBlur={()=>{if(name.trim()&&name.trim()!==person.name)change({...current.current,name:name.trim()});else setName(person.name);}}/></label>}
          {personal&&editable&&person.context&&<details><summary>Your saved context</summary><p>{person.context.role||'Cultural interests'}{person.context.interests?.length?`: ${person.context.interests.map(i=>i.name).join(', ')}`:''}</p><button type="button" onClick={()=>change({...current.current,context:undefined})}>Remove saved context</button></details>}
          <div className="cs-taste-chips">{person.artists.map(artist=><button type="button" disabled={!editable} key={artist} aria-label={`Remove ${artist}`} onClick={()=>change({...current.current,artists:current.current.artists.filter(v=>v!==artist)})}><Icon name="music" size={12}/>{artist}<Icon name="close" size={12}/></button>)}{person.vibes.map(id=><button type="button" disabled={!editable} key={id} aria-label={`Remove ${deck.find(c=>c.id===id)?.label||id}`} onClick={()=>change({...current.current,vibes:current.current.vibes.filter(v=>v!==id)})}>{deck.find(c=>c.id===id)?.label||id}<Icon name="close" size={12}/></button>)}</div>
          {!favorites&&<p className="cs-muted">Choose a few cards. Food, places, music and mood all help.</p>}
          {editable&&<form className="cs-inline-form cs-any-artist" onSubmit={addArtist}><input aria-label="Favorite artist" placeholder="Add an artist by name…" maxLength={160} value={custom} onChange={e=>setCustom(e.target.value)}/><button type="submit" aria-label="Add artist" disabled={!custom.trim()}><Icon name="plus" size={16}/></button></form>}
        </section>
        <section className="cs-taste-direct" aria-label="Choose preferences directly">
          <div className="cs-taste-section-heading"><h3>Choose directly</h3><span>No swiping required</span></div>
          {deck.filter(card=>card.kind==='vibe'&&(card.group||'mood')===category).map(card=><button type="button" className="cs-taste-direct-chip" key={card.id} disabled={!editable} aria-pressed={person.vibes.includes(card.id)} onClick={()=>toggleVibe(card)}>{card.label}{person.vibes.includes(card.id)&&<Icon name="check" size={12}/>}</button>)}
          {category==='music'&&<p className="cs-muted">Search the music stack, or add any artist above.</p>}
        </section>
        <section className="cs-taste-spending" aria-label="Spending preferences">
          <div className="cs-taste-section-heading"><h3>Spending style</h3><span>Guides allowances, not quotes</span></div>
          <div className="cs-taste-style-choices">{[['mindful','Keep it light'],['balanced','Balanced'],['treat','Make it special']].map(([id,label])=><button key={id} type="button" disabled={!editable} aria-pressed={style===id} onClick={()=>spending({style:id})}>{label}</button>)}</div>
          <label className="cs-field-label" htmlFor="cs-spend-priority">Where would you spend more?</label>
          <select id="cs-spend-priority" disabled={!editable} value={priority} onChange={e=>spending({priority:e.target.value})}>{[['even','A bit of everything'],['coffee','Coffee'],['dinner','A great meal'],['activity','Experiences'],['drinks','Drinks']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>
        </section>
      </div>}
    </div>
    <p className="cs-spend-note">Tastes guide discovery, not verified allergies, affordability or venue suitability.</p>
    {personal&&<small className="cs-tool-foot">Saved to your account. Your circle members see your latest tastes.</small>}
    {error&&<p className="cs-inline-error" role="alert">{error}</p>}
  </section>;
}

export function CirclesAction({circles,contacts,people,onApply,onPeople,onSave,onRemove,onDone,owner,accountUser,onInvite,onEmailInvite,onSignIn}){
  const [inviteFor,setInviteFor]=useState(null),[inviteEmail,setInviteEmail]=useState(''),[saving,setSaving]=useState(false),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function apply(circle){setBusy(true);try{await onApply(circle);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section className="cs-tool cs-circle-tool" aria-label="Choose a circle"><div className="cs-tool-head"><span><Icon name="people" size={17}/>Your circles</span><button onClick={onDone} aria-label="Close circle choices"><Icon name="close" size={15}/></button></div>{onPeople&&<button className="cs-text-button" onClick={onPeople}>Add people instead <Icon name="people" size={14}/></button>}{circles.length?circles.map(c=>{const members=circlePeople(c,contacts),here=members.every(p=>people.some(m=>m.id===p.id));return <div className="cs-circle-row" key={c.id}><button disabled={busy||!owner||here} onClick={()=>apply(c)} aria-label={`Bring ${c.name}`}><CircleFaces people={members}/><span><strong>{c.name}</strong><small>{members.map(p=>p.name).join(', ')}</small></span>{here?<small className="cs-here">Here <Icon name="check" size={12}/></small>:<Icon name="arrow" size={17}/>}</button>{accountUser&&<button className="cs-circle-invite" aria-label={`Invite to ${c.name}`} onClick={()=>{setInviteFor(inviteFor===c.id?null:c.id);setInviteEmail('');}}><Icon name="plus" size={14}/></button>}<details className="cs-circle-menu"><summary aria-label={`Options for ${c.name}`}>···</summary><button onClick={async()=>{try{await onRemove(c.id);}catch(e){setError(e.message);}}}>{c.owner===false?'Leave circle':accountUser?'Delete circle':'Forget circle'}</button></details>{inviteFor===c.id&&<form className="cs-inline-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await onEmailInvite(c.id,c.name,inviteEmail);setInviteFor(null);setInviteEmail('');}catch(e){setError(e.message);}finally{setBusy(false);}}}><input type="email" autoFocus required aria-label={`Email to invite to ${c.name}`} value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="friend@example.com"/><button disabled={busy||!inviteEmail.trim()}>Send invite</button></form>}</div>;}):<p className="cs-muted">No circles yet. Create one and invite your people for next time.</p>}{owner&&<><button className="cs-text-button" onClick={()=>setSaving(v=>!v)}><Icon name="plus" size={13}/>{accountUser?'Create a circle':'Save this group as a circle'}</button>{saving&&<form className="cs-inline-form" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await onSave(name);setSaving(false);setName('');}catch(e){setError(e.message);}finally{setBusy(false);}}}><input autoFocus aria-label="Circle name" placeholder="e.g. Sunday people" maxLength={40} value={name} onChange={e=>setName(e.target.value)}/><button disabled={busy||!name.trim()||circles.length>=12}>Save</button></form>}</>}<small className="cs-tool-foot">{accountUser?'Saved to your account. Members bring their latest tastes.':<>Remembered on this device. <button className="cs-text-button" onClick={onSignIn}>Sign in to keep them together</button></>}</small>{error&&<p className="cs-inline-error" role="alert">{error}</p>}</section>;
}

export function PeopleAction({people,contacts,owner,memberId,onTaste,onAdd,onRemove,onShare,onDone,onCircles,accountUser,circles=[],connections=[],onInvite,onEmailInvite,initialQuery=''}){
  const [query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function add(person){setBusy(true);try{await onAdd(person);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section className="cs-tool" aria-label="People in this day"><div className="cs-tool-head"><span><Icon name="people" size={17}/>Who’s coming?</span><button onClick={onDone} aria-label="Close people"><Icon name="close" size={15}/></button></div>{onCircles&&<button className="cs-text-button" onClick={onCircles}>Pick a saved circle <Icon name="people" size={14}/></button>}<div className="cs-crew">{people.map((p,i)=><div key={p.id}><button onClick={()=>onTaste(p.id)}><span className="cs-person-dot" style={{background:PERSON_COLORS[i%6]}}>{p.name[0]}</span><span><strong>{p.name}{p.id===memberId?' · you':''}</strong><small>{[...p.artists,...p.vibes.map(v=>v.replace('v-',''))].slice(0,2).join(' · ')||'Add their favorites'}</small></span><Icon name="music" size={15}/></button>{owner&&i>0&&<button className="cs-remove" aria-label={`Remove ${p.name}`} disabled={busy} onClick={async()=>{setBusy(true);try{await onRemove(p.id);}catch(e){setError(e.message);}finally{setBusy(false);}}}><Icon name="close" size={13}/></button>}</div>)}</div>{owner&&(accountUser?<ConnectedPeople people={people} connections={connections} circles={circles} onAdd={onAdd} onInvite={onInvite} onEmailInvite={onEmailInvite} initialQuery={initialQuery}/>:<div className="cs-people-privacy"><Icon name="lock" size={13}/>Sign in and create a circle to invite someone. People are added only after they accept the invitation.</div>)}{error&&<p className="cs-inline-error" role="alert">{error}</p>}</section>;
}


export {default as LocationAction} from './LocationAction.jsx';

