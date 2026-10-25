export default function SpendingChoices({person,onChange,disabled=false}) {
  const style=person.spending?.style,priority=person.spending?.priority||'even';
  const update=patch=>onChange({...person,spending:{style:'balanced',priority:'even',...person.spending,...patch}});
  return <div className="cs-spending">
    <p className="cs-field-label">What feels like a good spend for {person.name==='You'?'you':person.name}?</p>
    <div className="cs-spend-styles">{[['mindful','Keep it light','More tucked away',1],['balanced','A good balance','A bit of both',2],['treat','Make it special','Room for a treat',3]].map(([id,label,note,count])=><button type="button" key={id} disabled={disabled} aria-pressed={style===id} onClick={()=>update({style:id})}><span className="cs-spend-coins" aria-hidden="true">{[1,2,3].map(n=><i key={n} className={n<=count?'filled':''}/>)}</span><strong>{label}</strong><small>{note}</small></button>)}</div>
    <p className="cs-field-label">Where would you rather spend?</p><div className="cs-spend-priorities">{[['even','A little of everything'],['coffee','Coffee'],['dinner','A great meal'],['activity','Experiences'],['drinks','Drinks']].map(([id,label])=><button type="button" key={id} disabled={disabled} aria-pressed={priority===id} onClick={()=>update({priority:id})}>{label}</button>)}</div>
  </div>;
}
