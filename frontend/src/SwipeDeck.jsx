import { useEffect, useId, useRef, useState } from 'react';
import { swipeDirection } from './swipe.js';
import {Button, Card, Flex, Grid, IconButton, Text, TextField} from '@radix-ui/themes';

export function DeckIcon({ name, size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={name === 'heart' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === 'heart' ? <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/> : name === 'undo' ? <><path d="m8 3-5 5 5 5M3 8h10a7 7 0 0 1 0 14"/></> : name === 'arrow' ? <path d="M4 12h16m-6-6 6 6-6 6"/> : name === 'pin' ? <><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></> : name === 'sound' ? <><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></> : <path d="m6 6 12 12M6 18 18 6"/>}</svg>;
}
export default function SwipeDeck({ deck, history, onDecide, onUndo, onDone, doneLabel = 'See my picks', completeText, disabled = false, onAddMissing, onDecideCard, savedIds = [], agentic = false }) {
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
    if (onDecide(like) === false) { setDragging(false); setOffset({x:0,y:0}); return; }
    locked.current = true; setDragging(false); setOutgoingCard(card); setLeaving(true);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setOffset({ x: (like ? 1 : -1) * 650, y: -25 });
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
    <Flex className="deck-view-controls" align="center" justify="between" gap="3" mb="3"><Text size="2" color="gray">{spread?'Browse and choose what you like':'Swipe or choose below'}</Text><IconButton type="button" variant="soft" size="2" aria-label={spread?'Show one card at a time':'Show all cards'} title={spread?'Show one card at a time':'Show all cards'} aria-expanded={spread} aria-controls={collectionId} onClick={()=>{cancel();setSpread(value=>!value);}}>{spread?<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/></svg>:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>}</IconButton></Flex>
    {spread&&<div className="deck-collection" id={collectionId} aria-label="All taste cards">
      <TextField.Root size="3" type="search" aria-label="Find in this stack" value={stackQuery} onChange={e=>setStackQuery(e.target.value)} placeholder="Find a taste…"/>
      <Grid columns="1" gap="3" mt="3">
      {deck.slice(history.length).filter(item=>[item.label,item.sub,item.kind,item.group].some(value=>String(value||'').toLowerCase().includes(stackQuery.trim().toLowerCase()))).map(item=><Card key={item.id} size="2" className="deck-collection-card"><Flex direction="column" gap="2" height="100%"><Text size="2" color="gray">{item.emoji} &nbsp;{savedIds.includes(item.id) ? "Saved · " : ""}{item.kind==='artist'?'Artist':item.group==='food'?'Food':item.group==='activity'?'Things to do':'Mood'}</Text><Text as="div" size="4" weight="bold">{item.promptLabel||item.label}</Text><Text as="p" size="2" color="gray">{item.promptSub||item.sub}</Text>{(onDecideCard||item.id===deck[history.length]?.id)&&<Flex gap="2" mt="auto" pt="2"><Button type="button" variant="soft" size="2" disabled={disabled||leaving} onClick={()=>onDecideCard?onDecideCard(item.id,false):decide(false)} aria-label={`Skip ${item.label}`}><DeckIcon name="close" size={16}/>Pass</Button><Button type="button" variant="soft" size="2" disabled={disabled||leaving} onClick={()=>onDecideCard?onDecideCard(item.id,true):decide(true)} aria-label={`Love ${item.label}`}><DeckIcon name="heart" size={15}/>Love</Button></Flex>}</Flex></Card>)}
      </Grid>
      {!deck.slice(history.length).some(item=>[item.label,item.sub,item.kind,item.group].some(value=>String(value||'').toLowerCase().includes(stackQuery.trim().toLowerCase())))&&<div className="deck-no-match"><p>No matching cards.</p>{onAddMissing&&stackQuery.trim()&&<Button type="button" variant="soft" onClick={()=>{onAddMissing(stackQuery.trim());setStackQuery('');}}>Add {stackQuery.trim()} to favorites</Button>}</div>}
    </div>}
    <div className="card-stack" style={spread?{display:'none'}:undefined}>
      <div className="stack-sheet sheet-back" aria-hidden="true"/><div className="stack-sheet sheet-front" aria-hidden="true"/>
      {card ? <article className={`taste-card ${card.kind} ${card.group||''} ${dragging ? 'dragging' : ''} ${leaving ? 'leaving' : ''}`} key={card.id} aria-label={`${card.label}, ${card.kind}`} style={{ transform: `translate(${offset.x}px, ${offset.y * 0.15}px) rotate(${Math.max(-15, Math.min(15, offset.x / 20))}deg)` }}
        onPointerDown={(e) => { if (disabled || locked.current || (e.pointerType === 'mouse' && e.button !== 0)) return; pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY, active:false }; }}
        onPointerMove={(e) => { const start=pointer.current;if(start?.id!==e.pointerId)return;const x=e.clientX-start.x,y=e.clientY-start.y;if(!start.active){if(Math.abs(y)>12&&Math.abs(y)>Math.abs(x)){cancel();return;}if(Math.abs(x)<8||Math.abs(x)<Math.abs(y)*1.2)return;start.active=true;e.currentTarget.setPointerCapture(e.pointerId);setDragging(true);}setOffset({x,y:0}); }}
        onPointerUp={release} onPointerCancel={cancel} onLostPointerCapture={() => { if (pointer.current) cancel(); }}>
        <div className="card-orbit" aria-hidden="true"/>
        <div className="card-topline"><span className="card-glyph" aria-hidden="true">{card.emoji}</span><span>{savedIds.includes(card.id) ? 'Saved · ' : ''}{card.kind === 'artist' ? 'Artist' : card.group==='food'?'Food':card.group==='activity'?'Things to do':'Mood'}</span></div>
        {swipeDirection(offset.x,0,surface.current?.clientWidth||400)==='like' && <span className="swipe-stamp love-stamp">LOVE IT</span>}{swipeDirection(offset.x,0,surface.current?.clientWidth||400)==='skip' && <span className="swipe-stamp skip-stamp">PASS</span>}
        <div className="taste-card-copy"><span className="card-kind">{card.kind === 'artist' ? 'On repeat' : card.group==='food'?'At the table':card.group==='activity'?'Out in the world':'The feeling'}</span><h2>{card.promptLabel||card.label}</h2><p>{card.promptSub||card.sub}</p></div>
      </article> : <div className="deck-complete"><span className="complete-heart"><DeckIcon name="heart" size={42}/></span><h2>You've got taste.</h2><p>{completeText||`${likes} favorites. Let's find your places.`}</p><button className="primary" disabled={disabled} onClick={onDone}>{doneLabel}<DeckIcon name="arrow" size={18}/></button></div>}
    </div>
    {!spread&&<div className="decision-controls"><button type="button" className="undo-action" disabled={!history.length || leaving || disabled} onClick={undo} aria-label="Undo last swipe" title="Undo (Z)"><DeckIcon name="undo" size={21}/></button><button type="button" className="decision skip-action" disabled={!card || leaving || disabled} onClick={() => decide(false)} aria-label="Skip this card"><DeckIcon name="close" size={29}/><span>Skip</span></button><button type="button" className="decision love-action" disabled={!card || leaving || disabled} onClick={() => decide(true)} aria-label="Like this card"><DeckIcon name="heart" size={28}/><span>Love</span></button><span className="control-spacer"/></div>}
    {!spread&&<p className="keyboard-hint">Swipe or tap · <kbd>←</kbd> skip <kbd>→</kbd> love</p>}
    {card && !agentic && <button className="early-picks" disabled={disabled || leaving} onClick={onDone}>{doneLabel} now <DeckIcon name="arrow" size={16}/></button>}
    <span className="sr-only" role="status">{card ? `${card.label}. Card ${history.length + 1} of ${deck.length}. ${likes} liked.` : `All cards completed. ${likes} liked.`}</span>
  </div>;
}

