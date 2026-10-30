import {useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {personInput} from './day-state.js';

export default function useAccount(){
  const [data,setData]=useState({user:null,circles:[],configured:false}),[ready,setReady]=useState(false),[error,setError]=useState('');
  const version=useRef(0),writes=useRef(Promise.resolve()),pending=useRef(0),alive=useRef(true);
  async function refresh(){const generation=version.current;try{const next=await api.account();if(alive.current&&generation===version.current&&!pending.current){setData(next);setReady(true);setError('');}}catch(e){if(alive.current){setError(e.message);setReady(true);}}}
  useEffect(()=>{alive.current=true;refresh();const focus=()=>refresh(),timer=setInterval(()=>{if(document.visibilityState==='visible')refresh();},5000);window.addEventListener('focus',focus);return()=>{alive.current=false;clearInterval(timer);window.removeEventListener('focus',focus);};},[]);
  async function changeProfile(person){const generation=++version.current;pending.current++;setData(d=>({...d,user:{...d.user,profile:person}}));setError('');const job=writes.current.catch(()=>{}).then(()=>api.profile(personInput(person)));writes.current=job;
    try{const result=await job;if(alive.current&&generation===version.current)setData(d=>({...d,user:result.user}));}catch(e){if(alive.current)setError(`Your tastes could not be saved: ${e.message}`);throw e;}finally{pending.current--;if(!pending.current)refresh();}
  }
  async function createCircle(body){await writes.current;const result=await api.saveCircle(body);await refresh();return result;}
  async function renameCircle(id,name){const result=await api.renameCircle(id,name);await refresh();return result;}
  async function inviteCircleByEmail(id,email){return api.emailCircleInvite(id,email);}
  async function acceptCircleEmailInvite(id,token){const result=await api.acceptEmailCircleInvite(id,token);await refresh();return result;}
  async function removeCircleMember(id,memberId){await api.removeCircleMember(id,memberId);await refresh();}
  async function removeCircle(id){await api.forgetCircle(id);await refresh();}
  async function joinCircle(id,body){const result=await api.joinCircle(id,body);await refresh();return result;}
  async function changeCirclePerson(id,person){
    ++version.current;pending.current++;
    setData(d=>({...d,circles:d.circles.map(c=>c.id===id?{...c,people:c.people.map(p=>p.id===person.id?person:p)}:c)}));
    setError('');const job=writes.current.catch(()=>{}).then(()=>api.circlePerson(id,person.id,personInput(person)));writes.current=job;
    try{await job;}catch(e){if(alive.current)setError(`These circle tastes could not be saved: ${e.message}`);throw e;}finally{pending.current--;if(!pending.current)refresh();}
  }
  async function changePlanningLocation(id){++version.current;pending.current++;const job=writes.current.catch(()=>{}).then(()=>api.planningLocation(id));writes.current=job;try{const result=await job;if(alive.current)setData(d=>({...d,user:result.user}));return result.user.planningLocation;}finally{pending.current--;if(!pending.current)refresh();}}
  async function forgetPlanningLocation(id){++version.current;pending.current++;const job=writes.current.catch(()=>{}).then(()=>api.forgetPlanningLocation(id));writes.current=job;try{const result=await job;if(alive.current)setData(d=>({...d,user:result.user}));return result.user;}finally{pending.current--;if(!pending.current)refresh();}}
  async function signOut(){await writes.current;await api.signOut();version.current++;setData(d=>({...d,user:null,circles:[]}));}
  return {...data,ready,error,refresh,changeProfile,createCircle,renameCircle,inviteCircleByEmail,acceptCircleEmailInvite,removeCircleMember,removeCircle,joinCircle,changeCirclePerson,changePlanningLocation,forgetPlanningLocation,signOut,clearError:()=>setError('')};
}
