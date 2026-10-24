import {createAccountStore} from './accounts.js';
import {InputError} from './contract.js';

export const CLIENT_EVENTS=['visit','taste_edited','place_opened','checks_opened','plan_saved','daybook_downloaded','calendar_opened','calendar_downloaded','autopilot_enabled'];
export const SERVER_EVENTS=['plan_created','agent_request','day_shared','day_updated','circle_created','circle_joined','request_failed'];
const allowed=new Set([...CLIENT_EVENTS,...SERVER_EVENTS]);
const sessionPattern=/^[a-zA-Z0-9_-]{16,64}$/;
export function visitorId(req){const value=req.get('x-unstressed-session');return typeof value==='string'&&sessionPattern.test(value)?value:null;}
export function createMetrics({file=null,now=Date.now}={}) {
  const store=createAccountStore({file,now});
  return {
    async record(name,{userId=null,visitor=null}={}){
      if(!allowed.has(name))throw new InputError('Unknown usage event.');
      if(!userId&&!visitor)return;
      await store.transact(data=>{
        data.startedAt??=new Date(now()).toISOString();
        const cutoff=now()-90*86400000;
        data.events=(data.events||[]).filter(e=>e.at>=cutoff).slice(-49999);
        data.events.push({name,at:now(),userId,visitor});
      });
    },
    async report(users,days=7){
      if(![1,7,30,90].includes(days))throw new InputError('Choose 1, 7, 30 or 90 days.');
      return store.read(data=>{
        const cutoff=now()-days*86400000,events=(data.events||[]).filter(e=>e.at>=cutoff);
        const count=name=>events.filter(e=>e.name===name).length;
        const featureCounts=Object.fromEntries([...allowed].map(name=>[name,count(name)]));
        const active=new Set(events.filter(e=>e.userId).map(e=>e.userId));
        const sessions=new Set(events.filter(e=>e.visitor).map(e=>e.visitor));
        const guests=new Set(events.filter(e=>!e.userId&&e.visitor).map(e=>e.visitor));
        const daily=Array.from({length:days},(_,index)=>{const date=new Date(now()-(days-index-1)*86400000).toISOString().slice(0,10),rows=events.filter(e=>new Date(e.at).toISOString().slice(0,10)===date);return {date,plans:rows.filter(e=>e.name==='plan_created').length,activeAccounts:new Set(rows.filter(e=>e.userId).map(e=>e.userId)).size};});
        return {startedAt:data.startedAt||null,asOf:new Date(now()).toISOString(),days,totalAccounts:users.length,newAccounts:users.filter(u=>Date.parse(u.createdAt)>=cutoff).length,activeAccounts:active.size,sessions:sessions.size,guestSessions:guests.size,features:featureCounts,daily,users:users.map(user=>{const rows=events.filter(e=>e.userId===user.id);return {...user,lastActiveAt:rows.length?new Date(Math.max(...rows.map(e=>e.at))).toISOString():null,plans:rows.filter(e=>e.name==='plan_created').length,agentRequests:rows.filter(e=>e.name==='agent_request').length};}).sort((a,b)=>(b.lastActiveAt||b.createdAt).localeCompare(a.lastActiveAt||a.createdAt))};
      });
    },
  };
}
