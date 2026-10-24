import { useEffect, useRef, useState } from 'react';
import { ACTIVITY_NAMES, Icon, PERSON_COLORS } from './PlannerIcons.jsx';

import {CURRENCIES} from './money.js';
const VIBES = [['v-cafe', 'Cozy cafés'], ['v-african', 'African cuisine'], ['v-rooftop', 'Rooftops'], ['v-livemusic', 'Live music'], ['v-bar', 'Cocktail bars'], ['v-club', 'Late-night spots']];

export default function TripEditor({ brief, onClose, onSubmit, hasPlan, groupManaged = false,onLocation,draftOnly=false }) {
  const dialog = useRef(null);
  const [draft, setDraft] = useState(() => structuredClone(brief));
  const [artistText, setArtistText] = useState(() => brief.people.map(p => p.artists.join(', ')));
  const [error, setError] = useState(''),[saving,setSaving]=useState(false);
  useEffect(() => { dialog.current.showModal(); }, []);
  const update = (key, value) => setDraft(d => ({ ...d, [key]: value }));
  const person = (index, key, value) => setDraft(d => ({ ...d, people: d.people.map((p, i) => i === index ? { ...p, [key]: value } : p) }));
  async function submit(event) {
    event.preventDefault();
    if (draft.activities.length < 1 || draft.activities.length > 3) return setError('Choose one to three moments for your day.');
    if (draft.people.length > draft.party.adults + draft.party.children) return setError('There are more taste profiles than people going. Adjust the group size or remove a profile.');
    const people = draft.people.map((p, i) => ({ ...p, artists: [...new Set(artistText[i].split(',').map(a => a.trim()).filter(Boolean))] }));
    if (people.some(p => p.artists.length > 6)) return setError('Add up to six artists for each person.');
    setSaving(true);setError('');
    try{await onSubmit({ ...draft, people, pins: Object.fromEntries(Object.entries(draft.pins||{}).filter(([intent])=>draft.activities.includes(intent))) });}catch(e){setError(e.message);}finally{setSaving(false);}
  }
  return <dialog className="pl-dialog" ref={dialog} onCancel={onClose} aria-labelledby="trip-editor-title">
    <form onSubmit={submit}>
      <div className="pl-dialog-heading"><div><p className="pl-kicker">THE BRIEF</p><h2 id="trip-editor-title">Make it your kind of day.</h2></div><button type="button" className="pl-icon-button" aria-label="Close trip details" onClick={onClose}><Icon name="close"/></button></div>
      <div className="pl-dialog-body">
        <label className="pl-field">Give your day a name<input required maxLength={80} value={draft.title} onChange={e => update('title', e.target.value)}/></label>
        <div className="pl-field-grid">
          <label className="pl-field">City or neighborhood<input readOnly={!!onLocation} required={!onLocation} minLength={2} maxLength={160} aria-label="City or neighborhood" placeholder="e.g. Shibuya, Tokyo, Japan" value={draft.area} onChange={e => update('area', e.target.value)}/>{onLocation&&<button type="button" className="pl-text-button" onClick={()=>onLocation(draft)}>Change planning area</button>}</label>
          <label className="pl-field">When<input required type="date" value={draft.date} onChange={e => update('date', e.target.value)}/></label>
          <label className="pl-field">Adults<input required type="number" min="1" max="8" value={draft.party.adults} onChange={e => update('party', { ...draft.party, adults: Number(e.target.value) })}/></label>
          <label className="pl-field">Children<input required type="number" min="0" max="6" value={draft.party.children} onChange={e => { const children = Number(e.target.value); setDraft(d => ({ ...d, party: { ...d.party, children }, activities: children ? d.activities.filter(a => a !== 'drinks') : d.activities })); }}/></label>
          <label className="pl-field">Start time<input required type="time" value={draft.startTime} onChange={e => update('startTime', e.target.value)}/></label>
          <label className="pl-field">Back by<input required type="time" value={draft.endTime} onChange={e => update('endTime', e.target.value)}/></label>
          <label className="pl-field">Whole group budget<input required type="number" min="1" max="10000000" value={draft.budget} onChange={e => update('budget', Number(e.target.value))}/></label>
          <label className="pl-field">Currency<select value={draft.currency||'GHS'} onChange={e=>setDraft(d=>({...d,currency:e.target.value,currencyMode:'custom'}))}>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></label><label className="pl-field">Pace<select value={draft.pace} onChange={e => update('pace', e.target.value)}><option value="easy">Easy does it · 30 min buffers</option><option value="balanced">A little fuller · 20 min buffers</option></select></label>
        </div>
        <fieldset className="pl-fieldset"><legend>The shape of your day</legend><p className="pl-help">One place can be plenty. Choose 1–3 moments, in the order you want them.</p><div className="pl-choice-row">{Object.entries(ACTIVITY_NAMES).map(([key, name]) => <button type="button" key={key} disabled={key === 'drinks' && !!draft.party.children} className={`pl-choice ${draft.activities.includes(key) ? 'selected' : ''}`} aria-pressed={draft.activities.includes(key)} onClick={() => update('activities', draft.activities.includes(key) ? draft.activities.filter(a => a !== key) : [...draft.activities, key])}><Icon name={key} size={17}/>{name}{draft.activities.includes(key) && <span>{draft.activities.indexOf(key) + 1}</span>}</button>)}</div></fieldset>
        {!groupManaged&&<><div className="pl-editor-people-heading"><div><h3>Who’s coming along?</h3><p className="pl-help">Separate tastes, one thoughtful day. Up to 6 profiles.</p></div><button type="button" className="pl-text-button" disabled={draft.people.length >= Math.min(6, draft.party.adults + draft.party.children)} onClick={() => { update('people', [...draft.people, { name: '', artists: [], vibes: [] }]); setArtistText(a => [...a, '']); }}><Icon name="plus" size={16}/> Add person</button></div>
        {draft.people.map((p, index) => <fieldset className="pl-person-editor" key={index}><legend><i style={{ background: PERSON_COLORS[index] }}/>{p.name || `Person ${index + 1}`}</legend><div className="pl-person-fields"><label className="pl-field">Name<input required maxLength={24} placeholder="First name" value={p.name} onChange={e => person(index, 'name', e.target.value)}/></label>{draft.people.length > 1 && <button type="button" aria-label={`Remove ${p.name || 'person'}`} className="pl-icon-button" onClick={() => { update('people', draft.people.filter((_, i) => i !== index)); setArtistText(a => a.filter((_, i) => i !== index)); }}><Icon name="trash" size={18}/></button>}</div><label className="pl-field">Artists they love<input placeholder="e.g. Amaarae, Tems, Kojo Antwi" value={artistText[index]} onChange={e => setArtistText(a => a.map((text, i) => i === index ? e.target.value : text))}/></label><p className="pl-help">Separate names with commas. Qloo connects music taste to places.</p><div className="pl-choice-row pl-small-choices">{VIBES.filter(([id]) => !draft.party.children || !['v-bar', 'v-club'].includes(id)).map(([id, label]) => <button type="button" key={id} className={`pl-choice ${p.vibes.includes(id) ? 'selected' : ''}`} aria-pressed={p.vibes.includes(id)} onClick={() => person(index, 'vibes', p.vibes.includes(id) ? p.vibes.filter(v => v !== id) : [...p.vibes, id])}>{label}</button>)}</div></fieldset>)}
        </>}
        {groupManaged&&<p className="pl-help">Everyone’s tastes stay connected. Add people and swipe their favorites from the group lineup.</p>}
        <p className="pl-help">Times and budgets are planning allowances. Opening hours, travel times, prices and suitability need confirming with each venue.</p>
        {hasPlan && <p className="pl-help">Kept places and skipped venues stay in your plan when you change the details.</p>}
        {error && <p className="pl-error" role="alert">{error}</p>}
      </div>
      <div className="pl-dialog-footer"><button type="button" className="pl-secondary-button" onClick={onClose}>Cancel</button><button type="submit" disabled={saving} className="pl-button">{draftOnly?'Save details':hasPlan?'Update this plan':'Plan an outing'}<Icon name="arrow" size={18}/></button></div>
    </form>
  </dialog>;
}
