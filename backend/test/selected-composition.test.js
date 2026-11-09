import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgent,CHAT_TOOLS} from '../src/agent.js';
import {parseItinerary,buildItinerary} from '../src/itinerary.js';
import {createDiscovery} from '../src/plan.js';
import {agentPlanContext} from '../../frontend/src/agent-plan-context.js';
import {routeFromStops,routeFromChoices} from '../../frontend/src/shortlist.js';
import {bookingOperation,invalidateBookings} from '../src/booking-actions.js';

// Exact native-UI QA prompts; all IDs/provider data/model responses are synthetic.
const initialMessage='Plan a relaxed afternoon in East Legon, Accra tomorrow from noon to 5 pm for one person, with a cafe and a meal. Please show a few actual cafe alternatives so I can choose.';
const editMessage='Make this exactly two cafe stops: D Cafe (East Legon), then vida e caffè – Accra Mall. Remove the meal stop completely. Keep it for tomorrow noon to 5 pm.';
const route=[{intent:'coffee',placeId:'qloo:d-cafe'},{intent:'coffee',placeId:'qloo:vida'}];
const tool=(name,args)=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name,arguments:JSON.stringify(args)}}]}}]})});
const input=extra=>parseItinerary({title:'Cafés & A meal in East Legon',titleSource:'auto',area:'East Legon, Accra, Ghana',date:'2099-01-01',startTime:'12:00',endTime:'17:00',timing:{dateConfirmed:true,timeConfirmed:true,mode:'flexible',window:'custom'},activities:['coffee','dinner'],party:{adults:1,children:0},people:[{id:'you',name:'You',artists:[],vibes:[]}],budget:null,pins:{coffee:'qloo:d-cafe',dinner:'qloo:thai'},excludeIds:['qloo:excluded'],experience:{searchTags:[],notes:'Relaxed afternoon.'},...extra});
function discovery(tags=['cafe','restaurant']){return createDiscovery({provider:{name:'qloo',resolveArtist:async()=>null,resolveTasteTags:async()=>[],resolveExperienceTags:async()=>[],discover:async()=>[
 ['d-cafe','D Cafe (East Legon)',['cafe']],['thai','Thai House',['restaurant']],['vida','vida e caffè – Accra Mall',tags]
].map(([id,name,categories])=>({entity_id:id,name,tags:categories.map(tag=>({id:`urn:tag:category:qloo:${tag}`,name:tag})),properties:{address:'East Legon, Accra, Ghana',price_level:2}}))}});}
async function fixture(extra={}){
 const engine=discovery(),plan=await buildItinerary(engine,input(extra));
 // A valid option can have been surfaced under the old meal bucket. This is
 // exactly the distinction the selection contract previously could not express.
 const vida=plan.shortlist.find(choice=>choice.item.id==='qloo:vida');assert.ok(vida);
 plan.shortlist=plan.shortlist.filter(choice=>choice.item.id!=='qloo:vida');plan.shortlist.push({...vida,intent:'dinner'});
 return {engine,plan};
}
const selection=(extra={})=>({placeIds:route.map(stop=>stop.placeId),stopIntents:['coffee','coffee'],...extra});
async function interpret(plan,args=selection(),{name='select_places',mode='autopilot',message=editMessage,fetchImpl}={}){
 return createAgent({getKey:()=> 'synthetic-only',fetchImpl:fetchImpl||(async()=>tool(name,args))}).interpret({message,context:plan.request,planContext:agentPlanContext(plan),history:[{role:'user',text:initialMessage}],mode,locationContext:{confirmed:true,timeZone:'Africa/Accra'}});
}

test('exact two-cafe correction carries roles through agent, UI request, provider validation, schedule and comparison',async()=>{
 const {engine,plan}=await fixture(),before=JSON.stringify(plan);let payload;
 const action=await interpret(plan,selection(),{fetchImpl:async(_,options)=>{payload=JSON.parse(options.body);return tool('select_places',selection({message:'These are now booked for lunch.'}));}});
 const selected=payload.tools.find(t=>t.function.name==='select_places');assert.ok(selected.function.parameters.required.includes('stopIntents'));
 assert.deepEqual(action.route,route);assert.equal(action.assistantMessage,undefined);
 const next=parseItinerary(routeFromStops(plan,action.route,action.request));
 assert.deepEqual(next.activities,['coffee']);assert.deepEqual(next.stopIntents,['coffee','coffee']);assert.deepEqual(next.route,route);assert.deepEqual(next.pins,{});
 for(const key of ['people','party','date','timing','startTime','endTime','budget','excludeIds','experience'])assert.deepEqual(next[key],plan.request[key]);
 const result=await buildItinerary(engine,next);assert.equal(result.status,'complete');assert.equal(result.request.title,'Cafés in East Legon');
 assert.deepEqual(result.stops.map(s=>s.intent),['coffee','coffee']);assert.deepEqual(result.stops.map(s=>s.item.id),route.map(s=>s.placeId));assert.deepEqual(result.stops.map(s=>s.durationMinutes),[45,45]);
 assert.ok(result.stops.every(s=>s.item.reasons.some(r=>r.code==='intent_match')));assert.deepEqual(agentPlanContext(result).stops.map(s=>s.intent),['coffee','coffee']);
 assert.equal(JSON.stringify(plan),before);
});

test('ID-only model action repairs once instead of silently inheriting old roles',async()=>{
 const {plan}=await fixture();let calls=0,last;
 const result=await interpret(plan,undefined,{fetchImpl:async(_,options)=>{last=JSON.parse(options.body);return ++calls===1?tool('select_places',{placeIds:route.map(s=>s.placeId)}):tool('select_places',selection());}});
 assert.equal(calls,2);assert.match(last.messages[0].content,/Specify one requested visit role/);assert.deepEqual(result.route,route);
});

test('unchanged-role selection and existing UI selection retain the old categories without guessing a purpose',async()=>{
 const {plan}=await fixture();const action=await interpret(plan,selection({stopIntents:null}),{message:'Choose D Cafe then vida.'});
 assert.deepEqual(action.route.map(s=>s.intent),['coffee','dinner']);assert.deepEqual(routeFromChoices(plan,route.map(s=>s.placeId)).route,action.route);
});

for(const mode of ['autopilot','guided'])test(`${mode} exact selections apply day, time, budget and search edits atomically`,async()=>{
 const {plan}=await fixture();const changes={date:'2099-01-02',startTime:'14:00',endTime:'18:00',timePreference:'exact',timing:{dateConfirmed:true,timeConfirmed:true,mode:'flexible',window:'custom'},budget:120,experience:{searchTags:['v-cafe'],notes:'Two cafe stops only.'}};
 const action=await interpret(plan,selection({changes}),{mode});const next=routeFromStops(plan,action.route,action.request);
 for(const key of ['date','startTime','endTime','timing','budget','experience'])assert.deepEqual(next[key],changes[key],key);assert.deepEqual(next.route,route);assert.deepEqual(next.people,plan.request.people);
 const weekday=await interpret(plan,selection({changes:{weekday:'friday',timePreference:'afternoon'}}),{mode});assert.equal(new Date(weekday.request.date+'T12:00:00Z').getUTCDay(),5);assert.equal(weekday.request.startTime,'12:00');assert.equal(weekday.request.endTime,'17:00');
});

for(const source of ['custom','legacy'])test(`${source} names survive actual role changes without retaining an unwanted meal`,async()=>{
 const {plan,engine}=await fixture({title:'Cafés & A meal in East Legon',titleSource:source});const action=await interpret(plan),result=await buildItinerary(engine,parseItinerary(routeFromStops(plan,action.route,action.request)));
 assert.equal(result.request.title,plan.request.title);assert.equal(result.request.titleSource,source);assert.deepEqual(result.stops.map(s=>s.intent),['coffee','coffee']);
});

test('same selected venue supports separate requested roles and intentional return visits',async()=>{
 const {plan,engine}=await fixture();const action=await interpret(plan,{placeIds:['qloo:vida','qloo:vida','qloo:vida'],stopIntents:['coffee','dinner','coffee']});
 const result=await buildItinerary(engine,parseItinerary(routeFromStops(plan,action.route,action.request)));
 assert.deepEqual(result.stops.map(s=>s.item.id),['qloo:vida','qloo:vida','qloo:vida']);assert.deepEqual(result.stops.map(s=>s.intent),['coffee','dinner','coffee']);assert.equal(new Set(result.stops.map(s=>s.id)).size,3);
});

test('one-occurrence role edit preserves other visits, and null replacement preserves the visit role',async()=>{
 const {plan}=await fixture();const edit={operation:'replace',stopId:'stop-1',placeId:'qloo:vida',intent:'coffee',changes:{budget:80}};
 const action=await interpret(plan,edit,{name:'edit_stops'});assert.deepEqual(action.route,route);assert.equal(action.request.budget,80);
 const unchanged=await interpret(plan,{...edit,intent:null},{name:'edit_stops'});assert.deepEqual(unchanged.route.map(s=>s.intent),['coffee','dinner']);
 const inserted=await interpret(plan,{operation:'insert',placeId:'qloo:vida',afterStopId:null,intent:'coffee'},{name:'edit_stops'});assert.deepEqual(inserted.route.map(s=>s.intent),['coffee','coffee','dinner']);assert.deepEqual(inserted.route.map(s=>s.placeId),['qloo:vida','qloo:d-cafe','qloo:thai']);
});

test('requested role cannot fabricate provider support or bypass current hard constraints',async()=>{
 const {plan}=await fixture();const action=await interpret(plan);
 for(const [engine,changes,reason] of [[discovery(['restaurant']),{},'intent_not_supported'],[discovery(),{excludeIds:['qloo:vida']},'excluded_by_user'],[discovery(),{maxPriceLevel:1},'over_price_limit']]){
  const result=await buildItinerary(engine,parseItinerary({...routeFromStops(plan,action.route,action.request),...changes}));assert.equal(result.stops[1].item,null);assert.equal(result.stops[1].selectionEvidence.reason,reason);assert.equal(result.stops[1].intent,'coffee');assert.equal(result.stops.length,2);
 }
});

for(const invalid of [
 {stopIntents:['coffee']},{stopIntents:['coffee','cafe']},{stopIntents:[]},{stopIntents:'coffee'},
 {placeIds:['qloo:d-cafe','invented']},{placeIds:Array(4).fill('qloo:vida'),stopIntents:Array(4).fill('coffee')},
 {changes:{area:'Osu'}},{changes:{title:'Invented rename'}},{changes:{people:[]}},{changes:{activities:['dinner']}},{changes:null},
 {changes:{startTime:'12:00',endTime:'12:10'}},
])test(`invalid selected composition is rejected without a partial edit: ${JSON.stringify(invalid)}`,async()=>{
 const {plan}=await fixture(),before=JSON.stringify(plan);await assert.rejects(interpret(plan,selection(invalid)),e=>e.status===400);assert.equal(JSON.stringify(plan),before);
});

test('role-only changes stale booking review even if the selected ID and times remain unchanged',async()=>{
 const {plan}=await fixture();const entry={revision:1,plan};const selected=plan.stops[0];
 const created=bookingOperation(entry,'create',{planRevision:1,idempotencyKey:'create',stopId:selected.id,itemId:selected.item.id,entityId:selected.item.entityId,kind:'enquiry'}).booking;
 const ready=bookingOperation(entry,'handoff',{planRevision:1,idempotencyKey:'handoff',bookingVersion:created.bookingVersion,channel:'copy',reviewed:true},created.id).booking;
 const changed=structuredClone(plan);changed.stops[0].intent='activity';invalidateBookings(entry,changed);const stale=entry.bookingActions.records[0];
 assert.equal(stale.stale,true);assert.equal(stale.handoff,null);assert.equal(stale.submission.status,'not_submitted');assert.equal(stale.payment.status,'not_requested');assert.equal(stale.snapshot.intent,'coffee');
 assert.throws(()=>bookingOperation(entry,'handoff',{planRevision:1,idempotencyKey:'stale',bookingVersion:ready.bookingVersion,channel:'copy',reviewed:true},ready.id),e=>e.status===409);
 invalidateBookings(entry,plan);assert.equal(stale.stale,true);
});

// A contract assertion, not a claim that a language model follows every prompt.
test('both semantic selection tools can carry occurrence roles and simultaneous edits',()=>{
 for(const name of ['select_places','edit_stops']){const spec=CHAT_TOOLS.find(t=>t.function.name===name).function.parameters;assert.ok(spec.properties.changes.properties.date);assert.ok(spec.properties.changes.properties.timePreference);assert.equal(spec.properties.changes.properties.area,undefined);assert.equal(spec.properties.changes.properties.people,undefined);}
});

test('null role selection preserves every same-venue occurrence purpose rather than collapsing the option bucket',async()=>{
 const {plan,engine}=await fixture();const selected=await interpret(plan,{placeIds:['qloo:vida','qloo:vida','qloo:vida'],stopIntents:['coffee','dinner','coffee']});
 const repeated=await buildItinerary(engine,selected.request);const ids=repeated.stops.map(stop=>stop.item.id);
 const unchanged=await interpret(repeated,{placeIds:ids,stopIntents:null});assert.deepEqual(unchanged.route,selected.route);assert.deepEqual(routeFromChoices(repeated,ids).route,selected.route);
});
