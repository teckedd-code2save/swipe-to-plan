import {formatMoney} from './money.js';
import {useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {Icon,ACTIVITY_NAMES,dateLabel,money} from './PlannerIcons.jsx';
import TasteMap from './TasteMap.jsx';
import TripEditor from './TripEditor.jsx';
import PlanReview from './PlanReview.jsx';
import {PlaceDetails,PlaceCheckNotice,usePlaceChecks} from './PlaceGuide.jsx';
import './place-guide.css';
import ShareDay from './ShareDay.jsx';
import {Budget,BeforeGoing,Stop} from './PlanDetails.jsx';
import ChatStudio from './ChatStudio.jsx';
import {TasteAction,CirclesAction,PeopleAction,LocationAction} from './ChatActions.jsx';
import {readCircles,writeCircles,makeCircle,bringCircle,circlePeople} from './circles.js';
import useSharedDay from './useSharedDay.js';
import useAccount from './useAccount.js';
import {AccountButton,AccountPanel,CircleInvite} from './AccountPanel.jsx';
import {createLatestPlanner,withPeopleIds,updateRoster,identity,personInput,readContacts,saveContacts} from './day-state.js';
import './planner.css';
import './group-studio.css';
import './chat-studio.css';
import './account-tastes.css';
const STORAGE_KEY = 'outing.saved-plans.v1';
const defaults = () => ({ title: 'A little day, beautifully spent', area: '', date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), party: { adults: 1, children: 0 }, people: [{ name: 'You', artists: [], vibes: [] }], budget: 800, currency:'GHS',currencyMode:'local', startTime: '11:00', endTime: '18:00', pace: 'easy', activities: ['coffee', 'dinner'], pins: {}, excludeIds: [] });
const readPreferred=()=>{try{const p=JSON.parse(localStorage.getItem('unstressed.planning-area')||'null');return p?.id&&p?.label?p:null;}catch{return null;}};
const partyLabel = r => `${r.party.adults + r.party.children} ${r.party.adults + r.party.children === 1 ? 'person' : 'people'}${r.party.children ? ` · ${r.party.children} ${r.party.children === 1 ? 'child' : 'children'}` : ''}`;
const savedKey=id=>id?`${STORAGE_KEY}.${id}`:STORAGE_KEY;
const readSaved = (userId) => { try { const data = JSON.parse(localStorage.getItem(savedKey(userId)) || '[]'); return Array.isArray(data) ? data.filter(p => p.id && p.plan?.version === '1.0' && p.plan?.tasteMap && p.plan?.budget).slice(0, 8).map(entry=>({...entry,plan:{...entry.plan,request:{...entry.plan.request,people:entry.plan.request.people.map((p,i)=>({...p,id:p.id||entry.plan.people[i]?.id||identity()}))}}})) : []; } catch { return []; } };
const personSignature=p=>p?JSON.stringify({id:p.id,...personInput(p)}):'';
const rememberStops = plan => Object.fromEntries(plan.stops.filter(s => s.item).map(s => [s.intent, s.item.id]));

function planText(plan) {
  const r = plan.request;
  return [`UNSTRESSED — ${r.title}`, `${dateLabel(r.date)} · ${r.area} · ${partyLabel(r)}`, `Group budget: ${formatMoney(r.budget,r.currency)} (spending allowances, not venue quotes)`, '', ...plan.stops.flatMap(s => [`${s.start}–${s.end} · ${ACTIVITY_NAMES[s.intent]}`, s.item?.name || 'Still to be found', s.item?.address || '', `Allowance: ${formatMoney(plan.budget.allocations.find(a => a.intent === s.intent).amount,r.currency)}`, ...s.connections.map(e => { const pref = plan.tasteMap.nodes.find(n => n.id === e.from); const who = plan.people.find(p => p.id === e.personId); return `${who?.name}: ${pref.label} — ${e.label}${e.contribution !== undefined ? ` (${e.contribution}; relative contribution, not a likelihood)` : ''}`; }), s.item?.links?.map || '', '']), `Transport allowance: ${formatMoney(plan.budget.transport,r.currency)} · Buffer: ${formatMoney(plan.budget.reserve,r.currency)}`, '', ...plan.warnings, '', `Source: ${plan.provenance.provider} · retrieved ${plan.provenance.retrievedAt}`].join('\n');
}

export default function PlannerApp() {
  const account=useAccount();
  const accountRef=useRef(account);accountRef.current=account;
  const [accountOpen,setAccountOpen]=useState(false),[circleInvite,setCircleInvite]=useState(()=>location.hash.startsWith('#/circle/'));
  const accountIdentity=useRef(undefined),activeCircle=useRef(null);
  const restored=useRef(false),locationConfirmed=useRef(false),locationDraft=useRef(null),planningPaused=useRef(true);
  const [draftChanged,setDraftChanged]=useState(false);
  const [guestLocation,setGuestLocation]=useState(readPreferred),[locationPrompt,setLocationPrompt]=useState({});
  const preferred=account.user?account.user.planningLocation:guestLocation;
  const preferredRef=useRef(preferred);preferredRef.current=preferred;
  const [brief, setBrief] = useState(() => withPeopleIds(defaults()));
  const [plan, setPlan] = useState(null);
  const [previous, setPrevious] = useState(null);
  const [health, setHealth] = useState(null);
  const [editor, setEditor] = useState(false);
  const [tool,setTool]=useState(null),[planOpen,setPlanOpen]=useState(false);
  const toolRef=useRef(null),showWhenReady=useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),[revisionFailed,setRevisionFailed]=useState(false);
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState([]);
  const [tab, setTab] = useState('itinerary');
  const [selection, setSelection] = useState(null);
  const [saved, setSaved] = useState(readSaved);
  const [showSaved, setShowSaved] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmations, setConfirmations] = useState({});
  const [selectedPlace,setSelectedPlace] = useState(null);
  const placeChecks = usePlaceChecks(plan);
  const selectedStop = plan?.stops.find(stop=>stop.item?.entityId===selectedPlace);
  const editorRevision=useRef(null);
  const [deck,setDeck]=useState([]),[tasteId,setTasteId]=useState(null);
  const [localContacts,setContacts]=useState(readContacts),[pending,setPending]=useState(false);
  const [localCircles,setCircles]=useState(readCircles);
  const [joinName,setJoinName]=useState(''),[joinBusy,setJoinBusy]=useState(false);
  const shared=useSharedDay();
  const circles=account.user?account.circles:localCircles;
  const contacts=account.user?[account.user.profile,...account.circles.flatMap(c=>c.people)]:localContacts;
  const briefRef=useRef(brief), planRef=useRef(plan), autoTimer=useRef(null), localVersion=useRef(0), snapshotVersion=useRef('');
  const mutations=useRef(Promise.resolve()), pendingPeople=useRef(new Map()),profileTimer=useRef(null),dayEpoch=useRef(0);
  const sharedRef=useRef(shared);sharedRef.current=shared;
  const owner=!shared.day||shared.day.access.role==='owner';
  const groupUpdating=pending||busy||shared.day?.status==='updating';
  const planner=useRef(null);
  function keepPeople(people){if(accountRef.current.user)return;try{setContacts(saveContacts(people));}catch{/* Saving the optional local address book must not stop planning. */}}
  function replaceBrief(value){const next=withPeopleIds(value);briefRef.current=next;setBrief(next);return next;}
  function append(role,text,extra={}){const turn={id:identity(),role,text,...extra};setChat(c=>[...c,turn].slice(-60));return turn.id;}
  function resultReceipt(result,text){append('assistant',text||'Your day is ready.',{result:{title:result.request.title,detail:`${result.stops.filter(s=>s.item).length} ${result.stops.filter(s=>s.item).length===1?'stop':'stops'} · ${dateLabel(result.request.date)} · ${formatMoney(result.request.budget,result.request.currency)}`}});}
  function presentTool(kind,text){const id=identity();toolRef.current={id,kind};setTool(toolRef.current);setPlanOpen(false);setChat(c=>[...c,{id,role:'assistant',text:text||({tastes:'Let’s find a few favorites.',circles:'Who should we bring along?',people:'Here’s who’s in the day.',share:'Here’s the day, ready to share.',location:'Where should I plan?',review:'Here’s what I’ll work with. Change anything, then I’ll find the places.',profile:'A little passport to what you love. Your circles will see your latest tastes.'}[kind]),widget:kind}].slice(-60));}
  function askLocation(request=briefRef.current,query='',scope='plan'){
    if(!owner){setError('Ask the organizer to set the planning area.');return;}
    clearTimeout(autoTimer.current);autoTimer.current=null;planner.current.invalidate();setPending(false);
    localVersion.current++;
    if(request.area!==briefRef.current.area||request.locationId!==briefRef.current.locationId){locationConfirmed.current=false;planningPaused.current=true;setDraftChanged(!!planRef.current);}
    replaceBrief(request);locationDraft.current=request;setLocationPrompt({query,scope});
    presentTool('location',query?'Let’s confirm the area and local budget.':preferredRef.current&&!locationConfirmed.current?`Shall I plan around ${preferredRef.current.name} again?`:'Where should I plan?');
  }
  async function applyLocation(patch,scope,selected){
    if(!owner)throw Error('Only the organizer can change the planning area.');
    localVersion.current++;
    const next={...(locationDraft.current||briefRef.current),...patch};
    const changed=next.locationId!==briefRef.current.locationId&&!!briefRef.current.area;
    if(changed&&Object.keys(next.pins||{}).length)throw Error('Release kept places before moving the plan to a different area.');
    if(scope==='default'){if(account.user)await account.changePlanningLocation(selected.id);else{localStorage.setItem('unstressed.planning-area',JSON.stringify(selected));setGuestLocation(selected);}}
    planner.current.invalidate();clearTimeout(autoTimer.current);autoTimer.current=null;setPending(false);
    locationConfirmed.current=true;planningPaused.current=true;setDraftChanged(!!planRef.current);replaceBrief(next);
    locationDraft.current=null;
    const hasFavorites=next.people.some(p=>p.artists.length||p.vibes.length);
    const note=`${selected.name} it is.${scope==='default'?' I’ll offer this area next time.':''}`;
    if(!hasFavorites){setTasteId(next.people[0].id);presentTool('tastes',`${note} Now let’s find a few things you love. You can bring people or a circle below, too.`);}
    else presentTool('review',`${note} Your tastes and people are here. Review the plan when you’re ready.`);
  }
  async function forgetLocation(){if(account.user)await account.changePlanningLocation(null);else{localStorage.removeItem('unstressed.planning-area');setGuestLocation(null);}setNotice('Saved planning area removed. This plan keeps its area.');}
  function finishTool(){
    const tastes=toolRef.current?.kind==='tastes';toolRef.current=null;setTool(null);
    if(!tastes)return;
    if(!planRef.current||planningPaused.current){presentTool('review','Your tastes are in. Let’s make sure the plan feels right.');}
    else if(groupUpdating){showWhenReady.current=true;append('assistant','Your favorites are in. I’m updating the day.');}
    else {resultReceipt(planRef.current,'Your favorites are part of this day.');setPlanOpen(true);}
  }
  function showPlan(result,description){
    planningPaused.current=false;setDraftChanged(false);setRevisionFailed(false);const old=planRef.current;setPrevious(old);planRef.current=result;setPlan(result);
    setConfirmations({});setSelection(null);setSelectedPlace(null);
    keepPeople(result.request.people);
    if(!toolRef.current){resultReceipt(result,old?'I’ve updated the day for everyone.':'Here’s your day.');if(showWhenReady.current||!old){setPlanOpen(true);showWhenReady.current=false;}}
  }
  useEffect(()=>{planner.current=createLatestPlanner({run:api.itinerary,onStart:()=>setBusy(true),onIdle:()=>{setBusy(false);if(!autoTimer.current)setPending(false);},onError:e=>{setError(e.message);setRevisionFailed(true);},onResult:result=>{showPlan(result);replaceBrief(result.request);}});return()=>{clearTimeout(autoTimer.current);autoTimer.current=null;clearTimeout(profileTimer.current);planner.current.dispose();};},[]);
  useEffect(()=>{api.deck().then(setDeck).catch(e=>setError(e.message));},[]);
  useEffect(()=>{if(location.hash.startsWith('#/discover'))setTasteId(briefRef.current.people[0].id);},[]);
  useEffect(()=>{
    const day=shared.day;if(!day)return;locationConfirmed.current=true;
    const key=`${day.id}:${day.revision}:${day.planRevision}:${day.status}`;
    if(snapshotVersion.current===key)return;snapshotVersion.current=key;
    const request={...day.request,people:day.request.people.map(p=>pendingPeople.current.get(p.id)||p)};
    replaceBrief(request);setPending(day.status==='updating'||pendingPeople.current.size>0);
    if(day.plan&&day.planRevision===day.revision){showPlan(day.plan,day.events.at(-1)?.detail||'Everyone’s tastes, in the same picture.');}
    else if(day.plan&&!planRef.current)showPlan(day.plan);
    if(day.planError){setError(day.planError);setRevisionFailed(true);}
  },[shared.day]);
  function schedule(request,reason){
    replaceBrief(request);if(!sharedRef.current.linked&&(planningPaused.current||!planRef.current||!locationConfirmed.current)){if(planRef.current)setDraftChanged(true);return;}setPending(true);setError('');setRevisionFailed(false);
    clearTimeout(autoTimer.current);autoTimer.current=null;planner.current.invalidate();
    autoTimer.current=setTimeout(()=>{autoTimer.current=null;planner.current.enqueue(briefRef.current);},1100);
  }
  function queueMember(person){
    pendingPeople.current.set(person.id,person);setPending(true);clearTimeout(profileTimer.current);
    const version=dayEpoch.current;
    profileTimer.current=setTimeout(()=>{
      mutations.current=mutations.current.catch(()=>{}).then(async()=>{
        const entries=[...pendingPeople.current.entries()];
        for(const [id,value] of entries){
          if(version!==dayEpoch.current)return;
          try{const result=await sharedRef.current.updatePerson(id,personInput(value));
            if(pendingPeople.current.get(id)===value)pendingPeople.current.delete(id);
            if(version!==dayEpoch.current)return;
            setPending(result.status==='updating'||pendingPeople.current.size>0);
          }catch(e){setError(e.message);setPending(false);}
        }
      });
    },800);
  }
  function editTaste(person){
    if(activeCircle.current)activeCircle.current={...activeCircle.current,people:activeCircle.current.people.map(p=>p.id===person.id?person:p)};
    if(person.id===accountRef.current.user?.id)accountRef.current.changeProfile(person).catch(e=>setError(e.message));
    else {const circle=accountRef.current.circles.find(c=>c.id===activeCircle.current?.id);if(circle?.owner&&!circle.accountIds.includes(person.id))accountRef.current.changeCirclePerson(circle.id,person).catch(e=>setError(e.message));}
    localVersion.current++;
    const next={...briefRef.current,people:briefRef.current.people.map(p=>p.id===person.id?person:p)};
    replaceBrief(next);keepPeople(next.people);
    if(sharedRef.current.linked)queueMember(person);else schedule(next,`${person.name}’s tastes are now part of the day.`);
  }
  async function addPerson(person){
    localVersion.current++;
    const added={...person,id:person.id||identity()};
    if(shared.linked){const result=await shared.add(added);openTaste(result.request.people.at(-1).id);}
    else {const next=updateRoster(briefRef.current,[...briefRef.current.people,added]);schedule(next,`${added.name} is coming. Here’s how the day fits everyone now.`);openTaste(added.id);}
  }
  async function applyCircle(circle){
    activeCircle.current={id:circle.id,people:circlePeople(circle,contacts)};
    localVersion.current++;
    if(shared.linked)await shared.circle({name:circle.name,people:circlePeople(circle,contacts)});
    else schedule(bringCircle(briefRef.current,circle,contacts),`${circle.name} is coming.`);
    toolRef.current=null;setTool(null);if(!shared.linked&&(planningPaused.current||!planRef.current))presentTool('review',`${circle.name} is in. Everyone’s tastes are part of the draft.`);else append('assistant',`${circle.name} is in. I’m updating the day.`);
  }
  async function saveCircle(name){if(account.user){const savedCircle=await account.createCircle({name,people:briefRef.current.people});activeCircle.current={id:savedCircle.id,people:savedCircle.people};setNotice('Circle saved to your account. Copy its invite to bring everyone in.');}else{const next=writeCircles([makeCircle(name,briefRef.current.people),...circles]);setCircles(next);keepPeople(briefRef.current.people);}}
  async function removeCircle(id){if(account.user)await account.removeCircle(id);else setCircles(writeCircles(circles.filter(c=>c.id!==id)));if(activeCircle.current?.id===id)activeCircle.current=null;}
  async function removePerson(id){
    localVersion.current++;
    if(shared.linked){await shared.remove(id);}
    else {const current=briefRef.current;const next={...current,people:current.people.filter(p=>p.id!==id),party:{...current.party,adults:Math.max(1,current.party.adults-1)}};schedule(next,'The group changed. Finding the balance again.');}
    setTasteId(null);
  }
  function resetDay(){
    activeCircle.current=null;planningPaused.current=true;setDraftChanged(false);locationConfirmed.current=false;locationDraft.current=null;setLocationPrompt({});setRevisionFailed(false);
    dayEpoch.current++;
    localVersion.current++;planner.current.invalidate();clearTimeout(autoTimer.current);autoTimer.current=null;clearTimeout(profileTimer.current);pendingPeople.current.clear();
    shared.leave();snapshotVersion.current='';planRef.current=null;setPlan(null);setPrevious(null);replaceBrief(withPeopleIds({...defaults(),...(preferredRef.current?{area:preferredRef.current.label,locationId:preferredRef.current.id,currency:preferredRef.current.currency||'GHS'}:{}),...(accountRef.current.user?{people:[accountRef.current.user.profile]}:{})}));setChat([]);setMessage('');setError('');showWhenReady.current=false;setPending(false);setTasteId(null);toolRef.current=null;setTool(null);setPlanOpen(false);
  }
  async function join(){if(!joinName.trim())return;setJoinBusy(true);try{const result=await shared.join({name:joinName.trim(),artists:[],vibes:[]});openTaste(result.access.memberId);}catch(e){setError(e.message);}finally{setJoinBusy(false);}}
  function openTaste(id=sharedRef.current.day?.access.memberId||briefRef.current.people[0].id){if(deck.length){setTasteId(id);if(toolRef.current?.kind!=='tastes')presentTool('tastes');}else setError('Taste cards are still loading. Please try again.');}
  async function ensureShared(request){if(!planRef.current||planningPaused.current)throw Error('Review and create your day before sharing its link. You can invite people through a circle while you plan.');clearTimeout(autoTimer.current);autoTimer.current=null;planner.current.invalidate();const result=await shared.ensure(request);return result;}
  const activePerson=brief.people.find(p=>p.id===tasteId);
  const guest=shared.day?.access.role==='guest';

  const working = useRef(false);
  const savedDialog = useRef(null);
  useEffect(() => { const refresh=()=>api.health().then(setHealth).catch(()=>setHealth({offline:true}));refresh();window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh); }, []);
  useEffect(() => { if (showSaved) savedDialog.current?.showModal(); }, [showSaved]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
  useEffect(()=>{
    const onHash=()=>setCircleInvite(location.hash.startsWith('#/circle/'));window.addEventListener('hashchange',onHash);return()=>window.removeEventListener('hashchange',onHash);
  },[]);
  useEffect(()=>{
    if(!account.ready)return;
    const id=account.user?.id||null,prior=accountIdentity.current;
    if(prior!==id){
      accountIdentity.current=id;setSaved(readSaved(id));
      if(prior!==undefined&&prior!==null)resetDay();
    }
    if(!restored.current){
      restored.current=true;
      const params=new URLSearchParams(location.search),status=params.get('signin');
      if(status){
        try{const checkpoint=JSON.parse(sessionStorage.getItem('outing.signin-draft')||'null');if(checkpoint&&Date.now()-checkpoint.at<3600000&&(!checkpoint.userId||checkpoint.userId===id)){
          if(!shared.linked){replaceBrief(checkpoint.brief);locationConfirmed.current=!!checkpoint.plan||checkpoint.locationConfirmed===true;planningPaused.current=checkpoint.planningPaused??!checkpoint.plan;setDraftChanged(!!checkpoint.draftChanged);if(checkpoint.plan){planRef.current=checkpoint.plan;setPlan(checkpoint.plan);}}
          setChat(checkpoint.chat||[]);setMessage(checkpoint.message||'');
        }}catch{/* A missing checkpoint doesn't block the account. */}
        sessionStorage.removeItem('outing.signin-draft');params.delete('signin');history.replaceState(null,'',location.pathname+(params.size?`?${params}`:'')+location.hash);
        setNotice(status==='success'?'You’re signed in. Your day is right here.':status==='cancelled'?'Sign-in cancelled. Your day is still here.':'Sign-in couldn’t finish. Your day is still here; try again.');
      }
    }
    if(account.user&&!shared.linked){
      const current=briefRef.current;
      const placeholder=current.people.length===1&&current.people[0].name==='You'&&!current.people[0].artists.length&&!current.people[0].vibes.length&&!current.people[0].spending;
      if(placeholder){replaceBrief({...current,people:[account.user.profile]});}
      else {const existing=current.people.find(p=>p.id===id);if(existing&&personSignature(existing)!==personSignature(account.user.profile)){const next={...current,people:current.people.map(p=>p.id===id?account.user.profile:p)};if(planRef.current)schedule(next);else replaceBrief(next);}}
    }
    const active=activeCircle.current,circle=account.circles.find(c=>c.id===active?.id);
    if(circle&&active&&!shared.linked){
      const changed=circle.people.filter(p=>personSignature(p)!==personSignature(active.people.find(old=>old.id===p.id)));
      const removed=active.people.filter(p=>!circle.people.some(n=>n.id===p.id));
      if(changed.length||removed.length){
        let people=briefRef.current.people.filter(p=>!removed.some(r=>r.id===p.id));
        for(const person of changed){if(people.some(p=>p.id===person.id))people=people.map(p=>p.id===person.id?person:p);else people.push(person);}
        if(people.length<=6&&people.length){localVersion.current++;activeCircle.current={id:circle.id,people:circle.people};schedule(updateRoster(briefRef.current,people));append('assistant',`${circle.name} has new tastes or people. ${planningPaused.current?'Your draft is up to date.':'I’m updating your day.'}`);}
      }
    }
  },[account.ready,account.user,account.circles]);
  async function signIn(){
    if(groupUpdating)throw Error('Let the current day update finish, then sign in.');
    sessionStorage.setItem('outing.signin-draft',JSON.stringify({brief:briefRef.current,plan:planRef.current,chat,message,locationConfirmed:locationConfirmed.current,planningPaused:planningPaused.current,draftChanged,userId:account.user?.id||null,at:Date.now()}));
    const result=await api.signIn(location.hash.startsWith('#/day/')||location.hash.startsWith('#/circle/')?`/${location.hash}`:'/');location.assign(result.url);
  }
  async function copyCircleInvite(circle){await navigator.clipboard.writeText(`${location.origin}/#/circle/${circle.id}?invite=${circle.inviteToken}`);setNotice('Circle invite copied. Everyone joins with their own account.');}
  const activeBrief = brief;

  function accept(result, text) {locationConfirmed.current=true;showPlan(result,text);replaceBrief(result.request);setTab('itinerary');}
  async function build(request, description, revision) {
    if(!locationConfirmed.current&&!shared.linked){askLocation(request);return false;}
    planningPaused.current=false;setDraftChanged(false);localVersion.current++;
    clearTimeout(autoTimer.current);autoTimer.current=null;setError('');setRevisionFailed(false);
    if(shared.linked){try{await shared.updateBrief(request,revision);return true;}catch(e){setError(e.message);return false;}}
    planner.current.enqueue(withPeopleIds(request));return true;
  }
  async function sendMessage(sent=message){
    if(working.current||!sent.trim())return;
    if(!health?.agentConfigured){setError('Chat isn’t connected yet. Use Tastes, People, Circles and Review plan to shape your day.');return;}
    working.current=true;setBusy(true);setError('');setRevisionFailed(false);toolRef.current=null;setTool(null);
    const version=localVersion.current,revision=shared.day?.revision;
    append('user',sent.trim());setMessage('');
    const history=chat.filter(t=>t.text).slice(-8).map(({role,text})=>({role,text:text.slice(0,1600)}));
    try{
      const result=await api.agent({message:sent.trim(),context:briefRef.current,locationContext:{confirmed:locationConfirmed.current||shared.linked,preferredLabel:preferredRef.current?.label},history,circles:circles.map(c=>({id:c.id,name:c.name,people:circlePeople(c,contacts)})),planContext:planRef.current?{stops:planRef.current.stops.map(s=>({id:s.id,intent:s.intent,name:s.item?.name||null,connections:s.connections.map(e=>({personId:e.personId,kind:e.kind,label:e.label,preference:planRef.current.tasteMap.nodes.find(n=>n.id===e.from)?.label}))})),warnings:planRef.current.warnings}:undefined});
      if(version!==localVersion.current){append('assistant','The day changed while I was thinking. Please send that again so I can use the latest details.');return;}
      if(result.status==='action'){
        if(result.action==='set_location'){askLocation(result.request,result.query,result.scope);}
        if(result.action==='bring_circle'){if(!owner)throw Error('Only the organizer can bring a circle.');const circle=circles.find(c=>c.id===result.circleId);if(!circle)throw Error('That circle is no longer saved.');await applyCircle(circle);}
        if(result.action==='add_person'){if(!owner)throw Error('Only the organizer can add someone.');await addPerson(result.person);}
        if(result.action==='update_person'){if(!owner&&result.person.id!==shared.day?.access.memberId)throw Error('You can change your own tastes. Ask the organizer about other people.');showWhenReady.current=true;editTaste(result.person);append('assistant',`I’ve updated ${result.person.name}’s tastes. ${planRef.current&&!planningPaused.current?'I’m checking the day again.':'They’re saved in the draft.'}`);}
        if(result.action==='remove_person'){if(!owner)throw Error('Only the organizer can change the group.');await removePerson(result.personId);append('assistant',planRef.current&&!planningPaused.current?'The group is updated. I’m reworking the day.':'The group is updated in your draft.');}
      }else if(result.status==='show_ui'){
        if(result.panel==='tastes')openTaste(result.personId);
        else if(result.panel==='location')askLocation();
        else if(['circles','people','share'].includes(result.panel))presentTool(result.panel);
        else {setTab(result.panel==='budget'?'budget':result.panel==='checks'?'checklist':'itinerary');setPlanOpen(true);append('assistant',planRef.current?(result.panel==='checks'?'I’m comparing your times with reported hours and gathering the venue details. You’ll see what still needs confirming.':'Here’s the current day.'):'Add a few tastes first, and I’ll put a day together.');}
      }else if(result.status==='needs_input')append('assistant',result.question);
      else if(result.status==='reply')append('assistant',result.text);
      else {if(!owner)throw Error('Only the organizer can change the trip details.');showWhenReady.current=true;if(shared.linked)await shared.updateBrief(result.request,revision);else accept(result);}
    }catch(e){setError(e.message);setRevisionFailed(true);setMessage(sent);}
    finally{working.current=false;setBusy(false);}
  }
  function pin(intent, id) {
    const pins = { ...plan.request.pins };
    if (pins[intent]) delete pins[intent]; else pins[intent] = id;
    const request={...briefRef.current,pins};
    if(shared.linked){build(request,'Kept places updated.');}else{replaceBrief(request);const updated={...plan,request};planRef.current=updated;setPlan(updated);}
  }
  function swap(stop) {
    const pins = rememberStops(plan); delete pins[stop.intent];
    build({ ...plan.request, pins, excludeIds: [...new Set([...plan.request.excludeIds, stop.item.id])] }, 'I’ve looked for another stop and kept the other places in your day. You can undo this revision.');
  }
  function save() {
    const entry = { id: crypto.randomUUID(), savedAt: new Date().toISOString(), plan:{...plan,request:withPeopleIds(plan.request)} };
    const next = [entry, ...saved.filter(s => JSON.stringify(s.plan) !== JSON.stringify(plan))].slice(0, 8);
    try { localStorage.setItem(savedKey(account.user?.id), JSON.stringify(next)); setSaved(next); setNotice('Day saved on this device.'); } catch { setNotice('Your browser couldn’t save this day. Try copying it instead.'); }
  }
  async function copy() { try { await navigator.clipboard.writeText(planText(plan)); setNotice('Your itinerary and taste connections are copied.'); } catch { setNotice('Copy isn’t available here. Use Print to keep a copy.'); } }
  const trace = id => { setSelection(id); setTab('taste');setPlanOpen(true); };
  function chooseTool(kind){if(kind==='location'){askLocation();return;}if(kind==='profile'&&!account.user){setAccountOpen(true);return;}if(kind==='tastes')openTaste();else presentTool(kind);}
  function openDetails(){editorRevision.current=shared.day?.revision;setEditor(true);}
  async function planFromReview(){if(!locationConfirmed.current&&!shared.linked){askLocation(briefRef.current);return;}showWhenReady.current=true;finishTool();await build(briefRef.current);}
  function renderTool(){if(tool?.kind==='review')return <PlanReview brief={brief} deck={deck} hasPlan={!!plan} confirmed={locationConfirmed.current||shared.linked} busy={groupUpdating} onPlan={planFromReview} onTool={chooseTool} onDetails={openDetails} onDone={finishTool}/>;if(tool?.kind==='location')return <LocationAction key={tool.id} brief={locationDraft.current||brief} preferred={preferred} query={locationPrompt.query} scope={locationPrompt.scope} signedIn={!!account.user} onDone={finishTool} onApply={applyLocation} onForget={forgetLocation}/>;if(tool?.kind==='profile'&&account.user)return <TasteAction personal person={account.user.profile} people={[account.user.profile]} deck={deck} onChange={p=>account.changeProfile(p).catch(e=>setError(e.message))} onDone={finishTool} editable/>;if(tool?.kind==='tastes'&&activePerson)return <TasteAction key={activePerson.id} person={activePerson} people={brief.people} deck={deck} onPerson={openTaste} onChange={editTaste} onDone={()=>finishTool()} drafting={!plan||planningPaused.current} editable={owner||shared.day?.access.memberId===activePerson.id}/>;
    if(tool?.kind==='circles')return <CirclesAction circles={circles} contacts={contacts} people={brief.people} onApply={applyCircle} onSave={saveCircle} onRemove={removeCircle} onDone={finishTool} owner={owner} accountUser={account.user} onInvite={copyCircleInvite} onSignIn={()=>setAccountOpen(true)}/>;
    if(tool?.kind==='people')return <PeopleAction people={brief.people} contacts={contacts} owner={owner} memberId={shared.day?.access.memberId} onTaste={openTaste} onAdd={addPerson} onRemove={removePerson} onShare={()=>presentTool('share')} onDone={()=>finishTool()}/>;
    if(tool?.kind==='share')return <ShareDay embedded plan={plan} brief={brief} shared={shared} onEnsure={ensureShared} onClose={finishTool}/>;return null;
  }
  return <><ChatStudio draftChanged={draftChanged} accountButton={<AccountButton user={account.user} onClick={()=>setAccountOpen(true)}/>} brief={brief} plan={plan} chat={chat} tool={tool} renderTool={renderTool} message={message} onMessage={setMessage} onSend={sendMessage} busy={groupUpdating} configured={health?.agentConfigured} owner={owner} guest={guest} connecting={shared.connecting} revisionFailed={revisionFailed} error={error||shared.error||account.error} onDismissError={()=>{setError('');shared.clearError();account.clearError();}} onNew={resetDay} onSaved={()=>setShowSaved(true)} onTool={chooseTool} onOpenPlan={()=>setPlanOpen(true)} planOpen={planOpen} onClosePlan={()=>setPlanOpen(false)} planView={tab} onPlanView={setTab} notice={notice} joinContent={<div className="cs-join"><h1>Come along.</h1><p>{brief.people.map(p=>p.name).join(', ')} are putting a day together.</p><form className="cs-inline-form" onSubmit={e=>{e.preventDefault();join();}}><input aria-label="Your name" required maxLength={24} value={joinName} onChange={e=>setJoinName(e.target.value)} placeholder="Your name"/><button disabled={joinBusy}>Join the day <Icon name="arrow" size={15}/></button></form><small>Your name and tastes are visible to this group.</small></div>}>
    {plan&&<>{tab==='itinerary'&&<><PlaceCheckNotice checks={placeChecks} onOpen={()=>setTab('checklist')}/><div className="cs-day-actions">{owner&&<button onClick={openDetails} disabled={groupUpdating}><Icon name="edit" size={13}/>Details</button>}<button onClick={save}><Icon name="bookmark" size={13}/>Save</button><button onClick={copy}><Icon name="copy" size={13}/>Copy</button>{previous&&!shared.linked&&<button disabled={groupUpdating} onClick={()=>{planRef.current=previous;setPlan(previous);replaceBrief(previous.request);setPrevious(null);append('assistant','Your previous day is restored.');}}><Icon name="undo" size={13}/>Undo</button>}</div>{plan.stops.map(stop=><Stop key={`${stop.id}-${stop.item?.id}`} stop={stop} plan={plan} busy={groupUpdating||!owner} onPin={pin} onSwap={swap} onTrace={trace} onBudget={()=>setTab('budget')} onDetails={stop=>setSelectedPlace(stop.item.entityId)}/>)}<p className="cs-day-note">Suggested times and spending allowances. Confirm hours, prices and travel before you go.</p><details className="cs-plan-notes"><summary>Notes & sources</summary>{plan.provenance.locality&&<p>Qloo matched: {plan.provenance.locality.label}.</p>}{plan.timeZone&&<p>Suggested times are local to {plan.timeZone}.</p>}{plan.warnings.map(w=><p key={w}>{w}</p>)}<p>Places from {plan.provenance.provider}. Retrieved {plan.provenance.retrievedAt}.</p></details></>}
    {tab==='taste'&&<TasteMap key={selection||'all'} plan={plan} initialSelection={selection} onEdit={()=>{setPlanOpen(false);openTaste();}}/>}{tab==='budget'&&<Budget plan={plan} onEdit={id=>{setPlanOpen(false);openTaste(id);}}/>} {tab==='checklist'&&<BeforeGoing plan={plan} checks={placeChecks} done={confirmations} setDone={setConfirmations} onDetails={stop=>setSelectedPlace(stop.item.entityId)}/>}
    {shared.day?.status==='error'&&<button className="pl-button" onClick={()=>shared.retry().catch(e=>setError(e.message))}>Retry the update</button>}</>}
  </ChatStudio>
  {selectedStop&&<PlaceDetails key={selectedPlace} stop={selectedStop} plan={plan} checks={placeChecks} onClose={()=>setSelectedPlace(null)} onSwap={()=>{setSelectedPlace(null);swap(selectedStop);}} canSwap={owner&&!groupUpdating&&!plan.request.pins[selectedStop.intent]}/> }
  {accountOpen&&<AccountPanel account={account} onClose={()=>setAccountOpen(false)} onSignIn={signIn} onTastes={()=>{setAccountOpen(false);presentTool('profile');}} onCircles={()=>{setAccountOpen(false);presentTool('circles');}} onLocation={()=>{setAccountOpen(false);askLocation();}} onSignOut={async()=>{await account.signOut();setAccountOpen(false);}}/>}
  {circleInvite&&<CircleInvite account={account} onSignIn={signIn} onClose={()=>{setCircleInvite(false);history.replaceState(null,'',location.pathname);}} onJoined={circle=>{setCircleInvite(false);history.replaceState(null,'',location.pathname);applyCircle(circle).catch(e=>setError(e.message));}}/>}
  {editor&&owner&&<TripEditor draftOnly={planningPaused.current||!plan} onLocation={draft=>{setEditor(false);askLocation(draft);}} brief={activeBrief} groupManaged hasPlan={!!plan} onClose={()=>setEditor(false)} onSubmit={async request=>{if(planningPaused.current||!planRef.current){replaceBrief(request);setDraftChanged(!!planRef.current);setEditor(false);presentTool('review','Those details are saved. I’ll search when you’re ready.');return;}if(await build(request,undefined,editorRevision.current))setEditor(false);else{editorRevision.current=sharedRef.current.day?.revision;throw Error('The update could not be saved. Your edits are still here; review the group and retry.');}}}/>}
  {showSaved&&<dialog className="pl-dialog pl-saved-dialog" ref={savedDialog} onCancel={()=>setShowSaved(false)} aria-labelledby="saved-title"><div className="pl-dialog-heading"><h2 id="saved-title">Saved days</h2><button className="pl-icon-button" onClick={()=>setShowSaved(false)} aria-label="Close saved days"><Icon name="close"/></button></div><div className="pl-dialog-body">{saved.length?saved.map(entry=><div className="pl-saved-item" key={entry.id}><button onClick={()=>{resetDay();locationConfirmed.current=true;planningPaused.current=false;planRef.current=entry.plan;setPlan(entry.plan);replaceBrief(entry.plan.request);resultReceipt(entry.plan,'Your saved day is ready.');setShowSaved(false);setPlanOpen(true);}}><strong>{entry.plan.request.title}</strong><small>{dateLabel(entry.plan.request.date)} · {formatMoney(entry.plan.request.budget,entry.plan.request.currency)}</small></button><button className="pl-icon-button" aria-label={`Delete ${entry.plan.request.title}`} onClick={()=>{const next=saved.filter(s=>s.id!==entry.id);try{localStorage.setItem(savedKey(account.user?.id),JSON.stringify(next));setSaved(next);}catch{setNotice('Couldn’t update saved days.');}}}><Icon name="trash" size={16}/></button></div>):<p>No saved days yet. Save one from your day panel.</p>}</div></dialog>}
  </>;
}
