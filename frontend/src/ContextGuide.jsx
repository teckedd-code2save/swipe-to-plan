import {CONTEXT_RESEARCH} from '../../shared/research-context.js';

export default function ContextGuide({plan,onRemember}){
  const people=(plan.people||[]).filter(p=>p.taste?.contextSignals);
  if(!people.some(p=>p.taste.contextSignals.audiences.length||p.taste.contextSignals.interests.length||p.taste.contextSignals.unresolved.length))return null;
  return <details className="cs-action"><summary>What shaped these suggestions</summary>
    {people.map(person=>{const signals=person.taste.contextSignals;return <div key={person.id}>
      <strong>{person.name}</strong>
      {!!signals.audiences.length&&<p>Qloo context clues: {signals.audiences.map(a=>a.name).join(', ')}. These are broad audience correlations, given less weight than personal interests.</p>}
      {!!signals.interests.length&&<p>Cultural interests used: {signals.interests.map(i=>`${i.name} (${i.type.replaceAll('_',' ')})`).join(', ')}.</p>}
      {!!signals.unresolved.length&&<p>Not used: {signals.unresolved.map(i=>i.name).join(', ')}. No unambiguous cultural match was found.</p>}
    </div>;})}
    {onRemember&&<button type="button" onClick={onRemember}>Remember my context for future outings</button>}
    <p>These inputs guide the search; they do not prove why an individual place fits you. Your choices refine the outing.</p>
    <details><summary>Research behind the approach</summary><p>We explore opportunities to relax, connect, discover and choose for yourself. Research informs these possibilities; your work does not determine your tastes, and an outing is not a health treatment.</p>{CONTEXT_RESEARCH.map(source=><p key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> — {source.summary}</p>)}</details>
  </details>;
}
