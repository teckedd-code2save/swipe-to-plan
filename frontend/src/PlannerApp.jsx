import {conversationHistory} from './conversation.js';
import {track} from './usage.js';
import UsageDashboard from './UsageDashboard.jsx';
import {formatMoney} from './money.js';
import {useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {Icon,ACTIVITY_NAMES,dateLabel,money} from './PlannerIcons.jsx';
import TasteMap from './TasteMap.jsx';
import TripEditor from './TripEditor.jsx';
import TimingAction from './TimingAction.jsx';
import {localDate,needsTiming,timingLabel} from './timing.js';
import PlanReview from './PlanReview.jsx';
import {PlaceDetails,PlaceCheckNotice,usePlaceChecks} from './PlaceGuide.jsx';
import './place-guide.css';
import ShareDay from './ShareDay.jsx';
import {Budget,BeforeGoing,Stop} from './PlanDetails.jsx';
import ChatStudio from './ChatStudio.jsx';
import LocationWelcome from './LocationWelcome.jsx';
import {LOCATION_WELCOME_KEY,showLocationWelcome} from './location-arrival.js';
import {nextPlanSteps} from './plan-assistance.js';
import {connectedPeople,newlyJoinedPeople} from './connections.js';
import {TasteAction,CirclesAction,PeopleAction,LocationAction} from './ChatActions.jsx';
import {readCircles,writeCircles,makeCircle,bringCircle,circlePeople} from './circles.js';
import useSharedDay from './useSharedDay.js';
import useAccount from './useAccount.js';
import {AccountButton,AccountPanel,CircleInvite} from './AccountPanel.jsx';
import ProfileCircles from './ProfileCircles.jsx';
import {createLatestPlanner,withPeopleIds,updateRoster,adoptAccountProfile,identity,personInput,readContacts,saveContacts} from './day-state.js';
import './planner.css';
import './group-studio.css';
import './chat-studio.css';
import './account-tastes.css';
const STORAGE_KEY = 'outing.saved-plans.v1';
const defaults = () => ({ title: '', area: '', date: localDate(), timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'}, party: { adults: 1, children: 0 }, people: [{ name: 'You', artists: [], vibes: [] }], budget: null, currency:'GHS',currencyMode:'local', startTime: '09:00', endTime: '21:00', pace: 'easy', activities: [], pins: {}, excludeIds: [] });
const readPreferred=()=>{try{const p=JSON.parse(localStorage.getItem('unstressed.planning-area')||'null');return p?.id&&p?.label?p:null;}catch{return null;}};
const partyLabel = r => `${r.party.adults + r.party.children} ${r.party.adults + r.party.children === 1 ? 'person' : 'people'}${r.party.children ? ` · ${r.party.children} ${r.party.children === 1 ? 'child' : 'children'}` : ''}`;
const savedKey=id=>id?`${STORAGE_KEY}.${id}`:STORAGE_KEY;
const readSaved = (userId) => { try { const data = JSON.parse(localStorage.getItem(savedKey(userId)) || '[]'); return Array.isArray(data) ? data.filter(p => p.id && p.plan?.version === '1.0' && p.plan?.tasteMap && p.plan?.budget).slice(0, 8).map(entry=>({...entry,plan:{...entry.plan,request:{...entry.plan.request,people:entry.plan.request.people.map((p,i)=>({...p,id:p.id||entry.plan.people[i]?.id||identity()}))}}})) : []; } catch { return []; } };
const personSignature=p=>p?JSON.stringify({id:p.id,...personInput(p)}):'';
const rememberStops = plan => Object.fromEntries(plan.stops.filter(s => s.item).map(s => [s.intent, s.item.id]));

function planText(plan) {
  const r = plan.request;
  return [`UNSTRESSED — ${r.title}`, `${dateLabel(r.date)} · ${r.area} · ${partyLabel(r)}`, `Group budget: ${formatMoney(r.budget,r.currency)} (spending allowances, not venue quotes)`, '', ...plan.stops.filter(s=>s.item).flatMap(s => [`${s.item?`${s.start}–${s.end}`:'Not scheduled'} · ${ACTIVITY_NAMES[s.intent]}`, s.item?.name || 'Still to be found', s.item?.address || '', `Allowance: ${formatMoney(plan.budget.allocations.find(a => a.intent === s.intent).amount,r.currency)}`, ...s.connections.map(e => { const pref = plan.tasteMap.nodes.find(n => n.id === e.from); const who = plan.people.find(p => p.id === e.personId); return `${who?.name}: ${pref.label} — ${e.label}${e.contribution !== undefined ? ` (${e.contribution}; relative contribution, not a likelihood)` : ''}`; }), s.item?.links?.map || '', '']), `Transport allowance: ${formatMoney(plan.budget.transport,r.currency)} · Buffer: ${formatMoney(plan.budget.reserve,r.currency)}`, '', ...plan.warnings, '', `Source: ${plan.provenance.provider} · retrieved ${plan.provenance.retrievedAt}`].join('\n');
}

export default function PlannerApp() {
  const account=useAccount();
  const [locationWelcomeDismissed,setLocationWelcomeDismissed]=useState(()=>{try{return sessionStorage.getItem(LOCATION_WELCOME_KEY)==='seen';}catch{return false;}});
  function dismissLocationWelcome(){setLocationWelcomeDismissed(true);try{sessionStorage.setItem(LOCATION_WELCOME_KEY,'seen');}catch{/* Optional session memory. */}}
  const accountRef=useRef(account);accountRef.current=account;
  const [usageOpen,setUsageOpen]=useState(false);
  useEffect(()=>{track('visit');},[]);
  const [accountAction,setAccountAction]=useState(null);
  const [profileCirclesOpen,setProfileCirclesOpen]=useState(false);
  const [accountOpen,setAccountOpen]=useState(false),[circleInvite,setCircleInvite]=useState(()=>location.hash.startsWith('#/circle/'));
  const accountIdentity=useRef(undefined),activeCircle=useRef(null),accountProfileSeen=useRef(null);
  const invitedCircles=useRef(new Map());
  const [peopleQuery,setPeopleQuery]=useState('');
  const planningZone=useRef(null);
  const locationPrompted=useRef(false),restored=useRef(false),locationConfirmed=useRef(false),locationDraft=useRef(null),planningPaused=useRef(true);
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
  const [autopilot,setAutopilot]=useState(false),[autopilotPhase,setAutopilotPhase]=useState('');
  const autopilotRef=useRef(false),autopilotPending=useRef(null);
  const [tab, setTab] = useState('itinerary');
  const [selection, setSelection] = useState(null);
  const [saved, setSaved] = useState(readSaved);
  const [savedLoading,setSavedLoading]=useState(false);
  const savedIdentity=useRef({id:identity(),revision:0});
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
  const circles=account.user?account.circles.map(c=>({...c,people:c.people.filter(p=>c.accountIds.includes(p.id))})):localCircles;
  const contacts=account.user?[account.user.profile,...account.circles.flatMap(c=>c.people)]:localContacts;
  const connections=connectedPeople(account.user,account.circles);
  const briefRef=useRef(brief), planRef=useRef(plan), autoTimer=useRef(null), localVersion=useRef(0), snapshotVersion=useRef('');
  const mutations=useRef(Promise.resolve()), pendingPeople=useRef(new Map()),profileTimer=useRef(null),dayEpoch=useRef(0);
  const sharedRef=useRef(shared);sharedRef.current=shared;
  const owner=!shared.day||shared.day.access.role==='owner';
  const groupUpdating=pending||busy||shared.day?.status==='updating';
  const nextSteps=nextPlanSteps(plan,placeChecks);
  const planner=useRef(null);
  function savingHeaders(){if(!accountRef.current.user)return {};const target=savedIdentity.current;return {'x-unstressed-plan-id':target.id,'x-unstressed-plan-revision':String(++target.revision)};}
  function rememberSaved(result){
    if(!accountRef.current.user)return;
    if(result.saveError){setNotice(result.saveError);return;}
    const entry=result.savedPlan;if(!entry)return;
    savedIdentity.current={id:entry.id,revision:Math.max(savedIdentity.current.id===entry.id?savedIdentity.current.revision:0,entry.revision)};
    setSaved(items=>[{...entry,cloud:true},...items.filter(item=>!item.cloud||item.id!==entry.id)]);
    if(!sharedRef.current.linked)history.replaceState(null,'',`${location.pathname}${location.search}#/plan/${entry.id}`);
  }
  async function loadSaved(){
    const userId=accountRef.current.user?.id;if(!userId){setSaved(readSaved());return;}
    setSavedLoading(true);
    try{const result=await api.savedPlans();if(accountRef.current.user?.id===userId)setSaved([...result.plans.map(entry=>({...entry,cloud:true})),...readSaved(userId)]);}
    catch(e){if(accountRef.current.user?.id===userId)setError(`Saved days couldn’t load: ${e.message}`);}
    finally{if(accountRef.current.user?.id===userId)setSavedLoading(false);}
  }
  function openSavedResult(result){
    resetDay();locationConfirmed.current=true;planningPaused.current=false;planningZone.current=result.timeZone||null;
    planRef.current=result;setPlan(result);replaceBrief(result.request);rememberSaved(result);
    const circle=accountRef.current.circles.find(c=>c.people.length>1&&c.people.length===result.request.people.length&&c.people.every(p=>result.request.people.some(member=>member.id===p.id)));
    if(circle)activeCircle.current={id:circle.id,people:circle.people};
    resultReceipt(result,'Your saved day is ready, with its original area and timing.');setShowSaved(false);setPlanOpen(true);
  }
  async function openSaved(entry){
    const epoch=dayEpoch.current,version=localVersion.current,userId=accountRef.current.user?.id;setSavedLoading(true);
    try{const result=entry.cloud?await api.savedPlan(entry.id):entry.plan;if(dayEpoch.current===epoch&&version===localVersion.current&&accountRef.current.user?.id===userId)openSavedResult(result);}
    catch(e){setError(e.message);}finally{setSavedLoading(false);}
  }
  async function deleteSaved(entry){
    try{
      if(entry.cloud)await api.deleteSavedPlan(entry.id);
      else localStorage.setItem(savedKey(accountRef.current.user?.id),JSON.stringify(saved.filter(s=>!s.cloud&&s.id!==entry.id)));
      setSaved(items=>items.filter(s=>s.id!==entry.id||!!s.cloud!==!!entry.cloud));
      if(entry.cloud&&planRef.current?.savedPlan?.id===entry.id){savedIdentity.current={id:identity(),revision:0};const {savedPlan,...current}=planRef.current;planRef.current=current;setPlan(current);if(!sharedRef.current.linked)history.replaceState(null,'','/#/');}
    }catch(e){setError(`Couldn’t remove this saved day: ${e.message}`);}
  }
  useEffect(()=>{if(autopilotPhase==='checking'&&['ready','error','idle'].includes(placeChecks.status))setAutopilotPhase('');},[autopilotPhase,placeChecks.status]);
  function keepPeople(people){if(accountRef.current.user)return;try{setContacts(saveContacts(people));}catch{/* Saving the optional local address book must not stop planning. */}}
  function replaceBrief(value){const next=withPeopleIds(value);briefRef.current=next;setBrief(next);return next;}
  function append(role,text,extra={}){const turn={id:identity(),role,text,...extra};setChat(c=>[...c,turn].slice(-60));return turn.id;}
  function resultReceipt(result,text){append('assistant',text||'Your day is ready.',{result:{title:result.request.title,detail:`${result.stops.filter(s=>s.item).length} ${result.stops.filter(s=>s.item).length===1?'stop':'stops'} · ${dateLabel(result.request.date)} · ${formatMoney(result.request.budget,result.request.currency)}`}});}
  function presentTool(kind,text){const id=identity();toolRef.current={id,kind};setTool(toolRef.current);setPlanOpen(false);setChat(c=>[...c,{id,role:'assistant',text:text||({tastes:'Let’s find a few favorites.',circles:'Who should we bring along?',people:'Here’s who’s in the day.',share:'Here’s the day, ready to share.',location:'Where should I plan?',timing:'When would you like to go? I haven’t picked a date or time for you.',review:'Here’s what I’ll work with. Change anything, then I’ll find the places.',profile:'A little passport to what you love. Your circles will see your latest tastes.'}[kind]),widget:kind}].slice(-60));}
  function askLocation(request=briefRef.current,query='',scope='plan',assistantText,nearMe=false){
    if(!owner){setError('Ask the organizer to set the planning area.');return;}
    clearTimeout(autoTimer.current);autoTimer.current=null;planner.current.invalidate();setPending(false);
    localVersion.current++;
    if(request.area!==briefRef.current.area||request.locationId!==briefRef.current.locationId){locationConfirmed.current=false;planningPaused.current=true;setDraftChanged(!!planRef.current);}
    replaceBrief(request);locationDraft.current=request;setLocationPrompt({query,scope,nearMe});
    presentTool('location',assistantText||(query?'Let’s confirm the area and local budget.':preferredRef.current&&!locationConfirmed.current?`Shall I plan around ${preferredRef.current.name} again?`:'Where should I plan?'));
  }
  async function applyLocation(patch,scope,selected){
    if(!owner)throw Error('Only the organizer can change the planning area.');
    localVersion.current++;
    const next={...(locationDraft.current||briefRef.current),...patch};
    const changed=next.locationId!==briefRef.current.locationId&&!!briefRef.current.area;
    if(changed&&Object.keys(next.pins||{}).length)throw Error('Release kept places before moving the plan to a different area.');
    if(scope==='default'){if(account.user)await account.changePlanningLocation(selected.id);else{localStorage.setItem('unstressed.planning-area',JSON.stringify(selected));setGuestLocation(selected);}}
    planner.current.invalidate();clearTimeout(autoTimer.current);autoTimer.current=null;setPending(false);
    planningZone.current=selected.timeZone||null;
    locationConfirmed.current=true;planningPaused.current=true;setDraftChanged(!!planRef.current);replaceBrief(next);
    locationDraft.current=null;
    if(autopilotRef.current&&autopilotPending.current){await continueAutopilot(next);return;}
    if(needsTiming(next)){presentTool('timing');return;}
    const hasFavorites=next.people.some(p=>p.artists.length||p.vibes.length);
    const note=`${selected.name} it is.${scope==='default'?' I’ll offer this area next time.':''}`;
    presentTool('review',`${note} ${hasFavorites?'Your tastes and people are here. Review the plan when you’re ready.':'We can start with your area and activities. Add tastes below if you’d like to make the picks more personal.'}`);
  }
  async function applyTiming(request){
    replaceBrief(request);
    if(autopilotRef.current&&autopilotPending.current){await continueAutopilot(request);return;}
    if(planRef.current&&!planningPaused.current){toolRef.current=null;setTool(null);showWhenReady.current=true;await build(request);return;}
    presentTool('review',request.people.some(p=>p.artists.length||p.vibes.length)?'Your timing and tastes are here. Let’s check the plan.':'Your timing is set. We can start with the outing you asked for, or you can add tastes below.');
  }
  async function forgetLocation(){if(account.user)await account.changePlanningLocation(null);else{localStorage.removeItem('unstressed.planning-area');setGuestLocation(null);}setNotice('Saved planning area removed. This plan keeps its area.');}
  function finishTool(){
    const tastes=toolRef.current?.kind==='tastes';toolRef.current=null;setTool(null);
    if(!tastes)return;
    if(autopilotRef.current&&autopilotPending.current?.stage==='tastes'){continueAutopilot(briefRef.current,true).catch(e=>{setError(e.message);setAutopilotPhase('');});return;}
    if(needsTiming(briefRef.current)){presentTool('timing');return;}
    if(!planRef.current||planningPaused.current){presentTool('review','Your tastes are in. Let’s make sure the plan feels right.');}
    else if(groupUpdating){showWhenReady.current=true;append('assistant','Your favorites are in. I’m updating the day.');}
    else {resultReceipt(planRef.current,'Your favorites are part of this day.');setPlanOpen(true);}
  }
  function showPlan(result,description){
    rememberSaved(result);
    planningPaused.current=false;setDraftChanged(false);setRevisionFailed(false);const old=planRef.current;setPrevious(old);planRef.current=result;setPlan(result);
    setConfirmations({});setSelection(null);setSelectedPlace(null);
    keepPeople(result.request.people);
    const fromAutopilot=autopilotPending.current?.stage==='planning';
    if(fromAutopilot){autopilotPending.current=null;setAutopilotPhase('checking');}
    if(!toolRef.current){resultReceipt(result,fromAutopilot?`Here’s the day for ${result.request.people.map(p=>p.name==='You'?'you':p.name).join(', ')}. ${result.request.people.some(p=>p.artists.length||p.vibes.length)?result.request.people.length===1?'I’ve used your tastes':'I’ve used the group’s tastes':'I’ve started with your area and activities'} within the ${formatMoney(result.request.budget,result.request.currency)} allowance. I’m checking the reported hours next.`:old?(result.request.party.adults+result.request.party.children===1?'I’ve updated your day.':'I’ve updated the day for everyone.'):'Here’s your day.');if(showWhenReady.current||!old){setPlanOpen(true);showWhenReady.current=false;}}
  }
  useEffect(()=>{planner.current=createLatestPlanner({run:request=>api.itinerary(request,savingHeaders()),onStart:()=>setBusy(true),onIdle:()=>{setBusy(false);if(!autoTimer.current)setPending(false);},onError:e=>{setError(e.message);setRevisionFailed(true);setAutopilotPhase('');autopilotPending.current=null;},onResult:result=>{showPlan(result);replaceBrief(result.request);}});return()=>{clearTimeout(autoTimer.current);autoTimer.current=null;clearTimeout(profileTimer.current);planner.current.dispose();};},[]);
  useEffect(()=>{api.deck().then(setDeck).catch(e=>setError(e.message));},[]);
  useEffect(()=>{if(location.hash.startsWith('#/discover'))setTasteId(briefRef.current.people[0].id);},[]);
  useEffect(()=>{
    const day=shared.day;if(!day)return;locationConfirmed.current=true;
    const key=`${day.id}:${day.revision}:${day.planRevision}:${day.status}`;
    if(snapshotVersion.current===key)return;snapshotVersion.current=key;
    if(autopilotPending.current&&['location','timing','tastes'].includes(autopilotPending.current.stage)&&day.revision!==autopilotPending.current.revision){
      autopilotPending.current=null;setAutopilotPhase('');locationDraft.current=null;toolRef.current=null;setTool(null);
      setError('Someone updated this shared day. I’ve loaded the latest group; send your request again to continue Autopilot.');
    }
    const request={...day.request,people:day.request.people.map(p=>pendingPeople.current.get(p.id)||p)};
    replaceBrief(request);setPending(day.status==='updating'||pendingPeople.current.size>0);
    if(day.plan&&day.planRevision===day.revision){showPlan(day.plan,day.events.at(-1)?.detail||'Everyone’s tastes, in the same picture.');}
    else if(day.plan&&!planRef.current)showPlan(day.plan);
    if(day.planError){setError(day.planError);setRevisionFailed(true);setAutopilotPhase('');autopilotPending.current=null;}
  },[shared.day]);
  useEffect(()=>{
    const day=shared.day,access=shared.credential;if(!account.user||!day?.plan||day.planRevision!==day.revision||day.access.role==='guest'||!access)return;
    let cancelled=false;const epoch=dayEpoch.current;
    api.saveSharedPlan(day.id,access.token,{'x-unstressed-plan-id':day.id,'x-unstressed-plan-revision':String(day.planRevision)}).then(result=>{
      if(cancelled||dayEpoch.current!==epoch)return;rememberSaved(result);planRef.current=result;setPlan(result);
    }).catch(()=>{if(!cancelled)setNotice('This shared day could not be copied to your account. Keep its private link or save a copy on this device.');});
    return()=>{cancelled=true;};
  },[account.user?.id,shared.day?.id,shared.day?.planRevision,shared.day?.revision,shared.day?.access.role]);
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
    track('taste_edited');
    if(activeCircle.current)activeCircle.current={...activeCircle.current,people:activeCircle.current.people.map(p=>p.id===person.id?person:p)};
    if(person.id===accountRef.current.user?.id)accountRef.current.changeProfile(person).catch(e=>setError(e.message));
    else {const circle=accountRef.current.circles.find(c=>c.id===activeCircle.current?.id);if(circle?.owner&&!circle.accountIds.includes(person.id))accountRef.current.changeCirclePerson(circle.id,person).catch(e=>setError(e.message));}
    localVersion.current++;
    const next={...briefRef.current,people:briefRef.current.people.map(p=>p.id===person.id?person:p)};
    replaceBrief(next);keepPeople(next.people);
    if(autopilotPending.current&&['location','timing','tastes'].includes(autopilotPending.current.stage))return;
    if(sharedRef.current.linked)queueMember(person);else schedule(next,`${person.name}’s tastes are now part of the day.`);
  }
  async function addPerson(person,{assistantText,offerTastes=true}={}){
    if(!account.user){setAccountAction('circles');setAccountOpen(true);setError('Sign in and invite someone into a circle before adding them to this plan.');return;}
    if(account.user){
      const connected=connections.find(p=>p.id===person.id);
      if(!connected){setPeopleQuery(person.name||'');presentTool('people','Let’s invite them into your circle first. Their account joins when they accept.');return;}
      person=connected;
    }
    if(briefRef.current.people.some(p=>p.id===person.id))return;
    localVersion.current++;
    const added={...person,id:person.id||identity()};
    let addedId=added.id;
    if(shared.linked){const result=await shared.add(added);addedId=result.request.people.at(-1).id;}
    else {const next=updateRoster(briefRef.current,[...briefRef.current.people,added]);schedule(next,`${added.name} is coming. Here’s how the day fits everyone now.`);}
    if(offerTastes)openTaste(addedId,assistantText);
    else append('assistant',assistantText||`${added.name} is part of the plan. We can add their tastes if they’d help; you don’t need them to continue.`);
  }
  async function applyCircle(circle,assistantText){
    activeCircle.current={id:circle.id,people:circlePeople(circle,contacts)};
    localVersion.current++;
    if(shared.linked)await shared.circle({name:circle.name,people:circlePeople(circle,contacts)});
    else schedule(bringCircle(briefRef.current,circle,contacts),`${circle.name} is coming.`);
    toolRef.current=null;setTool(null);if(!shared.linked&&(planningPaused.current||!planRef.current))presentTool('review',assistantText||`${circle.name} is in. Everyone’s tastes are part of the draft.`);else append('assistant',assistantText||`${circle.name} is in. I’m updating the day.`);
  }
  async function saveCircle(name){if(account.user){const savedCircle=await account.createCircle({name,people:[account.user.profile]});invitedCircles.current.set(savedCircle.id,savedCircle.accountIds);setNotice('Circle created. Copy its invite so people can choose to join.');}else{const next=writeCircles([makeCircle(name,briefRef.current.people),...circles]);setCircles(next);keepPeople(briefRef.current.people);}}
  async function prepareCircleInvite(id,name){
    if(!account.user)throw Error('Sign in to invite people to a circle.');
    const circle=id?account.circles.find(c=>c.id===id):await account.createCircle({name,people:[account.user.profile]});
    if(!circle?.inviteToken)throw Error('Choose a circle you organize.');
    invitedCircles.current.set(circle.id,[...circle.accountIds]);
    return {name:circle.name,url:`${location.origin}/#/circle/${circle.id}?invite=${circle.inviteToken}`};
  }
  async function sendCircleEmailInvite(id,name,email){
    if(!account.user)throw Error('Sign in to invite people.');
    const circle=id?account.circles.find(c=>c.id===id&&c.owner):await account.createCircle({name,people:[account.user.profile]});
    if(!circle)throw Error('Join a circle before inviting members.');
    await account.inviteCircleByEmail(circle.id,email);
    invitedCircles.current.set(circle.id,[...circle.accountIds]);
    setNotice('Email invitation sent. They will appear after accepting.');
    return circle.id;
  }
  async function removeCircle(id){if(account.user)await account.removeCircle(id);else setCircles(writeCircles(circles.filter(c=>c.id!==id)));if(activeCircle.current?.id===id)activeCircle.current=null;}
  async function removePerson(id){
    localVersion.current++;
    if(shared.linked){await shared.remove(id);}
    else {const current=briefRef.current;const next={...current,people:current.people.filter(p=>p.id!==id),party:{...current.party,adults:Math.max(1,current.party.adults-1)}};schedule(next,'The group changed. Finding the balance again.');}
    setTasteId(null);
  }
  function resetDay(){
    locationPrompted.current=false;
    savedIdentity.current={id:identity(),revision:0};setSavedLoading(false);
    invitedCircles.current.clear();setPeopleQuery('');setTab('itinerary');
    autopilotPending.current=null;setAutopilotPhase('');
    activeCircle.current=null;planningZone.current=null;planningPaused.current=true;setDraftChanged(false);locationConfirmed.current=false;locationDraft.current=null;setLocationPrompt({});setRevisionFailed(false);
    dayEpoch.current++;
    localVersion.current++;planner.current.invalidate();clearTimeout(autoTimer.current);autoTimer.current=null;clearTimeout(profileTimer.current);pendingPeople.current.clear();
    shared.leave();snapshotVersion.current='';planRef.current=null;setPlan(null);setPrevious(null);replaceBrief(withPeopleIds({...defaults(),...(preferredRef.current?{area:preferredRef.current.label,locationId:preferredRef.current.id,currency:preferredRef.current.currency||'GHS'}:{}),...(accountRef.current.user?{people:[accountRef.current.user.profile]}:{})}));setChat([]);setMessage('');setError('');showWhenReady.current=false;setPending(false);setTasteId(null);toolRef.current=null;setTool(null);setPlanOpen(false);
  }
  async function join(){if(!joinName.trim())return;setJoinBusy(true);try{const result=await shared.join({name:joinName.trim(),artists:[],vibes:[]});openTaste(result.access.memberId);}catch(e){setError(e.message);}finally{setJoinBusy(false);}}
  function openTaste(id=sharedRef.current.day?.access.memberId||briefRef.current.people[0].id,assistantText){if(deck.length){setTasteId(id);if(toolRef.current?.kind!=='tastes')presentTool('tastes',assistantText);}else setError('Taste cards are still loading. Please try again.');}
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
      if(id){loadSaved();const match=location.hash.match(/^#\/plan\/([a-zA-Z0-9_-]{1,64})$/);if(match)openSaved({id:match[1],cloud:true});}
    }
    if(!restored.current){
      restored.current=true;
      const params=new URLSearchParams(location.search),status=params.get('signin');
      if(status){
        try{const checkpoint=JSON.parse(sessionStorage.getItem('outing.signin-draft')||'null');if(checkpoint&&Date.now()-checkpoint.at<3600000&&(!checkpoint.userId||checkpoint.userId===id)){
          if(!shared.linked){replaceBrief(checkpoint.brief);locationConfirmed.current=!!checkpoint.plan||checkpoint.locationConfirmed===true;planningPaused.current=checkpoint.planningPaused??!checkpoint.plan;setDraftChanged(!!checkpoint.draftChanged);if(checkpoint.plan){planRef.current=checkpoint.plan;setPlan(checkpoint.plan);}}
          setChat(checkpoint.chat||[]);setMessage(checkpoint.message||'');
          if(status==='success'&&['calendar','circles','profile'].includes(checkpoint.resumeAction))presentTool(checkpoint.resumeAction==='calendar'?'share':checkpoint.resumeAction,checkpoint.resumeAction==='calendar'?'You’re signed in. Open your calendar event below, review it and save.':undefined);
        }}catch{/* A missing checkpoint doesn't block the account. */}
        sessionStorage.removeItem('outing.signin-draft');params.delete('signin');history.replaceState(null,'',location.pathname+(params.size?`?${params}`:'')+location.hash);
        setNotice(status==='success'?'You’re signed in. Your day is right here.':status==='cancelled'?'Sign-in cancelled. Your day is still here.':'Sign-in couldn’t finish. Your day is still here; try again.');
      }
    }
    if(account.user&&!shared.linked){
      const current=briefRef.current;
      const profileSignature=personSignature(account.user.profile),profileChanged=accountProfileSeen.current?.id===id&&accountProfileSeen.current.signature!==profileSignature;
      const adopted=adoptAccountProfile(current,account.user.profile);
      if(adopted){if(planRef.current&&!planningPaused.current)schedule(adopted);else replaceBrief(adopted);}
      else {const existing=current.people.find(p=>p.id===id);if(existing&&profileChanged&&personSignature(existing)!==profileSignature){const next={...current,people:current.people.map(p=>p.id===id?account.user.profile:p)};if(planRef.current)schedule(next);else replaceBrief(next);}}
      accountProfileSeen.current={id,signature:profileSignature};
    }
    const active=activeCircle.current,savedCircle=account.circles.find(c=>c.id===active?.id),circle=savedCircle?{...savedCircle,people:savedCircle.people.filter(p=>savedCircle.accountIds.includes(p.id))}:null;
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
  useEffect(()=>{
    if(!account.ready||!restored.current||locationPrompted.current||!owner||shared.linked||planRef.current||preferred||brief.area||tool||chat.length||message||circleInvite)return;
    if(location.hash&&location.hash!=='#/')return;
    locationPrompted.current=true;
    dismissLocationWelcome();
    askLocation(briefRef.current,'','plan','Choose your planning area to begin. You can change it for any new day.');
  },[account.ready,preferred,brief.area,tool,chat.length,message,owner,shared.linked,circleInvite]);
  useEffect(()=>{
    if(!account.user||!owner)return;
    for(const [id,known] of invitedCircles.current){
      const circle=account.circles.find(c=>c.id===id);if(!circle)continue;
      const joined=newlyJoinedPeople(circle,known).filter(p=>!briefRef.current.people.some(member=>member.id===p.id));
      invitedCircles.current.set(id,[...circle.accountIds]);
      if(!joined.length)continue;
      if(briefRef.current.people.length+joined.length>6){append('assistant',`Someone joined ${circle.name}. This day already has six taste profiles; you can find them in People.`);continue;}
      localVersion.current++;
      append('assistant',`${joined.map(p=>p.name).join(', ')} accepted the invitation to ${circle.name}. Their own tastes are now part of this day.`);
      if(sharedRef.current.linked)sharedRef.current.circle({name:circle.name,people:joined}).catch(e=>setError(e.message));
      else schedule(updateRoster(briefRef.current,[...briefRef.current.people,...joined]));
    }
  },[account.user,account.circles,owner]);
  async function signIn(){
    if(groupUpdating)throw Error('Let the current day update finish, then sign in.');
    sessionStorage.setItem('outing.signin-draft',JSON.stringify({brief:briefRef.current,plan:planRef.current,chat,message,locationConfirmed:locationConfirmed.current,planningPaused:planningPaused.current,draftChanged,resumeAction:accountAction,userId:account.user?.id||null,at:Date.now()}));
    const result=await api.signIn(/^#\/(day|circle|plan)\//.test(location.hash)?`/${location.hash}`:'/');location.assign(result.url);
  }
  async function copyCircleInvite(circle){invitedCircles.current.set(circle.id,[...circle.accountIds]);await navigator.clipboard.writeText(`${location.origin}/#/circle/${circle.id}?invite=${circle.inviteToken}`);setNotice('Circle invite copied. Everyone joins with their own account.');}
  const activeBrief = brief;

  function toggleAutopilot(){
    if(!owner)return;
    const enabled=!autopilotRef.current;
    if(enabled)track('autopilot_enabled');
    autopilotRef.current=enabled;setAutopilot(enabled);autopilotPending.current=null;setAutopilotPhase('');
    // A pending model response must not restart a workflow after the mode changes.
    localVersion.current++;
    append('assistant',enabled?'Autopilot is on. Tell me what you have in mind and who’s coming. I’ll use your tastes to shape the plan and check the details; you can steer me anytime.':'Autopilot is off. Your tastes and draft are still here; we’ll shape the next steps together.');
    setPlanOpen(false);
  }
  async function continueAutopilot(request){
    if(!autopilotRef.current||!autopilotPending.current)return;
    if(!owner)throw Error('Only the organizer can use Autopilot for this day.');
    const pendingRun=autopilotPending.current;
    replaceBrief(request);
    if(needsTiming(request)){pendingRun.stage='timing';setAutopilotPhase('timing');presentTool('timing');return;}
    pendingRun.stage='planning';setAutopilotPhase('planning');toolRef.current=null;setTool(null);showWhenReady.current=true;
    planningPaused.current=false;setDraftChanged(false);localVersion.current++;
    clearTimeout(autoTimer.current);autoTimer.current=null;planner.current.invalidate();setError('');
    append('assistant',`I’m planning for ${request.people.map(p=>p.name==='You'?'you':p.name).join(', ')}: ${dateLabel(request.date)}, ${timingLabel(request)}, with ${formatMoney(request.budget,request.currency)} for the group. You can adjust these details after the plan.`);
    if(shared.linked){try{await shared.autopilot(request,pendingRun.revision);}catch(e){autopilotPending.current=null;setAutopilotPhase('');setRevisionFailed(true);throw e;}}
    else {setPending(true);planner.current.enqueue(withPeopleIds(request));}
  }
  function nextAction(action){
    if(action.id==='checks'){
      track('checks_opened');
      if(placeChecks.status==='error')placeChecks.refresh();
      append('user','Check the hours and menus for our day.');
      append('assistant',nextSteps.note);
      setTab('checklist');setPlanOpen(true);
    }else if(action.id==='location')askLocation();
    else if(action.id==='tastes')openTaste(owner?action.personId:undefined);
    else presentTool(action.id);
  }

  function accept(result, text) {locationConfirmed.current=true;showPlan(result,text);replaceBrief(result.request);setTab('itinerary');}
  async function build(request, description, revision) {
    if(!locationConfirmed.current&&!shared.linked){askLocation(request);return false;}
    if(needsTiming(request)){replaceBrief(request);presentTool('timing');return false;}
    if(!request.activities.length){replaceBrief(request);presentTool('review','Choose what you’d like to do. I’ll only find places for those moments.');return false;}
    planningPaused.current=false;setDraftChanged(false);localVersion.current++;
    clearTimeout(autoTimer.current);autoTimer.current=null;setError('');setRevisionFailed(false);
    if(shared.linked){try{await shared.updateBrief(request,revision);return true;}catch(e){setError(e.message);return false;}}
    planner.current.enqueue(withPeopleIds(request));return true;
  }
  async function sendMessage(sent=message){
    if(working.current||!sent.trim())return;
    if(owner&&!shared.linked&&!locationConfirmed.current&&!briefRef.current.area&&!preferredRef.current?.label){setMessage(sent);askLocation(briefRef.current,'','plan','Choose a planning area first. Your message is saved here, ready to send afterward.');return;}
    if(!health?.agentConfigured){setError('Chat isn’t connected yet. Use Tastes, People, Circles and Review plan to shape your day.');return;}
    working.current=true;setBusy(true);setError('');setRevisionFailed(false);toolRef.current=null;setTool(null);
    const version=localVersion.current,revision=shared.day?.revision;
    autopilotPending.current=null;setAutopilotPhase(autopilotRef.current&&owner?'thinking':'');
    append('user',sent.trim());setMessage('');
    const history=conversationHistory(chat);
    try{
      const result=await api.agent({message:sent.trim(),mode:autopilotRef.current&&owner?'autopilot':'guided',contacts:autopilotRef.current&&owner?[...new Map(contacts.map(p=>[p.id,{id:p.id,...personInput(p)}])).values()].slice(0,30):[],context:briefRef.current,locationContext:{confirmed:locationConfirmed.current||shared.linked,preferredLabel:preferredRef.current?.label,timeZone:planningZone.current||planRef.current?.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone},history,circles:circles.map(c=>({id:c.id,name:c.name,people:circlePeople(c,contacts)})),planContext:planRef.current?{stops:planRef.current.stops.map(s=>({id:s.id,intent:s.intent,name:s.item?.name||null,connections:s.connections.map(e=>({personId:e.personId,kind:e.kind,label:e.label,preference:planRef.current.tasteMap.nodes.find(n=>n.id===e.from)?.label}))})),warnings:planRef.current.warnings}:undefined},savingHeaders());
      setAutopilotPhase('');
      if(version!==localVersion.current){append('assistant','The day changed while I was thinking. Please send that again so I can use the latest details.');return;}
      if(result.status==='autopilot'){
        if(!owner)throw Error('Only the organizer can use Autopilot for this day.');
        if(result.circleId){const circle=circles.find(c=>c.id===result.circleId);activeCircle.current=circle?{id:circle.id,people:circlePeople(circle,contacts)}:null;}
        autopilotPending.current={stage:result.needsLocation?'location':'planning',revision};
        if(result.needsLocation){setAutopilotPhase('location');askLocation(result.request,result.nearby?'':result.request.area,'plan',result.assistantMessage,result.nearby);}
        else {if(result.assistantMessage)append('assistant',result.assistantMessage);await continueAutopilot(result.request);}
      }else if(result.status==='action'){
        if(result.action==='invite_person'){setPeopleQuery(result.name);presentTool('people',result.assistantMessage||`Let’s invite ${result.name} into a circle. They’ll join with their own account and tastes.`);}
        if(result.action==='choose_activities'){replaceBrief(result.request);presentTool('review','Choose what you’d like to do. One place or a little mix—it’s up to you.');}
        if(result.action==='set_timing'){replaceBrief(result.request);presentTool('timing',result.assistantMessage);}
        if(result.action==='set_location'){askLocation(result.request,result.query,result.scope,result.assistantMessage,result.nearby);}
        if(result.action==='bring_circle'){if(!owner)throw Error('Only the organizer can bring a circle.');const circle=circles.find(c=>c.id===result.circleId);if(!circle)throw Error('That circle is no longer saved.');await applyCircle(circle,result.assistantMessage);}
        if(result.action==='add_person'){if(!owner)throw Error('Only the organizer can add someone.');await addPerson(result.person,{assistantText:result.assistantMessage,offerTastes:false});}
        if(result.action==='update_person'){if(!owner&&result.person.id!==shared.day?.access.memberId)throw Error('You can change your own tastes. Ask the organizer about other people.');showWhenReady.current=true;editTaste(result.person);append('assistant',result.assistantMessage||`I’ve updated ${result.person.name}’s tastes. ${planRef.current&&!planningPaused.current?'I’m checking the day again.':'They’re saved in the draft.'}`);}
        if(result.action==='remove_person'){if(!owner)throw Error('Only the organizer can change the group.');await removePerson(result.personId);append('assistant',result.assistantMessage||(planRef.current&&!planningPaused.current?'The group is updated. I’m reworking the day.':'The group is updated in your draft.'));}
      }else if(result.status==='show_ui'){
        if(result.panel==='tastes')openTaste(result.personId,result.assistantMessage);
        else if(result.panel==='location')askLocation(briefRef.current,'','plan',result.assistantMessage);
        else if(result.panel==='timing')presentTool('timing',result.assistantMessage);
        else if(['circles','people','share','review'].includes(result.panel))presentTool(result.panel,result.assistantMessage);
        else {setTab(result.panel==='budget'?'budget':result.panel==='checks'?'checklist':'itinerary');setPlanOpen(true);append('assistant',result.assistantMessage||(planRef.current?(result.panel==='checks'?'I’m comparing your times with reported hours and gathering the venue details. You’ll see what still needs confirming.':'Here’s the current day.'):'Tell me the outing you have in mind, and we can shape it together.'));}
      }else if(result.status==='needs_input')append('assistant',result.question);
      else if(result.status==='reply')append('assistant',result.text);
      else if(result.status==='ready'){if(!owner)throw Error('Only the organizer can change the trip details.');if(result.assistantMessage)append('assistant',result.assistantMessage);replaceBrief(result.request);showWhenReady.current=true;await build(result.request,undefined,revision);}else throw Error('The planning response was not understood. Please retry your request.');
    }catch(e){setError(e.message);setRevisionFailed(true);setMessage(sent);setAutopilotPhase('');autopilotPending.current=null;}
    finally{working.current=false;setBusy(false);}
  }
  async function pin(intent, id) {
    const pins = { ...plan.request.pins };
    if (pins[intent]) delete pins[intent]; else pins[intent] = id;
    const request={...briefRef.current,pins};
    if(shared.linked){build(request,'Kept places updated.');}else{
      let updated={...plan,request};
      if(account.user&&plan.savedPlan){try{updated=await api.editSavedPlan(plan.savedPlan.id,{revision:plan.savedPlan.revision,pins});rememberSaved(updated);}catch(e){setError(e.message);return;}}
      replaceBrief(updated.request);planRef.current=updated;setPlan(updated);
    }
  }
  function swap(stop) {
    const pins = rememberStops(plan); delete pins[stop.intent];
    build({ ...plan.request, pins, excludeIds: [...new Set([...plan.request.excludeIds, stop.item.id])] }, 'I’ve looked for another stop and kept the other places in your day. You can undo this revision.');
  }
  async function undo(){
    let result=previous;
    if(account.user&&plan.savedPlan&&previous.savedPlan?.id===plan.savedPlan.id){
      try{result=await api.editSavedPlan(plan.savedPlan.id,{revision:plan.savedPlan.revision,restoreRevision:previous.savedPlan.revision});rememberSaved(result);}catch(e){setError(e.message);return;}
    }
    planRef.current=result;setPlan(result);replaceBrief(result.request);setPrevious(null);append('assistant','Your previous day is restored.');
  }
  function save() {
    if(account.user&&plan.savedPlan&&!plan.saveError){setNotice('Saved automatically to your account. Find it anytime in Saved days.');return;}
    const entry = { id: crypto.randomUUID(), savedAt: new Date().toISOString(), plan:{...plan,request:withPeopleIds(plan.request)} };
    const next = [entry, ...saved.filter(s => !s.cloud&&JSON.stringify(s.plan) !== JSON.stringify(plan))].slice(0, 8);
    try { localStorage.setItem(savedKey(account.user?.id), JSON.stringify(next)); setSaved([...saved.filter(s=>s.cloud),...next]); setNotice('Day saved on this device.');track('plan_saved'); } catch { setNotice('Your browser couldn’t save this day. Try copying it instead.'); }
  }
  async function copy() { try { await navigator.clipboard.writeText(planText(plan)); setNotice('Your itinerary and taste connections are copied.'); } catch { setNotice('Copy isn’t available here. Use Print to keep a copy.'); } }
  const trace = id => { setSelection(id); setTab('taste');setPlanOpen(true); };
  function chooseTool(kind){if(kind==='nearby'){askLocation(briefRef.current,'','plan','Let’s see what’s around you. Choose a nearby area, then we’ll shape the outing.',true);return;}if(kind==='location'){askLocation();return;}if(kind==='profile'&&!account.user){setAccountAction('profile');setAccountOpen(true);return;}if(kind==='tastes')openTaste();else presentTool(kind);}
  function openDetails(){editorRevision.current=shared.day?.revision;setEditor(true);}
  function chooseActivities(activities){
    if(!owner)return;
    clearTimeout(autoTimer.current);autoTimer.current=null;planner.current.invalidate();setPending(false);localVersion.current++;
    planningPaused.current=true;setDraftChanged(!!planRef.current);
    replaceBrief({...briefRef.current,activities,pins:Object.fromEntries(Object.entries(briefRef.current.pins||{}).filter(([intent])=>activities.includes(intent)))});
  }
  async function planFromReview(){if(autopilotRef.current&&autopilotPending.current?.stage==='activities'){await continueAutopilot(briefRef.current,true);return;}if(!locationConfirmed.current&&!shared.linked){askLocation(briefRef.current);return;}showWhenReady.current=true;finishTool();await build(briefRef.current);}
  function renderTool(){if(tool?.kind==='timing')return <TimingAction key={tool.id} brief={brief} timeZone={planningZone.current||plan?.timeZone} onApply={applyTiming} onClose={finishTool}/>;if(tool?.kind==='review')return <PlanReview brief={brief} deck={deck} hasPlan={!!plan} confirmed={locationConfirmed.current||shared.linked} busy={groupUpdating} onActivities={owner?chooseActivities:undefined} onPlan={planFromReview} onTool={chooseTool} onDetails={openDetails} onDone={finishTool}/>;if(tool?.kind==='location')return <LocationAction key={tool.id} brief={locationDraft.current||brief} preferred={preferred} query={locationPrompt.query} scope={locationPrompt.scope} nearMe={locationPrompt.nearMe} signedIn={!!account.user} onDone={finishTool} onApply={applyLocation} onForget={forgetLocation}/>;if(tool?.kind==='profile'&&account.user)return <TasteAction personal person={account.user.profile} people={[account.user.profile]} deck={deck} onChange={p=>account.changeProfile(p).catch(e=>setError(e.message))} onDone={finishTool} editable/>;if(tool?.kind==='tastes'&&activePerson)return <TasteAction autopilot={autopilotPending.current?.stage==='tastes'} key={activePerson.id} person={activePerson} people={brief.people} deck={deck} onPerson={openTaste} onChange={editTaste} onDone={()=>finishTool()} drafting={!plan||planningPaused.current} editable={owner||shared.day?.access.memberId===activePerson.id}/>;
    if(tool?.kind==='circles')return <CirclesAction circles={circles} contacts={contacts} people={brief.people} onApply={applyCircle} onSave={saveCircle} onRemove={removeCircle} onDone={finishTool} owner={owner} accountUser={account.user} onInvite={copyCircleInvite} onEmailInvite={sendCircleEmailInvite} onSignIn={()=>{setAccountAction('circles');setAccountOpen(true);}}/>;
    if(tool?.kind==='people')return <PeopleAction key={tool.id} accountUser={account.user} circles={account.circles} connections={connections} onInvite={prepareCircleInvite} onEmailInvite={sendCircleEmailInvite} initialQuery={peopleQuery} people={brief.people} contacts={contacts} owner={owner} memberId={shared.day?.access.memberId} onTaste={openTaste} onAdd={addPerson} onRemove={removePerson} onShare={()=>presentTool('share')} onDone={()=>finishTool()}/>;
    if(tool?.kind==='share')return <ShareDay updating={groupUpdating} accountUser={account.user} onAccountRequired={action=>{setAccountAction(action);setAccountOpen(true);}} embedded plan={plan} brief={brief} shared={shared} onEnsure={ensureShared} onClose={finishTool}/>;return null;
  }
  return <><ChatStudio reviewContent={<PlanReview brief={brief} deck={deck} hasPlan={!!plan} confirmed={locationConfirmed.current||shared.linked} busy={groupUpdating} onActivities={owner?chooseActivities:undefined} onPlan={planFromReview} onTool={chooseTool} onDetails={openDetails}/>} planCircleName={plan&&activeCircle.current?.people.every(p=>plan.request.people.some(member=>member.id===p.id))?circles.find(c=>c.id===activeCircle.current?.id)?.name:undefined} circleName={circles.find(c=>c.id===activeCircle.current?.id)?.name} autopilot={autopilot&&owner} autopilotPhase={autopilotPhase} onAutopilot={toggleAutopilot} nextSteps={!draftChanged&&!revisionFailed?nextSteps:null} onNextAction={nextAction} draftChanged={draftChanged} accountButton={<AccountButton user={account.user} onClick={()=>setAccountOpen(true)}/>} brief={brief} plan={plan} chat={chat} tool={tool} renderTool={renderTool} message={message} onMessage={setMessage} onSend={sendMessage} busy={groupUpdating} configured={health?.agentConfigured} owner={owner} guest={guest} connecting={shared.connecting} revisionFailed={revisionFailed} error={error||shared.error||account.error} onDismissError={()=>{setError('');shared.clearError();account.clearError();}} onNew={resetDay} onSaved={()=>{setShowSaved(true);loadSaved();}} onTool={chooseTool} onOpenPlan={()=>setPlanOpen(true)} planOpen={planOpen} onClosePlan={()=>setPlanOpen(false)} planView={tab} onPlanView={setTab} notice={notice} joinContent={<div className="cs-join"><h1>Come along.</h1><p>{brief.people.map(p=>p.name).join(', ')} are putting a day together.</p><form className="cs-inline-form" onSubmit={e=>{e.preventDefault();join();}}><input aria-label="Your name" required maxLength={24} value={joinName} onChange={e=>setJoinName(e.target.value)} placeholder="Your name"/><button disabled={joinBusy}>Join the day <Icon name="arrow" size={15}/></button></form><small>Your name and tastes are visible to this group.</small></div>}>
    {plan&&<>{tab==='itinerary'&&<>{plan.timingNotes?.map(note=><p className="cs-timing-note" key={note}><Icon name="clock" size={16}/>{note}</p>)}<PlaceCheckNotice checks={placeChecks} onOpen={()=>setTab('checklist')}/>{plan.saveError&&<p role="alert" className="cs-timing-note">{plan.saveError}</p>}<div className="cs-day-actions">{owner&&<button onClick={openDetails} disabled={groupUpdating}><Icon name="edit" size={13}/>Details</button>}<button onClick={save} title={account.user&&plan.savedPlan?"Saved automatically to your account":"Save a copy on this device"}><Icon name="bookmark" size={13}/>{account.user&&plan.savedPlan&&!plan.saveError?'Saved to account':'Save on device'}</button><button onClick={copy}><Icon name="copy" size={13}/>Copy</button>{previous&&!shared.linked&&<button disabled={groupUpdating} onClick={undo}><Icon name="undo" size={13}/>Undo</button>}</div>{plan.stops.filter(stop=>stop.item).map(stop=><Stop key={`${stop.id}-${stop.item?.id}`} stop={stop} plan={plan} busy={groupUpdating||!owner} onPin={pin} onSwap={swap} onTrace={trace} onBudget={()=>setTab('budget')} onDetails={stop=>(track('place_opened'),setSelectedPlace(stop.item.entityId))}/>)}<p className="cs-day-note">Suggested times and spending allowances. Confirm hours, prices and travel before you go.</p><details className="cs-plan-notes"><summary>Notes & sources</summary>{plan.provenance.locality&&<p>Qloo matched: {plan.provenance.locality.label}.</p>}{plan.timeZone&&<p>Suggested times are local to {plan.timeZone}.</p>}{plan.warnings.map(w=><p key={w}>{w}</p>)}<p>Places from {plan.provenance.provider}. Retrieved {plan.provenance.retrievedAt}.</p></details></>}
    {tab==='taste'&&<TasteMap key={selection||'all'} plan={plan} initialSelection={selection} onEdit={()=>{setPlanOpen(false);openTaste();}}/>}{tab==='budget'&&<Budget plan={plan} onEdit={id=>{setPlanOpen(false);openTaste(id);}}/>} {tab==='checklist'&&<BeforeGoing plan={plan} checks={placeChecks} done={confirmations} setDone={setConfirmations} onDetails={stop=>(track('place_opened'),setSelectedPlace(stop.item.entityId))}/>}
    {shared.day?.status==='error'&&<button className="pl-button" onClick={()=>shared.retry().catch(e=>setError(e.message))}>Retry the update</button>}</>}
  </ChatStudio>
  {showLocationWelcome({ready:account.ready,dismissed:locationWelcomeDismissed,area:brief.area,preferred,plan,chatLength:chat.length,tool,message,hash:location.hash,search:location.search})&&!accountOpen&&!showSaved&&<LocationWelcome onSkip={dismissLocationWelcome} onNearby={()=>{dismissLocationWelcome();chooseTool('nearby');}} onChoose={()=>{dismissLocationWelcome();chooseTool('location');}}/>}
  {selectedStop&&<PlaceDetails key={selectedPlace} stop={selectedStop} plan={plan} checks={placeChecks} onClose={()=>setSelectedPlace(null)} onSwap={()=>{setSelectedPlace(null);swap(selectedStop);}} canSwap={owner&&!groupUpdating&&!plan.request.pins[selectedStop.intent]}/> }
  {accountOpen&&<AccountPanel resumeAction={accountAction} account={account} onClose={()=>{setAccountOpen(false);setAccountAction(null);}} onSignIn={signIn} onTastes={()=>{setAccountOpen(false);presentTool('profile');}} onCircles={()=>{setAccountOpen(false);setProfileCirclesOpen(true);}} onLocation={()=>{setAccountOpen(false);askLocation();}} onUsage={()=>{setAccountOpen(false);setUsageOpen(true);}} onSignOut={async()=>{await account.signOut();setAccountOpen(false);}}/>}
  {profileCirclesOpen&&account.user&&<ProfileCircles account={account} onClose={()=>setProfileCirclesOpen(false)}/>}
  {usageOpen&&<UsageDashboard onClose={()=>setUsageOpen(false)}/>}
  {circleInvite&&<CircleInvite account={account} onSignIn={signIn} onClose={()=>{setCircleInvite(false);history.replaceState(null,'',location.pathname);}} onJoined={circle=>{setCircleInvite(false);history.replaceState(null,'',location.pathname);applyCircle(circle).catch(e=>setError(e.message));}}/>}
  {editor&&owner&&<TripEditor draftOnly={planningPaused.current||!plan} onLocation={draft=>{setEditor(false);askLocation(draft);}} brief={activeBrief} groupManaged hasPlan={!!plan} onClose={()=>setEditor(false)} onSubmit={async request=>{if(planningPaused.current||!planRef.current){replaceBrief(request);setDraftChanged(!!planRef.current);setEditor(false);presentTool('review','Those details are saved. I’ll search when you’re ready.');return;}if(await build(request,undefined,editorRevision.current))setEditor(false);else{editorRevision.current=sharedRef.current.day?.revision;throw Error('The update could not be saved. Your edits are still here; review the group and retry.');}}}/>}
  {showSaved&&<dialog className="pl-dialog pl-saved-dialog" ref={savedDialog} onCancel={()=>setShowSaved(false)} aria-labelledby="saved-title"><div className="pl-dialog-heading"><h2 id="saved-title">Saved days</h2><button className="pl-icon-button" onClick={()=>setShowSaved(false)} aria-label="Close saved days"><Icon name="close"/></button></div><div className="pl-dialog-body"><p>{account.user?'Your days save automatically to your account. Each keeps its own area, people and timing.':'Days you save here are kept on this device. Sign in to save new plans automatically to your account.'}</p>{savedLoading&&<p role="status">Loading your saved days…</p>}{saved.map(entry=>{const r=entry.cloud?entry:entry.plan.request;return <div className="pl-saved-item" key={`${entry.cloud?'account':'device'}-${entry.id}`}><button disabled={savedLoading} onClick={()=>openSaved(entry)}><strong>{r.title}</strong><small>{dateLabel(r.date)} · {r.area} · {formatMoney(r.budget,r.currency)}{!entry.cloud?' · This device':''}</small></button><button className="pl-icon-button" disabled={savedLoading} aria-label={`Delete ${r.title}`} onClick={()=>deleteSaved(entry)}><Icon name="trash" size={16}/></button></div>;})}{!savedLoading&&!saved.length&&<p>{account.user?'Your next day will appear here automatically.':'No saved days yet. Save one from your day panel.'}</p>}</div></dialog>}
  </>;
}
