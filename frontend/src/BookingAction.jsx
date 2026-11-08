import VenueContact,{DialerLink} from './VenueContact.jsx';
import {useEffect,useState} from 'react';
import {bookingMessage,bookingSnapshot,bookingStatus,reservationEligible} from './booking-actions.js';
import useBookingActions from './useBookingActions.js';

export default function BookingAction(props) {
  // Remount, cancel and discard reviewed details on every identity or itinerary change.
  return <BookingSession key={JSON.stringify([props.scope,props.context,props.plan,props.stop,props.place?.links,props.place?.contact],(key,value)=>['retrievedAt','providerUpdatedAt'].includes(key)?undefined:value)} {...props}/>;
}
function BookingSession({scope={allowed:true,type:'guest'},plan,stop,place,context}) {
  const state=useBookingActions(scope),snapshot=bookingSnapshot(plan,stop,state.durable?stop.item:place);
  const [draft,setDraft]=useState(()=>bookingMessage(snapshot)),[channel,setChannel]=useState('copy'),[reviewed,setReviewed]=useState(null),[record,setRecord]=useState(null),[message,setMessage]=useState(''),[reference,setReference]=useState(''),[outcome,setOutcome]=useState('awaiting_reply');
  const locked=state.busy||state.blocked;
  const current=record||state.records.find(item=>!item.stale&&item.snapshot.stopId===stop.id&&item.snapshot.itemId===stop.item.id&&item.snapshot.entityId===stop.item.entityId);
  useEffect(()=>{if(current){setDraft(current.notes||bookingMessage(current.snapshot));setKind(current.kind);}},[current?.id]);
  const contactSnapshot=current?.snapshot||snapshot,contacts=contactSnapshot.contacts;
  const contactEvidence=contactSnapshot.contactEvidence;
  const editable=scope.allowed&&stop.id!=='shortlist-place';
  const ready=reviewed&&reviewed.draft===draft&&reviewed.channel===channel;
  const timed=reservationEligible(contactSnapshot);
  const [kind,setKind]=useState('enquiry');
  async function useDetails(){
    setMessage('');
    if(!state.durable){setReviewed({draft,channel});return;}
    const body={kind,notes:draft};
    const unchanged=current&&!current.stale&&current.kind===kind&&current.notes===draft;
    const saved=unchanged?current:await state.mutate(current?'updateBooking':'createBooking',current,current?body:{...body,stopId:stop.id,itemId:stop.item.id,entityId:stop.item.entityId});
    if(!saved)return;
    setRecord(saved);
    const reviewedDestination=value=>JSON.stringify([value.name,value.entityId,value.date,value.localTime,value.timeZone,value.party,channel==='phone'?value.contacts.phone:channel==='website'?value.contacts.website:null]);
    if(reviewedDestination(saved.snapshot)!==reviewedDestination(contactSnapshot)){setReviewed(null);setMessage('Saved venue details differ from those shown. Review the updated recipient and details before continuing.');return;}
    // The same deliberate review covers this exact text/channel, but never a future send.
    const approved=await state.mutate('bookingHandoff',saved,{channel,reviewed:true});
    if(approved){setRecord(approved);setReviewed({draft,channel});}
  }
  async function copy(){try{await navigator.clipboard.writeText(draft);setMessage('Copied. Nothing sent.');}catch{setMessage('Copy failed. Select and copy the message below.');}}
  async function report(){const saved=await state.mutate('reportBooking',current,{outcome,reference});if(saved){setRecord(saved);setMessage('Your report saved. Not independently verified.');}}
  if(!editable)return <section className="pg-enquiry"><h3>Booking preparation</h3><p>{stop.id==='shortlist-place'?'Add this place to your day to prepare its visit details.':'Only the day owner can prepare and privately track bookings.'}</p></section>;
  return <section className="pg-enquiry" aria-label="Booking preparation">
    <h3>Prepare & track this stop</h3><p role="status">{bookingStatus(current?.status||ready&&'ready_for_contact')}</p>
    <p>Nothing has been sent or booked by Unstressed. Availability, prices and your reports are not independently verified.</p>
    {!state.durable&&<p>This preparation is temporary. Closing this panel or changing the day clears it. Private tracking needs an owned saved plan.</p>}
    <p><strong>Recipient: {contactSnapshot.name}</strong><br/>{contactSnapshot.date&&contactSnapshot.localTime?`${contactSnapshot.date} · ${contactSnapshot.localTime} · ${contactSnapshot.timeZone||'Time zone missing'}`:'Visit timing not set: general enquiry only.'}{contactSnapshot.party&&` · ${contactSnapshot.party.adults} adults, ${contactSnapshot.party.children||0} children`}</p>
    <label>Request type<select value={kind} disabled={locked} onChange={e=>{setKind(e.target.value);setReviewed(null);}}><option value="enquiry">General enquiry</option>{timed&&<option value="reservation">Reservation request</option>}</select></label>
    <label>Message to {contactSnapshot.name}<textarea value={draft} maxLength={2000} rows={8} disabled={locked} onChange={e=>{setDraft(e.target.value);setReviewed(null);}}/></label>
    <label>Contact channel<select value={channel} disabled={locked} onChange={e=>{setChannel(e.target.value);setReviewed(null);}}><option value="copy">Copy for me to send</option>{contacts.website&&<option value="website">Venue website</option>}{contacts.phone&&<option value="phone">Call venue</option>}</select></label>
    <p>{channel==='website'?`Website: ${contacts.website}`:channel==='phone'?`Phone: ${contacts.phone}`:'Copy only: you choose the recipient when you send.'}</p>
    <VenueContact place={{entityId:contactSnapshot.entityId,name:contactSnapshot.name,links:contacts}} contact={contactEvidence} contacts={contacts} allowDial={false} allowWebsite={false}/>
    <button className="pl-button" disabled={locked||!draft.trim()} onClick={useDetails}>{state.blocked?'Reload tracking to continue':state.busy?'Saving…':'Use these details'}</button>
    <small>This reviews only the message and channel shown here. It does not authorize an automatic or future send.</small>
    {ready&&!locked&&<div><button className="pl-secondary-button" onClick={copy}>Copy enquiry</button>{channel==='website'&&contacts.website&&<a className="pl-secondary-button" href={contacts.website} target="_blank" rel="noreferrer">Open venue website</a>}{channel==='phone'&&contacts.phone&&<DialerLink className="pl-secondary-button" place={{entityId:contactSnapshot.entityId,name:contactSnapshot.name,links:contacts}} contact={contactEvidence} allowedUrl={contacts.phone}/>}</div>}
    {state.durable&&current?.handoff&&!current.stale&&current.notes===draft&&current.kind===kind&&<fieldset disabled={locked}><legend>Your private report for this stop</legend><label>Outcome<select value={outcome} onChange={e=>setOutcome(e.target.value)}>{['awaiting_reply','confirmed','unavailable','cancelled'].map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label><label>Reference (optional)<input value={reference} maxLength={160} onChange={e=>setReference(e.target.value)}/></label><button onClick={report}>Save my report</button>{current.userReport?.reference&&<p>{current.userReport.stale?`Previous report reference (not current), ${current.userReport.snapshot?.name||'previous place'} · ${current.userReport.snapshot?.date||'No date'} · ${current.userReport.snapshot?.localTime||'No time'}`:'Saved reference'}: {current.userReport.reference}</p>}</fieldset>}
    {!!current?.reportHistory?.length&&<details className="pg-report-history"><summary>Earlier reports for this booking</summary>{current.reportHistory.map((report,index)=><ReportedDetails key={index} report={report}/>)}</details>}
    {state.records.some(item=>item.stale)&&<details className="pg-booking-history"><summary>Previous details & reports</summary><p>These records belong to earlier visit details, including removed stops. They do not confirm your current plan.</p>{state.records.filter(item=>item.stale).map(item=><HistoricalBooking key={item.id} record={item} busy={locked} onReport={(outcome,reference)=>state.mutate('reportBooking',item,{outcome,reference})}/>)}</details>}
    {state.error&&<p role="alert">{state.error}</p>}<p role="status">{message}</p>
  </section>;
}

function SnapshotDetails({snapshot}) {
  return <p><strong>{snapshot?.name||'Previous place'}</strong> · {snapshot?.date||'No date'} · {snapshot?.localTime||'No time'} · {snapshot?.timeZone||'Time zone not set'}<br/>Stop: {snapshot?.stopId}{snapshot?.party&&` · ${snapshot.party.adults} adults, ${snapshot.party.children||0} children`}</p>;
}
function ReportedDetails({report}) {
  return <article className="pg-reported-details"><SnapshotDetails snapshot={report.snapshot}/><p>{bookingStatus(`user_reported_${report.outcome}`)}{report.reportedAt&&` · Recorded ${report.reportedAt}`}. Your report only; not independently verified.</p>{report.reference&&<p>Reference: {report.reference}</p>}{report.notes&&<details><summary>Message associated with this report</summary><p style={{whiteSpace:'pre-wrap'}}>{report.notes}</p></details>}</article>;
}
function HistoricalBooking({record,busy,onReport}) {
  const [outcome,setOutcome]=useState('awaiting_reply'),[reference,setReference]=useState(''),[message,setMessage]=useState('');
  async function save(){setMessage('');const saved=await onReport(outcome,reference);if(saved)setMessage('Historical report saved. Your current draft is unchanged.');}
  return <article className="pg-historical-booking" aria-label={`Previous booking for ${record.snapshot.name}`}>
    <SnapshotDetails snapshot={record.snapshot}/><p role="status">{bookingStatus(record.status)}. Previous visit details, not the current plan.</p>
    {record.userReport&&<ReportedDetails report={record.userReport}/>}
    {!!record.reportHistory?.length&&<details><summary>Earlier reports</summary>{record.reportHistory.map((report,index)=><ReportedDetails key={index} report={report}/>)}</details>}
    <fieldset disabled={busy}><legend>Update your report for this previous booking</legend><p>Your report only; this does not contact or cancel with the venue.</p><label>Previous booking outcome<select value={outcome} onChange={e=>setOutcome(e.target.value)}>{['awaiting_reply','confirmed','unavailable','cancelled'].map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label><label>Previous booking reference (optional)<input maxLength={160} value={reference} onChange={e=>setReference(e.target.value)}/></label><button onClick={save}>Save historical report</button></fieldset><p role="status">{message}</p>
  </article>;
}
