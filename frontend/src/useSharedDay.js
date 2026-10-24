import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api.js';

const credentialKey='outing.day-access.v1';
function linkedDay() {
  const match=location.hash.match(/^#\/day\/([a-zA-Z0-9-]+)\?(.*)$/);
  if(!match)return null;
  const key=new URLSearchParams(match[2]).get('key');
  return key?{id:match[1],token:key}:null;
}
function keepCredential(value) {try{const saved=JSON.parse(localStorage.getItem(credentialKey)||'{}');saved[value.id]=value.token;localStorage.setItem(credentialKey,JSON.stringify(saved));}catch{/* A copied link still gives access if device storage is unavailable. */}}
export const dayLink=(id,token)=>`${location.origin}/#/day/${encodeURIComponent(id)}?key=${encodeURIComponent(token)}`;

export default function useSharedDay() {
  const [credential,setCredential]=useState(linkedDay),[day,setDay]=useState(null),[error,setError]=useState(''),[connecting,setConnecting]=useState(!!linkedDay());
  const current=useRef(null),creation=useRef(null),epoch=useRef(0);
  const accept=useCallback(snapshot=>{
    const previous=current.current;
    if(previous?.id===snapshot.id&&(snapshot.revision<previous.revision||(snapshot.revision===previous.revision&&snapshot.planRevision<previous.planRevision)))return;
    current.current=snapshot;setDay(snapshot);setError('');setConnecting(false);
  },[]);
  useEffect(()=>{
    if(!credential)return;
    let cancelled=false,fetching=false;
    async function poll(){if(fetching||document.hidden)return;fetching=true;try{const snapshot=await api.day(credential.id,credential.token);if(!cancelled)accept(snapshot);}catch(e){if(!cancelled){setError(e.message);setConnecting(false);}}finally{fetching=false;}}
    poll();const timer=setInterval(poll,3000);document.addEventListener('visibilitychange',poll);
    return()=>{cancelled=true;clearInterval(timer);document.removeEventListener('visibilitychange',poll);};
  },[credential?.id,credential?.token,accept]);
  async function ensure(request) {
    if(credential&&current.current)return {day:current.current,credential};
    if(creation.current)return creation.current;
    const version=epoch.current;
    setConnecting(true);
    creation.current=(async()=>{try{
      const result=await api.createDay(request), access={id:result.id,token:result.token};
      if(version!==epoch.current)throw new Error('This day was closed before sharing finished.');
      keepCredential(access);setCredential(access);accept(result);
      history.replaceState(null,'',dayLink(result.id,result.token));
      return {day:result,credential:access};
    }catch(e){setError(e.message);setConnecting(false);throw e;}finally{creation.current=null;}})();
    return creation.current;
  }
  async function invoke(method,...args) {
    const version=epoch.current;
    try{const result=await method(credential.id,credential.token,...args);if(version===epoch.current)accept(result);return result;}
    catch(e){if(version!==epoch.current)throw e;setError(e.message);if(e.status===409)try{accept(await api.day(credential.id,credential.token));}catch{}throw e;}
  }
  async function join(person) {
    const result=await api.joinDay(credential.id,credential.token,person);
    const access={id:result.id,token:result.token};keepCredential(access);setCredential(access);accept(result);
    history.replaceState(null,'',dayLink(result.id,result.token));return result;
  }
  function leave(){epoch.current++;setConnecting(false);setCredential(null);setDay(null);current.current=null;setError('');history.replaceState(null,'','/#/');}
  return {day,credential,error,connecting,linked:!!credential,ensure,accept,join,leave,clearError:()=>setError(''),
    circle:value=>invoke(api.addCircle,value),add:person=>invoke(api.addPerson,person),updatePerson:(id,person)=>invoke(api.updatePerson,id,person),remove:id=>invoke(api.removePerson,id),
    autopilot:(request,revision=current.current.revision)=>invoke(api.autopilotDay,request,revision),
    updateBrief:(request,revision=current.current.revision)=>invoke(api.updateDay,request,revision),retry:()=>invoke(api.retryDay)};
}
