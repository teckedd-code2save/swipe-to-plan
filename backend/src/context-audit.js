import {publicDeck} from './deck.js';

// A short semantic review may only remove proposed signals. It cannot add tastes,
// change the outing or turn an unsupported occupation into a professional cohort.
export async function auditContext(result,{previous=[],message,history=[],catalog=[],review}){
  const people=result.request?.people||(result.person?[result.person]:[]);
  const changed=people.filter(person=>person.context&&JSON.stringify(person.context)!==JSON.stringify(previous.find(p=>p.id===person.id)?.context));
  if(!changed.length)return result;
  const candidates=changed.map(person=>({id:person.id,context:person.context,audiences:(person.context.audiences||[]).map(id=>catalog.find(a=>a.id===id)).filter(Boolean),vibes:person.vibes.map(id=>({id,label:publicDeck().find(c=>c.id===id)?.label}))}));
  let approved=[];
  try{approved=await review({utterances:[...history.filter(t=>t.role==='user').map(t=>t.text),message],candidates});if(!Array.isArray(approved))approved=[];}catch{/* Keep discovery available; unreviewed new signals are omitted. */}
  for(const person of changed){
    const old=previous.find(p=>p.id===person.id)||{},decision=approved.find(p=>p?.id===person.id)||{};
    const keep=(values,allowed,prior=[])=>values.filter(value=>prior.includes(value)||Array.isArray(allowed)&&allowed.includes(value));
    const context=person.context;
    context.audiences=keep(context.audiences||[],decision.audiences,old.context?.audiences);
    context.interests=(context.interests||[]).filter((interest,index)=>(old.context?.interests||[]).some(i=>i.type===interest.type&&i.name===interest.name)||Array.isArray(decision.interestIndexes)&&decision.interestIndexes.includes(index));
    person.vibes=keep(person.vibes,decision.vibes,old.vibes);
  }
  return result;
}
