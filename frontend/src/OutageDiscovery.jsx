export default function OutageDiscovery({result}){
  return <section className="cs-place-shortlist cs-tool" aria-label="Nearby options while chat is busy">
    <div className="cs-tool-head"><span>Nearby options</span><small>Chat is temporarily busy</small></div>
    <p>These use your existing tastes and selected area. Your latest message hasn’t been applied; it’s still in the typing area.</p>
    {result.items?.length?result.items.map(item=><article className="cs-place-option" key={item.id||item.entityId}>
      <strong>{item.name}</strong><small>{item.address}</small>
      {item.description&&<p>{item.description}</p>}
      <a target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([item.name,item.address].filter(Boolean).join(' '))}`}>View on map</a>
    </article>):<p>No places returned for these existing preferences in this area.</p>}
    <small>These are alternatives, not a new plan. Hours, menus and prices still need checking.</small>
  </section>;
}
