import {useEffect,useRef,useState} from 'react';
import {DialerLink} from './VenueContact.jsx';
import {Icon} from './PlannerIcons.jsx';
import {api} from './api.js';
import {publishedWhatsapp} from './booking-contact-links.js';
export default function BookingContacts({snapshot,place,message,disabled=false}){
 const [checking,setChecking]=useState(false),[whatsapp,setWhatsapp]=useState(null),[notice,setNotice]=useState('');
 const abort=useRef(null);
 useEffect(()=>()=>abort.current?.abort(),[]);
 async function check(){
  if(checking)return;const controller=new AbortController();abort.current=controller;setChecking(true);setNotice('');
  try{const result=await api.contactEvidence(snapshot.entityId,controller.signal);if(controller.signal.aborted)return;const link=publishedWhatsapp(result,snapshot);setWhatsapp(link);if(!link)setNotice('No matching published WhatsApp contact found. You can call the venue instead.');}
  catch{if(!controller.signal.aborted)setNotice('WhatsApp contact could not be checked. Try again or call the venue.');}
  finally{if(!controller.signal.aborted)setChecking(false);}
 }
 return <div className="booking-contact-options"><div className="booking-contact-actions">
 <DialerLink place={{...place,entityId:snapshot.entityId,name:snapshot.name}} contact={snapshot.contactEvidence} allowedUrl={snapshot.contacts.phone} className="pg-link"/>
 {whatsapp?<a className="pg-link" href={`${whatsapp}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer"><Icon name="chat" size={16}/>WhatsApp</a>:<button className="pg-link" type="button" disabled={disabled||checking||!snapshot.contacts.website} onClick={check}><Icon name="chat" size={16}/>{checking?'Checking WhatsApp…':'Find WhatsApp contact'}</button>}

 </div>
 {whatsapp&&<p className="pg-note">Review the prepared message in WhatsApp and send it yourself. A reply is needed to confirm your booking.</p>}{notice&&<p role="status" className="pg-note">{notice}</p>}</div>;
}
