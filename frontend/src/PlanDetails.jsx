import {Badge,Button,Card,Flex,Heading,Text} from '@radix-ui/themes';
import {routeLink} from './route-links.js';
import {reportedPrice} from './decision-evidence.js';
import BudgetChoices from './BudgetChoices.jsx';
import {formatMoney} from './money.js';
import {useState} from 'react';
import {ACTIVITY_NAMES,Icon,PERSON_COLORS,Sun,money} from './PlannerIcons.jsx';
const partyLabel=r=>`${r.party.adults+r.party.children} ${r.party.adults+r.party.children===1?'person':'people'}`;
export function Budget({ plan,onEdit,onBudget,onPerson,disabled }) {
  if(plan.request.budget==null)return <BudgetChoices request={plan.request} onBudget={onBudget} onPerson={onPerson} disabled={disabled}/>;
  const segments = [...plan.budget.allocations.map((a, i) => ({ label: plan.request.route?`${i+1}. ${plan.stops[i]?.item?.name||ACTIVITY_NAMES[a.intent]}`:ACTIVITY_NAMES[a.intent], amount: a.amount, color: ['#bd633e', '#c6a269', '#657e65'][i], note: a.assigned ? 'Group allowance' : 'Reserved for an unfilled stop' })), { label: 'Getting around', amount: plan.budget.transport, color: '#8d94ab', note: 'Transport allowance' }, { label: 'A little breathing room', amount: plan.budget.reserve, color: '#ddd5c4', note: 'Unallocated buffer' }];
  let offset = 0;
  return <section><BudgetChoices request={plan.request} onBudget={onBudget} onPerson={onPerson} disabled={disabled}/><div className="pl-section-heading"><div><p className="pl-kicker">ROOM FOR THE GOOD STUFF</p><h2>A day within your intentions.</h2><p>Give every part of the day a spending envelope.</p></div></div><div className="pl-budget-layout"><div className="pl-budget-ring"><svg viewBox="0 0 220 220" role="img" aria-label={`Group spending allowance ${formatMoney(plan.budget.total,plan.request.currency)}`}><circle cx="110" cy="110" r="88" fill="none" stroke="#eee8dc" strokeWidth="22"/>{segments.map(segment => { const length = segment.amount / plan.budget.total * 100; const start = offset; offset += length; return <circle key={segment.label} cx="110" cy="110" r="88" fill="none" stroke={segment.color} strokeWidth="22" pathLength="100" strokeDasharray={`${Math.max(0, length - .9)} ${100 - Math.max(0, length - .9)}`} strokeDashoffset={-start} transform="rotate(-90 110 110)"/>; })}<text x="110" y="98" textAnchor="middle" className="pl-ring-label">FOR EVERYONE</text><text x="110" y="128" textAnchor="middle" className="pl-ring-total">{formatMoney(plan.budget.total,plan.request.currency)}</text></svg><span>{partyLabel(plan.request)} · one shared budget</span></div><div className="pl-budget-lines">{segments.map(segment => <div className="pl-budget-line" key={segment.label}><i style={{ background: segment.color }}/><div><strong>{segment.label}</strong><small>{segment.note}</small></div><span>{formatMoney(segment.amount,plan.request.currency)}</span></div>)}</div></div>{plan.budget.influences?.some(p=>p.explicit)&&<div className="cs-spend-influences"><p className="cs-field-label">EVERYONE HAS A SAY</p>{plan.budget.influences.map((p,i)=><button key={p.personId} onClick={()=>onEdit?.(p.personId)}><span className="cs-person-dot" style={{background:PERSON_COLORS[i%6]}}>{p.name[0]}</span><span><strong>{p.name}</strong><small>{({mindful:'Keep it light',balanced:'A good balance',treat:'Make it special'})[p.style]}</small></span><Icon name="arrow" size={13}/><span className="cs-spend-destination">{p.priority==='even'?'Across the day':ACTIVITY_NAMES[p.priority]}{p.priority!=='even'&&!plan.request.activities.includes(p.priority)&&<small>Not in this day yet</small>}</span><Icon name="edit" size={12}/></button>)}<p>The group averages everyone’s reserve preferences and gives extra room to their priorities. The total stays the same.</p></div>}<div className="pl-notice"><Icon name="info" size={20}/><p>These amounts come from your budget, not venue menus. They don’t establish what the day will cost. Check prices before you go.</p></div></section>;
}

export { BeforeGoing } from './PlaceGuide.jsx';

export function Stop({stop,plan,busy,onPin,onSwap,onTrace,onBudget,onDetails,onMenus,onRemove,actions,discovery=false}) {
  const [imageFailed,setImageFailed]=useState(false),item=stop.item;
  if(!item)return <Card className="outing-empty"><Heading size="3">{stop.label||'A place still to find'}</Heading><Text as="p">{stop.reason==='no_open_place'?'The places found don’t fit this time. Change the time or explore another option.':'No matching place returned for this part of your request.'}</Text></Card>;
  const pinned=!!plan.request.pins?.[stop.intent];
  const names=[...new Set((stop.connections||[]).map(edge=>plan.people?.find(p=>p.id===edge.personId)?.name).filter(Boolean))];
  return <Card className="outing-place" size="3" data-stop-id={stop.id} tabIndex={-1} aria-label={item.name}>
    <button className="outing-place-photo" onClick={()=>onDetails(stop)} aria-label={`Explore ${item.name}`}>
      {item.image&&!imageFailed?<img src={item.image} alt="" loading="lazy" onError={()=>setImageFailed(true)}/>:<span><Icon name={stop.intent} size={32}/>{ACTIVITY_NAMES[stop.intent]||'Explore'}</span>}
      {!discovery&&<span className="outing-photo-label">{stop.start?`${stop.start} · ${ACTIVITY_NAMES[stop.intent]}`:'Suggested for your outing'}</span>}
    </button>
    <div className="outing-place-copy"><Flex gap="2" wrap="wrap"><Badge color="gray">{reportedPrice(item)}</Badge>{item.nearby&&<Badge color="amber">{item.nearby.distanceKm} km from your area</Badge>}</Flex>
      <Heading as="h3" size="5" mt="3"><button className="outing-place-name" onClick={()=>onDetails(stop)}>{item.name}</button></Heading>
      <Text as="p" size="2" color="gray" mt="2">{item.address}</Text>
      {item.description&&<Text as="p" size="2" mt="3" className="outing-place-description">{item.description}</Text>}
      {stop.timeStatus==='needs_time'&&<Text as="p" size="2" color="amber">{stop.reason==='time_in_past'?'Your requested time has passed. Choose another time to visit.':'I couldn’t fit this place into your requested time. Its reported hours may not match; explore other places or change the time.'}</Text>}
      {names.length>0&&onTrace&&<button className="outing-fit" onClick={()=>onTrace(stop.id)}><Icon name="nodes" size={14}/>Taste connections for {names.join(', ')}<Icon name="arrow" size={14}/></button>}
      <Flex gap="2" wrap="wrap" mt="4"><Button variant="soft" onClick={()=>onDetails(stop,'practical')}>Menu & details</Button><Button asChild variant="outline"><a href={routeLink({stop},'driving')} target="_blank" rel="noreferrer">Directions ↗</a></Button>{!discovery&&onSwap&&<Button variant="ghost" disabled={busy||pinned} onClick={()=>onSwap(stop)}>Find another</Button>}{onRemove&&<Button variant="ghost" disabled={busy} onClick={()=>onRemove(stop)}>Remove stop</Button>}{actions}</Flex>
      {!discovery&&onPin&&!plan.request.route&&<button className="outing-keep" disabled={busy} aria-pressed={pinned} onClick={()=>onPin(stop.intent,item.id)}><Icon name={pinned?'check':'bookmark'} size={14}/>{pinned?'Kept in your outing':'Keep this place'}</button>}
    </div>
  </Card>;
}

