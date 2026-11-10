import test,{before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {syntheticRoutePlan} from './fixtures/route-plan.js';
import {recommendationKey,resultPreview,comparisonPreviewText} from '../src/result-preview.js';
import {resultsReady} from '../src/results-ready.js';

let ChatStudio,ResultsComparison,createRoot,bundleDir,dom,root,props,compact=false,reduced=false,scrolls=[],mediaChanges=new Set();
function setupDom(){
 dom?.window.close();dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true});
 for(const key of ['window','document','location','localStorage','sessionStorage','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Element','Node','MutationObserver','Event','MouseEvent','KeyboardEvent','navigator'])Object.defineProperty(globalThis,key,{value:dom.window[key],writable:true,configurable:true});
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 globalThis.requestAnimationFrame=fn=>{fn();return 0;};globalThis.cancelAnimationFrame=()=>{};
 window.matchMedia=query=>({get matches(){return query.includes('prefers-reduced-motion')?reduced:compact;},addEventListener(type,listener){if(query.includes('max-width'))mediaChanges.add(listener);},removeEventListener(type,listener){mediaChanges.delete(listener);}});
 HTMLElement.prototype.scrollTo=function(options){scrolls.push({element:this,options});};HTMLElement.prototype.scrollIntoView=()=>{};
 // JSDOM does not lay out. Expose potential focus targets for behavior-only Tab
 // tests, not as evidence of visibility or rendered viewport fit.
 HTMLElement.prototype.getClientRects=()=>[{width:100,height:44}];
 localStorage.setItem('unstressed.intro-dismissed','1');
}
before(async()=>{
 setupDom();({createRoot}=await import('react-dom/client'));
 const frontend=fileURLToPath(new URL('..',import.meta.url));bundleDir=await mkdtemp(join(frontend,'node_modules/.chat-results-test-'));
 for(const name of ['ChatStudio','ResultsComparison'])await build({entryPoints:[join(frontend,`src/${name}.jsx`)],outfile:join(bundleDir,`${name}.mjs`),bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',loader:{'.css':'empty'}});
 ChatStudio=(await import(pathToFileURL(join(bundleDir,'ChatStudio.mjs')).href)).default;
 ResultsComparison=(await import(pathToFileURL(join(bundleDir,'ResultsComparison.mjs')).href)).default;
});
after(async()=>{await rm(bundleDir,{recursive:true,force:true});});
beforeEach(()=>{
 compact=false;reduced=false;scrolls=[];mediaChanges=new Set();setupDom();const plan=syntheticRoutePlan();
 props={brief:plan.request,plan,chat:[{id:'receipt',role:'assistant',text:'Original generated receipt.',result:{recommendationKey:recommendationKey(plan),title:'Synthetic outing',detail:'2 stops'}}],tool:null,message:'',busy:false,configured:true,owner:true,guest:false,connecting:false,error:'',revisionFailed:false,draftChanged:false,planOpen:false,planView:'itinerary',resultScope:'account-a:day-one',resultRevision:1,
 onMessage(){},onSend(){},onDismissError(){},onNew(){},onSaved(){},onTool(){},onOpenPlan(){},onClosePlan(){},onPlanView(){},onPlace(){},onNextAction(){},renderTool:()=>null,children:React.createElement('section',{'data-testid':'full-results'},'Full synthetic results')};
});
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=null;dom.window.close();});
async function render(changes={}){props={...props,...changes};await act(async()=>{root??=createRoot(document.getElementById('root'));root.render(React.createElement(ChatStudio,props));});}
const button=name=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===name||el.getAttribute('aria-label')===name);
async function click(name){const node=button(name);assert.ok(node,`Missing button ${name}`);await act(async()=>{node.focus();node.click();});return node;}

function steps(){return {note:'Confirm details with the venue before going.',actions:[{id:'checks',label:'View hours & menus',icon:'list'},{id:'compare',label:'Compare places',icon:'nodes'},{id:'routes',label:'Plan the journey',icon:'map'},{id:'bookings',label:'Prepare bookings',icon:'edit'}]};}

test('all lower context and next actions collapse, retain their state on refresh, and support Escape',async()=>{
 await render({nextSteps:steps()});assert.equal(button('Plan actions').getAttribute('aria-expanded'),'false');assert.equal(document.querySelector('.cs-quick-actions'),null);assert.equal(document.querySelector('.cs-action-content'),null);assert.equal(document.querySelector('.cs-results-ready'),null);
 await click('Plan actions');assert.equal(button('Hide actions').getAttribute('aria-expanded'),'true');assert.equal(document.querySelectorAll('.cs-action-content .cs-next-buttons button').length,4);assert.match(document.querySelector('.cs-action-content').textContent,/Confirm details/);
 await render({resultRevision:2});assert.ok(document.querySelector('.cs-action-content'),'Background updates never choose the user’s collapse state');
 const route=button('Plan the journey');route.focus();await act(async()=>route.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 assert.equal(document.querySelector('.cs-action-content'),null);assert.equal(document.activeElement,button('Plan actions'));
 await click('Plan actions');await click('Hide actions');assert.equal(document.querySelector('.cs-action-content'),null);
});

test('blocked errors, important warnings and confirmation tools stay outside the collapsed area',async()=>{
 const error='The shared day changed. Review the latest people before continuing.';
 await render({error,nextSteps:{...steps(),attention:true,note:'A selected visit is missing.'},tool:{id:'permission',kind:'share'},chat:[...props.chat,{id:'permission',role:'assistant',text:'Confirm before sharing.',widget:'share'}],renderTool:()=>React.createElement('button',null,'Confirm sharing')});
 assert.equal(document.querySelector('[role="alert"]').textContent.includes(error),true);assert.equal(document.querySelector('.cs-plan-attention').textContent.includes('missing'),true);assert.ok(button('Confirm sharing'));assert.equal(button('Confirm sharing').closest('.cs-action-drawer'),null);
 await click('Plan actions');await render({busy:true});assert.ok([...document.querySelectorAll('.cs-action-content button')].every(el=>el.disabled));
});

test('preview retains visit order and repeated venues, counts options separately and opens exact stop details',async()=>{
 const plan=syntheticRoutePlan();plan.stops.push({...plan.stops[0],id:'missing',intent:'coffee',item:null,reason:'selected_evidence_unavailable'});plan.shortlist=[{intent:'coffee',item:{id:'another',name:'Synthetic Cafe'}}];let opened;
 await render({plan,brief:plan.request,chat:[{id:'receipt',role:'assistant',result:{recommendationKey:recommendationKey(plan)}}],onPlace:stop=>{opened=stop;}});
 const preview=document.querySelector('.cs-recommendation-preview');assert.equal(preview.querySelectorAll('li').length,3);assert.match(preview.textContent,/2 of 3 stops found · 2 places to explore/);
 assert.deepEqual([...preview.querySelectorAll('.cs-preview-place-copy strong')].map(el=>el.textContent),['Synthetic Listening Bar','Synthetic Listening Bar','Still to find']);
 await click('Explore stop 2: Synthetic Listening Bar');assert.equal(opened,plan.stops[1]);assert.match(preview.textContent,/compatible recent provider evidence is unavailable/);assert.match(preview.textContent,/Hours, prices and availability need confirmation/);
 assert.equal(plan.stops.length,3);assert.equal(plan.stops[2].item,null);
});

test('More opens Places directly while the complete comparison and actual results remain together',async()=>{
 const lead='Synthetic Listening Bar is worth exploring for its reported music focus.';
 const long=lead+'\n\n'+'Prices, opening times and meal service are unconfirmed. '.repeat(15);
 const comparison={id:'compare',role:'assistant',text:long,comparisonKey:recommendationKey(props.plan)};let opened=0,view;
 await render({chat:[...props.chat,comparison],onOpenPlan:()=>opened++,onPlanView:value=>{view=value;},planView:'checklist'});
 assert.equal(document.querySelectorAll('.cs-messages .cs-recommendation-preview').length,1);assert.equal(document.querySelector('.cs-messages').textContent.includes(long.trim()),false);assert.equal(document.querySelector('.cs-preview-lead').textContent,lead);
 await click('More · View results');assert.equal(opened,1);assert.equal(view,'itinerary');
 await render({planOpen:true,planView:view});const detail=document.querySelector('.cs-result-reasoning');assert.ok(detail);assert.equal(detail.open,false);assert.ok(detail.textContent.includes('Prices, opening times and meal service are unconfirmed.'));assert.ok(document.querySelector('[data-testid="full-results"]'));
 await act(async()=>{detail.open=true;});await click('Back to places');assert.equal(detail.open,false);assert.equal(document.activeElement,detail.querySelector('summary'));
});

test('earlier recommendations cannot acquire another day’s preview or link their venue names to it',async()=>{
 const old=syntheticRoutePlan(),oldKey=recommendationKey(old);const current={...old,request:{...old.request,date:'2027-02-02'}};
 await render({plan:current,brief:current.request,chat:[{id:'old',role:'assistant',text:'Synthetic Listening Bar, for the old date only.',comparisonKey:oldKey},{id:'old-receipt',role:'assistant',text:'An earlier result.',result:{title:'Old date',detail:'2 stops',recommendationKey:oldKey}}]});
 assert.equal(document.querySelectorAll('.cs-recommendation-preview').length,1);assert.ok(document.querySelector('[data-current-result-preview] .cs-recommendation-preview'),'Legacy history receives a separate, explicitly current preview');assert.equal(document.querySelector('.cs-earlier-result .cs-recommendation-preview'),null);assert.ok(document.querySelector('.cs-earlier-result details'));assert.equal(document.querySelector('.cs-earlier-result .cs-venue-mention'),null);assert.equal(document.querySelectorAll('.cs-result-card strong')[0].textContent,'View current results');
 const newer={...current,provenance:{...current.provenance,retrievedAt:'2026-11-09T00:00:00Z'}};assert.notEqual(recommendationKey(current),recommendationKey(newer));
});

test('ordinary user and assistant content is never truncated or moved into More',async()=>{
 const text='A direct answer with essential safety information. '.repeat(80);
 await render({chat:[{id:'u',role:'user',text},{id:'a',role:'assistant',text}]});
 const turns=document.querySelectorAll('.cs-turn-body');assert.equal(turns[0].textContent,text);assert.equal(turns[1].textContent,text.trim());assert.equal(document.querySelector('.cs-earlier-result'),null);
});

test('only successful settled refreshes announce once, including a same-place refresh',async()=>{
 await render({busy:true});assert.equal(document.querySelector('.cs-result-toast'),null);
 await render({busy:false});const first=document.querySelector('.cs-result-toast');assert.ok(first);const glints=document.querySelector('.cs-result-sparkles');assert.ok(glints);
 await render({plan:{...props.plan,qualityReview:{status:'complete'},savedPlan:{id:'saved',revision:1}}});assert.equal(document.querySelector('.cs-result-toast'),first);assert.equal(document.querySelector('.cs-result-sparkles'),glints);
 await render({planOpen:true});assert.equal(document.querySelector('.cs-view-day').classList.contains('fresh'),false);assert.equal(document.querySelector('.cs-result-toast'),first);
 await render({busy:true,planOpen:false});assert.equal(document.querySelector('.cs-result-toast'),null);
 await render({busy:false,revisionFailed:true,resultRevision:2});assert.equal(document.querySelector('.cs-result-toast'),null);
 await render({busy:true,revisionFailed:false});await render({busy:false,resultRevision:3});const refreshed=document.querySelector('.cs-result-toast');assert.ok(refreshed);assert.notEqual(refreshed,first);assert.match(refreshed.textContent,/Results updated/);
 await render({resultRevision:3});assert.equal(document.querySelector('.cs-result-toast'),refreshed);
});

test('context switches clear feedback and expanded controls before an account or shared-day change',async()=>{
 await render();await click('Plan actions');assert.ok(document.querySelector('.cs-result-toast'));
 for(const scope of ['account-b:day-one','account-b:shared-two','account-b:shared-two:guest']){
  await render({resultScope:scope});assert.equal(document.querySelector('.cs-result-toast'),null);assert.equal(document.querySelector('.cs-action-content'),null);assert.equal(document.querySelector('.cs-result-sparkles'),null);
  await click('Plan actions');
 }
 await render({resultScope:'fresh',plan:null,chat:[]});assert.equal(document.querySelector('.cs-result-toast'),null);assert.equal(document.querySelector('.cs-action-content'),null);
});

test('a refresh never opens results, steals button focus or jumps a reader to the latest message',async()=>{
 let opened=0;await render({onOpenPlan:()=>opened++});await click('Plan actions');const active=button('Hide actions');
 const log=document.querySelector('.cs-messages');Object.defineProperties(log,{scrollHeight:{value:1000,configurable:true},clientHeight:{value:300,configurable:true}});log.scrollTop=10;await act(async()=>log.dispatchEvent(new Event('scroll',{bubbles:true})));scrolls=[];
 await render({busy:true});await render({busy:false,resultRevision:2,chat:[...props.chat,{id:'new',role:'assistant',text:'New result detail.'}]});
 assert.equal(opened,0);assert.equal(document.activeElement,active);assert.equal(scrolls.filter(call=>call.element===log).length,0);
});

test('mobile results keep focus within the panel and return focus to More on Escape',async()=>{
 compact=true;await render();const more=await click('More · View results');await render({planOpen:true,onClosePlan:()=>{}});const panel=document.querySelector('.cs-day-panel');assert.equal(panel.getAttribute('aria-modal'),'true');assert.equal(document.activeElement,button('Back to chat'));
 const candidates=[...panel.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),summary,[tabindex="0"]')];candidates.at(-1).focus();await act(async()=>panel.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));assert.equal(document.activeElement,candidates[0]);
 let closed=0;await render({onClosePlan:()=>closed++});await act(async()=>panel.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));assert.equal(closed,1);
 await render({planOpen:false});assert.equal(document.activeElement,more);
});

test('reduced motion keeps a text cue, uses auto scrolling and removes every decorative animation',async()=>{
 reduced=true;await render();assert.ok(document.querySelector('.cs-result-toast'));assert.ok(scrolls.filter(call=>call.element.className==='cs-messages').every(call=>call.options.behavior==='auto'));
 const css=await readFile(new URL('../src/recommendation-preview.css',import.meta.url),'utf8');const styles=new JSDOM(`<style>${css}</style>`);
 try{const rule=[...styles.window.document.styleSheets[0].cssRules].find(rule=>rule.conditionText==='(prefers-reduced-motion:reduce)');assert.ok(rule);const declarations=new Map([...rule.cssRules].map(rule=>[rule.selectorText,rule.style]));assert.equal(declarations.get('.chat-studio .cs-result-sparkles').display,'none');assert.equal(declarations.get('.chat-studio .cs-result-sparkles *').animation,'none');}finally{styles.window.close();}
});

test('result identity covers repetition, unfilled positions, dates, taste context, times and retrieval revision',()=>{
 const plan=syntheticRoutePlan();const before=resultsReady(plan,null).key;
 for(const changed of [{...plan,stops:[plan.stops[0]]},{...plan,stops:[plan.stops[1],plan.stops[0]]},{...plan,stops:[plan.stops[0],{...plan.stops[1],item:null}]},{...plan,request:{...plan.request,date:'2027-03-01'}},{...plan,request:{...plan.request,people:[{...plan.request.people[0],vibes:['quiet']}]}},{...plan,stops:[plan.stops[0],{...plan.stops[1],start:'22:00'}]}])assert.notEqual(resultsReady(changed,null).key,before);
 assert.deepEqual(resultPreview(plan).stops,plan.stops);assert.notEqual(recommendationKey({...plan,provenance:{retrievedAt:'new'}}),recommendationKey(plan));
});

test('a stale or interrupted automatic comparison cannot append after the result context changes',async()=>{
 const plan=syntheticRoutePlan();plan.stops[1]={...plan.stops[1],item:{id:'second',entityId:'synthetic-second',name:'Synthetic second'}};plan.stops[0]={...plan.stops[0],item:{id:'first',entityId:'synthetic-first',name:'Synthetic first'}};
 const pending=[],ready=[],client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 client.setQueryData(['venue','synthetic-first'],{});client.setQueryData(['venue','synthetic-second'],{});
 const compare=(ids,picks,signal)=>new Promise(resolve=>pending.push({ids,signal,resolve}));
 const show=async(next,busy=false)=>{await act(async()=>{root??=createRoot(document.getElementById('root'));root.render(React.createElement(QueryClientProvider,{client},React.createElement(ResultsComparison,{plan:next,busy,onCompare:compare,onReady:(text,key)=>ready.push({text,key})})));});};
 await show(plan);assert.equal(pending.length,1);const old=pending[0];
 const changed={...plan,request:{...plan.request,date:'2027-02-02'}};await show(changed);assert.equal(old.signal.aborted,true);assert.equal(pending.length,2);
 await act(async()=>old.resolve('Stale comparison'));assert.deepEqual(ready,[]);
 await act(async()=>pending[1].resolve('Current comparison'));assert.deepEqual(ready,[{text:'Current comparison',key:recommendationKey(changed)}]);
 await show({...changed,request:{...changed.request,area:'Elsewhere'}},true);assert.equal(pending.length,2);client.clear();
});


test('a comparison lead preserves complete source sentences, grounding and all concise uncertainty',()=>{
 const plan=syntheticRoutePlan(),short='Synthetic Listening Bar is an option. The visit time and price are unconfirmed.';assert.equal(comparisonPreviewText(short,plan),short);
 const intro='Here is how the places compare. ',lead='Recommendation: Synthetic Listening Bar for the music stop.';const remainder=' Its full supplied description is available with the results.'.repeat(15);assert.equal(comparisonPreviewText(intro+lead+remainder,plan),lead);
 const unsupported='Unreturned Venue is ideal.'+' Other details remain unknown.'.repeat(30);assert.equal(comparisonPreviewText(unsupported,plan),'');
 const longSentence='Synthetic Listening Bar '+('with a very long source description '.repeat(30))+'.';assert.equal(comparisonPreviewText(longSentence,plan),'','Never split an overlong sentence into a new claim');
});


test('Your day preserves the selected result tab while a new first-plan preview is discoverable',async()=>{
 let opened=0,selected;await render({chat:[],planView:'checklist',busy:true,onOpenPlan:()=>opened++,onPlanView:tab=>{selected=tab;}});
 assert.ok(document.querySelector('[data-current-result-preview]'));assert.equal(document.querySelector('.cs-result-toast'),null);await click('Your day');assert.equal(opened,1);assert.equal(selected,undefined);
 await click('More · View results');assert.equal(opened,2);assert.equal(selected,'itinerary');
});

test('feedback expires without reannouncing on polling and its timer is cancelled on a context change',async()=>{
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,timers=new Map();let next=0;
 globalThis.setTimeout=(callback,delay,...args)=>{if(delay!==5000)return originalSet(callback,delay,...args);const token={id:++next};timers.set(token,callback);return token;};
 globalThis.clearTimeout=token=>{if(timers.has(token))timers.delete(token);else originalClear(token);};
 try{
  await render();assert.equal(timers.size,1);await act(async()=>[...timers.values()][0]());assert.equal(document.querySelector('.cs-result-toast'),null);assert.equal(document.querySelector('.cs-result-sparkles'),null);
  await render({plan:{...props.plan,qualityReview:{status:'complete'}}});assert.equal(document.querySelector('.cs-result-toast'),null);
  await render({resultRevision:2});assert.equal(timers.size,1);await render({resultScope:'different-account'});assert.equal(timers.size,0);assert.equal(document.querySelector('.cs-result-toast'),null);
 }finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});

test('long comparison previews reject abbreviation fragments rather than displaying a partial claim',()=>{
 const plan=syntheticRoutePlan(),text='Synthetic Listening Bar costs approx. GHS 100, but that price is not confirmed. '+('See the source and confirm prices. '.repeat(20));
 assert.equal(comparisonPreviewText(text,plan),'');
});

test('empty results never invent a recommendation, selected visit, photo or booking state',async()=>{
 const plan={...props.plan,stops:[],shortlist:[],warnings:[]};await render({plan,brief:plan.request,chat:[{id:'receipt',role:'assistant',result:{recommendationKey:recommendationKey(plan)}}]});
 assert.match(currentText(),/Places still to find/);assert.equal(document.querySelectorAll('.cs-preview-places li').length,0);assert.equal(document.querySelectorAll('.cs-preview-places img').length,0);assert.match(currentText(),/0 planned stops · 0 places to explore/);assert.doesNotMatch(currentText(),/booked|confirmed availability/i);
 function currentText(){return document.querySelector('.cs-recommendation-preview').textContent;}
});

test('a fresh web conversation has a useful unbranded prompt and no automatic personalization wall',async()=>{
 localStorage.removeItem('unstressed.intro-dismissed');
 await render({plan:null,chat:[]});
 const opening=document.querySelector('.cs-opening');assert.ok(opening);assert.match(opening.textContent,/What do you feel like doing/);
 assert.equal(opening.querySelector('.outing-sun'),null);assert.equal(document.querySelector('.cs-welcome'),null);
 assert.equal(document.querySelector('[aria-label="Help me know your kind of outing"]'),null);
 assert.ok(document.querySelector('.cs-header .cs-brand'));assert.ok(button('Plan near me'));assert.ok(button('Bring a circle'));
 assert.equal(document.querySelector('.cs-thinking'),null,'No made-up loading period');
});

test('an opening suggestion fills the composer without sending or requesting location',async()=>{
 let draft,sent=0,tools=0;
 await render({plan:null,chat:[],onMessage:text=>{draft=text;},onSend:()=>sent++,onTool:()=>tools++});
 await click('Somewhere to unwind');assert.equal(draft,'I’d like somewhere to unwind.');assert.equal(sent,0);assert.equal(tools,0);
 assert.equal(document.querySelector('.cs-opening'),null);assert.equal(document.activeElement,document.querySelector('textarea'));
 await render({message:draft});await render({message:''});assert.equal(document.querySelector('.cs-opening'),null,'Clearing a draft does not replay the opening');
});

test('typing, tools, results and real activity dismiss the opening for the current outing only',async()=>{
 await render({plan:null,chat:[]});assert.ok(document.querySelector('.cs-opening'));
 await render({message:'A quiet place'});assert.equal(document.querySelector('.cs-opening'),null);
 await render({message:''});assert.equal(document.querySelector('.cs-opening'),null);
 await render({resultScope:'new-day'});assert.ok(document.querySelector('.cs-opening'));
 await render({tool:{id:'review',kind:'review'},reviewContent:React.createElement('p',null,'Review the draft')});assert.equal(document.querySelector('.cs-opening'),null);assert.match(document.querySelector('.cs-draft-plan').textContent,/Review the draft/);
 await render({tool:null});assert.equal(document.querySelector('.cs-opening'),null);
 await render({resultScope:'next-day',busy:true});assert.equal(document.querySelector('.cs-opening'),null);assert.ok(document.querySelector('.cs-thinking'));
 await render({busy:false});assert.equal(document.querySelector('.cs-opening'),null);
});

test('nearby and circle starters use the existing contextual actions without an intro detour',async()=>{
 const actions=[];await render({plan:null,chat:[],onTool:kind=>actions.push(kind)});
 await click('Plan near me');assert.deepEqual(actions,['nearby']);assert.equal(document.querySelector('.cs-opening'),null);
 await render({resultScope:'new-day'});await click('Bring a circle');assert.deepEqual(actions,['nearby','circles']);
});

test('personalization is explicitly opened, dismissible and cleared across account or outing changes',async()=>{
 await render({plan:null,chat:[]});await click('Add to the conversation');await click('Personalize');
 assert.ok(document.querySelector('[aria-label="Help me know your kind of outing"]'));assert.equal(document.querySelector('.cs-opening'),null);
 await click('Maybe later');assert.equal(document.querySelector('[aria-label="Help me know your kind of outing"]'),null);
 await click('Add to the conversation');await click('Personalize');await render({resultScope:'another-account'});
 assert.equal(document.querySelector('[aria-label="Help me know your kind of outing"]'),null);assert.ok(document.querySelector('.cs-opening'));
});

test('shared-day connection status exists only while connecting and never delays the join screen',async()=>{
 await render({plan:null,chat:[],guest:true,owner:false,connecting:true,joinContent:React.createElement('p',{'data-testid':'join'},'Join this day')});
 assert.match(document.querySelector('.cs-connecting').textContent,/Opening your shared day/);assert.equal(document.querySelector('.cs-opening'),null);
 await render({connecting:false});assert.equal(document.querySelector('.cs-connecting'),null);assert.ok(document.querySelector('[data-testid="join"]'));assert.equal(document.querySelector('.cs-opening'),null);
});

test('desktop keeps the inline outing, opens details on request and restores focus after repeated dismissals',async()=>{
 let closed=0;await render({chat:[],onClosePlan:()=>closed++});
 assert.ok(document.querySelector('[data-current-result-preview]'));assert.equal(document.querySelector('.cs-opening'),null);assert.equal(document.querySelector('.cs-welcome'),null);
 const panel=document.querySelector('.cs-day-panel');assert.equal(panel.hidden,true);assert.equal(button('Your day').getAttribute('aria-expanded'),'false');
 for(let i=0;i<2;i++){
  const more=await click('More · View results');await render({planOpen:true});assert.equal(panel.hidden,false);assert.equal(panel.getAttribute('aria-modal'),null);assert.equal(document.activeElement,button('Back to chat'));
  assert.equal(button('Your day').getAttribute('aria-expanded'),'true');
  await act(async()=>panel.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));assert.equal(closed,i+1);
  await render({planOpen:false});assert.equal(panel.hidden,true);assert.ok(document.activeElement===more,'Focus returns to the result trigger');
 }
});

test('contextual detail views support arrow keys, Home and End with one tab stop and linked panel',async()=>{
 let selected='itinerary';await render({planOpen:true,onPlanView:value=>selected=value});
 const tabs=[...document.querySelectorAll('[role="tab"]')],panel=document.querySelector('[role="tabpanel"]');
 assert.equal(tabs.filter(tab=>tab.tabIndex===0).length,1);assert.equal(panel.getAttribute('aria-labelledby'),tabs[0].id);
 const press=async key=>act(async()=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})));
 tabs[0].focus();await press('ArrowRight');assert.equal(selected,'taste');assert.equal(document.activeElement,tabs[1]);
 await render({planView:selected});assert.equal(tabs[1].tabIndex,0);assert.equal(tabs[0].tabIndex,-1);
 await press('End');assert.equal(selected,'checklist');await render({planView:selected});assert.equal(panel.id,tabs[3].getAttribute('aria-controls'));
 await press('ArrowRight');assert.equal(selected,'itinerary');await press('ArrowLeft');assert.equal(selected,'checklist');await press('Home');assert.equal(selected,'itinerary');
});


test('narrowing an open desktop pane moves focus into the modal without losing its original return target',async()=>{
 await render();const more=await click('More · View results');await render({planOpen:true});
 document.querySelector('textarea').focus();assert.equal(document.activeElement.tagName,'TEXTAREA');
 await act(async()=>{compact=true;for(const change of mediaChanges)change();});
 assert.equal(document.querySelector('.cs-day-panel').getAttribute('aria-modal'),'true');
 assert.ok(document.activeElement===button('Back to chat'),'Focus leaves the newly inert conversation');
 await act(async()=>{compact=false;for(const change of mediaChanges)change();});
 await render({planOpen:false});assert.ok(document.activeElement===more,'Resize never replaces the original return target');
});
