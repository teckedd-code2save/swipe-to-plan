import {CONTEXT_RESEARCH} from '../../shared/research-context.js';

export function ResearchSources(){
  return <details className="cs-research-sources"><summary>Research informing suggestions</summary><p>Research guides possibilities to unwind, connect and explore. Your own choices guide the plan.</p>{CONTEXT_RESEARCH.map(source=><p key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></p>)}</details>;
}
export default function ContextGuide({plan,onRemember}){
  const signals=(plan.people||[]).flatMap(p=>[...(p.taste?.contextSignals?.interests||[]).map(i=>i.name),...(p.taste?.contextSignals?.audiences||[]).map(a=>a.name)]);
  if(!signals.length)return null;
  return <details className="cs-context-note"><summary>Why these places</summary><p>Qloo explored connections with { [...new Set(signals)].join(', ')}. These guide discovery; they do not verify an individual place’s fit.</p>{onRemember&&<button type="button" onClick={onRemember}>Remember for next time</button>}</details>;
}
