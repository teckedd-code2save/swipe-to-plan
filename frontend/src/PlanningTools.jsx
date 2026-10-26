import DecisionPanel from './DecisionPanel.jsx';
import {TasteAction} from './ChatActions.jsx';
import {Icon} from './PlannerIcons.jsx';
import BudgetChoices from './BudgetChoices.jsx';

// Each surface has a separate agent action and only the controls for that decision.
export function TasteCardsAction({focus='mood',cardIds=[],...props}) {
  return <TasteAction {...props} focus={focus} suggestedIds={cardIds}/>;
}
export function BudgetAction({brief,onApply,onPerson,onDone,editable=true,busy=false}) {
  return <section className="cs-tool" aria-label="Choose a spending limit"><div className="cs-tool-head"><span><Icon name="wallet" size={18}/>Spending, your way</span><button className="cs-icon-button" aria-label="Close choices" onClick={onDone}><Icon name="close" size={17}/></button></div><BudgetChoices request={brief} onBudget={editable?onApply:undefined} onPerson={editable?onPerson:undefined} disabled={!editable||busy}/><p className="cs-muted">You can explore places without setting a budget.</p></section>;
}
export function MenuChoicesAction(props) { return <DecisionPanel {...props} mode="menus"/>; }
export function ComparePlacesAction(props) { return <DecisionPanel {...props} mode="compare"/>; }
