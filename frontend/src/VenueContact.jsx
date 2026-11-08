import {contactForItem,safeContactWebsite} from '../../shared/venue-contact.js';

function evidenceFor(place,contact) {
  if((contact||place?.contact)?.identityStatus==='conflicting')return {...contactForItem({}),identityStatus:'conflicting'};
  return contactForItem({...place,...(contact?{contact}:{})});
}

// Opening a device dialer never records a call, a send, or a booking outcome.
export function DialerLink({place,contact,allowedUrl,className=''}) {
  const evidence=evidenceFor(place,contact),phone=evidence.phone;
  const url=phone?.dialUrl;
  if(evidence.identityStatus==='conflicting'||contact?.identityStatus==='conflicting'||!/^tel:\+[1-9][0-9]{7,14}$/.test(url||'')||(allowedUrl!==undefined&&url!==allowedUrl))return null;
  return <a className={className} href={url}>Open dialer · {place?.name||'Venue'} · {url.slice(4)}</a>;
}
function Source({source}) {
  const date=source?.retrievedAt&&new Date(source.retrievedAt),valid=date&&Number.isFinite(date.getTime());
  return <small>Source: {source?.provider==='qloo'?'Qloo':source?.provider||'saved venue data'}{source?.field?` · ${source.field}`:''}. {valid?<>Retrieved <time dateTime={date.toISOString()}>{date.toLocaleString()}</time>.</>:'Retrieval time unknown.'} Provider update time unknown.</small>;
}
export default function VenueContact({place,contact,allowDial=true,allowWebsite=true,contacts}) {
  const evidence=evidenceFor(place,contact),phone=evidence.phone,website=evidence.website;
  if(evidence.identityStatus==='conflicting')return <section className="pg-venue-contact" aria-label={`Contact ${place?.name||'venue'}`}><h3>Contact {place?.name||'venue'}</h3><p>Contact details do not match this venue. Verify its contact information manually before reaching out.</p></section>;
  const websiteUrl=contacts?contacts.website:website?.url;
  const safeWebsite=safeContactWebsite(websiteUrl);
  return <section className="pg-venue-contact" aria-label={`Contact ${place?.name||'venue'}`}>
    <h3>Contact {place?.name||'venue'}</h3>
    {phone?.display?<p><strong>Reported phone: {phone.display}</strong><br/><Source source={phone.source}/></p>:<p>No usable phone supplied in the venue data.</p>}
    {phone?.format==='local_only'&&<p>Country context is missing. Check the venue website or verify this number manually before dialing.</p>}
    {phone?.format==='invalid'&&<p>This phone format cannot be safely opened. Check the venue website or verify it manually.</p>}
    {safeWebsite&&<p>{allowWebsite?<a href={safeWebsite} target="_blank" rel="noreferrer">Venue website · {safeWebsite}</a>:<span>Venue website · {safeWebsite}</span>}<br/><Source source={website?.source}/></p>}
    {phone?.format==='missing'&&!safeWebsite&&<p>No website or phone was supplied in the venue data. No booking link has been guessed.</p>}
    <p className="pg-note">Ownership and reachability unverified. Details may be outdated. WhatsApp support unknown.</p>
    {allowDial&&<DialerLink place={place} contact={evidence} allowedUrl={contacts?.phone}/>}
    {phone?.dialUrl&&<small>Opens your dialer only. Confirm the venue identity, visit time, availability and any fees with the venue. Nothing is called or booked by Unstressed.</small>}
  </section>;
}
