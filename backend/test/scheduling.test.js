import test from 'node:test';
import assert from 'node:assert/strict';
import {schedulePlaces,localNow} from '../src/scheduling.js';
import {weeklyHours} from '../src/place-guide.js';
import {parseItinerary,makeSchedule,buildItinerary} from '../src/itinerary.js';
import {createAgent} from '../src/agent.js';
import {localDate,needsTiming} from '../../frontend/src/timing.js';
const now=Date.parse('2026-10-24T08:00:00Z');
const request=changes=>parseItinerary({area:'Accra',date:'2026-10-24',activities:['dinner'],startTime:'09:00',endTime:'18:00',timing:{dateConfirmed:true,timeConfirmed:true,mode:'flexible'},...changes});
const place=(id,opens,closes)=>({id,entityId:id,hours:weeklyHours({saturday:[opens===null?{closed:true}:{closed:false,opens,closes}]})});
const run=(r,pools)=>schedulePlaces(pools,makeSchedule(r),r,{now,timeZone:'Africa/Accra',details:async id=>pools.flat().find(p=>p.id===id)});
test('flexible time waits for opening and never defaults a lunchtime venue to 11',async()=>{
  const result=await run(request({}),[[place('garden','12:00','19:00')]]);assert.equal(result.stops[0].start,'12:00');assert.equal(result.stops[0].end,'13:15');assert.equal(result.stops[0].hours.status,'fits_reported_hours');assert.equal(result.notes.length,1);
});
test('fixed start stays fixed and chooses a fitting alternative',async()=>{
  const r=request({startTime:'11:00',timing:{dateConfirmed:true,timeConfirmed:true,mode:'fixed'}}),result=await run(r,[[place('late','12:00','19:00'),place('open','10:00','18:00')]]);assert.equal(result.stops[0].item.id,'open');assert.equal(result.stops[0].start,'11:00');
});
test('closed or incompatible pinned places leave an honest gap instead of moving the date or breaking the time',async()=>{
  for(const p of [place('closed',null),place('late','18:00','22:00')]){const result=await run(request({}),[[p]]);assert.equal(result.stops[0].item,null);assert.equal(result.stops[0].reason,'no_open_place');}
});
test('unknown hours remain unverified, not advertised as open',async()=>{
  const result=await run(request({}),[[{id:'unknown',entityId:'unknown'}]]);assert.equal(result.stops[0].hours.status,'unknown');assert.equal(result.stops[0].start,'09:00');
});
test('multiple stops remain distinct, preserve buffers and fit inside the chosen window',async()=>{
  const r=request({activities:['coffee','dinner'],endTime:'15:00'}),result=await run(r,[[place('shared','12:00','17:00'),place('cafe','11:00','16:00')],[place('shared','12:00','17:00')]]);assert.equal(result.stops[0].item.id,'cafe');assert.equal(result.stops[1].item.id,'shared');assert.ok(result.stops[1].start>result.stops[0].end);assert.ok(result.stops[1].end<='15:00');
});
test('today cannot start in the past; flexible plans leave 30 minutes to get ready',async()=>{
  const r=request({}),p=place('cafe','06:00','22:00');const result=await schedulePlaces([[p]],makeSchedule(r),r,{now:Date.parse('2026-10-24T13:07Z'),timeZone:'Africa/Accra',details:async()=>p});assert.equal(result.stops[0].start,'13:45');
  const fixed=request({timing:{dateConfirmed:true,timeConfirmed:true,mode:'fixed'}}),past=await schedulePlaces([[p]],makeSchedule(fixed),fixed,{now:Date.parse('2026-10-24T13:07Z'),timeZone:'Africa/Accra'});assert.equal(past.stops[0].reason,'time_in_past');
});
test('destination-local dates handle crossing midnight and UTC differences',()=>{
  assert.equal(localNow('Asia/Tokyo',Date.parse('2026-10-24T17:00Z')).date,'2026-10-25');assert.equal(localDate('America/Los_Angeles',0,Date.parse('2026-10-24T02:00Z')),'2026-10-23');assert.equal(localDate('Africa/Accra',0,now),'2026-10-24');
});
test('an unfilled coffee after noon has no placeholder time and does not delay lunch',async()=>{
  const r=request({activities:['coffee','dinner']}),meal=place('lunch','06:00','22:00');
  const result=await schedulePlaces([[],[meal]],makeSchedule(r),r,{now:Date.parse('2026-10-24T12:23Z'),timeZone:'Africa/Accra',details:async()=>meal});
  assert.equal(result.stops[0].start,null);assert.equal(result.stops[0].end,null);assert.equal(result.stops[0].bufferAfterMinutes,0);
  assert.equal(result.stops[0].reason,'no_eligible_places');
  assert.equal(result.stops[1].start,'13:00');assert.equal(result.stops[1].end,'14:15');assert.equal(result.stops[1].bufferAfterMinutes,0);
});
test('a missing middle or final stop never displays an earlier time or adds phantom travel',async()=>{
  const r=request({activities:['coffee','activity','dinner']}),cafe=place('cafe','14:00','22:00'),meal=place('meal','14:00','22:00');
  const result=await run(r,[[cafe],[],[meal]]);
  assert.equal(result.stops[0].start,'14:00');assert.equal(result.stops[1].start,null);
  assert.equal(result.stops[2].start,'15:15');assert.equal(result.stops[1].bufferAfterMinutes,0);
  const partial=await run(r,[[cafe],[],[]]);assert.equal(partial.stops[0].bufferAfterMinutes,0);
});
test('an elapsed or too-short remaining window leaves unscheduled slots, never stale times',async()=>{
  const r=request({endTime:'13:00'}),p=place('meal','06:00','22:00');
  for(const time of ['2026-10-24T12:00Z','2026-10-24T13:07Z']){
    const result=await schedulePlaces([[p]],makeSchedule(r),r,{now:Date.parse(time),timeZone:'Africa/Accra',details:async()=>p});
    assert.equal(result.stops[0].item,null);assert.equal(result.stops[0].start,null);assert.equal(result.stops[0].end,null);
  }
});
test('unconfirmed date or time cannot start discovery',async()=>{
  const r=request({timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'}});assert.equal(needsTiming(r),true);await assert.rejects(buildItinerary({},r),/Choose when/);
});
test('an open agent request preserves unconfirmed timing and asks before discovery',async()=>{
  const context=request({timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'}});
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'revise_day',arguments:JSON.stringify({title:'A solo date'})}}]}}]})})});
  const result=await agent.interpret({message:'plan for me a solo date inside accra',context,locationContext:{confirmed:true}});assert.equal(result.action,'set_timing');assert.equal(result.request.date,'2026-10-24');assert.equal(result.request.timing.dateConfirmed,false);
});
test('an explicit chat time switches flexible scheduling to a fixed start without changing the date',async()=>{
  const context=request({});const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'revise_day',arguments:JSON.stringify({startTime:'12:00',timing:{dateConfirmed:true,timeConfirmed:true,mode:'fixed'}})}}]}}]})})});
  const result=await agent.interpret({message:'set time to 12pm',context,locationContext:{confirmed:true}});assert.equal(result.request.startTime,'12:00');assert.equal(result.request.date,context.date);assert.equal(result.request.timing.mode,'fixed');
});

test('named afternoon windows are deterministic even if the model supplies a fixed noon start and stale end time',async()=>{
  const context=request({endTime:'21:00',timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'}});
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'autopilot_day',arguments:JSON.stringify({changes:{timePreference:'afternoon',startTime:'12:00',endTime:'21:00',timing:{dateConfirmed:true,timeConfirmed:true,mode:'fixed'}}})}}]}}]})})});
  const result=await agent.interpret({message:'Plan a lunch today afternoon',mode:'autopilot',context,locationContext:{confirmed:true}});
  assert.equal(result.request.startTime,'12:00');assert.equal(result.request.endTime,'17:00');assert.equal(result.request.timing.mode,'flexible');assert.equal(result.request.date,context.date);
});
