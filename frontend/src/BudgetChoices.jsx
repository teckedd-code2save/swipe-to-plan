import {useEffect,useId,useRef,useState} from 'react';
import {Icon} from './PlannerIcons.jsx';
import {formatMoney,allowanceLabel} from './money.js';
import {suggestBudget,budgetBasis} from '../../shared/budget-suggestion.js';
import SpendingChoices from './SpendingChoices.jsx';
import './budget-choices.css';

export default function BudgetChoices({request,onBudget,onPerson,disabled=false}) {
  const amountId=useId(),dirty=useRef(false),lastSaved=useRef(null);
  const suggested=request.budget==null,total=suggested?suggestBudget(request):request.budget;
  const [amount,setAmount]=useState(total??''),[personId,setPersonId]=useState(request.people[0]?.id),[saving,setSaving]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setAmount(total??'');dirty.current=false;setError('');},[total,request.currency]);
  const person=request.people.find(p=>p.id===personId)||request.people[0],party=request.party.adults+request.party.children;
  async function apply(event){event?.preventDefault();const value=Number(amount);if(!dirty.current||saving||!Number.isInteger(value)||value<1||value>10000000||lastSaved.current===value)return;setSaving(true);setError('');lastSaved.current=value;try{await onBudget(value);dirty.current=false;}catch(e){lastSaved.current=null;setError(e.message);}finally{setSaving(false);}}

  return <section className="bc-card bc-editor" aria-label="Spending choices">
    <div className="bc-heading"><Icon name="wallet" size={20}/><div><span>{suggested?'PLANNING ESTIMATE':'YOUR SPENDING LIMIT'}</span><h3>{party===1?'Your budget':'Budget for the whole group'}</h3></div></div>
    {onBudget?<form className="bc-direct-amount" onSubmit={apply}><label htmlFor={amountId}>Total amount <span>({request.currency})</span></label><div><span aria-hidden="true">{request.currency}</span><input id={amountId} aria-label={`Total budget in ${request.currency}`} required type="number" inputMode="numeric" min="1" max="10000000" step="1" value={amount} disabled={disabled||saving} onChange={e=>{dirty.current=true;lastSaved.current=null;setAmount(e.target.value);}} onBlur={()=>apply()}/><span className="bc-save-state" role="status">{saving?'Saving…':'Saves as you go'}</span></div></form>:<strong>{formatMoney(total,request.currency)}</strong>}
    <p className="bc-total-note">{suggested?'An estimate, not a set limit. Edit the amount to set a limit.':'Applies to the whole outing, including stops and getting around.'}{party>1&&total!=null?` About ${formatMoney(Math.floor(total/party),request.currency)} each for ${party} people.`:''}</p>
    {error&&<p role="alert">{error}</p>}
    {person&&onPerson&&<details className="bc-preferences"><summary>Personal spending preferences<Icon name="edit" size={14}/></summary>{request.people.length>1&&<label className="bc-person">Preferences for<select value={person.id} onChange={e=>setPersonId(e.target.value)}>{request.people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}<SpendingChoices person={person} disabled={disabled||saving} onChange={onPerson}/><small>Preferences shape the breakdown; the total stays the same.</small></details>}
    <details className="bc-basis"><summary>{suggested?'About this estimate':'About the breakdown'}</summary><p>{suggested?budgetBasis:`${allowanceLabel(request)}. Menu prices and transport costs still need checking.`}</p></details>
  </section>;
}
