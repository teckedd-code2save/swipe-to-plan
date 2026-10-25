import {useState} from 'react';
import {Icon} from './PlannerIcons.jsx';
import {formatMoney,allowanceLabel} from './money.js';
import {suggestBudget,budgetBasis} from '../../shared/budget-suggestion.js';
import SpendingChoices from './SpendingChoices.jsx';
import './budget-choices.css';

export default function BudgetChoices({request,onBudget,onPerson,disabled=false}) {
  const [editing,setEditing]=useState(false),[amount,setAmount]=useState(''),[personId,setPersonId]=useState(request.people[0]?.id);
  const suggested=request.budget==null;
  const total=suggested?suggestBudget(request):request.budget;
  const person=request.people.find(p=>p.id===personId)||request.people[0];
  return <section className="bc-card" aria-label="Spending choices">
    <div className="bc-heading"><Icon name="wallet" size={19}/><div><span>{suggested?'A STARTING SUGGESTION':'YOUR CHOSEN BUDGET'}</span><h3>{total==null?'What feels comfortable?':`${formatMoney(total,request.currency)} for ${request.party.adults+request.party.children===1?'you':'the group'}`}</h3></div></div>
    <p>{suggested?(total==null?request.activities.length?`Enter an amount in ${request.currency}. I don’t have a starting suggestion for this currency yet.`:'Choose activities to see a starting suggestion, or enter your own amount.':`Does this feel right for ${request.party.adults+request.party.children===1?'you':`the ${request.party.adults+request.party.children} of you`}? Tweak the amount or your spending style below.`):'We’ll divide this amount between your stops, getting around and a little reserve. Your total stays fixed when spending preferences change.'}</p>
    {onBudget&&<div className="bc-actions">{suggested&&total!=null&&<button type="button" className="pl-button" disabled={disabled} onClick={()=>onBudget(total)}>Use {formatMoney(total,request.currency)}<Icon name="check" size={14}/></button>}<button type="button" className="pl-secondary-button" disabled={disabled} aria-expanded={editing} onClick={()=>{setAmount(total??'');setEditing(v=>!v);}}>{total==null?'Set an amount':'Adjust amount'}<Icon name="edit" size={14}/></button></div>}
    {editing&&<form className="bc-amount" onSubmit={e=>{e.preventDefault();onBudget(Number(amount));setEditing(false);}}><label>Whole group allowance ({request.currency})<input autoFocus required type="number" min="1" max="10000000" value={amount} onChange={e=>setAmount(e.target.value)}/></label><button className="pl-button" disabled={disabled}>Apply</button></form>}
    {person&&onPerson&&<>{request.people.length>1&&<label className="bc-person">Spending preferences for<select value={person.id} onChange={e=>setPersonId(e.target.value)}>{request.people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}<SpendingChoices person={person} disabled={disabled} onChange={onPerson}/><small>Adjust spending preferences for this day. Each person gets an equal say in the breakdown.</small></>}
    <details className="bc-basis"><summary>{suggested?'How this suggestion works':'About the breakdown'}</summary><p>{suggested?budgetBasis:`${allowanceLabel(request)}. This is a spending limit, not a quote. Menu prices and transport costs still need checking.`}</p></details>
  </section>;
}
