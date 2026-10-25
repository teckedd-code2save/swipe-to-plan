import ActivityChoices from './ActivityChoices.jsx';
import {Icon,dateLabel} from './PlannerIcons.jsx';
import {needsTiming,timingLabel} from './timing.js';
import {formatMoney} from './money.js';
import {CircleFaces} from './Circles.jsx';

// Reuse the studio's inline action pattern: prepare first, discover on request.
export default function PlanReview({brief,deck,hasPlan,confirmed,busy,onActivities,onPlan,onTool,onDetails,onDone}) {
  const favorites=brief.people.reduce((sum,p)=>sum+p.artists.length+p.vibes.length,0);
  const labels=[...new Set(brief.people.flatMap(p=>[...p.artists,...p.vibes.map(id=>deck.find(c=>c.id===id)?.label).filter(Boolean)]))];
  return <section className="cs-tool cs-plan-review" aria-label="Review your plan">
    <div className="cs-tool-head"><span><Icon name="list" size={17}/>Your outing, taking shape</span><button onClick={onDone} aria-label="Close plan review"><Icon name="close" size={15}/></button></div>
    <ActivityChoices activities={brief.activities} children={brief.party.children} disabled={busy||!onActivities} onChange={onActivities}/>
    <button className="cs-review-row" onClick={()=>onTool('people')}><CircleFaces people={brief.people}/><span><strong>{brief.people.map(p=>p.name).join(', ')}</strong><small>{brief.party.adults+brief.party.children} going · add people or bring a circle</small></span><Icon name="arrowUpRight" size={14}/></button>
    <button className={`cs-review-row ${!favorites?'needs-tastes':''}`} onClick={()=>onTool('tastes')}><Icon name="music" size={19}/><span><strong>{favorites?`${favorites} ${favorites===1?'favorite':'favorites'} in the mix`:'What would make this your kind of day?'}</strong><small>{favorites?labels.slice(0,3).join(' · '):'Add food, activities, music and mood'}</small></span><Icon name="plus" size={15}/></button>
    <button className="cs-review-row" onClick={()=>onTool('location')}><Icon name="pin" size={19}/><span><strong>{confirmed?brief.area:'Choose a planning area'}</strong><small>{confirmed?'Area confirmed · change anytime':'I’ll find real places around your chosen area'}</small></span><Icon name="arrowUpRight" size={14}/></button>
    <button className="cs-review-row" onClick={()=>onTool('timing')}><Icon name="calendar" size={19}/><span><strong>Date & time</strong><small>{brief.timing?.dateConfirmed!==false?dateLabel(brief.date):'Choose a day'} · {timingLabel(brief)}</small></span><span className="cs-review-edit">Edit</span></button>
    <button className="cs-review-row" onClick={onDetails}><Icon name="wallet" size={19}/><span><strong>{brief.budget==null?'Set a group budget':`${formatMoney(brief.budget,brief.currency)} group allowance`}</strong><small>Activities, budget and other details</small></span><span className="cs-review-edit">Edit</span></button>
    <p className="cs-review-note">{favorites?'I’ll use everyone’s tastes to find the places.':'You can add tastes first, or ask me to start with the area and activities.'}</p>
    <button className="cs-review-plan" disabled={busy||!brief.activities.length||brief.budget==null} onClick={onPlan}>{!brief.activities.length?'Choose what to do':brief.budget==null?'Set budget':!confirmed?'Choose an area':needsTiming(brief)?'Choose when to go':hasPlan?'Update my plan':'Plan it'}<Icon name="arrow" size={16}/></button>
  </section>;
}
