import {useEffect,useRef,useState} from 'react';
import SwipeDeck from './SwipeDeck.jsx';
import {Icon,PERSON_COLORS,Sun} from './PlannerIcons.jsx';
import {tasteFromSwipe} from './day-state.js';

export default function TasteStudio({person,index=0,deck,onChange,onClose,liveStatus,editable=true,onRemove}) {
  const dialog=useRef(null), current=useRef(person);
  const [history,setHistory]=useState([]),[error,setError]=useState(''),[custom,setCustom]=useState(''),[name,setName]=useState(person.name);
  useEffect(()=>{dialog.current.showModal();},[]);
  useEffect(()=>{current.current=person;},[person]);
  const color=PERSON_COLORS[index%PERSON_COLORS.length];
  const ordered=useRef([...deck.filter(c=>c.kind==='vibe'),...deck.filter(c=>c.kind==='artist')]).current;
  function change(next) {current.current=next;onChange(next);setError('');}
  function decide(like) {
    const card=ordered[history.length];if(!card)return;
    try {const before=current.current;const after=tasteFromSwipe(before,card,like);change(after);setHistory(h=>[...h,{id:card.id,like,before}]);}
    catch(e){setError(e.message);}
  }
  function undo() {const last=history.at(-1);if(last){change(last.before);setHistory(h=>h.slice(0,-1));}}
  return <dialog ref={dialog} className="pl-dialog gs-taste-dialog" onCancel={onClose} aria-labelledby="taste-studio-title">
    <div className="pl-dialog-heading"><div className="gs-person-heading"><span className="gs-avatar" style={{background:color}}>{person.name.slice(0,2).toUpperCase()}</span><div><p className="pl-kicker">ONE TASTE IN YOUR SHARED DAY</p><h2 id="taste-studio-title">{person.name==='You'?'Your':`${person.name}’s`} kind of day.</h2></div></div><button className="pl-icon-button" onClick={onClose} aria-label="Close taste studio"><Icon name="close"/></button></div>
    <div className="gs-taste-layout"><div className="gs-swipe-zone"><div className="gs-live-caption"><Sun size={16}/><span>{liveStatus||'Every favorite shapes your day automatically.'}</span></div>{editable?<SwipeDeck deck={ordered} history={history} onDecide={decide} onUndo={undo} onDone={onClose} doneLabel="Back to our day" completeText="Your favorites are part of the same day. Keep exploring together."/>:<p className="pl-muted">This person adds their own tastes from their personal link.</p>}</div><aside className="gs-taste-notes"><label className="gs-taste-name">What should I call you?<input aria-label="Person’s name" maxLength={24} disabled={!editable} value={name} onChange={e=>setName(e.target.value)} onBlur={()=>{if(name.trim()&&name.trim()!==person.name)change({...person,name:name.trim()});else setName(person.name);}}/></label><p className="pl-kicker">THE LITTLE THINGS THEY LOVE</p><h3>A fingerprint,<br/><em>not a form.</em></h3><p>Swipe right for a favorite. The planner finds the common ground with everyone else.</p><div className="gs-selected-tastes">{person.artists.map(a=><button key={a} disabled={!editable} onClick={()=>change({...person,artists:person.artists.filter(v=>v!==a)})}><Icon name="music" size={13}/>{a}<Icon name="close" size={12}/></button>)}{person.vibes.map(id=><button key={id} disabled={!editable} onClick={()=>change({...person,vibes:person.vibes.filter(v=>v!==id)})}><Icon name="leaf" size={13}/>{deck.find(c=>c.id===id)?.label||id}<Icon name="close" size={12}/></button>)}</div>{!person.artists.length&&!person.vibes.length&&<div className="gs-taste-placeholder"><Icon name="nodes" size={24}/><span>Their first favorite starts a thread.</span></div>}{editable&&<form onSubmit={e=>{e.preventDefault();if(!custom.trim())return;try{change(tasteFromSwipe(person,{kind:'artist',label:custom.trim()},true));setCustom('');}catch(e){setError(e.message);}}}><label htmlFor="custom-artist">Someone else on repeat?</label><div className="gs-custom-artist"><input id="custom-artist" value={custom} maxLength={160} onChange={e=>setCustom(e.target.value)} placeholder="Add a favorite artist"/><button aria-label="Add artist" disabled={!custom.trim()}><Icon name="plus" size={18}/></button></div></form>}<div className="gs-connected-note"><Icon name="nodes" size={20}/><p>These choices flow into your itinerary, budget split and taste map. There’s no separate shortlist.</p></div>{onRemove&&<button className="gs-remove-person" onClick={()=>Promise.resolve(onRemove()).catch(e=>setError(e.message))}><Icon name="close" size={13}/>Remove from this day</button>}{error&&<p className="pl-error" role="alert">{error}</p>}</aside></div>
  </dialog>;
}
