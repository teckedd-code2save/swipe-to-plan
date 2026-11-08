// Contact evidence is provider-reported, never proof of ownership or reachability.
// Deliberately no network lookup, country inference, WhatsApp detection or calling.
const cleanText = value => typeof value === 'string' && value.length <= 200 && !/[\x00-\x1f\x7f<>]/.test(value) ? value.trim() : null;
export function safeContactWebsite(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\\x00-\x1f\x7f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    // Only links, never server fetch targets. Exclude obvious local destinations too.
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || host.endsWith('.localhost') || host.endsWith('.local') || /^\[|^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    return url.href;
  } catch { return null; }
}
export function phoneFormat(value) {
  const display = cleanText(value);
  if (value == null || value === '') return {display:null,format:'missing',dialUrl:null};
  if (!display || !/^\+?[0-9 ()-]+$/.test(display)) return {display:null,format:'invalid',dialUrl:null};
  // Reject service codes, extensions, URI parameters and international access-prefix guesses.
  const digits = display.replace(/[ ()-]/g, '');
  if (/^\+[1-9][0-9]{7,14}$/.test(digits)) return {display,format:'international',dialUrl:`tel:${digits}`};
  if (/^[0-9]{6,15}$/.test(digits)) return {display,format:'local_only',dialUrl:null};
  return {display,format:'invalid',dialUrl:null};
}
function evidence(provider, entityId, field, retrievedAt) {
  return {provider:typeof provider==='string'?provider:null,entityId:typeof entityId==='string'?entityId:null,field,retrievedAt:typeof retrievedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(retrievedAt)&&Number.isFinite(Date.parse(retrievedAt))?retrievedAt:null,providerUpdatedAt:null};
}
function build(phone, website, phoneSource, websiteSource, status) {
  const number=phoneFormat(phone), url=safeContactWebsite(website);
  return {
    phone:{...number,status:number.format==='missing'?'missing':status,source:phoneSource,reachability:'unverified',ownership:'unverified'},
    website:{status:website==null||website===''?'missing':status,url,source:websiteSource,ownership:'unverified'},
    whatsapp:{capability:'unknown',optIn:'unknown'},
    callReadiness:number.dialUrl?'manual_dial_only':number.format==='local_only'?'needs_country_context':'unavailable',
  };
}
export function shapeProviderContact(raw, provider, retrievedAt) {
  return build(raw.properties?.phone,raw.properties?.website,
    evidence(provider,raw.entity_id,'properties.phone',retrievedAt),
    evidence(provider,raw.entity_id,'properties.website',retrievedAt),'provider_reported');
}
// Old saved plans remain usable, but do not acquire invented provider provenance.
// New evidence is accepted only for the same entity and re-sanitized before use.
export function contactForItem(item={}) {
  const contact=item.contact;
  // Explicit evidence for another venue cannot become legacy evidence for this one.
  // Clear both destinations: retained links may have come from the same wrong entity.
  const sourceIds=[contact?.phone?.source?.entityId,contact?.website?.source?.entityId];
  if (sourceIds.some(id=>typeof id==='string' && id.length>0 && id!==item.entityId)) {
    return {...build(null,null,evidence(null,null,null,null),evidence(null,null,null,null),'missing'),identityStatus:'conflicting'};
  }
  if (typeof item.entityId==='string' && item.entityId.length>0 && contact?.phone?.source?.entityId===item.entityId && contact?.website?.source?.entityId===item.entityId) {
    const result = build(contact.phone.display,contact.website.url,
      evidence(contact.phone.source.provider,item.entityId,contact.phone.source.field,contact.phone.source.retrievedAt),
      evidence(contact.website.source.provider,item.entityId,contact.website.source.field,contact.website.source.retrievedAt),contact.phone.source.field==='links.phone'?'legacy_reported':'provider_reported');
    if (contact.phone.format==='invalid' && !result.phone.dialUrl) Object.assign(result.phone,{format:'invalid',status:contact.phone.source.field==='links.phone'?'legacy_reported':'provider_reported'});
    return result;
  }
  const phone=typeof item.links?.phone==='string'&&item.links.phone.startsWith('tel:')?item.links.phone.slice(4):item.links?.phone;
  return build(phone,item.links?.website,evidence(null,item.entityId,'links.phone',null),evidence(null,item.entityId,'links.website',null),'legacy_reported');
}
