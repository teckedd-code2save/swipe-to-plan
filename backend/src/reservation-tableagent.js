const availabilityMessages={tableagent_no_services:'No services are offered for this date. Choose another date.',tableagent_service_review:'Choose a service on the venue website before continuing.',tableagent_time_unavailable:'The requested time is not offered for this service. Choose another time.'};
export class TableagentAvailabilityError extends Error {
 constructor(code,bounds){super(availabilityMessages[code]||'The requested party size is unavailable for this service.');this.code=code;
  if(code==='tableagent_party_unavailable'&&Number.isInteger(bounds?.min)&&Number.isInteger(bounds?.max)&&bounds.min>=1&&bounds.max<=99&&bounds.min<=bounds.max)this.message=`This service accepts ${bounds.min}–${bounds.max} guests. Your party size was not changed.`;
 }
}
export function tableagentPreviewFailure(error){
 if(!(error instanceof TableagentAvailabilityError)||(!Object.hasOwn(availabilityMessages,error.code)&&error.code!=='tableagent_party_unavailable'))return null;
 return {code:error.code,error:`${error.message} No booking was submitted.`};
}
// A narrow, one-request capability for Tableagent's source-verified availability
// lookups. The booking POST and every other non-GET remain blocked.
export function tableagentAvailabilityPermit({pageUrl,path,body}){
 const page=new URL(pageUrl);
 if(page.origin!=='https://tableagent.com'||page.search||page.hash||!/^\/[a-z0-9-]+\/[a-z0-9-]+\/$/.test(page.pathname))throw Error('Unsupported Tableagent page.');
 if(!['/api/business-hours/','/api/business-hours-times/'].includes(path))throw Error('Unsupported availability endpoint.');
 const entries=Object.entries(body),keys=entries.map(([k])=>k).sort().join(',');
 const expected=path==='/api/business-hours/'?'dayofweek,eventid,id,reservationdate,slugname':'hours_id,id,reservationdate,timeformat';
 if(keys!==expected||entries.some(([,v])=>typeof v!=='string')||!/^\d{1,10}$/.test(body.id)||!/^\d{2}\/\d{2}\/\d{4}$/.test(body.reservationdate))throw Error('Invalid availability request.');
 const [month,day,year]=body.reservationdate.split('/').map(Number),date=new Date(Date.UTC(year,month-1,day));
 if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw Error('Invalid availability date.');
 if(path==='/api/business-hours/'&&body.dayofweek!==String(date.getUTCDay()))throw Error('Invalid availability weekday.');
 if(path==='/api/business-hours/'&&(body.slugname!==page.pathname.split('/')[2]||body.eventid!=='0'||! /^[0-6]$/.test(body.dayofweek)))throw Error('Invalid availability scope.');
 if(path==='/api/business-hours-times/'&&(!/^\d{1,10}$/.test(body.hours_id)||body.timeformat!=='False'))throw Error('Invalid service scope.');
 let used=false;const expectedBody=new URLSearchParams(body).toString();
 return req=>{if(used||req.method()!=='PUT'||req.url()!==`https://tableagent.com${path}`||req.postData()!==expectedBody||req.isNavigationRequest?.()||!['fetch','xhr'].includes(req.resourceType()))return false;used=true;return true;};
}
export function tableagentVisit(values){
 const date=values['ta-date'],time=values['ta-time'],party=values['ta-party'];
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!/^\d{2}:\d{2}$/.test(time||'')||!/^\d{1,2}$/.test(party||''))throw Error('Review the date, time and party size first.');
 const parsed=new Date(`${date}T12:00:00Z`);if(!Number.isFinite(+parsed)||parsed.toISOString().slice(0,10)!==date||+time.slice(0,2)>23||+time.slice(3)>59||+party<1||+party>99)throw Error('Invalid visit details.');
 return {date:`${date.slice(5,7)}/${date.slice(8)}/${date.slice(0,4)}`,time,party,dayofweek:String(parsed.getUTCDay())};
}
export async function prepareTableagent(page,form,values,permit){
 if(typeof permit!=='function')throw Error('Availability lookup is unavailable.');
 const visit=tableagentVisit(values),pageUrl=page.url();
 async function options(path,body){
  permit(tableagentAvailabilityPermit({pageUrl,path,body}));
  try{return await page.evaluate(async({path,body})=>{
   const form=document.getElementById('findtableform'),token=form?.elements.csrfmiddlewaretoken?.value;
   if(!token)throw Error('Booking page session expired.');
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
   try{const response=await fetch(path,{method:'PUT',redirect:'error',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-CSRFToken':token,'X-Requested-With':'XMLHttpRequest'},body:new URLSearchParams(body).toString(),signal:controller.signal});
    if(!response.ok)throw Error('Availability could not be loaded.');
    const reader=response.body.getReader(),chunks=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>100000){await reader.cancel();throw Error('Availability response too large.');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const parsed=new DOMParser().parseFromString(new TextDecoder().decode(bytes),'text/html');
    return [...parsed.querySelectorAll('option')].slice(0,100).map(o=>({value:o.value,label:o.textContent,disabled:o.disabled||!!o.closest('optgroup[disabled]'),passcode:o.dataset.passcoderequired,hourstype:o.dataset.hourstype,min:o.dataset.minguest,max:o.dataset.maxguest}));
   }finally{clearTimeout(timer);}
  },{path,body});}finally{permit(null);}
 }
 const services=await options('/api/business-hours/',{id:form.restaurantId,slugname:new URL(pageUrl).pathname.split('/')[2],reservationdate:visit.date,dayofweek:visit.dayofweek,eventid:'0'});
 const eligible=services.filter(o=>/^\d{1,10}$/.test(o.value)&&+o.value>0&&!o.disabled);
 if(eligible.length!==1)throw new TableagentAvailabilityError(eligible.length?'tableagent_service_review':'tableagent_no_services');
 const service=eligible[0];
 if(!['true','false'].includes(String(service.passcode).toLowerCase())||!/^\d+$/.test(service.hourstype||'')||!/^[1-9]\d?$/.test(service.min||'')||!/^[1-9]\d?$/.test(service.max||'')||+service.min>+service.max)throw Error('Service details could not be verified.');
 if(String(service.passcode).toLowerCase()==='true'||service.hourstype!=='14')throw Error('This service needs extra review on the venue website.');
 if((service.min&&+visit.party<+service.min)||(service.max&&+visit.party>+service.max))throw new TableagentAvailabilityError('tableagent_party_unavailable',{min:+service.min,max:+service.max});
 const times=await options('/api/business-hours-times/',{hours_id:service.value,id:form.restaurantId,timeformat:'False',reservationdate:visit.date});
 const selected=times.find(o=>!o.disabled&&(o.value===visit.time||o.value===`${visit.time}:00`));
 if(!selected)throw new TableagentAvailabilityError('tableagent_time_unavailable');
 return {visit,service,time:selected,restaurantId:form.restaurantId};
}
// Executed only after the browser network has been disconnected.
export function fillTableagent({index,prepared}){
 const form=document.forms[index],{visit,service,time}=prepared;
 if(location.origin!=='https://tableagent.com'||form?.id!=='findtableform'||form.elements.restaurant?.value!==prepared.restaurantId||form.action!==`${location.origin}${location.pathname}table-search/`)throw Error('The booking form changed.');
 if([...form.querySelectorAll('input,select,textarea')].some(e=>e.required&&!['reservationdate','reservationtime','partysize','hours'].includes(e.name)&&e.type!=='hidden'))throw Error('Additional booking details need review.');
 const dateControl=form.querySelector('input#reservationdate[name=reservationdate]');
 if(!dateControl||dateControl.readOnly||!form.querySelector('select#id_hours')||!form.querySelector('select#reservationtime[name=reservationtime]')||!form.querySelector('select#partysize[name=partysize]'))throw Error('The booking controls changed.');
 function select(id,option){const el=form.querySelector(id);el.replaceChildren(new Option(option.label,option.value));el.disabled=false;el.value=option.value;return el.value;}
 const date=form.querySelector('#reservationdate');date.value=visit.date;
 select('#id_hours',service);const selectedTime=select('#reservationtime',time);
 const party=form.querySelector('#partysize'),choice=[...party.options].find(o=>o.value===visit.party);
 // Site hydration may empty the party select. Only numeric size within its
 // source-verified service limits is restored, without triggering handlers.
 if(choice?.disabled)throw Error('This party size is unavailable.');
 if(!choice)party.append(new Option(`${visit.party} people`,visit.party));party.disabled=false;party.value=visit.party;
 return [{label:'Date',value:date.value,status:date.value===visit.date?'filled':'unsupported_value'},{label:'Time',value:selectedTime,status:selectedTime===time.value?'filled':'unsupported_value'},{label:'Party size',value:party.value,status:party.value===visit.party?'filled':'unsupported_value'}];
}
