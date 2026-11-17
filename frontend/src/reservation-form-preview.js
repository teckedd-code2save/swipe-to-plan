import {safeContactWebsite} from '../../shared/venue-contact.js';
const text=(v,n=2000)=>typeof v==='string'&&v.length<=n;
export function normalizeReservationForms(value) {
  if(!value||!text(value.status,80)||!Array.isArray(value.forms)||value.forms.length>12)throw Error('Invalid form discovery response.');
  const sourceUrl=safeContactWebsite(value.sourceUrl);
  if(value.forms.length&&!sourceUrl)throw Error('The form source could not be verified.');
  const seen=new Set();
  const forms=value.forms.map(form=>{
    if(!text(form.id,200)||seen.has(form.id)||!Array.isArray(form.fields)||form.fields.length>60)throw Error('Invalid form.');seen.add(form.id);
    const ids=new Set();
    return {id:form.id,fields:form.fields.map(field=>{
      if(!text(field.id,200)||ids.has(field.id)||!text(field.label,300)||!text(field.type,40)||!text(field.semantic||'',40))throw Error('Invalid form field.');ids.add(field.id);
      const options=field.options||[];
      if(!Array.isArray(options)||options.length>250||options.some(o=>!text(o.value,500)||!text(o.label,500)))throw Error('Invalid form options.');
      return {id:field.id,label:field.label||'Unlabelled field',type:field.type,semantic:field.semantic||'',required:field.required===true,options};
    })};
  });
  const rawCandidates=value.candidates||[],unsupported=value.unsupported||[];
  if(!Array.isArray(rawCandidates)||rawCandidates.length>30||!Array.isArray(unsupported)||unsupported.length>20||unsupported.some(code=>!text(code,80)))throw Error('Invalid booking destinations.');
  const candidateIds=new Set();
  const candidates=rawCandidates.map(candidate=>{
    const url=safeContactWebsite(candidate?.url),id=reservationPreviewId(candidate?.id);
    if(!id||candidateIds.has(id)||!url||!text(candidate.label,300)||!['same_site','booking_partner'].includes(candidate.relationship))throw Error('Invalid booking destination.');
    candidateIds.add(id);return {id,url,label:candidate.label||'Booking page',relationship:candidate.relationship};
  });
  return {status:value.status,sourceUrl,forms,candidates,unsupported,previewAvailable:value.previewAvailable===true};
}
export function seedReservationFields(form,snapshot,message) {
  const party=snapshot.party,guests=Number.isInteger(party?.adults)&&Number.isInteger(party?.children)?String(party.adults+party.children):'';
  const values={dateTime:snapshot.date&&snapshot.localTime?`${snapshot.date}T${snapshot.localTime}`:'',date:snapshot.date||'',time:snapshot.localTime||'',guests,partySize:guests,party_size:guests,notes:message||'',message:message||''};
  return Object.fromEntries(form.fields.map(field=>{
    const candidate=values[field.semantic]||'';
    // Never choose a different date, time, party size or option just to complete a form.
    const value=field.options.length?(field.options.find(option=>option.value===candidate||option.label===candidate)?.value||''):candidate;
    return [field.id,value];
  }));
}
export function reservationPreviewId(value) {
  return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value:null;
}
export function normalizeReservationPreview(value) {
  if(!value||value.submitted!==false||!text(value.status,80)||!Array.isArray(value.fields)||value.fields.length>60)throw Error('The preview could not be verified. Nothing has been confirmed.');
  if(value.fields.some(f=>!text(f.label,300)||!text(f.value,2000)||!text(f.status,80)))throw Error('Invalid preview fields.');
  const screenshotDataUrl=value.screenshotDataUrl;
  if(screenshotDataUrl&&(!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(screenshotDataUrl)||screenshotDataUrl.length>12000000))throw Error('Invalid form screenshot.');
  let liveViewUrl=null,previewId=null,expiresAt=null;
  if(value.liveViewUrl!=null||value.previewId!=null||value.expiresAt!=null){
    previewId=reservationPreviewId(value.previewId);
    let url;try{url=new URL(value.liveViewUrl);}catch{throw Error('Invalid interactive preview.');}
    if(url.origin!=='https://live.browser.run'||url.username||url.password||!previewId||!text(value.expiresAt,64)||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=Date.now())throw Error('Invalid or expired interactive preview.');
    liveViewUrl=url.href;expiresAt=value.expiresAt;
  }
  return {status:value.status,fields:value.fields,screenshotDataUrl:screenshotDataUrl||null,sourceUrl:safeContactWebsite(value.sourceUrl),liveViewUrl,previewId,expiresAt};
}

export function unsupportedFormMessage(discovery) {
  const codes=discovery.unsupported||[];
  if(codes.includes('custom_calendar'))return 'This page uses a custom calendar that cannot be filled here yet.';
  if(codes.includes('embedded_forms'))return 'The booking form is embedded. Inspect its published booking page below, if available.';
  return discovery.candidates?.length?'Choose a published booking page below to look for the form.':'No fillable booking form found. Use the venue website to continue.';
}
