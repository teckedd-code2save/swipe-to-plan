import {safeContactWebsite} from '../../shared/venue-contact.js';
export function venueSearchUrl(place){
 const query=[place?.name,place?.address,place?.contact?.phone?.display,'official website reservations'].filter(Boolean).join(' ');
 return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
// A published WhatsApp URL must match this venue's identity-bound phone.
// This verifies the link association, not account ownership or availability.
export function publishedWhatsapp(result,snapshot){
 if(result?.entityId?.toUpperCase()!==snapshot.entityId?.toUpperCase())return null;
 const phone=snapshot.contacts?.phone?.replace(/^tel:\+/,''),source=safeContactWebsite(result.providerSourceUrl);
 if(!/^[1-9]\d{7,14}$/.test(phone||'')||!source)return null;
 for(const c of result.candidates||[]){
  if(c.kind!=='whatsapp'||c.comparison==='conflict')continue;
  try{
   const url=new URL(c.url),origin=new URL(c.sourceUrl);
   if(origin.hostname.replace(/^www\./,'')!==new URL(source).hostname.replace(/^www\./,''))continue;
   const number=url.hostname==='wa.me'?url.pathname.slice(1):['api.whatsapp.com','www.whatsapp.com','whatsapp.com'].includes(url.hostname)&&url.pathname==='/send'?url.searchParams.get('phone'):null;
   if(url.protocol==='https:'&&!url.username&&!url.password&&number?.replace(/^\+/,'')===phone)return `https://wa.me/${phone}`;
  }catch{/* Reject unsupported links. */}
 }
 return null;
}
