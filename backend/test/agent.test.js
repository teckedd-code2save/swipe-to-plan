import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, PLAN_TOOL } from '../src/agent.js';
import { parseItinerary as parseBrief } from '../src/itinerary.js';
const parseItinerary=(body={})=>parseBrief({activities:['coffee','dinner'],...body});
import {conversationHistory} from '../../frontend/src/conversation.js';

const response = (name, args) => ({ ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }] }) });

test('action narration travels with a validated action but never becomes a planning or taste field',async()=>{
  const context=parseItinerary({people:[{id:'you',name:'You',artists:['Sade']}]});
  const message='One stop gives you room to catch up without rushing between places.';
  let payload;
  const invoke=(name,args)=>createAgent({getKey:()=> 'test',fetchImpl:async(_,options)=>{payload=JSON.parse(options.body);return response(name,args);}}).interpret({message:'Just one place to catch up',context});
  const result=await invoke('revise_day',{activities:['dinner'],message});
  assert.equal(result.assistantMessage,message);
  assert.deepEqual(result.request.people,context.people);
  assert.equal(result.request.message,undefined);assert.equal(result.request.assistantMessage,undefined);
  assert.equal(payload.tools.find(t=>t.function.name==='revise_day').function.parameters.properties.message.maxLength,600);
  assert.deepEqual(await invoke('show_ui',{panel:'location',message}),{status:'show_ui',panel:'location',assistantMessage:message});
  for(const invalid of ['',42,'x'.repeat(601)])await assert.rejects(invoke('revise_day',{activities:['dinner'],message:invalid}),e=>e.status===400);
  await assert.rejects(invoke('revise_day',{activities:['dinner'],message,quietnessVerified:true}),e=>e.status===400);
});

test('a concern can be answered without mutating the plan or fabricating another person’s tastes',async()=>{
  const context=parseItinerary({people:[{id:'you',name:'You'}]});
  const before=JSON.stringify(context);
  const text='Would finding somewhere to talk with your supervisor help, or would you prefer a break after the meeting?';
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('reply',{text})});
  assert.deepEqual(await agent.interpret({message:'I want to meet my supervisor',context,mode:'autopilot'}),{status:'reply',text});
  assert.equal(JSON.stringify(context),before);
});

test('conversation context keeps the original purpose and recent corrections within a bounded history',async()=>{
  const turns=Array.from({length:30},(_,i)=>({id:String(i),role:i%2?'assistant':'user',text:`Turn ${i}`,widget:'private UI state'}));
  turns[0].text='I need a break after a difficult week.';turns[29].text='Actually, just one stop and no music.';
  const history=conversationHistory(turns);
  assert.equal(history.length,16);assert.equal(history[0].text,turns[0].text);assert.equal(history.at(-1).text,turns.at(-1).text);
  assert.deepEqual(history.map(t=>t.text),[...turns.slice(0,4),...turns.slice(-12)].map(t=>t.text));
  assert.ok(history.every(t=>Object.keys(t).length===2));
  let received;
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async(_,options)=>{received=JSON.parse(options.body);return response('reply',{text:'We can keep it to one stop.'});}});
  await agent.interpret({message:'Yes',history});
  assert.deepEqual(JSON.parse(received.messages[1].content).history,history);
  await assert.rejects(agent.interpret({message:'Yes',history:[...history,history[0]]}),e=>e.status===400);
});

test('one invalid model action is repaired before execution without dropping the original request',async()=>{
  let calls=0,lastPayload;
  const context=parseItinerary({people:[{id:'you',name:'You'}]});
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async(_,options)=>{
    calls++;lastPayload=JSON.parse(options.body);
    return calls===1?response('revise_day',{unknownField:true}):response('revise_day',{activities:['coffee'],message:'One coffee stop keeps this simple.'});
  }});
  const result=await agent.interpret({message:'Just one coffee stop',context});
  assert.equal(calls,2);assert.deepEqual(result.request.activities,['coffee']);
  assert.deepEqual(result.request.people,context.people);
  assert.equal(JSON.parse(lastPayload.messages[1].content).message,'Just one coffee stop');
  assert.match(lastPayload.messages[0].content,/No action ran/);
  assert.ok(lastPayload.messages[0].content.includes('Unsupported keys: ["unknownField"]'));
  assert.match(lastPayload.messages[0].content,/Allowed keys:/);
  let rejected=0;
  const broken=createAgent({getKey:()=> 'test',fetchImpl:async()=>{rejected++;return response('revise_day',{unknownField:true});}});
  await assert.rejects(broken.interpret({message:'One stop',context}),e=>e.status===400);
  assert.equal(rejected,2);
});

test('conversational model text gets one chance to use the reply tool instead of being dropped',async()=>{
  let calls=0;
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>{
    calls++;
    return calls===1?{ok:true,json:async()=>({choices:[{message:{content:'Unstructured answer'}}]})}:response('reply',{text:'Would a short break or a change of scene help?'});
  }});
  assert.deepEqual(await agent.interpret({message:'This week has been tiring.'}),{status:'reply',text:'Would a short break or a change of scene help?'});
  assert.equal(calls,2);
});

test('person tools preserve spending tastes and validate conversational spending changes',async()=>{
  const context=parseItinerary({people:[{id:'sam',name:'Sam',artists:['Tems'],spending:{style:'mindful',priority:'dinner'}}]});
  const invoke=args=>createAgent({getKey:()=> 'test',fetchImpl:async()=>response('update_person',args)}).interpret({message:'Change my tastes',context});
  const unchanged=await invoke({id:'sam',name:'Sam',artists:['Sarkodie'],vibes:[]});assert.deepEqual(unchanged.person.spending,context.people[0].spending);
  const updated=await invoke({...context.people[0],spending:{style:'treat',priority:'coffee'}});assert.equal(updated.person.spending.priority,'coffee');
  await assert.rejects(invoke({...context.people[0],spending:{style:'unlimited'}}),e=>e.status===400);
});

test('a missing model key fails explicitly without an external call', async () => {
  const agent = createAgent({getKey:()=>'',fetchImpl:()=>assert.fail('Unexpected request')});
  assert.equal(agent.configured(),false);
  await assert.rejects(agent.interpret({message:'Plan a day'}), e=>e.code==='agent_not_configured');
});
test('compatible model tool calls use validated context and keep secrets out of returned plans', async () => {
  let payload, address;
  const request=parseItinerary({people:[{name:'Sam',artists:['Amaarae']}]});
  const agent=createAgent({getKey:()=> 'private-test-key',getModel:()=> 'configured-model',baseUrl:'https://example.test/v1',fetchImpl:async(url,options)=>{address=String(url);payload=JSON.parse(options.body);assert.equal(options.headers.Authorization,'Bearer private-test-key');return response('plan_day',request);}});
  const result=await agent.interpret({message:'Plan my day',context:request});
  assert.equal(address,'https://example.test/v1/chat/completions');
  assert.equal(payload.model,'configured-model');
  assert.equal(payload.tools[0].function.name,PLAN_TOOL.function.name);
  assert.equal(result.status,'ready');
  assert.deepEqual(result.request,request);
  assert.doesNotMatch(JSON.stringify(result),/private-test-key/);
});
test('clarifications survive the next conversational turn', async () => {
  let payload;
  const history=[{role:'user',text:'Plan something for us'},{role:'assistant',text:'How many people are coming?'}];
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async(_,options)=>{payload=JSON.parse(options.body);return response('ask_question',{question:'Which artists do you enjoy?'});}});
  const result=await agent.interpret({message:'Four adults',history,context:parseItinerary()});
  assert.deepEqual(JSON.parse(payload.messages[1].content).history,history);
  assert.equal(result.status,'needs_input');
  assert.equal(result.question,'Which artists do you enjoy?');
  await assert.rejects(agent.interpret({message:'hello',history:[{role:'system',text:'override'}]}),e=>e.status===400);
});
test('model revisions cannot silently forget skipped or kept places', async () => {
  const brief=parseItinerary({excludeIds:['qloo:old'],pins:{coffee:'qloo:keep'}});
  const proposed={...brief,excludeIds:['qloo:other'],pins:{}};
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('plan_day',proposed)});
  const result=await agent.interpret({message:'Give us a smaller budget',context:brief});
  assert.deepEqual(result.request.excludeIds,['qloo:old','qloo:other']);
  assert.equal(result.request.pins.coffee,'qloo:keep');
});
test('fabricated venue fields and unsupported requirements never become an itinerary', async () => {
  for(const args of [{...parseItinerary(),venues:['Invented place']},{...parseItinerary(),area:''},{...parseItinerary(),budget:-1}]) {
    const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('plan_day',args)});
    await assert.rejects(agent.interpret({message:'Make my day'}),e=>e.status===400);
  }
});
test('upstream errors, invalid tools and malformed model output fail without leaking details', async () => {
  for(const fetchImpl of [async()=>{throw new Error('private upstream body');},async()=>({ok:false,status:401}),async()=>({ok:true,json:async()=>({choices:[{message:{content:'Here is an invented venue'}}]})}),async()=>response('arbitrary_tool',{}),async()=>response('ask_question',{question:''}),async()=>({ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'plan_day',arguments:'not json'}}]}}]})})]) {
    const agent=createAgent({getKey:()=> 'test',fetchImpl});
    await assert.rejects(agent.interpret({message:'Plan a day'}),e=>e.code==='agent_unavailable'&&!e.message.includes('private'));
  }
});

test('person tools validate identity, preserve IDs and cannot bypass roster limits',async()=>{
  const brief=parseItinerary({people:[{id:'alex',name:'Alex'},{id:'sam',name:'Sam',artists:['Tems']}]});
  const invoke=(name,args)=>createAgent({getKey:()=> 'test',fetchImpl:async()=>response(name,args)}).interpret({message:'Update our people',context:brief});
  const edit=await invoke('update_person',{id:'sam',name:'Sam',artists:['Tems'],vibes:['v-cafe']});
  assert.equal(edit.status,'action');assert.equal(edit.person.id,'sam');assert.deepEqual(edit.person.vibes,['v-cafe']);
  assert.equal((await invoke('add_person',{name:'Ama',artists:[],vibes:[]})).action,'add_person');
  assert.equal((await invoke('remove_person',{id:'sam'})).personId,'sam');
  await assert.rejects(invoke('update_person',{id:'unknown',name:'Sam'}),e=>e.status===400);
  await assert.rejects(invoke('remove_person',{id:'alex'}),e=>e.status===400);
  await assert.rejects(invoke('add_person',{name:'Ama',venues:['invented']}),e=>e.status===400);
  await assert.rejects(invoke('plan_day',{...brief,people:[{name:'New group'}]}),e=>e.status===400);
});

test('a saved circle is addressed by ID without inventing or replacing its members',async()=>{
  let payload;
  const context=parseItinerary({people:[{id:'alex',name:'Alex',artists:['Amaarae']}]});
  const circles=[{id:'sunday',name:'Sunday people',people:[{id:'sam',name:'Sam',artists:['Tems'],vibes:[]}]}];
  const invoke=(args,input={})=>createAgent({getKey:()=> 'test',fetchImpl:async(_,options)=>{payload=JSON.parse(options.body);return response('bring_circle',args);}}).interpret({message:'Bring Sunday people',context,circles,...input});
  assert.equal((await invoke({circleId:'sunday'})).circleId,'sunday');
  assert.deepEqual(JSON.parse(payload.messages[1].content).circles,circles);
  assert.equal(payload.reasoning_effort,'minimal');
  await assert.rejects(invoke({circleId:'invented'}),e=>e.status===400);
  const full=parseItinerary({party:{adults:6},people:Array.from({length:6},(_,i)=>({id:`p${i}`,name:`Person ${i}`}))});
  await assert.rejects(invoke({circleId:'sunday'},{context:full}),e=>e.status===400);
});

test('small day revisions keep everyone’s tastes, exclusions and remaining pinned stops',async()=>{
  const context=parseItinerary({people:[{id:'alex',name:'Alex',artists:['Amaarae']},{id:'sam',name:'Sam',artists:['Tems']}],pins:{coffee:'qloo:keep'},excludeIds:['qloo:skip']});
  const invoke=args=>createAgent({getKey:()=> 'test',fetchImpl:async()=>response('revise_day',args)}).interpret({message:'Make our group allowance 500',context});
  const result=await invoke({budget:500});
  assert.deepEqual(result.request,{...context,budget:500});
  assert.deepEqual((await invoke({activities:['activity','dinner']})).request.pins,{});
  await assert.rejects(invoke({people:[]}),e=>e.status===400);
  await assert.rejects(invoke({budget:0}),e=>e.status===400);
  const family={...context,party:{adults:2,children:1}};
  const revised=await createAgent({getKey:()=> 'test',fetchImpl:async()=>response('revise_day',{party:{adults:3}})}).interpret({message:'Another adult is coming',context:family});
  assert.deepEqual(revised.request.party,{adults:3,children:1});
});

test('just one place removes other stops and pins while keeping people, preferences and budget',async()=>{
  const context=parseItinerary({people:[{id:'sam',name:'Sam',artists:['SZA'],vibes:['v-seafood'],spending:{style:'mindful',priority:'dinner'}}],pins:{coffee:'qloo:coffee',dinner:'qloo:meal'},excludeIds:['qloo:skip']});
  let sent;
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async(_,options)=>{sent=JSON.parse(options.body);return response('revise_day',{activities:['dinner']});}});
  const result=await agent.interpret({message:'we wanna visit just one place',context});
  assert.deepEqual(result.request.activities,['dinner']);assert.deepEqual(result.request.people,context.people);
  assert.equal(result.request.budget,context.budget);assert.deepEqual(result.request.excludeIds,context.excludeIds);assert.deepEqual(result.request.pins,{dinner:'qloo:meal'});
  assert.equal(sent.tools.find(t=>t.function.name==='revise_day').function.parameters.properties.activities.minItems,0);
});

test('interactive chat tools validate panels and participant IDs',async()=>{
  const context=parseItinerary({people:[{id:'sam',name:'Sam'}]});
  const invoke=args=>createAgent({getKey:()=> 'test',fetchImpl:async()=>response('show_ui',args)}).interpret({message:'Show Sam’s taste cards',context});
  assert.deepEqual(await invoke({panel:'tastes',personId:'sam'}),{status:'show_ui',panel:'tastes',personId:'sam'});
  for(const args of [{panel:'tastes',personId:'invented'},{panel:'email_everyone'},{panel:'share',personId:'sam'},{panel:'tastes',token:'secret'}])await assert.rejects(invoke(args),e=>e.status===400);
});

test('comparison panels ignore accidental taste changes without mutating the outing',async()=>{
  const context=parseItinerary({area:'Accra'}),before=JSON.stringify(context);
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('show_ui',{panel:'compare',changes:{activities:['drinks']}})});
  assert.deepEqual(await agent.interpret({message:'Compare these places',context}),{status:'show_ui',panel:'compare'});
  assert.equal(JSON.stringify(context),before);
});

test('replies receive bounded participant-to-preference evidence, with malformed context rejected before the model',async()=>{
  let payload,calls=0;
  const context=parseItinerary({people:[{id:'sam',name:'Sam',artists:['Tems']}]});
  const planContext={stops:[{id:'stop-0',intent:'coffee',name:'A café',connections:[{personId:'sam',kind:'search_signal',label:'Used in the search; individual contribution unavailable',preference:'Tems'}]}],warnings:['Opening hours are not verified.']};
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async(_,options)=>{calls++;payload=JSON.parse(options.body);return response('reply',{text:'Sam’s Tems preference was used in the search. We don’t have an individual contribution score for this stop.'});}});
  const result=await agent.interpret({message:'How did you consider Sam?',context,planContext});
  assert.equal(result.status,'reply');
  assert.deepEqual(JSON.parse(payload.messages[1].content).planContext,planContext);
  assert.match(payload.messages[0].content,/search_signal/);
  const invalid=[{circles:[{id:'x',name:'X',people:[{id:'sam',name:'Sam',apiKey:'private'}]}]},{circles:[{id:'x',name:'X',people:[]}]},{planContext:{...planContext,warnings:['x'.repeat(1001)]}},{planContext:{...planContext,stops:[{...planContext.stops[0],connections:[{personId:'unknown',kind:'search_signal',label:'used'}]}]}}];
  for(const extra of invalid)await assert.rejects(agent.interpret({message:'Hi',context,...extra}),e=>e.status===400);
  assert.equal(calls,1);
});

test('a practical-details request opens checks without inventing verification or reworking the plan',async()=>{
 const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('show_ui',{panel:'checks'})});
 const result=await agent.interpret({message:'Check hours and menus for this day',context:parseItinerary()});
 assert.deepEqual(result,{status:'show_ui',panel:'checks'});
});

test('signed-in additions use connected identities or prepare an invite; guest names stay simple',async()=>{
  const context=parseItinerary({people:[{id:'alex',name:'Alex'}]});
  const contacts=[{id:'sam',name:'Sam',artists:['Sade'],vibes:[]}];
  const invoke=(name,args,peopleMode='connected')=>createAgent({getKey:()=> 'test',fetchImpl:async()=>response(name,args)}).interpret({message:'Add Sam',context,contacts,peopleMode});
  const known=await invoke('add_saved_person',{personId:'sam'});assert.deepEqual(known.person,contacts[0]);
  const unknown=await invoke('add_person',{name:'Maya',artists:[],vibes:[]});assert.deepEqual(unknown,{status:'action',action:'invite_person',name:'Maya'});
  await assert.rejects(invoke('add_saved_person',{personId:'unknown'}),e=>e.status===400);
  assert.equal((await invoke('add_person',{name:'Maya',artists:[],vibes:[]},'guest')).action,'add_person');
});


test('an open draft stays undecided through location, timing and circle changes',async()=>{
  const draft={...parseBrief({people:[{id:'you',name:'You'}]}),area:''};
  const run=(name,args,context=draft,extras={})=>createAgent({getKey:()=> 'test',fetchImpl:async()=>response(name,args)}).interpret({message:'Plan an outing',context,...extras});
  const located=await run('set_location',{area:'Accra'});
  assert.deepEqual(located.request.activities,[]);
  const timed=await run('revise_day',{startTime:'14:00'},located.request);
  assert.equal(timed.action,'choose_activities');
  assert.deepEqual(timed.request.activities,[]);
  const circle=await run('bring_circle',{circleId:'friends'},draft,{circles:[{id:'friends',name:'Friends',people:[{id:'sam',name:'Sam'}]}]});
  assert.equal(circle.action,'bring_circle');
  const meal=await run('revise_day',{activities:['dinner']},located.request);
  assert.equal(meal.status,'ready');
  assert.deepEqual(meal.request.activities,['dinner']);
});

test('an additive food request keeps existing stops and explicit cuisine through revision',async()=>{
  const context=parseItinerary({area:'Kasoa, Ghana',title:'Coffee in Kasoa',activities:['coffee'],people:[{id:'owner',name:'Owner',artists:['SZA'],vibes:[]}]});
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('revise_day',{activities:['coffee','dinner'],experience:{cuisine:'Ghanaian',atmosphere:'romantic'}})});
  const result=await agent.interpret({message:'I want some local Ghanaian foods too, somewhere romantic',context});
  assert.equal(result.status,'ready');
  assert.deepEqual(result.request.activities,['coffee','dinner']);
  assert.equal(result.request.experience.cuisine,'Ghanaian');
  assert.equal(result.request.experience.atmosphere,'romantic');
  assert.deepEqual(result.request.people,context.people);
  assert.match(result.request.title,/Dinner/);
});
test('unrelated timing changes preserve stored cuisine requirements',async()=>{
  const context=parseItinerary({area:'Kasoa, Ghana',activities:['dinner'],experience:{cuisine:'Ghanaian'}});
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('revise_day',{timePreference:'evening'})});
  const result=await agent.interpret({message:'Make it this evening',context});
  assert.equal(result.request.experience.cuisine,'Ghanaian');
  assert.equal(result.request.startTime,'17:00');
  assert.equal(result.request.endTime,'22:00');
});


test('a Friday nightlife request recovers from unsupported activity synonyms into contextual swipes',async()=>{
  let calls=0;
  const context=parseBrief({area:'East Legon',activities:[],timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'}});
  const message='Friday drinks with friends, somewhere we can start talking then go somewhere livelier.';
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async(_,options)=>{
    calls++;
    if(calls===1)return response('show_ui',{panel:'tastes',focus:'request',cardIds:['v-bar'],changes:{activities:['cocktails','nightlife']}});
    assert.match(JSON.parse(options.body).messages[0].content,/Bars, cocktails and nightlife use drinks/);
    return response('show_ui',{panel:'tastes',focus:'request',cardIds:['v-bar','v-club'],changes:{activities:['drinks'],experience:{notes:message}}});
  }});
  const result=await agent.interpret({message,context,mode:'autopilot',locationContext:{confirmed:true}});
  assert.equal(calls,2);
  assert.deepEqual(result.request.activities,['drinks']);
  assert.equal(result.request.experience.notes,message);
  assert.equal(result.request.timing.timeConfirmed,false);
  assert.equal(result.request.budget,null);
  assert.deepEqual(result.request.people[0].vibes,[]);
  assert.deepEqual(result.cardIds,['v-bar','v-club']);
});

test('contextual swipe suggestions accompany planning without becoming votes or blocking discovery',async()=>{
  let payload;
  const context=parseBrief({activities:[],timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'}});
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async(_,options)=>{
    payload=JSON.parse(options.body);
    return response('autopilot_day',{cardIds:['v-bar','v-club'],changes:{activities:['drinks']},message:'Swipe what fits while I find places.'});
  }});
  const result=await agent.interpret({message:'Drinks with friends',context,mode:'autopilot',locationContext:{confirmed:true}});
  assert.deepEqual(result.tasteCards,['v-bar','v-club']);
  assert.deepEqual(result.request.people[0].vibes,[]);
  assert.equal(result.request.timing.dateConfirmed,false);
  assert.ok(payload.tools.find(t=>t.function.name==='autopilot_day').function.parameters.required.includes('cardIds'));
});

test('route problems open travel alternatives without changing the plan',async()=>{
  const context=parseItinerary({people:[{id:'you',name:'You'}],budget:500});
  const before=JSON.stringify(context);
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('show_ui',{panel:'routes',message:'Let’s compare other ways to get there.'})});
  const result=await agent.interpret({message:'Maps could not find transit directions',context});
  assert.equal(result.status,'show_ui');assert.equal(result.panel,'routes');assert.equal(JSON.stringify(context),before);
});

test('Autopilot can reference a current participant without requiring a saved contact or adding anyone',async()=>{
  let payload;
  const context=parseBrief({people:[{id:'current-you',name:'You'}],activities:[],timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'}});
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async(_,options)=>{
    payload=JSON.parse(options.body);
    return response('autopilot_day',{personIds:['current-you'],changes:{activities:['drinks']},cardIds:['v-bar']});
  }});
  const result=await agent.interpret({message:'Drinks with friends',context,mode:'autopilot',contacts:[],locationContext:{confirmed:true}});
  assert.deepEqual(result.request.people,context.people);
  const properties=payload.tools.find(t=>t.function.name==='autopilot_day').function.parameters.properties;
  assert.deepEqual(properties.personIds.items.enum,['current-you']);
  assert.equal(properties.circleId,undefined);
  assert.deepEqual(result.tasteCards,['v-bar']);
});

test('disclosed work and cultural interests travel with contextual cards without adding fake tastes',async()=>{
 const context=parseBrief({people:[{id:'you',name:'You'}],activities:[],timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'}});
 const audience='urn:audience:professional_area:medical_professional';
 let payload;
 const agent=createAgent({getKey:()=> 'test',fetchImpl:async(_,options)=>{payload=JSON.parse(options.body);return response('autopilot_day',{changes:{activities:['activity']},tasteUpdates:[{id:'you',context:{role:'Doctor',roleQuote:'a doctor',audiences:[audience],interests:[{type:'book',name:'Dune',quote:'love Dune'}]}}],cardIds:['v-nature']});}});
 const result=await agent.interpret({message:'I am a doctor and love Dune. Find somewhere to unwind.',context,mode:'autopilot',audienceCatalog:[{id:audience,name:'Medical Professional'}]});
 assert.equal(result.request.people[0].context.role,'Doctor');assert.deepEqual(result.request.people[0].vibes,[]);
 assert.deepEqual(result.tasteCards,['v-nature']);
 const input=JSON.parse(payload.messages[1].content);assert.equal(input.audienceCatalog[0].id,audience);assert.equal(input.contextResearch.length,3);
});

test('semantic context review keeps approved cultural entities and rejects unrelated professional cohorts',async()=>{
 const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('review_context',{people:[{id:'you',audiences:['urn:audience:leisure:museums'],interestIndexes:[],vibes:[]}]})});
 const result={status:'autopilot',request:{people:[{id:'you',artists:[],vibes:['v-cafe'],context:{role:'Research student',audiences:['urn:audience:professional_area:business_professional','urn:audience:leisure:museums'],interests:[{type:'destination',name:'hiking'}]}}]}};
 const reviewed=await agent.auditContext(result,{message:'I am a research student who likes museums',context:{people:[{id:'you',artists:[],vibes:[]}]},audienceCatalog:[]});
 assert.deepEqual(reviewed.request.people[0].context.audiences,['urn:audience:leisure:museums']);assert.deepEqual(reviewed.request.people[0].context.interests,[]);assert.deepEqual(reviewed.request.people[0].vibes,[]);
});

test('weekday tool values are computed in code and cannot retain a wrong placeholder date',async()=>{
 const {localNow,nextWeekdayDate}=await import('../src/scheduling.js');
 const context=parseBrief({date:'2026-01-01',people:[{id:'you',name:'You'}],activities:[],timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'}});
 const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('autopilot_day',{changes:{weekday:'friday',date:'2026-01-01',activities:['drinks'],timePreference:'evening'}})});
 const result=await agent.interpret({message:'This Friday after work',context,mode:'autopilot',locationContext:{confirmed:true,timeZone:'Africa/Accra'}});
 assert.equal(result.request.date,nextWeekdayDate(localNow('Africa/Accra').date,'friday'));assert.equal(result.request.timing.dateConfirmed,true);assert.equal(result.request.weekday,undefined);
});

test('a new date confirmation without a concrete date repairs instead of scheduling a placeholder',async()=>{
 const context=parseBrief({people:[{id:'you',name:'You'}],activities:[],timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'}});
 let calls=0;
 const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('autopilot_day',{changes:++calls===1?{activities:['drinks'],timing:{dateConfirmed:true,timeConfirmed:true,mode:'flexible'}}:{weekday:'friday',activities:['drinks'],timePreference:'evening'}})});
 const result=await agent.interpret({message:'This Friday after work',context,mode:'autopilot',locationContext:{confirmed:true,timeZone:'Africa/Accra'}});
 assert.equal(calls,2);assert.equal(new Date(result.request.date+'T12:00:00Z').getUTCDay(),5);
});

test('a new open request starts discovery with contextual card copy, without waiting for a card or budget',async()=>{
 const context=parseBrief({people:[{id:'you',name:'You',vibes:['v-bar']}],activities:[],budget:null,timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'}});
 const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('autopilot_day',{changes:{activities:['activity'],experience:{explore:true,notes:'Unwind after work'}},cardIds:['v-nature'],cardPrompts:[{id:'v-nature',label:'A little room to breathe?',sub:'Try an outdoor pause after work.'}]})});
 const result=await agent.interpret({message:'I need to unwind after work',context,mode:'autopilot',locationContext:{confirmed:true}});
 assert.equal(result.status,'autopilot');assert.equal(result.request.budget,null);assert.equal(result.request.experience.explore,true);assert.equal(result.cardPrompts[0].label,'A little room to breathe?');assert.deepEqual(result.request.people[0].vibes,['v-bar']);
});

test('an area in the first prompt survives interpretation before location confirmation',async()=>{
 const context=parseBrief({area:'',people:[{id:'you',name:'You'}],activities:[],timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'}},{allowMissingLocation:true});
 let received;
 const agent=createAgent({getKey:()=> 'test',fetchImpl:async(_,options)=>{received={message:JSON.parse(options.body).messages.at(-1).content};return response('set_location',{area:'East Legon, Accra, Ghana'});}});
 const result=await agent.interpret({message:'Find somewhere in East Legon to unwind',context,locationContext:{confirmed:false}});
 assert.equal(received.message,'Find somewhere in East Legon to unwind');
 assert.equal(result.action,'set_location');assert.equal(result.query,'East Legon, Accra, Ghana');
});

test('London correction is the latest user turn and preserves ten-person outing details',async()=>{
  const history=[{role:'user',text:'We want an puting for 10 pwoplw fdiday migh'},{role:'assistant',text:'Where in Accra would you like to plan this Friday night outing for 10 people?'},{role:'user',text:'No london'},{role:'assistant',text:'Which neighborhood in Accra would you like?'}];
  let payload;
  const context=parseBrief({area:'',party:{adults:1,children:0}},{allowMissingLocation:true});
  const agent=createAgent({getKey:()=> 'test',fetchImpl:async(_,options)=>{payload=JSON.parse(options.body);return response('autopilot_day',{changes:{area:'London, United Kingdom',party:{adults:10,children:0},weekday:'friday',timePreference:'evening',activities:['activity']},message:'Finding options for your Friday night outing in London.'});}});
  const result=await agent.interpret({message:'Londom',context,history,mode:'autopilot',locationContext:{confirmed:false}});
  assert.deepEqual(payload.messages.slice(-5),[...history.map(t=>({role:t.role,content:t.text})),{role:'user',content:'Londom'}]);
  assert.equal(result.request.area,'London, United Kingdom');
  assert.equal(result.request.party.adults,10);
  assert.equal(result.request.people.length,1);
  assert.equal(result.needsLocation,true);
  assert.equal(new Date(result.request.date+'T12:00:00Z').getUTCDay(),5);
});

test('larger headcount is independent of taste profiles and still validates whole numbers',()=>{
  for(const adults of [10,25,100]) assert.equal(parseBrief({party:{adults,children:10}}).party.adults,adults);
  for(const adults of [0,1.5,101]) assert.throws(()=>parseBrief({party:{adults,children:0}}),/Adults must/);
});

test('a requested outing routes missing location to its picker while retaining headcount and weekday',async()=>{
 const context=parseBrief({area:'',timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'}},{allowMissingLocation:true});
 const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('ask_question',{question:'Where and what kind of outing?',topic:'location',outingRequested:true,changes:{party:{adults:10,children:0},weekday:'friday'}})});
 const result=await agent.interpret({message:'Outing for ten Friday',context,mode:'autopilot',locationContext:{confirmed:false}});
 assert.equal(result.status,'autopilot');assert.equal(result.needsLocation,true);assert.equal(result.request.party.adults,10);assert.equal(result.request.area,'');assert.equal(new Date(result.request.date+'T12:00:00Z').getUTCDay(),5);
});
test('a concern without an outing request still receives a conversational question',async()=>{
 const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('ask_question',{question:'Would a change of scene help?',topic:'experience',outingRequested:false,changes:{}})});
 const result=await agent.interpret({message:'I am struggling with my research',mode:'autopilot'});
 assert.equal(result.status,'needs_input');assert.equal(result.request,undefined);
});


test('unsupported optional taste suggestions cannot block a valid family outing',async()=>{
 const context=parseBrief({area:'London',people:[{id:'you',name:'You',vibes:[]}],activities:[],timing:{dateConfirmed:false,timeConfirmed:false,mode:'flexible'}});
 let calls=0;
 const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>{calls++;return response('autopilot_day',{changes:{activities:['activity'],party:{adults:2,children:2},budget:60,currency:'GBP',experience:{searchTags:['v-cinema']}},cardIds:['v-invented-family','v-cinema'],cardPrompts:[{id:'v-invented-family',label:'Play together',sub:'Invented optional card.'}]});}});
 const result=await agent.interpret({message:'Cinema for two adults and two children, 60 pounds total',context,mode:'autopilot',locationContext:{confirmed:true}});
 assert.equal(calls,1);assert.equal(result.status,'autopilot');assert.deepEqual(result.tasteCards,['v-cinema']);assert.deepEqual(result.request.party,{adults:2,children:2});assert.equal(result.request.budget,60);assert.deepEqual(result.request.people[0].vibes,[]);
});

test('post-discovery choice uses existing option IDs and preserves planning context',async()=>{
 const context=parseItinerary({people:[{id:'you',name:'You'}],budget:350});
 let payload;
 const planContext={stops:[],options:[{id:'real-one',intent:'dinner',name:'One',connections:[],practical:'Provider menu highlights, no prices'},{id:'real-two',intent:'drinks',name:'Two',connections:[]}],warnings:[]};
 const invoke=ids=>createAgent({getKey:()=> 'test',fetchImpl:async(_,opts)=>{payload=JSON.parse(opts.body);return response('select_places',{placeIds:ids});}}).interpret({message:'Go with the second one',context,planContext,mode:'autopilot'});
 assert.deepEqual(await invoke(['real-two']),{status:'action',action:'select_places',placeIds:['real-two']});
 assert.equal(context.budget,350);
 assert(payload.tools.some(t=>t.function.name==='select_places'));
 const sent=JSON.parse(payload.messages.find(m=>m.role==='user').content);
 assert.equal(sent.planContext.options.length,2);
 await assert.rejects(invoke(['invented']),e=>e.status===400);
 await assert.rejects(invoke(['real-one','real-one']),e=>e.status===400);
});
test('explicit comparison permits only a reply and keeps the existing plan unchanged',async()=>{
 const context=parseItinerary({area:'Accra'}),before=JSON.stringify(context);
 const planContext={stops:[],options:[{id:'a',intent:'dinner',name:'A',connections:[],practical:'{"menu":["Rice"]}'}],warnings:[]};
 let sent;const agent=createAgent({getKey:()=> 'test',fetchImpl:async(_,options)=>{sent=JSON.parse(options.body);return response('reply',{text:'A has rice; check its current price.'});}});
 const result=await agent.interpret({message:'Help me compare',context,planContext,task:'compare',mode:'autopilot'});
 assert.equal(result.status,'reply');assert.deepEqual(sent.tools.map(t=>t.function.name),['reply']);assert.equal(sent.tool_choice.function.name,'reply');assert.equal(JSON.stringify(context),before);
 await assert.rejects(agent.interpret({message:'Compare',context,task:'compare'}),e=>e.status===400);
 const wrong=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('show_ui',{panel:'compare'})});
 await assert.rejects(wrong.interpret({message:'Compare',context,planContext,task:'compare'}));
});
test('comparison retries a different weekday and uses the confirmed outing date',async()=>{
 const context=parseItinerary({area:'Accra',date:'2026-10-29',timing:{dateConfirmed:true,timeConfirmed:true,mode:'fixed'}});
 const planContext={stops:[],options:[{id:'a',intent:'dinner',name:'Restaurant A',connections:[],practical:'{}'}],warnings:[]};
 let calls=0;const agent=createAgent({getKey:()=> 'test',fetchImpl:async()=>response('reply',{text:++calls===1?'Restaurant A is open Friday.':'Restaurant A reports hours for Thursday; confirm with them.'})});
 const result=await agent.interpret({message:'Compare these',context,planContext,task:'compare'});
 assert.equal(calls,2);assert.match(result.text,/Thursday/);
});
