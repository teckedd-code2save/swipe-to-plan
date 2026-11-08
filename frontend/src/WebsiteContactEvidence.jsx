import {useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {safeContactWebsite} from '../../shared/venue-contact.js';

const statusText={match:'Published phone matches the provider phone.',conflict:'Website lists a different number; needs review. Verify manually before contacting.',website_only:'Contact information found on the website only.',missing:'No usable contact information found on the checked pages.',unavailable:'Website contacts could not be checked. You can retry or verify manually.',manual_review:'Venue identity is ambiguous. Review the source manually before using any contact.'};
// Treat API data as untrusted display input. Reject malformed or excessive evidence
// rather than partially displaying a reassuring summary with discarded candidates.
function normalizeEvidence(value,entityId) {
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const text=(v,max=2048)=>typeof v==='string'&&v.length<=max;
  const optionalText=(v,max=2048)=>v==null||text(v,max);
  const invalid=()=>{throw new Error('Invalid evidence');};
  if(!object(value)||!text(value.entityId,256)||typeof entityId!=='string'||value.entityId.toUpperCase()!==entityId.toUpperCase()||typeof value.status!=='string'||!Object.hasOwn(statusText,value.status))invalid();
  if(!optionalText(value.sourceUrl)||!optionalText(value.checkedAt,64)||!optionalText(value.providerPhone,200)||!Array.isArray(value.candidates)||value.candidates.length>60||!Array.isArray(value.pages)||value.pages.length>10)invalid();
  const candidates=value.candidates.map(candidate=>{
    if(!object(candidate)||!['phone','whatsapp','booking'].includes(candidate.kind)||!text(candidate.value)||!text(candidate.sourceUrl)||!text(candidate.basis)||!['venue','manual_review'].includes(candidate.assignment)||!['match','conflict','website_only','not_comparable'].includes(candidate.comparison)||!optionalText(candidate.url)||!optionalText(candidate.identityCue,500))invalid();
    return {kind:candidate.kind,value:candidate.value,sourceUrl:candidate.sourceUrl,basis:candidate.basis,assignment:candidate.assignment,comparison:candidate.comparison,url:candidate.url||null,identityCue:candidate.identityCue||null};
  });
  const pages=value.pages.map(page=>{
    if(!object(page)||!text(page.url)||!text(page.status,80))invalid();
    return {url:page.url,status:page.status};
  });
  return {entityId:value.entityId,status:value.status,sourceUrl:value.sourceUrl||null,checkedAt:value.checkedAt||null,providerPhone:value.providerPhone||null,candidates,pages};
}
function SourceLink({url,label}) {
  const safe=safeContactWebsite(url);
  return safe?<a href={safe} target="_blank" rel="noopener noreferrer">{label||safe}</a>:<span>Source link unavailable</span>;
}
export default function WebsiteContactEvidence(props) {
  // Remount on account/day/venue changes, including changes while a request is pending.
  return <ContactCheck key={JSON.stringify([props.entityId,props.scope,props.context])} {...props}/>;
}
function ContactCheck({entityId}) {
  const [result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef(null);
  useEffect(()=>()=>{pending.current?.abort();},[]);
  async function check(){
    if(!entityId||pending.current)return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setError('');setResult(null);
    try {
      const response=await api.contactEvidence(entityId,controller.signal);
      if(controller.signal.aborted)return;
      setResult(normalizeEvidence(response,entityId));
    } catch {
      if(!controller.signal.aborted)setError('Website contacts could not be checked. Try again or verify the venue website manually.');
    } finally {
      if(!controller.signal.aborted){pending.current=null;setBusy(false);}
    }
  }
  const date=result?.checkedAt&&new Date(result.checkedAt),validDate=date&&Number.isFinite(date.getTime());
  return <section aria-label="Website contact evidence">
    <button type="button" className="pl-secondary-button" disabled={busy||!entityId} onClick={check}>{busy?'Checking website contacts…':'Check website contacts'}</button>
    <p className="pg-note">Checks published website information only. Publication does not verify ownership, reachability, availability or WhatsApp consent. These findings do not change your dialer or booking details.</p>
    {busy&&<p role="status">Checking the venue website…</p>}
    {error&&<p role="alert">{error}</p>}
    {result&&<div>
      <p role="status">{statusText[result.status]}</p>
      <p>Source: <SourceLink url={result.sourceUrl}/><br/>{validDate?<>Checked <time dateTime={date.toISOString()}>{date.toLocaleString()}</time>.</>:'Check time unknown.'}</p>
      {result.providerPhone&&<p>Provider comparison phone: {result.providerPhone}</p>}
      <ul>{(Array.isArray(result.candidates)?result.candidates:[]).map((candidate,index)=><li key={index}>
        <strong>{candidate.kind==='whatsapp'?'Published WhatsApp link':candidate.kind==='booking'?'Published booking link':'Published phone'}: {candidate.value}</strong>
        <p>{candidate.assignment==='manual_review'?'Manual review required: this contact could belong to another business or branch.':candidate.comparison==='match'?'Matches the provider phone.':candidate.comparison==='conflict'?'Differs from the provider phone. Verify manually.':candidate.comparison==='website_only'?'Website-only evidence.':'Not comparable with the provider phone.'} {candidate.identityCue&&`Identity cue: ${candidate.identityCue}.`} {candidate.basis}</p>
        {['whatsapp','booking'].includes(candidate.kind)&&safeContactWebsite(candidate.url)&&<p>Published destination (review only): {safeContactWebsite(candidate.url)}</p>}
        <small>Source: <SourceLink url={candidate.sourceUrl}/></small>
      </li>)}</ul>
      {!!result.pages?.length&&<details><summary>Checked pages</summary><ul>{result.pages.map((page,index)=><li key={index}><SourceLink url={page.url}/> · {page.status}</li>)}</ul></details>}
    </div>}
  </section>;
}
