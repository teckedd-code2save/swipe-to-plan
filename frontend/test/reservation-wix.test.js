import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {inspectWixForms,fillWixForm,installReservationClickGate} from '../../shared/reservation-wix.js';
const values={'wix-date':'2026-11-18','wix-time':'19:30','wix-partySize':'2'};
async function fixture(options,job){
 const dom=new JSDOM(`<form data-hook="reservation-addon-form__root"><div data-hook="reservation-addon-form__date"><input readonly value="11/17/2026"><button type="button" aria-label="Date" aria-expanded="false"></button><div data-hook="date-picker-calendar" hidden><button type="button" role="gridcell" ${options.disabled?'disabled':''}><div aria-label="Wednesday, November 18, 2026"></div></button></div></div>${['partySize','time'].map((k,i)=>`<div data-hook="reservation-addon-form__${k}"><button type="button" role="combobox" aria-controls="list${i}" aria-expanded="false">${i?'9:30 PM':'3 guests'}</button><div id="list${i}" hidden><div role="option" aria-disabled="false">${i?'7:30 PM':'2 guests'}</div></div></div>`).join('')}<button type="submit">Request a Table</button><a href="https://example.com">link</a></form>`,{url:'https://venue.example'});
 const w=dom.window,previous={};for(const [k,v] of Object.entries({window:w,document:w.document,HTMLFormElement:w.HTMLFormElement,getComputedStyle:w.getComputedStyle.bind(w)})){previous[k]=globalThis[k];globalThis[k]=v;}
 w.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};
 const form=w.document.forms[0],date=form.querySelector('[aria-label="Date"]'),calendar=form.querySelector('[data-hook="date-picker-calendar"]');
 date.onclick=()=>{calendar.hidden=!calendar.hidden;date.setAttribute('aria-expanded',String(!calendar.hidden));};
 calendar.querySelector('button').onclick=()=>{if(!options.noState)form.querySelector('input').value='11/18/2026';calendar.hidden=true;date.setAttribute('aria-expanded','false');};
 for(const button of form.querySelectorAll('[role="combobox"]')){const list=w.document.getElementById(button.getAttribute('aria-controls'));button.onclick=()=>{list.hidden=!list.hidden;button.setAttribute('aria-expanded',String(!list.hidden));};list.firstChild.onclick=()=>{if(!options.noState)button.textContent=list.firstChild.textContent;list.hidden=true;button.setAttribute('aria-expanded','false');if(options.resetDate)form.querySelector('input').value='11/19/2026';};}
 if(options.clock24)w.document.getElementById('list1').firstChild.textContent='19:30';
 if(options.foreign){const list=w.document.getElementById('list1');w.document.body.append(list);}
 if(options.missing)w.document.getElementById('list1').replaceChildren();
 if(options.disabledOption)w.document.getElementById('list1').firstChild.setAttribute('aria-disabled','true');
 const gate=installReservationClickGate();
 try{return await job({w,form,gate});}finally{w.close();for(const [k,v] of Object.entries(previous)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
}
test('Wix adapter changes real widget state through owned enabled controls, not backing assignment',()=>fixture({},async({form,gate})=>{
 assert.equal(inspectWixForms()[0].adapter,'wix-reservation-v1');
 const result=await fillWixForm({index:0,values},gate);
 assert.deepEqual(result.map(x=>x.status),['filled','filled','filled']);
 assert.equal(form.querySelector('input').value,'11/18/2026');assert.equal(gate.size,0);
}));
for(const [name,options] of [['disabled calendar',{disabled:true}],['handler did not update state',{noState:true}],['foreign dropdown',{foreign:true}],['offline missing options',{missing:true}],['disabled time option',{disabledOption:true}]])test(`Wix adapter fails closed: ${name}`,()=>fixture(options,async({gate})=>{
 const result=await fillWixForm({index:0,values},gate);assert.ok(result.some(x=>x.status!=='filled'));assert.equal(gate.size,0);
}));
test('freeze gate blocks submit, links, nested submit attempts and imperative submission',()=>fixture({},async({form,gate,w})=>{
 let submitted=0;form.addEventListener('submit',()=>submitted++);
 const submit=form.querySelector('[type="submit"]');let clicked=0;submit.onclick=()=>clicked++;
 submit.click();assert.equal(clicked,0);
 const a=form.querySelector('a');const ev=new w.MouseEvent('click',{bubbles:true,cancelable:true});a.dispatchEvent(ev);assert.equal(ev.defaultPrevented,true);
 const date=form.querySelector('[aria-label="Date"]');const original=date.onclick;date.onclick=()=>{submit.click();original();};
 await fillWixForm({index:0,values},gate);assert.equal(clicked,0);assert.equal(submitted,0);
 assert.throws(()=>form.submit(),/Preview only/);assert.throws(()=>form.requestSubmit(),/Preview only/);
}));

test('Wix adapter matches exact rendered24-hour times',()=>fixture({clock24:true},async({gate})=>{const result=await fillWixForm({index:0,values},gate);assert.equal(result.find(f=>f.label==='Time').status,'filled');}));

test('Wix adapter rechecks final state after later handlers reset date',()=>fixture({resetDate:true},async({gate})=>{const result=await fillWixForm({index:0,values},gate);assert.equal(result.find(f=>f.label==='Date').status,'unsupported_value');}));

test('Wix discovery fingerprint inputs include observed stable labels and date format',()=>fixture({},async({form})=>{
 const before=inspectWixForms()[0];
 form.querySelector('input').setAttribute('placeholder','DD/MM/YYYY');
 form.querySelector('[data-hook="reservation-addon-form__time"] button').setAttribute('aria-label','End time');
 const after=inspectWixForms()[0];assert.notDeepEqual(before.widgetSignature,after.widgetSignature);
}));
for(const mutation of ['move-date-root','disable-time','change-label','change-type'])test(`final verification rejects changed owned widget: ${mutation}`,()=>fixture({},async({form,gate,w})=>{
 const option=w.document.getElementById('list1').firstChild,original=option.onclick;
 option.onclick=()=>{original();const time=form.querySelector('[data-hook="reservation-addon-form__time"] button');if(mutation==='move-date-root'){const root=form.querySelector('[data-hook="reservation-addon-form__date"]'),replacement=root.cloneNode(true);replacement.querySelector('input').value='11/19/2026';root.replaceWith(replacement);w.document.body.append(root);}if(mutation==='disable-time')time.disabled=true;if(mutation==='change-label')time.setAttribute('aria-label','Different widget');if(mutation==='change-type')time.type='submit';};
 const result=await fillWixForm({index:0,values},gate);assert.ok(result.every(f=>f.status!=='filled'));assert.equal(gate.size,0);
}));
test('retained native offline fields remain clickable while action controls stay blocked',()=>fixture({},async({form,w})=>{
 for(const type of ['text','email','tel','date','time','number']){const input=w.document.createElement('input');input.type=type;form.append(input);const event=new w.MouseEvent('click',{bubbles:true,cancelable:true});input.dispatchEvent(event);assert.equal(event.defaultPrevented,false);}
 const button=form.querySelector('[type=submit]'),event=new w.MouseEvent('click',{bubbles:true,cancelable:true});button.dispatchEvent(event);assert.equal(event.defaultPrevented,true);
}));
test('an anchor masquerading as a widget option is never clicked',()=>fixture({},async({gate,w})=>{
 const list=w.document.getElementById('list1'),a=w.document.createElement('a');a.href='https://example.com/send';a.setAttribute('role','option');a.textContent='7:30 PM';let clicked=0;a.onclick=()=>clicked++;list.replaceChildren(a);
 const result=await fillWixForm({index:0,values},gate);assert.equal(clicked,0);assert.notEqual(result.find(f=>f.label==='Time').status,'filled');
}));
