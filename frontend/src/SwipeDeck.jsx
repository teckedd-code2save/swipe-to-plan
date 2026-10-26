import { useEffect, useId, useRef, useState } from 'react';
import { swipeDirection } from './swipe.js';

export function DeckIcon({ name, size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={name === 'heart' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === 'heart' ? <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/> : name === 'undo' ? <><path d="m8 3-5 5 5 5M3 8h10a7 7 0 0 1 0 14"/></> : name === 'arrow' ? <path d="M4 12h16m-6-6 6 6-6 6"/> : name === 'pin' ? <><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></> : name === 'sound' ? <><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></> : <path d="m6 6 12 12M6 18 18 6"/>}</svg>;
}
export default function SwipeDeck({ deck, history, onDecide, onUndo, onDone, doneLabel = 'See my picks', completeText, disabled = false, onAddMissing, onDecideCard }) {
  const collectionId=useId();
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [spread, setSpread] = useState(false);
  const [stackQuery, setStackQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [outgoingCard, setOutgoingCard] = useState(null);
  const pointer = useRef(null), locked = useRef(false), timer = useRef(null), surface = useRef(null);
  const card = leaving ? outgoingCard : deck[history.length];
  const likes = history.filter((h) => h.like).length;
  useEffect(() => () => clearTimeout(timer.current), []);
  function decide(like) {
    if (!card || locked.current || disabled) return;
    locked.current = true; setDragging(false); setOutgoingCard(card); setLeaving(true);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setOffset({ x: (like ? 1 : -1) * 650, y: -25 });
    // Commit the choice before the animation: closing or switching people must not lose it.
    onDecide(like);
    timer.current = setTimeout(() => {
      setOffset({ x: 0, y: 0 }); setLeaving(false); setOutgoingCard(null); locked.current = false;
    }, reduced ? 0 : 180);
  }
  function release(e) {
    if (!pointer.current || pointer.current.id !== e.pointerId) return;
    const { x, y } = pointer.current;
    const direction = swipeDirection(e.clientX - x, e.clientY - y, e.currentTarget.clientWidth);
    pointer.current = null; setDragging(false);
    if (direction) decide(direction === 'like'); else setOffset({ x: 0, y: 0 });
  }
  function cancel() { pointer.current = null; setDragging(false); if (!leaving) setOffset({ x: 0, y: 0 }); }
  function undo() { if (locked.current || disabled || !history.length) return; cancel(); onUndo(); surface.current?.focus({ preventScroll: true }); }
  return <div className="swipe-deck" ref={surface} tabIndex={0} role="group" aria-label="Swipe taste cards" onKeyDown={(e) => {
    if (e.target.closest('input,button,select,textarea,[contenteditable=true]'))return;
    if (e.key === 'ArrowDown') {e.preventDefault();setSpread(true);}
    if (e.key === 'ArrowUp') {e.preventDefault();setSpread(false);}
    if (e.key === 'ArrowRight') { e.preventDefault(); decide(true); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); decide(false); }
    if (e.key.toLowerCase() === 'z' || e.key === 'Backspace') { e.preventDefault(); undo(); }
  }}>
    <div className="deck-progress"><span>{card ? `${String(history.length + 1).padStart(2, '0')} / ${deck.length}` : 'All swiped'}</span><div className="progress-track"><span style={{ width: `${100 * history.length / Math.max(deck.length, 1)}%` }}/></div><span><DeckIcon name="heart" size={12}/>{likes}</span></div>
    <div className="deck-view-controls"><span>{spread?'Explore the cards':'Swipe sideways or use the buttons'}</span><button type="button" aria-expanded={spread} aria-controls={collectionId} onClick={()=>{cancel();setSpread(value=>!value);}}>{spread?'One at a time':'See all cards'}</button></div>
    {spread&&<div className="deck-spread" id={collectionId} aria-label="Expanded taste card fan">
      <label className="deck-spread-search">Find in this stack<input type="search" value={stackQuery} onChange={e=>setStackQuery(e.target.value)} placeholder="Search your cards…"/></label>
      {deck.slice(history.length).filter(item=>[item.label,item.sub,item.kind,item.group].some(value=>String(value||'').toLowerCase().includes(stackQuery.trim().toLowerCase()))).map((item,index)=><article key={item.id} className={`taste-card deck-fan-card ${item.kind} ${item.group||''}`} style={{'--fan-index':index}}>
        <div className="card-topline"><span className="card-glyph">{item.emoji}</span><span>{item.kind==='artist'?'Artist':item.group==='food'?'Food':item.group==='activity'?'Things to do':'Mood'}</span></div>
        <div className="taste-card-copy"><h2>{item.promptLabel||item.label}</h2><p>{item.promptSub||item.sub}</p></div>
        {(onDecideCard||item.id===deck[history.length]?.id)&&<div className="deck-fan-actions"><button type="button" disabled={disabled||leaving} onClick={()=>onDecideCard?onDecideCard(item.id,false):decide(false)} aria-label={`Skip ${item.label}`}><DeckIcon name="close" size={17}/> Pass</button><button type="button" disabled={disabled||leaving} onClick={()=>onDecideCard?onDecideCard(item.id,true):decide(true)} aria-label={`Love ${item.label}`}><DeckIcon name="heart" size={17}/> Love</button></div>}
      </article>)}
      {!deck.slice(history.length).some(item=>[item.label,item.sub,item.kind,item.group].some(value=>String(value||'').toLowerCase().includes(stackQuery.trim().toLowerCase())))&&<div className="deck-no-match"><p>No matching cards.</p>{onAddMissing&&stackQuery.trim()&&<button type="button" onClick={()=>{onAddMissing(stackQuery.trim());setStackQuery('');}}>Add {stackQuery.trim()} to favorites</button>}</div>}
    <button type="button" className="deck-gather" onClick={()=>{setSpread(false);surface.current?.focus({preventScroll:true});}}>Back to one card</button>
    </div>}
    <div className="card-stack" style={spread?{display:'none'}:undefined}>
      <div className="stack-sheet sheet-back" aria-hidden="true"/><div className="stack-sheet sheet-front" aria-hidden="true"/>
      {card ? <article className={`taste-card ${card.kind} ${card.group||''} ${dragging ? 'dragging' : ''} ${leaving ? 'leaving' : ''}`} key={card.id} aria-label={`${card.label}, ${card.kind}`} style={{ transform: `translate(${offset.x}px, ${offset.y * 0.15}px) rotate(${Math.max(-15, Math.min(15, offset.x / 20))}deg)` }}
        onPointerDown={(e) => { if (disabled || locked.current || (e.pointerType === 'mouse' && e.button !== 0)) return; pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY, active:false }; }}
        onPointerMove={(e) => { const start=pointer.current;if(start?.id!==e.pointerId)return;const x=e.clientX-start.x,y=e.clientY-start.y;if(!start.active){if(Math.abs(y)>12&&Math.abs(y)>Math.abs(x)){cancel();return;}if(Math.abs(x)<8||Math.abs(x)<Math.abs(y)*1.2)return;start.active=true;e.currentTarget.setPointerCapture(e.pointerId);setDragging(true);}setOffset({x,y:0}); }}
        onPointerUp={release} onPointerCancel={cancel} onLostPointerCapture={() => { if (pointer.current) cancel(); }}>
        <div className="card-orbit" aria-hidden="true"/>
        <div className="card-topline"><span className="card-glyph" aria-hidden="true">{card.emoji}</span><span>{card.kind === 'artist' ? 'Artist' : card.group==='food'?'Food':card.group==='activity'?'Things to do':'Mood'}</span></div>
        {offset.x > 28 && <span className="swipe-stamp love-stamp">LOVE IT</span>}{offset.x < -28 && <span className="swipe-stamp skip-stamp">PASS</span>}
        <div className="taste-card-copy"><span className="card-kind">{card.kind === 'artist' ? 'On repeat' : card.group==='food'?'At the table':card.group==='activity'?'Out in the world':'The feeling'}</span><h2>{card.promptLabel||card.label}</h2><p>{card.promptSub||card.sub}</p></div>
      </article> : <div className="deck-complete"><span className="complete-heart"><DeckIcon name="heart" size={42}/></span><h2>You've got taste.</h2><p>{completeText||`${likes} favorites. Let's find your places.`}</p><button className="primary" disabled={disabled} onClick={onDone}>{doneLabel}<DeckIcon name="arrow" size={18}/></button></div>}
    </div>
    {!spread&&<div className="decision-controls"><button type="button" className="undo-action" disabled={!history.length || leaving || disabled} onClick={undo} aria-label="Undo last swipe" title="Undo (Z)"><DeckIcon name="undo" size={21}/></button><button type="button" className="decision skip-action" disabled={!card || leaving || disabled} onClick={() => decide(false)} aria-label="Skip this card"><DeckIcon name="close" size={29}/><span>Skip</span></button><button type="button" className="decision love-action" disabled={!card || leaving || disabled} onClick={() => decide(true)} aria-label="Like this card"><DeckIcon name="heart" size={28}/><span>Love</span></button><span className="control-spacer"/></div>}
    <p className="keyboard-hint">Swipe or tap · <kbd>←</kbd> skip <kbd>→</kbd> love</p>
    {card && <button className="early-picks" disabled={disabled || leaving} onClick={onDone}>{doneLabel} now <DeckIcon name="arrow" size={16}/></button>}
    <span className="sr-only" role="status">{card ? `${card.label}. Card ${history.length + 1} of ${deck.length}. ${likes} liked.` : `All cards completed. ${likes} liked.`}</span>
  </div>;
}

