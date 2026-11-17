// Deliberately bounded to the observed Wix reservation add-on, not arbitrary forms.
export function inspectWixForms(){
 return [...document.forms].flatMap((form,index)=>{
  if(form.getAttribute('data-hook')!=='reservation-addon-form__root')return [];
  const date=form.querySelector('[data-hook="reservation-addon-form__date"] input[readonly]');
  const party=form.querySelector('[data-hook="reservation-addon-form__partySize"] button[role="combobox"][type="button"]');
  const time=form.querySelector('[data-hook="reservation-addon-form__time"] button[role="combobox"][type="button"]');
  const opener=form.querySelector('[data-hook="reservation-addon-form__date"] button[type="button"][aria-label="Date"]');
  if(!date||!party||!time||!opener||![date,party,time,opener].every(e=>e.getClientRects().length&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'))return [];
  return [{index,action:form.action,method:form.method,adapter:'wix-reservation-v1',widgetSignature:{dateType:date.type,datePlaceholder:date.getAttribute('placeholder')||'',dateLabel:opener.getAttribute('aria-label'),partyLabel:party.getAttribute('aria-label')||'',timeLabel:time.getAttribute('aria-label')||''},fields:[
   {id:'wix-date',type:'date',semantic:'date',label:'Date',required:true},
   {id:'wix-time',type:'time',semantic:'time',label:'Time',required:true},
   {id:'wix-partySize',type:'number',semantic:'partySize',label:'Party size',required:true}
  ]}];
 });
}
// Executes only after network freeze, in the SAME live page. No values are assigned
// to readonly inputs. The gate permits a single checked widget node synchronously.
export async function fillWixForm({index,values},gate){
 const form=document.forms[index],result=[];
 if(form?.getAttribute('data-hook')!=='reservation-addon-form__root')throw Error('Reservation widget changed.');
 const visible=e=>!!e&&!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const enabled=e=>form.isConnected&&document.forms[index]===form&&e?.isConnected&&form.contains(e)&&visible(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';
 const click=e=>{if(!enabled(e)||e.tagName!=='BUTTON'&&!(e.tagName==='DIV'&&e.getAttribute('role')==='option')||e.tagName==='BUTTON'&&e.type!=='button')return false;gate.add(e);try{e.click();}finally{gate.delete(e);}return true;};
 const settle=()=>new Promise(r=>setTimeout(r,100));
 const signature=()=>{
  const date=form.querySelector('[data-hook="reservation-addon-form__date"] input[readonly]'),party=form.querySelector('[data-hook="reservation-addon-form__partySize"] button[role="combobox"][type="button"]'),time=form.querySelector('[data-hook="reservation-addon-form__time"] button[role="combobox"][type="button"]'),opener=form.querySelector('[data-hook="reservation-addon-form__date"] button[type="button"][aria-label="Date"]');
  if(![date,party,time,opener].every(enabled))return null;
  return JSON.stringify({dateType:date.type,datePlaceholder:date.getAttribute('placeholder')||'',dateLabel:opener.getAttribute('aria-label'),partyLabel:party.getAttribute('aria-label')||'',timeLabel:time.getAttribute('aria-label')||''});
 };
 const initialSignature=signature();
 if(!initialSignature)throw Error('Reservation widget changed.');
 const dateRoot=form.querySelector('[data-hook="reservation-addon-form__date"]');
 const date=values['wix-date'];
 let dateOk=false;
 if(/^\d{4}-\d{2}-\d{2}$/.test(date||'')){
  const [y,m,d]=date.split('-').map(Number),target=new Date(Date.UTC(y,m-1,d));
  if(Number.isFinite(target.getTime())&&target.toISOString().slice(0,10)===date){
   const opener=dateRoot?.querySelector('button[type="button"][aria-label="Date"]');
   if(click(opener)){await settle();
    // Only currently rendered dates. No guessed next-month controls or navigation.
    const label=target.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});
    const matches=[...dateRoot.querySelectorAll('button[type="button"][role="gridcell"]')].filter(e=>e.querySelector('[aria-label]')?.getAttribute('aria-label')===label);
    if(matches.length===1&&click(matches[0])){await settle();
     const display=dateRoot.querySelector('input[readonly]')?.value||'';
     dateOk=display===`${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')}/${y}`||display===`${m}/${d}/${y}`;
    }
    if(opener.getAttribute('aria-expanded')==='true')click(opener);
   }
  }
 }
 result.push({label:'Date',value:dateOk?date:'',status:dateOk?'filled':'unsupported_value'});
 const asTime=s=>{if(/^([01]\d|2[0-3]):[0-5]\d$/.test(s.trim()))return s.trim();const match=s.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);if(!match)return null;let h=Number(match[1]);const m=Number(match[2]);if(h<1||h>12||m>59)return null;h=h%12+(match[3].toUpperCase()==='PM'?12:0);return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;};
 for(const [key,label,semantic] of [['partySize','Party size','party'],['time','Time','time']]){
  const value=values[`wix-${key}`],root=form.querySelector(`[data-hook="reservation-addon-form__${key}"]`),button=root?.querySelector('button[role="combobox"][type="button"]');
  let ok=false;
  // A changed date must be verified first. Never reuse options for a different date.
  if(dateOk&&value&&click(button)){await settle();
   const ownedId=button.getAttribute('aria-controls'),list=ownedId?document.getElementById(ownedId):null;
   const convert=s=>semantic==='time'?asTime(s):(/^(\d+)\s+guests?$/i.exec(s.trim())?.[1]||null);
   if(list&&root.contains(list)&&visible(list)){
    const matches=[...list.querySelectorAll('[role="option"]')].filter(e=>enabled(e)&&convert(e.textContent)===value);
    if(matches.length===1&&click(matches[0])){await settle();ok=convert(button.textContent)===value&&button.getAttribute('aria-expanded')==='false';}
   }
   if(button.getAttribute('aria-expanded')==='true')click(button);
  }
  result.push({label,value:ok?value:'',status:ok?'filled':'unavailable_offline'});
 }
 // A later widget handler can reset an earlier selection. Re-read the final
 // connected form state; do not report per-step observations as final success.
 const sameForm=form.isConnected&&document.forms[index]===form&&enabled(dateRoot)&&form.querySelector('[data-hook="reservation-addon-form__date"]')===dateRoot&&signature()===initialSignature;
 const dateDisplay=dateRoot?.querySelector('input[readonly]')?.value||'';
 const parts=(date||'').split('-').map(Number);
 const finalDate=parts.length===3&&(dateDisplay===`${String(parts[1]).padStart(2,'0')}/${String(parts[2]).padStart(2,'0')}/${parts[0]}`||dateDisplay===`${parts[1]}/${parts[2]}/${parts[0]}`);
 for(const field of result){
  let matches=field.label==='Date'?finalDate:false;
  if(field.label==='Time')matches=asTime(form.querySelector('[data-hook="reservation-addon-form__time"] button[role="combobox"]')?.textContent||'')===values['wix-time'];
  if(field.label==='Party size')matches=/^(\d+)\s+guests?$/i.exec((form.querySelector('[data-hook="reservation-addon-form__partySize"] button[role="combobox"]')?.textContent||'').trim())?.[1]===values['wix-partySize'];
  if(field.status==='filled'&&(!sameForm||!matches)){field.status='unsupported_value';field.value='';}
 }
 return result;
}

// Closed by default, including links and nested programmatic submit-button clicks.
export function installReservationClickGate(){
 const allowed=new Set();window.stop();
 document.addEventListener('click',e=>{
  const target=e.target.closest?.('button,[role="option"]');
  if(target&&allowed.has(target))return;
  // Keep native offline fields editable in the retained review tab. This does
  // not permit buttons, links, custom-widget controls, or form submission.
  const field=e.target.closest?.('input,textarea,select');
  if(!target&&!e.target.closest?.('a[href]')&&field&&(!field.matches('input')||['text','email','tel','number','date','time','datetime-local','search','url'].includes(field.type)))return;
  e.preventDefault();e.stopImmediatePropagation();
 },true);
 document.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();}},true);
 document.addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation();},true);
 HTMLFormElement.prototype.submit=function(){throw Error('Preview only');};
 HTMLFormElement.prototype.requestSubmit=function(){throw Error('Preview only');};
 return allowed;
}
