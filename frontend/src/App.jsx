import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import SwipeDeck, { DeckIcon } from './SwipeDeck.jsx';
import { decideCard, undoCard, likedCards } from './swipe.js';

const AREAS = ['Accra','Osu','East Legon','Cantonments','Labone','Airport Residential'];
const INTENTS = [['any','Anything'],['dinner','Dinner'],['drinks','Drinks'],['coffee','Coffee']];
const roomFromHash = () => (location.hash.match(/^#\/room\/([A-Z0-9]+)$/i)||[])[1]?.toUpperCase() || null;
const wireFeedback = (values) => values.map(({candidateId,reason})=>({candidateId,reason}));

export default function App() {
  const [deck,setDeck]=useState([]), [health,setHealth]=useState(null), [error,setError]=useState(''), [reload,setReload]=useState(0), [code,setCode]=useState(roomFromHash);
  useEffect(()=>{const change=()=>setCode(roomFromHash());addEventListener('hashchange',change);return()=>removeEventListener('hashchange',change);},[]);
  useEffect(()=>{let cancelled=false;setError('');Promise.all([api.deck(),api.health()]).then(([cards,info])=>{if(!cancelled){setDeck(cards);setHealth(info);}}).catch(()=>{if(!cancelled)setError('Discovery is unavailable.');});return()=>{cancelled=true;};},[reload]);
  return <div className="app"><a className="skip-link" href="#main">Skip to cards</a><header><a className="logo" href="#/" aria-label="Outing home">Outing<span>.</span></a><div className="header-meta"><span className="source-dot"/>{health?.provider==='demo'?'Demo · sample places':'Taste by Qloo'}</div></header>
    {error&&<p className="app-error" role="alert">{error} <button onClick={()=>setReload(n=>n+1)}>Reconnect</button></p>}
    {code?<Room key={code} code={code} deck={deck}/>:<Solo deck={deck} roomsConfigured={health?.roomsConfigured}/>}
    <footer><span>Made for your kind of day.</span><a href="/api/schema" target="_blank" rel="noreferrer">For agents ↗</a></footer>
  </div>;
}

function CompactOptions({options,setOptions,disabled=false}) {
  return <div className="compact-options"><label><span className="sr-only">Outing</span><select disabled={disabled} value={options.intent} onChange={e=>setOptions({...options,intent:e.target.value})}>{INTENTS.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label className="location-option"><DeckIcon name="pin" size={16}/><span className="sr-only">Location</span><select disabled={disabled} value={options.area} onChange={e=>setOptions({...options,area:e.target.value})}>{AREAS.map(area=><option key={area} value={area}>{area==='Accra'?'All Accra':area}</option>)}</select></label></div>;
}
function PriceOption({value,onChange,disabled}) {
  return <details className="price-option"><summary>{value?`Price tier ≤ ${value}`:'Price preference'}</summary><label>Provider price cap<select value={value||''} disabled={disabled} onChange={e=>onChange(e.target.value)}><option value="">No cap</option>{[1,2,3,4].map(n=><option key={n} value={n}>Tier {n} or below</option>)}</select></label><p>Reported tiers, not current quotes. Unknown prices are excluded with a cap.</p></details>;
}

function Solo({deck,roomsConfigured}) {
  const [history,setHistory]=useState([]), [options,setOptions]=useState({intent:'any',area:'Accra',price:''}), [stage,setStage]=useState('swipe'), [data,setData]=useState(null), [feedback,setFeedback]=useState([]), [busy,setBusy]=useState(false), [error,setError]=useState('');
  const inFlight=useRef(false), last=useRef(null), resultHeading=useRef(null), focusResults=useRef(false);
  const liked=likedCards(history);
  useEffect(()=>{if(stage==='results'&&focusResults.current){resultHeading.current?.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});focusResults.current=false;}},[stage,data]);
  const body=()=>({intent:options.intent,location:{area:options.area},liked,constraints:options.price?{maxPriceLevel:Number(options.price)}:{},feedback:wireFeedback(feedback)});
  async function find(request=body(),nextFeedback=feedback,focus=true){
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');last.current={request,nextFeedback,focus};
    if(stage==='swipe')setStage('loading');
    try{const result=await api.recommend(request);focusResults.current=focus;setData(result);setFeedback(nextFeedback);setStage('results');}
    catch(e){setError(e.name==='TimeoutError'?'That took too long. Try again.':e.message);if(!data)setStage('swipe');}
    finally{setBusy(false);inFlight.current=false;}
  }
  const updateFeedback=(next)=>find({...data.request,feedback:wireFeedback(next)},next,false);
  function relax(option){const request={...data.request,...option.changes};setOptions({intent:request.intent,area:request.location.area,price:request.constraints.maxPriceLevel?String(request.constraints.maxPriceLevel):''});find(request);}
  async function createRoom(){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{const room=await api.createRoom({intent:options.intent,location:{area:options.area}});location.hash=`#/room/${room.code}`;}catch(e){setError(e.message);}finally{setBusy(false);inFlight.current=false;}}
  const errorView=error&&<div className="error-message" role="alert"><span>{error}</span><button disabled={busy} onClick={()=>last.current?find(last.current.request,last.current.nextFeedback,last.current.focus):find()}>Try again</button></div>;
  if(stage==='loading')return <main id="main" className="loading-page"><div className="spinner"/><h1>Finding your kind of place.</h1><p>Your taste. Real places in {options.area}.</p><div className="loading-cards"><div/><div/></div></main>;
  if(stage==='results'&&data)return <main id="main" className="results-page"><div className="results-toolbar"><button className="back-button" disabled={busy} onClick={()=>setStage('swipe')}>← Keep swiping</button><CompactOptions options={options} setOptions={setOptions} disabled={busy}/><button className="update-button" disabled={busy} onClick={()=>find()}>Update</button></div>{errorView}
    <Feedback feedback={feedback} busy={busy} onUndo={()=>updateFeedback(feedback.slice(0,-1))} onClear={()=>updateFeedback([])}/>
    <Results data={data} busy={busy} headingRef={resultHeading} onFeedback={(item,reason)=>updateFeedback([...feedback.filter(f=>f.candidateId!==item.id),{candidateId:item.id,name:item.name,reason}])} onRelax={relax}/>
  </main>;
  return <main id="main" className="deck-page"><div className="deck-layout"><section className="deck-intro"><h1>Swipe what you <em>love.</em></h1><p className="intro-line">We'll find where to go.</p><CompactOptions options={options} setOptions={setOptions} disabled={busy}/><details className="more-options"><summary>More options</summary><PriceOption value={options.price} onChange={price=>setOptions({...options,price})} disabled={busy}/>{roomsConfigured&&<button className="group-button" disabled={busy} onClick={createRoom}>Plan with friends ↗</button>}</details></section><section className="deck-stage" aria-label="Taste discovery">
    {deck.length?<SwipeDeck deck={deck} history={history} onDecide={like=>setHistory(h=>decideCard(h,deck,like))} onUndo={()=>setHistory(undoCard)} onDone={()=>find()} disabled={busy}/>:<div className="deck-placeholder"><span className="spinner"/><p>Loading your cards…</p><button className="early-picks" onClick={()=>find()}>Find places without taste →</button></div>}{errorView}
  </section></div></main>;
}

function Feedback({feedback,busy,onUndo,onClear}) {
  const [expanded,setExpanded]=useState(false);
  if(!feedback.length)return null;
  const latest=feedback.at(-1);
  return <aside className="feedback-toast" aria-label="Session feedback"><span><strong>{latest.name||'Place'}</strong> hidden{latest.reason==='too_noisy'?' · quieter preferences applied':''}</span><button disabled={busy} onClick={onUndo}><DeckIcon name="undo" size={14}/> Undo</button><button className="feedback-more" aria-expanded={expanded} aria-label="Feedback details" onClick={()=>setExpanded(!expanded)}>···</button>{expanded&&<div className="feedback-detail">{feedback.length} hidden. Noise feedback lowers music/nightlife matches; it doesn't verify quietness. <button disabled={busy} onClick={onClear}>Clear all feedback</button></div>}</aside>;
}
function conciseReason(item,data){const vibe=item.reasons.find(r=>r.code==='vibe_match');if(vibe)return vibe.text;const group=item.reasons.find(r=>r.code==='group_rank');if(group)return group.text;if(data.taste?.resolved.length)return 'Ranked with your artist picks.';const tags=item.tagNames.filter(t=>!/parking|restroom|wheelchair|^\d/.test(t.toLowerCase()));return tags.slice(0,2).join(' · ')||'Matches your outing.';}
function Results({data,busy,headingRef,onFeedback,onRelax}) {
  const demo=data.provenance.provider==='demo';
  const unresolved=data.taste?.unresolved.length||0;
  return <section className="results" aria-label="Recommendations" aria-busy={busy}><div className="results-title"><div><p className="eyebrow">Your next good plan</p><h1 tabIndex={-1} ref={headingRef}>This looks like <em>you.</em></h1></div><span className="results-count">{data.items.length} picks</span></div><div className="results-status" role="status">{busy?<><span className="spinner small"/> Updating…</>:<><span className="status-dot"/>{demo?'Sample venues · demo':data.taste?.resolved.length?'Taste matched by Qloo':'Discovery by Qloo'}{unresolved>0&&' · Some artist signals unavailable'}{data.status==='insufficient_matches'&&' · No filters widened'}</>}</div>
    {!data.items.length&&<div className="empty-state"><DeckIcon name="pin" size={38}/><h2>No close matches yet.</h2><p>Keep your choices, or widen one below.</p></div>}
    <div className="venue-grid">{data.items.map((item,index)=><article className="venue-card" key={item.id} aria-label={item.name}><div className="venue-photo">{item.image?<img src={item.image} alt="" loading="lazy" onError={e=>{e.currentTarget.hidden=true;}}/>:<span className="photo-unavailable">Photo unavailable</span>}<span className="venue-rank">{String(index+1).padStart(2,'0')}</span>{demo&&<span className="sample-chip">Sample</span>}<div className="venue-shade"/><h2>{item.name}</h2></div><div className="venue-body"><p className="venue-reason">{conciseReason(item,data)}</p><p className="venue-address"><DeckIcon name="pin" size={13}/>{item.address||data.request.location.area}</p><div className="venue-actions">{!demo&&item.links.map&&<a className="map-link" href={item.links.map} target="_blank" rel="noreferrer">Let's go ↗</a>}<button disabled={busy} aria-label={`Not relevant: ${item.name}`} title="Not for me" onClick={()=>onFeedback(item,'not_relevant')}><DeckIcon name="close" size={18}/></button><button disabled={busy} aria-label={`Too noisy: ${item.name}`} title="Too noisy" onClick={()=>onFeedback(item,'too_noisy')}><DeckIcon name="sound" size={18}/></button></div><details className="venue-details"><summary>Why this pick <span>+</span></summary><ul>{item.reasons.map(reason=><li key={reason.code}>{reason.text}</li>)}</ul><p>Via {demo?'synthetic demo':'Qloo'} · {item.facts.price.level?`reported price tier ${item.facts.price.level}/4`:'price unknown'}. Hours and availability unverified.</p><p>Location uses source address/locality text; boundaries and current details aren't independently verified.</p><div className="detail-links">{!demo&&Object.entries(item.links).filter(([label,link])=>label!=='map'&&link).map(([label,link])=><a key={label} href={link} target={label==='phone'?undefined:'_blank'} rel="noreferrer">{label==='phone'?'Call venue':label==='menu'?'Menu':'Website'} ↗</a>)}</div></details></div></article>)}</div>
    {!!data.relaxationOptions.length&&<div className="relax-options">{data.relaxationOptions.map(option=><button disabled={busy} key={option.code} onClick={()=>onRelax?.(option)}>{option.code==='remove_price_cap'?'Remove price cap':option.label} →</button>)}</div>}
    <details className="about-picks"><summary>About these picks</summary><p>{data.taste?.resolved.length?`Artist signals used: ${data.taste.resolved.map(s=>s.name).join(', ')}.`:'No artist affinity signals were used.'}</p>{!!unresolved&&<p>Not used: {data.taste.unresolved.map(s=>s.requested).join(', ')}.</p>}{data.people?.map(person=><p key={person.id}>{person.name}: {person.taste.resolved.map(s=>s.name).join(', ')||'no resolved artist signals'}{person.taste.unresolved.length?` · unresolved: ${person.taste.unresolved.map(s=>s.requested).join(', ')}`:''}.</p>)}{data.summary?.map((s,i)=><p key={i}>{s}</p>)}<p>Your constraints are never widened automatically. Confirm hours, availability and prices with the venue. Feedback stays in this session.</p></details>
  </section>;
}

function Room({code,deck}) {
  const [room,setRoom]=useState(null),[name,setName]=useState(''),[history,setHistory]=useState([]),[joined,setJoined]=useState(false),[stage,setStage]=useState('lobby'),[data,setData]=useState(null),[feedback,setFeedback]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  const inFlight=useRef(false);
  useEffect(()=>{let done=false;const load=async()=>{try{const value=await api.room(code);if(!done)setRoom(value);}catch(e){if(!done)setError(e.message);}};load();const timer=setInterval(load,5000);return()=>{done=true;clearInterval(timer);};},[code]);
  async function join(){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{await api.join(code,{name,liked:likedCards(history)});setJoined(true);setStage('lobby');setRoom(await api.room(code));}catch(e){setError(e.message);}finally{inFlight.current=false;setBusy(false);}}
  async function plan(next=feedback){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{setData(await api.plan(code,{feedback:wireFeedback(next)}));setFeedback(next);setStage('results');}catch(e){setError(e.message);}finally{inFlight.current=false;setBusy(false);}}
  async function invite(){try{await navigator.clipboard.writeText(location.href);setCopied(true);}catch{setError('Copy this page’s address to invite friends.');}}
  return <main id="main" className={stage==='results'?'results-page':'room-page'}><button className="back-button" onClick={()=>stage==='results'?setStage('lobby'):location.hash='#/'}>← {stage==='results'?'Room':'Solo discovery'}</button>{error&&<p className="error-message" role="alert">{error}</p>}{stage==='results'&&data?<><Feedback feedback={feedback} busy={busy} onUndo={()=>plan(feedback.slice(0,-1))} onClear={()=>plan([])}/><Results data={data} busy={busy} onFeedback={(item,reason)=>plan([...feedback.filter(f=>f.candidateId!==item.id),{candidateId:item.id,name:item.name,reason}])}/></>:stage==='swipe'?<SwipeDeck deck={deck} history={history} onDecide={like=>setHistory(h=>decideCard(h,deck,like))} onUndo={()=>setHistory(undoCard)} onDone={join} doneLabel="Join the room" disabled={busy}/>:<><p className="eyebrow">Your people. One plan.</p><h1>Room <em>{code}</em></h1><p>{room?`${room.intent==='any'?'Anything':room.intent} · ${room.area}`:'Loading…'}</p><button className="secondary" onClick={invite}>{copied?'Link copied':'Copy invite link ↗'}</button><div className="room-members">{room?.members.map(m=><span key={m.id}>{m.name}</span>)}</div>{!joined&&<form onSubmit={e=>{e.preventDefault();setStage('swipe');}}><label className="sr-only" htmlFor="room-name">Your name</label><input id="room-name" required maxLength={24} value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"/><button className="primary" disabled={busy||!deck.length||!name.trim()||!room||room.members.length>=8}>Swipe your taste →</button></form>}{joined&&<p className="room-joined">You're in. Ready when your friends are.</p>}<button className="early-picks" disabled={busy||!room?.members.length} onClick={()=>plan()}>{busy?'Finding places…':'Build our shortlist →'}</button><details className="about-picks"><summary>Room privacy</summary><p>Names and likes are saved to this room. Anyone with the link can view the members and plan. Feedback is session-only.</p></details></>}</main>;
}
