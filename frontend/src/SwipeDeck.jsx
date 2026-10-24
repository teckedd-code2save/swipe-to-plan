import { useEffect, useRef, useState } from 'react';
import { swipeDirection } from './swipe.js';

export function DeckIcon({ name, size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={name === 'heart' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === 'heart' ? <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/> : name === 'undo' ? <><path d="m8 3-5 5 5 5M3 8h10a7 7 0 0 1 0 14"/></> : name === 'arrow' ? <path d="M4 12h16m-6-6 6 6-6 6"/> : name === 'pin' ? <><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></> : name === 'sound' ? <><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></> : <path d="m6 6 12 12M6 18 18 6"/>}</svg>;
}
export default function SwipeDeck({ deck, history, onDecide, onUndo, onDone, doneLabel = 'See my picks', completeText, disabled = false }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
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
    if (e.key === 'ArrowRight') { e.preventDefault(); decide(true); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); decide(false); }
    if (e.key.toLowerCase() === 'z' || e.key === 'Backspace') { e.preventDefault(); undo(); }
  }}>
    <div className="deck-progress"><span>{card ? `${String(history.length + 1).padStart(2, '0')} / ${deck.length}` : 'All swiped'}</span><div className="progress-track"><span style={{ width: `${100 * history.length / Math.max(deck.length, 1)}%` }}/></div><span><DeckIcon name="heart" size={12}/>{likes}</span></div>
    <div className="card-stack">
      <div className="stack-sheet sheet-back" aria-hidden="true"/><div className="stack-sheet sheet-front" aria-hidden="true"/>
      {card ? <article className={`taste-card ${card.kind} ${card.group||''} ${dragging ? 'dragging' : ''} ${leaving ? 'leaving' : ''}`} key={card.id} aria-label={`${card.label}, ${card.kind}`} style={{ transform: `translate(${offset.x}px, ${offset.y * 0.15}px) rotate(${Math.max(-15, Math.min(15, offset.x / 20))}deg)` }}
        onPointerDown={(e) => { if (disabled || locked.current || (e.pointerType === 'mouse' && e.button !== 0)) return; pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); }}
        onPointerMove={(e) => { if (pointer.current?.id === e.pointerId) setOffset({ x: e.clientX - pointer.current.x, y: e.clientY - pointer.current.y }); }}
        onPointerUp={release} onPointerCancel={cancel} onLostPointerCapture={() => { if (pointer.current) cancel(); }}>
        <div className="card-orbit" aria-hidden="true"/>
        <div className="card-topline"><span className="card-glyph" aria-hidden="true">{card.emoji}</span><span>{card.kind === 'artist' ? 'Artist' : card.group==='food'?'Food':card.group==='activity'?'Things to do':'Mood'}</span></div>
        {offset.x > 28 && <span className="swipe-stamp love-stamp">LOVE IT</span>}{offset.x < -28 && <span className="swipe-stamp skip-stamp">PASS</span>}
        <div className="taste-card-copy"><span className="card-kind">{card.kind === 'artist' ? 'On repeat' : card.group==='food'?'At the table':card.group==='activity'?'Out in the world':'The feeling'}</span><h2>{card.label}</h2><p>{card.sub}</p></div>
      </article> : <div className="deck-complete"><span className="complete-heart"><DeckIcon name="heart" size={42}/></span><h2>You've got taste.</h2><p>{completeText||`${likes} favorites. Let's find your places.`}</p><button className="primary" disabled={disabled} onClick={onDone}>{doneLabel}<DeckIcon name="arrow" size={18}/></button></div>}
    </div>
    <div className="decision-controls"><button type="button" className="undo-action" disabled={!history.length || leaving || disabled} onClick={undo} aria-label="Undo last swipe" title="Undo (Z)"><DeckIcon name="undo" size={21}/></button><button type="button" className="decision skip-action" disabled={!card || leaving || disabled} onClick={() => decide(false)} aria-label="Skip this card"><DeckIcon name="close" size={29}/><span>Skip</span></button><button type="button" className="decision love-action" disabled={!card || leaving || disabled} onClick={() => decide(true)} aria-label="Like this card"><DeckIcon name="heart" size={28}/><span>Love</span></button><span className="control-spacer"/></div>
    <p className="keyboard-hint">Swipe or tap · <kbd>←</kbd> skip <kbd>→</kbd> love</p>
    {card && <button className="early-picks" disabled={disabled || leaving} onClick={onDone}>{doneLabel} now <DeckIcon name="arrow" size={16}/></button>}
    <span className="sr-only" role="status">{card ? `${card.label}. Card ${history.length + 1} of ${deck.length}. ${likes} liked.` : `All cards completed. ${likes} liked.`}</span>
  </div>;
}
