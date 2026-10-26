import {Icon,Sun} from './PlannerIcons.jsx';

export default function NextSteps({steps,onAction,compact=false,disabled=false}) {
  if(!steps)return null;
  return <section className={`cs-next-steps ${compact?'compact':''} ${steps.attention?'attention':''}`} aria-label="Suggested next steps">
    <div className="cs-next-note"><Sun size={16}/><p>{steps.note}</p></div>
    <div className="cs-next-buttons">{(compact?steps.actions.slice(0,2):steps.actions).map(action=><button type="button" key={action.id} onClick={()=>onAction(action)} disabled={disabled}><Icon name={action.icon} size={14}/>{action.label}<Icon name="arrow" size={13}/></button>)}</div>
  </section>;
}

