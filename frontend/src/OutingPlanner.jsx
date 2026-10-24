import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { DeckIcon } from './SwipeDeck.jsx';
import './outing.css';

const RECIPES = [
  { id: 'evening', name: 'Make a night of it', description: 'Dinner → drinks', intents: ['dinner', 'drinks'] },
  { id: 'slow', name: 'Take your time', description: 'Coffee → dinner', intents: ['coffee', 'dinner'] },
  { id: 'day', name: 'A little of everything', description: 'Coffee → dinner → drinks', intents: ['coffee', 'dinner', 'drinks'] },
];
const STOP_NAMES = { coffee: 'Coffee', dinner: 'Dinner', drinks: 'Drinks' };

export default function OutingPlanner({ preferences, onBack }) {
  const [recipe, setRecipe] = useState('evening');
  const [data, setData] = useState(null);
  const [previous, setPrevious] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const locked = useRef(false);
  const lastRequest = useRef(null);
  const heading = useRef(null);
  const changedStop = useRef(null);
  const recipeInfo = RECIPES.find((item) => item.id === recipe);
  const area = data?.request.location.area ?? preferences.location.area;
  const artistCount = preferences.taste?.artists.length ?? preferences.liked?.filter((id) => id.startsWith('a-')).length ?? 0;
  const matched = data?.stops.filter((stop) => stop.item) ?? [];
  const demo = data?.provenance.provider === 'demo';

  useEffect(() => { heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }, []);

  async function build(request, swapping = false) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    lastRequest.current = { request, swapping };
    try {
      const result = await api.outing(request);
      setPrevious(swapping ? data : null);
      setData(result);
      if (swapping) {
        const stop = result.stops.find((item) => item.intent === changedStop.current);
        setNotice(stop?.item ? `${STOP_NAMES[stop.intent]} changed to ${stop.item.name}.` : 'No replacement met your preferences. You can undo this swap.');
      } else {
        setNotice(`${result.diagnostics.filled} of ${result.stops.length} stops found.`);
        heading.current?.focus({ preventScroll: true });
      }
    } catch (e) {
      setError(e.name === 'TimeoutError' ? 'That took too long. Your choices are still here. Try again.' : e.message);
    } finally { locked.current = false; setBusy(false); }
  }

  function swap(intent) {
    const stop = data.stops.find((item) => item.intent === intent);
    changedStop.current = intent;
    build({
      ...data.request,
      stops: data.stops.map((item) => ({ intent: item.intent, ...(item.intent !== intent && item.item ? { pinnedId: item.item.id } : {}) })),
      feedback: stop.item ? [...data.request.feedback.filter((entry) => entry.candidateId !== stop.item.id), { candidateId: stop.item.id, reason: 'not_relevant' }] : data.request.feedback,
    }, true);
  }

  async function copyPlan() {
    const lines = [demo ? 'Outing · sample plan (demo)' : `An outing in ${area}`, '', ...data.stops.map((stop, index) => stop.item
      ? `${index + 1}. ${STOP_NAMES[stop.intent]} — ${stop.item.name}\n${stop.item.address}${!demo && stop.item.links.map ? `\n${stop.item.links.map}` : ''}`
      : `${index + 1}. ${STOP_NAMES[stop.intent]} — still to be decided`), '', 'Suggested sequence only. Check opening hours, prices, availability and travel before heading out.'];
    try { await navigator.clipboard.writeText(lines.join('\n\n')); setNotice('Plan copied. Share it with your people.'); }
    catch { setNotice('Copy is unavailable in this browser. Select the plan text to copy it.'); }
  }

  return <main id="main" className="outing-page" aria-busy={busy}>
    <div className="outing-topbar"><button className="back-button" disabled={busy} onClick={onBack}>← Back to your picks</button><span><DeckIcon name="pin" size={14}/>{area === 'Accra' ? 'Across Accra' : area}</span></div>
    <div className="outing-heading"><p className="eyebrow">A little less planning. A little more living.</p><h1 ref={heading} tabIndex={-1}>{data ? <>Your kind of <em>outing.</em></> : <>Good taste. <em>Great plans.</em></>}</h1><p>{data ? 'A few places, chosen together. Make it yours.' : 'Turn what you love into a few good stops around the city.'}</p></div>
    {!data && <section className="outing-setup" aria-label="Choose your outing">
      <fieldset className="outing-recipes" disabled={busy}><legend>What kind of day?</legend>{RECIPES.map((item) => <label key={item.id} className={`outing-recipe ${recipe === item.id ? 'selected' : ''}`}><input type="radio" name="outing-recipe" value={item.id} checked={recipe === item.id} onChange={() => setRecipe(item.id)}/><span><strong>{item.name}</strong><small>{item.description}</small></span><DeckIcon name="arrow" size={18}/></label>)}</fieldset>
      <div className="outing-preferences"><span>{artistCount ? `${artistCount} artist ${artistCount === 1 ? 'pick' : 'picks'} carried over` : 'Your selected vibes and preferences carry over'}</span><span>{preferences.constraints?.maxPriceLevel ? `Price tier ${preferences.constraints.maxPriceLevel} or below` : 'No price cap'}</span></div>
      <button className="primary outing-build" disabled={busy} onClick={() => build({ ...preferences, stops: recipeInfo.intents.map((intent) => ({ intent })) })}>{busy ? <><span className="spinner small"/> Finding your stops…</> : <>Build my outing <DeckIcon name="arrow" size={18}/></>}</button>
      <p className="outing-smallprint">Real place recommendations. You choose when to go.</p>
    </section>}
    {error && <div className="error-message" role="alert"><span>{error}</span><button disabled={busy} onClick={() => build(lastRequest.current.request, lastRequest.current.swapping)}>Try again</button></div>}
    <p className="outing-notice" role="status">{busy && data ? 'Finding a replacement while keeping your other stops…' : notice}</p>
    {data && <>
      <div className="outing-summary"><span className="status-dot"/>{demo ? 'Sample plan · demo' : data.taste.resolved.length ? 'Taste matched by Qloo' : 'Discovery by Qloo'}<span>{matched.length} / {data.stops.length} stops{data.status === 'partial' ? ' · Still a little room to fill' : ' · Ready to explore'}</span></div>
      <ol className="outing-timeline">{data.stops.map((stop, index) => <li className="outing-stop" key={stop.intent}>
        <span className="outing-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <div className="outing-stop-content"><p className="outing-stop-label">{stop.label}</p>{stop.item ? <>
          <div className="outing-stop-main">{stop.item.image && <img className="outing-stop-image" src={stop.item.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.hidden = true; }}/>}<div><h2>{stop.item.name}</h2><p className="venue-address"><DeckIcon name="pin" size={13}/>{stop.item.address || area}</p><p className="outing-reason">{stop.item.why}</p><div className="outing-stop-actions">{!demo && stop.item.links.map && <a className="map-link" href={stop.item.links.map} target="_blank" rel="noreferrer">View on map ↗</a>}<button className="secondary" disabled={busy || data.request.feedback.length >= 100} onClick={() => swap(stop.intent)} aria-label={`Swap ${STOP_NAMES[stop.intent].toLowerCase()} stop`}>Swap this stop <DeckIcon name="undo" size={14}/></button></div></div></div>
          <details className="venue-details"><summary>Why this stop <span>+</span></summary><ul>{stop.item.reasons.map((reason, i) => <li key={i}>{reason.text}</li>)}</ul><p>{stop.item.facts.price.level ? `Reported price tier ${stop.item.facts.price.level}. This is not a current quote.` : 'Price not reported.'}</p>{stop.item.uncertainty.map((text) => <p key={text}>{text}</p>)}{!demo && <div className="detail-links">{stop.item.links.website && <a href={stop.item.links.website} target="_blank" rel="noreferrer">Website ↗</a>}{stop.item.links.phone && <a href={stop.item.links.phone}>Call venue ↗</a>}</div>}</details>
        </> : <div className="outing-unfilled"><h2>A little room for discovery.</h2><p>{stop.reason === 'kept_place_unavailable' ? 'The place you kept no longer meets this request.' : stop.reason === 'no_distinct_place' ? 'The matching place is already another stop in your plan.' : `No ${STOP_NAMES[stop.intent].toLowerCase()} places met all your preferences.`} Your filters are still in place.</p><button className="secondary" disabled={busy} onClick={() => swap(stop.intent)}>Try this stop again</button></div>}</div>
      </li>)}</ol>
      <div className="outing-finish"><div><h2>Good plans are for sharing.</h2><p>Send the stops to your people. Decide the time together.</p></div><button className="primary" disabled={busy || !matched.length} onClick={copyPlan}>Copy plan <DeckIcon name="arrow" size={18}/></button></div>
      <div className="outing-bottom-actions">{previous && <button className="back-button" disabled={busy} onClick={() => { setData(previous); setPrevious(null); setError(''); setNotice('Swap undone. Your previous plan is restored.'); }}>↶ Undo last swap</button>}<button className="back-button" disabled={busy} onClick={() => { setData(null); setPrevious(null); setError(''); setNotice(''); heading.current?.focus(); }}>Choose a different outing</button></div>
      <p className="outing-smallprint">A suggested sequence, not a reservation. Check opening hours, prices, availability and travel before heading out.</p>
      <details className="about-picks outing-evidence"><summary>How your plan came together</summary><p>{data.diagnostics.fetched} provider candidates considered. Each stop is checked against your area, activity and price preferences. Places are not repeated.</p><p>{data.taste.resolved.length ? `Artist signals: ${data.taste.resolved.map((artist) => artist.name).join(', ')}.` : 'No artist affinity signals were used.'}</p>{data.taste.unresolved.length > 0 && <p>Artists not used: {data.taste.unresolved.map((artist) => artist.requested).join(', ')}.</p>}{data.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details>
    </>}
  </main>;
}
