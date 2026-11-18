import BookingWebsiteSearch from './BookingWebsiteSearch.jsx';
import {venueSearchUrl} from './booking-contact-links.js';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './PlannerIcons.jsx';
import {api} from './api.js';
import {secureBookingWebsite,normalizeReservationForms,normalizeReservationPreview,seedReservationFields,reservationPreviewId,unsupportedFormMessage} from './reservation-form-preview.js';

export default function ReservationFormPreview({snapshot,message,disabled=false,fillAllowed=true,onTiming,enabled=import.meta.env?.VITE_RESERVATION_FORM_PREVIEW==='true'}) {
  return enabled?<PreviewSession key={JSON.stringify([snapshot,message])} snapshot={snapshot} message={message} disabled={disabled} fillAllowed={fillAllowed} onTiming={onTiming}/>:null;
}
function PreviewSession({snapshot,message,disabled,fillAllowed,onTiming}) {
  const [capability,setCapability]=useState('loading'),[capabilityAttempt,setCapabilityAttempt]=useState(0),[discovery,setDiscovery]=useState(null),[formId,setFormId]=useState(''),[fields,setFields]=useState({}),[consent,setConsent]=useState(false),[preview,setPreview]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState('');
  const pending=useRef(null),lease=useRef(null);
  const [browserView,setBrowserView]=useState(null),[open,setOpen]=useState(false),[searchingWeb,setSearchingWeb]=useState(false);
  const workspace=useRef(null),trigger=useRef(null);
  const [detailsOpen,setDetailsOpen]=useState(false),[zoomed,setZoomed]=useState(false);
  useEffect(()=>{if(error||discovery||preview)setDetailsOpen(true);},[error,discovery,preview]);
  useEffect(()=>{
    if(!open)return;
    const el=workspace.current;el.showModal();
    const back=()=>cancel();window.addEventListener('popstate',back);
    return()=>{el.close();window.removeEventListener('popstate',back);trigger.current?.focus({preventScroll:true});};
  },[open]);
  function receiveProgress(abort){return event=>{if(abort.signal.aborted)return;setBrowserView(previous=>event.type==='frame'?{...previous,imageDataUrl:event.imageDataUrl}:{...previous,stage:event.stage});};}
  function closeLease(id=lease.current){
    if(!id)return;
    if(lease.current===id)lease.current=null;
    // The URL is a temporary access credential. Never persist or log it.
    api.closeReservationFormPreview(snapshot.entityId,id).catch(()=>{});
  }
  function clearPreview(){closeLease();setPreview(null);}

  useEffect(()=>{
    const abort=new AbortController();
    api.actionCapabilities(abort.signal).then(value=>{if(!abort.signal.aborted)setCapability(value.reservationFormPreview===true?'available':'disabled');}).catch(()=>{if(!abort.signal.aborted)setCapability('failed');});
    return()=>abort.abort();
  },[capabilityAttempt]);
  useEffect(()=>()=>{pending.current?.abort();closeLease();},[]);
  useEffect(()=>{
    if(!preview?.expiresAt)return;
    const timer=setTimeout(()=>{closeLease();setPreview(null);setConsent(false);setError('This interactive preview expired. Fill the form again to reopen it.');},Math.min(2147483647,Math.max(0,Date.parse(preview.expiresAt)-Date.now())));
    return()=>clearTimeout(timer);
  },[preview?.previewId]);
  const form=discovery?.forms.find(item=>item.id===formId);
  const locked=disabled||!!busy;
  const hasDetails=!!(error||preview||discovery?.forms.length||discovery?.candidates.length);
  function selectForm(next){setFormId(next.id);setFields(seedReservationFields(next,snapshot,message));setConsent(false);clearPreview();}
  function startWebSearch(){pending.current?.abort();pending.current=null;clearPreview();setDiscovery(null);setError('');setBusy('');setSearchingWeb(true);setOpen(true);}
  async function useSearchDestination(candidate,imageDataUrl){
    if(!candidate?.candidateId)throw Error('This search destination expired. Search again.');
    setSearchingWeb(false);setBrowserView({imageDataUrl,stage:'connecting'});setBusy('inspecting');const abort=new AbortController();pending.current=abort;
    try{const result=normalizeReservationForms(await api.reservationFormDestination(snapshot.entityId,{candidateId:candidate.candidateId},abort.signal,receiveProgress(abort)));if(abort.signal.aborted)return;setDiscovery(result);if(result.forms[0])selectForm(result.forms[0]);}
    catch(e){if(!abort.signal.aborted)setError(e.message||'Could not inspect this website.');}
    finally{if(!abort.signal.aborted){pending.current=null;setBusy('');}}
  }
  async function discover(){
    if(!snapshot.contacts?.website){startWebSearch();return;}setSearchingWeb(false);
    if(pending.current||disabled)return;setOpen(true);const abort=new AbortController();pending.current=abort;setBrowserView({stage:'connecting'});setBusy('finding');setError('');setDiscovery(null);clearPreview();setConsent(false);setFormId('');setFields({});
    try{const result=normalizeReservationForms(await api.reservationForm(snapshot.entityId,abort.signal,receiveProgress(abort)));if(abort.signal.aborted)return;setDiscovery(result);if(result.forms[0])selectForm(result.forms[0]);}
    catch(e){if(!abort.signal.aborted)setError(e.message||'Could not find a booking form.');}
    finally{if(!abort.signal.aborted){pending.current=null;setBusy('');}}
  }
  async function inspectDestination(candidate){
    if(pending.current||disabled||!discovery?.candidates.some(item=>item.id===candidate.id))return;
    const abort=new AbortController();pending.current=abort;setBrowserView({stage:'connecting'});setBusy('inspecting');setError('');setDiscovery(null);clearPreview();setConsent(false);setFormId('');setFields({});
    try{
      // Only the reviewed destination identifier goes to discovery. Personal
      // fields are sent separately, after the new page's form is reviewed.
      const result=normalizeReservationForms(await api.reservationFormDestination(snapshot.entityId,{candidateId:candidate.id},abort.signal,receiveProgress(abort)));
      if(abort.signal.aborted)return;setDiscovery(result);if(result.forms[0])selectForm(result.forms[0]);
    }catch(e){if(!abort.signal.aborted)setError(e.message||'Could not inspect this booking page.');}
    finally{if(!abort.signal.aborted){pending.current=null;setBusy('');}}
  }
  async function fill(){
    if(pending.current||disabled||!fillAllowed||!consent||!form||!discovery.previewAvailable)return;
    const abort=new AbortController();pending.current=abort;setBrowserView({stage:'connecting'});setBusy('filling');setError('');clearPreview();
    let returnedId=null;
    try{
      const raw=await api.reservationFormPreview(snapshot.entityId,{formId,fields,consent:true},abort.signal,receiveProgress(abort));returnedId=reservationPreviewId(raw?.previewId);
      if(abort.signal.aborted){closeLease(returnedId);return;}
      const result=normalizeReservationPreview(raw);lease.current=result.previewId;setPreview(result);
    }
    catch(e){closeLease(returnedId);if(!abort.signal.aborted)setError(e.message||'Could not prepare this form. No booking is confirmed.');}
    finally{if(!abort.signal.aborted){pending.current=null;setBusy('');}}
  }
  function editVisitTime(){workspace.current?.close();cancel();onTiming?.();}
  function cancel(){setSearchingWeb(false);setOpen(false);setBrowserView(null);pending.current?.abort();pending.current=null;setBusy('');setConsent(false);clearPreview();setDiscovery(null);setFields({});setError('');}
  if(capability==='disabled')return <p className="pg-note">The in-app booking browser is unavailable. <a href={venueSearchUrl(snapshot)} target="_blank" rel="noopener noreferrer">Open search in your browser</a></p>;
  if(capability!=='available')return <section className="pg-form-preview" aria-label="Booking form preview">
    <h4>Find a booking form</h4>
    <button type="button" className="pl-secondary-button" disabled>Find booking form</button>
    {capability==='loading'?<p role="status">Checking whether booking form preview is available…</p>:<><p role="status">Could not check booking form preview availability. Try again to check before opening a venue page.</p><button type="button" className="pl-secondary-button" disabled={disabled} onClick={()=>{setCapability('loading');setCapabilityAttempt(value=>value+1);}}>Retry availability check</button><a className="pg-link" href={venueSearchUrl(snapshot)} target="_blank" rel="noopener noreferrer">Open search in your browser</a></>}
  </section>;
  return <>
    <div className="booking-launch"><div><strong>Book online</strong><span>{snapshot.contacts?.website?"Find and prepare the venue’s booking form.":"Find the venue’s website without leaving Unstressed."}</span></div><button ref={trigger} type="button" className="pl-button" onClick={discover} disabled={locked||!snapshot.entityId}><Icon name={snapshot.contacts?.website?"arrowUpRight":"search"} size={18}/>{snapshot.contacts?.website?"Find booking form":"Search web for booking"}</button></div>
    {!open&&!fillAllowed&&onTiming&&<button type="button" className="pg-link" onClick={onTiming}>Set visit time</button>}
    {open&&createPortal(<dialog ref={workspace} className="booking-workspace" aria-label={`Booking browser for ${snapshot.name}`} onCancel={e=>{e.preventDefault();e.stopPropagation();cancel();}} onKeyDown={e=>e.stopPropagation()}>
      <header className="booking-browser-bar"><Icon name="lock" size={18}/><div><strong>{snapshot.name}</strong><span>{discovery?.sourceUrl?new URL(discovery.sourceUrl).hostname:'Booking browser'} · No booking submitted</span></div>{discovery&&!searchingWeb&&<><button type="button" className="booking-icon" disabled={locked} onClick={startWebSearch} aria-label="Search another booking website" title="Search another booking website"><Icon name="search"/></button>{discovery.sourceUrl&&<a className="booking-icon" href={discovery.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label="Open venue website in a new tab" title="Open venue website"><Icon name="arrowUpRight"/></a>}</>}{!discovery&&<button type="button" className="booking-icon" onClick={discover} disabled={locked} aria-label="Find booking form" title="Retry search"><Icon name="undo"/></button>}<button type="button" className="booking-icon" onClick={cancel} aria-label="Close form preview" title="Close"><Icon name="close"/></button></header>
      <div className={`booking-workspace-body ${hasDetails?'has-booking-stage':''} ${detailsOpen?'booking-details-open':''}`}>{searchingWeb?<BookingWebsiteSearch snapshot={snapshot} onSelected={useSearchDestination} onCancel={cancel}/>:<>
      <section className={`booking-browser-canvas ${zoomed?'booking-canvas-zoomed':''}`} aria-label="Read-only browser view">
        {busy&&<div className="booking-browser-status" role="status">{({waiting:'Waiting briefly for a booking browser…',connecting:'Connecting to the browser…',loading:'Opening the venue website…',inspecting:'Looking for booking fields…',freezing:'Disconnecting the form before filling…',filling:'Filling your reviewed details…'}[browserView?.stage]||'Opening booking page…')}</div>}
        {(browserView?.imageDataUrl||preview?.screenshotDataUrl)&&<button type="button" className="booking-view-zoom" aria-pressed={zoomed} onClick={()=>setZoomed(v=>!v)}>{zoomed?'Fit page':'Zoom page'}</button>}
        {browserView?.imageDataUrl||preview?.screenshotDataUrl?<img src={preview?.screenshotDataUrl||browserView.imageDataUrl} alt="Actual remote browser page, read-only preview"/>:<div className="booking-browser-empty"><Icon name={busy?'clock':'search'} size={36}/><h2>{busy?'Opening the booking page':error?'Let’s try another way':discovery?.forms.length?'Your form is ready to prepare':'No preview available'}</h2><p>{busy?'You’ll see the website here as the browser works.':'Choose the next step alongside this view.'}</p></div>}
        {discovery&&!hasDetails&&<div className="booking-next-action"><span role="status">No form detected</span><button type="button" disabled={locked} onClick={startWebSearch}>Find another page<Icon name="search" size={16}/></button></div>}
        {preview?.liveViewUrl&&<a className="pl-button booking-open-live" href={preview.liveViewUrl} target="_blank" rel="noopener noreferrer">Open filled form<Icon name="arrowUpRight" size={18}/></a>}
      </section>
      {hasDetails&&<><button type="button" className="booking-details-toggle" aria-expanded={detailsOpen} aria-controls="booking-details-panel" onClick={()=>setDetailsOpen(v=>!v)}>{preview?'Review prepared form':discovery?.forms.length?'Prepare booking':'Booking options'}<Icon name={detailsOpen?"close":"list"} size={16}/></button>
      <aside id="booking-details-panel" className="booking-browser-controls" aria-label="Booking details">
    {!!discovery?.forms.length&&!fillAllowed&&onTiming&&<button type="button" className="pl-secondary-button" disabled={locked} onClick={editVisitTime}>Add visit details</button>}
    {error&&<div className="booking-error"><p role="alert">{error}</p><button type="button" className="pl-secondary-button" disabled={locked} onClick={discover}>Try again</button>{secureBookingWebsite(snapshot.contacts?.website)&&<a className="pg-link" href={secureBookingWebsite(snapshot.contacts.website)} target="_blank" rel="noopener noreferrer">Open venue website <Icon name="arrowUpRight" size={16}/></a>}<button type="button" className="pg-link" disabled={locked} onClick={startWebSearch}>Search web for booking <Icon name="search" size={16}/></button><button type="button" className="pg-link" onClick={cancel}>Back to booking options</button></div>}
    {discovery&&<div>
      {!!discovery.candidates.length&&<div><h4>Choose a booking page</h4><ul>{discovery.candidates.map(candidate=><li key={candidate.id}>
        <strong>{candidate.label}</strong> · {candidate.relationship==='website_redirect'?'Redirected website':candidate.relationship==='booking_partner'?'External booking provider':'Venue website'}<br/>
        <a href={candidate.url} target="_blank" rel="noopener noreferrer">{new URL(candidate.url).hostname}</a><br/>
        <button type="button" className="pl-secondary-button" disabled={locked} onClick={()=>inspectDestination(candidate)}>{candidate.relationship==='website_redirect'?'Continue to this website':'Inspect this booking page'}</button>
      </li>)}</ul></div>}
      {discovery.unsupported.includes('visit_time_not_mapped')&&<p role="status">This form’s date or time control could not be mapped. Check the visit timing on the venue page; the preview is incomplete.</p>}
      {!discovery.forms.length?<p role="status">{unsupportedFormMessage(discovery)}</p>:<>
        
        {discovery.forms.length>1&&<label>Booking form<select value={formId} disabled={locked} onChange={e=>selectForm(discovery.forms.find(f=>f.id===e.target.value))}>{discovery.forms.map((f,i)=><option key={f.id} value={f.id}>Form {i+1}: {f.fields.slice(0,3).map(field=>field.label).join(', ')}</option>)}</select></label>}
        <fieldset disabled={locked}><legend>Your reservation details</legend>
          {form?.fields.map(field=><label key={field.id}>{field.label}{field.required?' (required)':''}{field.options.length?<select value={fields[field.id]||''} onChange={e=>{setFields({...fields,[field.id]:e.target.value});setConsent(false);clearPreview();setBrowserView(null);}}><option value="">Choose…</option>{field.options.map((option,i)=><option key={i} value={option.value}>{option.label}</option>)}</select>:<input type={['date','time','datetime-local','email','tel','number'].includes(field.type)?field.type:'text'} value={fields[field.id]||''} maxLength={2000} onChange={e=>{setFields({...fields,[field.id]:e.target.value});setConsent(false);clearPreview();setBrowserView(null);}}/>}</label>)}
        </fieldset>
        {discovery.previewAvailable?<><label><input type="checkbox" checked={consent} disabled={locked||!fillAllowed} onChange={e=>setConsent(e.target.checked)}/> Use the details shown above in Cloudflare’s browser to fill this form for review. Do not submit it to the venue.</label><button type="button" className="pl-button" disabled={locked||!fillAllowed||!consent} onClick={fill}>{busy==='filling'?'Filling for review…':'Fill form without submitting'}</button></>:<p>Form found. Browser preview is not configured on this instance yet.</p>}
      </>}
    </div>}
    {preview&&<div className="booking-prepared" role="status"><h4>Prepared for review · not submitted</h4><p>Review the filled form in its browser tab. It is disconnected from the venue, so no booking can be sent.</p>{preview.status!=='filled'&&<p>Some fields need your review.</p>}<details><summary>Filled details</summary><dl>{preview.fields.map((field,index)=><div key={index}><dt>{field.label}</dt><dd>{field.status==='filled'?field.value||'Filled':'Needs review'}</dd></div>)}</dl></details>{preview.expiresAt&&<small>Available until {new Date(preview.expiresAt).toLocaleTimeString()}.</small>}</div>}
      </aside></>}</>}</div>
    </dialog>,document.body)}
  </>;
}
