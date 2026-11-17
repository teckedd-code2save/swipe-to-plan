import {useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {normalizeReservationForms,normalizeReservationPreview,seedReservationFields,reservationPreviewId,unsupportedFormMessage} from './reservation-form-preview.js';

export default function ReservationFormPreview({snapshot,message,disabled=false,enabled=import.meta.env?.VITE_RESERVATION_FORM_PREVIEW==='true'}) {
  return enabled?<PreviewSession key={JSON.stringify([snapshot,message])} snapshot={snapshot} message={message} disabled={disabled}/>:null;
}
function PreviewSession({snapshot,message,disabled}) {
  const [available,setAvailable]=useState(false),[discovery,setDiscovery]=useState(null),[formId,setFormId]=useState(''),[fields,setFields]=useState({}),[consent,setConsent]=useState(false),[preview,setPreview]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState('');
  const pending=useRef(null),lease=useRef(null);
  function closeLease(id=lease.current){
    if(!id)return;
    if(lease.current===id)lease.current=null;
    // The URL is a temporary access credential. Never persist or log it.
    api.closeReservationFormPreview(snapshot.entityId,id).catch(()=>{});
  }
  function clearPreview(){closeLease();setPreview(null);}

  useEffect(()=>{const abort=new AbortController();api.actionCapabilities(abort.signal).then(value=>{if(!abort.signal.aborted)setAvailable(value.reservationFormPreview===true);}).catch(()=>{});return()=>{abort.abort();pending.current?.abort();closeLease();};},[]);
  useEffect(()=>{
    if(!preview?.expiresAt)return;
    const timer=setTimeout(()=>{closeLease();setPreview(null);setConsent(false);setError('This interactive preview expired. Fill the form again to reopen it.');},Math.min(2147483647,Math.max(0,Date.parse(preview.expiresAt)-Date.now())));
    return()=>clearTimeout(timer);
  },[preview?.previewId]);
  const form=discovery?.forms.find(item=>item.id===formId);
  const locked=disabled||!!busy;
  function selectForm(next){setFormId(next.id);setFields(seedReservationFields(next,snapshot,message));setConsent(false);clearPreview();}
  async function discover(){
    if(pending.current||disabled)return;const abort=new AbortController();pending.current=abort;setBusy('finding');setError('');setDiscovery(null);clearPreview();setConsent(false);setFormId('');setFields({});
    try{const result=normalizeReservationForms(await api.reservationForm(snapshot.entityId,abort.signal));if(abort.signal.aborted)return;setDiscovery(result);if(result.forms[0])selectForm(result.forms[0]);}
    catch(e){if(!abort.signal.aborted)setError(e.message||'Could not find a booking form.');}
    finally{if(!abort.signal.aborted){pending.current=null;setBusy('');}}
  }
  async function inspectDestination(candidate){
    if(pending.current||disabled||!discovery?.candidates.some(item=>item.id===candidate.id))return;
    const abort=new AbortController();pending.current=abort;setBusy('inspecting');setError('');setDiscovery(null);clearPreview();setConsent(false);setFormId('');setFields({});
    try{
      // Only the reviewed destination identifier goes to discovery. Personal
      // fields are sent separately, after the new page's form is reviewed.
      const result=normalizeReservationForms(await api.reservationFormDestination(snapshot.entityId,{candidateId:candidate.id},abort.signal));
      if(abort.signal.aborted)return;setDiscovery(result);if(result.forms[0])selectForm(result.forms[0]);
    }catch(e){if(!abort.signal.aborted)setError(e.message||'Could not inspect this booking page.');}
    finally{if(!abort.signal.aborted){pending.current=null;setBusy('');}}
  }
  async function fill(){
    if(pending.current||disabled||!consent||!form||!discovery.previewAvailable)return;
    const abort=new AbortController();pending.current=abort;setBusy('filling');setError('');clearPreview();
    let returnedId=null;
    try{
      const raw=await api.reservationFormPreview(snapshot.entityId,{formId,fields,consent:true},abort.signal);returnedId=reservationPreviewId(raw?.previewId);
      if(abort.signal.aborted){closeLease(returnedId);return;}
      const result=normalizeReservationPreview(raw);lease.current=result.previewId;setPreview(result);
    }
    catch(e){closeLease(returnedId);if(!abort.signal.aborted)setError(e.message||'Could not prepare this form. No booking is confirmed.');}
    finally{if(!abort.signal.aborted){pending.current=null;setBusy('');}}
  }
  function cancel(){pending.current?.abort();pending.current=null;setBusy('');setConsent(false);clearPreview();setDiscovery(null);setFields({});setError('');}
  if(!available)return null;
  return <section className="pg-form-preview" aria-label="Booking form preview">
    <h4>Fill the booking form</h4><p>Use this stop’s details to prepare the venue’s form for review. Nothing will be submitted.</p>
    <button type="button" className="pl-secondary-button" onClick={discover} disabled={locked||!snapshot.entityId}>{busy==='finding'?'Finding the form…':'Find booking form'}</button>
    {(busy||discovery)&&<button type="button" className="pl-secondary-button" onClick={cancel}>Close form preview</button>}
    {busy==='inspecting'&&<p role="status">Inspecting the selected booking page…</p>}
    {error&&<p role="alert">{error}</p>}
    {discovery&&<div>
      {discovery.sourceUrl&&<p>Form source: <a href={discovery.sourceUrl} target="_blank" rel="noopener noreferrer">{discovery.sourceUrl}</a></p>}
      {!!discovery.candidates.length&&<div><h4>Published booking pages</h4><p>Check the venue and branch at each destination. Inspecting a page does not send your reservation details.</p><ul>{discovery.candidates.map(candidate=><li key={candidate.id}>
        <strong>{candidate.label}</strong> · {candidate.relationship==='booking_partner'?'External booking provider':'Venue website'}<br/>
        <a href={candidate.url} target="_blank" rel="noopener noreferrer">{candidate.url}</a><br/>
        <button type="button" className="pl-secondary-button" disabled={locked} onClick={()=>inspectDestination(candidate)}>Inspect this booking page</button>
      </li>)}</ul></div>}
      {discovery.unsupported.includes('visit_time_not_mapped')&&<p role="status">This form’s date or time control could not be mapped. Check the visit timing on the venue page; the preview is incomplete.</p>}
      {!discovery.forms.length?<p role="status">{unsupportedFormMessage(discovery)}</p>:<>
        <p>Check that this is the right venue and branch before continuing.</p>
        {discovery.forms.length>1&&<label>Booking form<select value={formId} disabled={locked} onChange={e=>selectForm(discovery.forms.find(f=>f.id===e.target.value))}>{discovery.forms.map((f,i)=><option key={f.id} value={f.id}>Form {i+1}: {f.fields.slice(0,3).map(field=>field.label).join(', ')}</option>)}</select></label>}
        <fieldset disabled={locked}><legend>Your reservation details</legend>
          {form?.fields.map(field=><label key={field.id}>{field.label}{field.required?' (required)':''}{field.options.length?<select value={fields[field.id]||''} onChange={e=>{setFields({...fields,[field.id]:e.target.value});setConsent(false);clearPreview();}}><option value="">Choose…</option>{field.options.map((option,i)=><option key={i} value={option.value}>{option.label}</option>)}</select>:<input type={['date','time','datetime-local','email','tel','number'].includes(field.type)?field.type:'text'} value={fields[field.id]||''} maxLength={2000} onChange={e=>{setFields({...fields,[field.id]:e.target.value});setConsent(false);clearPreview();}}/>}</label>)}
        </fieldset>
        {discovery.previewAvailable?<><label><input type="checkbox" checked={consent} disabled={locked} onChange={e=>setConsent(e.target.checked)}/> Use the details shown above in Cloudflare’s browser to fill this form for review. Do not submit it to the venue.</label><button type="button" className="pl-button" disabled={locked||!consent} onClick={fill}>{busy==='filling'?'Filling for review…':'Fill form without submitting'}</button></>:<p>Form found. Browser preview is not configured on this instance yet.</p>}
      </>}
    </div>}
    {preview&&<div role="status"><h4>Prepared for review · not submitted</h4><p>The form was filled with its network connection disabled. This shows your details on the form, not a completed booking.</p><p>{preview.status==='filled'?'The supported fields were filled.':'Review the field results below; some fields may need manual entry.'}</p>{preview.liveViewUrl&&<div><a className="pl-button" href={preview.liveViewUrl} target="_blank" rel="noopener noreferrer">Open filled form</a><p>Review and edit the actual form in a temporary browser tab. Its network remains disabled, so it cannot send a booking. Keep this link private. Closing this preview or changing the details ends access.</p><small>Available until {new Date(preview.expiresAt).toLocaleTimeString()}.</small></div>}{preview.screenshotDataUrl&&<img src={preview.screenshotDataUrl} alt={`Booking form preview for ${snapshot.name}; not submitted`} style={{maxWidth:'100%',height:'auto'}}/>}<dl>{preview.fields.map((field,index)=><div key={index}><dt>{field.label} · {field.status}</dt><dd>{field.value||'Not filled'}</dd></div>)}</dl><p>No reservation has been sent or confirmed. This preview does not create a booking.</p></div>}
  </section>;
}
