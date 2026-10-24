import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, PLAN_TOOL } from '../src/agent.js';
import { parseItinerary } from '../src/itinerary.js';

const response = (name, args) => ({ ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }] }) });

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
  assert.equal(sent.tools.find(t=>t.function.name==='revise_day').function.parameters.properties.activities.minItems,1);
});

test('interactive chat tools validate panels and participant IDs',async()=>{
  const context=parseItinerary({people:[{id:'sam',name:'Sam'}]});
  const invoke=args=>createAgent({getKey:()=> 'test',fetchImpl:async()=>response('show_ui',args)}).interpret({message:'Show Sam’s taste cards',context});
  assert.deepEqual(await invoke({panel:'tastes',personId:'sam'}),{status:'show_ui',panel:'tastes',personId:'sam'});
  for(const args of [{panel:'tastes',personId:'invented'},{panel:'email_everyone'},{panel:'share',personId:'sam'},{panel:'tastes',token:'secret'}])await assert.rejects(invoke(args),e=>e.status===400);
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
