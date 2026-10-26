import {checkHours} from './place-guide.js';

export const minutes = value => Number(value.slice(0,2))*60+Number(value.slice(3));
export const clockTime = value => `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
export function localNow(timeZone, now=Date.now()) {
  const zone=timeZone||'UTC';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const get=key=>parts.find(p=>p.type===key).value;
  return {date:`${get('year')}-${get('month')}-${get('day')}`,minutes:Number(get('hour'))*60+Number(get('minute'))};
}

// Pick useful distinct places before dates or times are chosen. No opening-hour
// promise and no placeholder timetable is attached to a discovery result.
export function discoverPlaces(pools,schedule){
  let best=null;
  function visit(index,used,stops,score){
    if(index===schedule.length){if(!best||score>best.score)best={stops,score};return;}
    const base={...schedule[index],start:null,end:null,bufferAfterMinutes:0};
    for(const [rank,item]of pools[index].entries())if(!used.has(item.id)){const next=new Set(used);next.add(item.id);visit(index+1,next,[...stops,{...base,item}],score+10000-rank);}
    visit(index+1,used,[...stops,{...base,item:null,reason:pools[index].length?'no_distinct_place':'no_eligible_places'}],score);
  }
  visit(0,new Set(),[],0);return {stops:best.stops,notes:[]};
}

// Keep ranking/taste evidence intact; only choose a place and time that can fit.
// Unknown hours stay visibly unverified. Known conflicts are never hidden.
export async function schedulePlaces(pools, schedule, request, {details, timeZone, now=Date.now()}={}) {
  const local=localNow(timeZone,now),flexible=request.timing?.mode==='flexible';
  const end=minutes(request.endTime),start=minutes(request.startTime);
  const earliest=request.date===local.date?Math.ceil((local.minutes+30)/15)*15:start;
  const minimumStart=flexible?Math.max(start,earliest):start;
  if(request.date<local.date||!flexible&&request.date===local.date&&start<local.minutes||minimumStart>=end) {
    return {stops:schedule.map(s=>({...s,start:null,end:null,bufferAfterMinutes:0,item:null,reason:'time_in_past'})),notes:['This time has passed at your destination. Choose a later time or another date.']};
  }
  const info=new Map(),items=[...new Map(pools.flat().filter(Boolean).map(p=>[p.id,p])).values()];
  if(details) {
    let index=0;
    await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{
      while(index<items.length){const item=items[index++];try{info.set(item.id,await details(item.entityId));}catch{/* Missing hours cannot establish a conflict. */}}
    }));
  }
  function slotFor(item,base,earliestTime,index){
    const place=info.get(item.id),duration=base.durationMinutes;
    const fixedFirst=index===0&&!flexible;
    const first=fixedFirst?start:earliestTime;
    if(first<earliestTime||first+duration>end)return null;
    let unknown=null;
    for(let at=first;at+duration<=end;at+=15){
      const from=clockTime(at),to=clockTime(at+duration);
      const hours=checkHours(place?.hours,request.date,from,to,place?.isClosed);
      if(hours.status==='fits_reported_hours')return {...base,start:from,end:to,item,hours};
      if(hours.status==='unknown'&&hours.intervals===null&&!unknown)unknown={...base,start:from,end:to,item,hours};
      if(fixedFirst||!place?.hours||place.isClosed)break;
    }
    return unknown;
  }
  let best=null;
  function visit(index,cursor,used,stops,score){
    if(index===schedule.length){if(!best||score>best.score)best={stops,score};return;}
    const base=schedule[index];
    for(const [rank,item] of pools[index].entries()){
      if(used.has(item.id))continue;
      const slot=slotFor(item,base,cursor,index);if(!slot)continue;
      const next=new Set(used);next.add(item.id);
      visit(index+1,minutes(slot.end)+base.bufferAfterMinutes,next,[...stops,slot],score+10000+(slot.hours.status==='fits_reported_hours'?1000:0)-rank*10-(minutes(slot.start)-cursor)/10);
    }
    // An unfilled activity is a request still to resolve, not a scheduled visit.
    // Don't display its original placeholder or consume time/travel for it.
    const empty={...base,start:null,end:null,bufferAfterMinutes:0,item:null,reason:pools[index].length?'no_open_place':'no_eligible_places'};
    visit(index+1,cursor,used,[...stops,empty],score);
  }
  visit(0,minimumStart,new Set(),[],0);
  const shifted=best.stops.some((s,i)=>s.item&&s.start!==schedule[i].start);
  const stops=best.stops.map((s,i)=>({...s,bufferAfterMinutes:s.item&&best.stops.slice(i+1).some(next=>next.item)?s.bufferAfterMinutes:0}));
  return {stops,notes:[...(shifted?['I adjusted the stop times within your chosen window, allowing for the time now and any reported opening hours.']:[])]};
}


export const WEEKDAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
export function nextWeekdayDate(localDate,weekday){
  const target=WEEKDAYS.indexOf(weekday);if(target<0)throw new RangeError('Choose a supported weekday.');
  const date=new Date(`${localDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate()+(target-date.getUTCDay()+7)%7);
  return date.toISOString().slice(0,10);
}
