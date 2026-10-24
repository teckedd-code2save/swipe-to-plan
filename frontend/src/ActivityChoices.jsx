import {ACTIVITY_NAMES,Icon} from './PlannerIcons.jsx';

export default function ActivityChoices({activities,children=0,disabled=false,onChange}) {
  return <fieldset className="pl-fieldset cs-activity-choices">
    <legend>What would you like to do?</legend>
    <p className="pl-help">Choose 1–3, in the order you want them. One place can be plenty.</p>
    <div className="pl-choice-row">{Object.entries(ACTIVITY_NAMES).map(([key,name])=>{
      const selected=activities.includes(key);
      return <button type="button" key={key} disabled={disabled||(key==='drinks'&&!!children)||(!selected&&activities.length>=3)} className={`pl-choice ${selected?'selected':''}`} aria-pressed={selected} onClick={()=>onChange(selected?activities.filter(a=>a!==key):[...activities,key])}><Icon name={key} size={17}/>{name}{selected&&<span>{activities.indexOf(key)+1}</span>}</button>;
    })}</div>
  </fieldset>;
}
