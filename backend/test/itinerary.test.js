import test from 'node:test';
import assert from 'node:assert/strict';
import { parseItinerary as parseBrief, buildItinerary, makeSchedule, allocateBudget } from '../src/itinerary.js';
import { createDiscovery } from '../src/plan.js';
import { selectStops, parseOutingRequest, buildOuting } from '../src/outing.js';

// These fixtures test selection/evidence, not whether today's start is past.
const parseItinerary=(body={})=>parseBrief({date:'2099-01-01',activities:['coffee','dinner'],...body});
const venue = (id, tags, contributions = []) => ({ entity_id: id, name: `Place ${id}`, tags: tags.map(tag => ({ id: `urn:tag:category:qloo:${tag}`, name: tag })), properties: { address: 'Osu, Accra, Ghana', price_level: 2 }, query: { explainability: { 'signal.interests.entities': contributions } } });
function engine(places, resolveArtist = async name => name === 'Missing' ? { status: 'unresolved', reason: 'no_exact_artist_match' } : { status: 'resolved', entityId: name.toLowerCase(), name }) {
  return createDiscovery({ provider: { name: 'qloo', resolveArtist, discover: async () => structuredClone(places) } });
}

test('one-place plans have one allowance, no between-stop travel and working destination directions',async()=>{
  for(const [intent,tag] of [['coffee','cafe'],['dinner','restaurant'],['activity','museum'],['drinks','bar']]){
    const request=parseItinerary({activities:[intent],startTime:'12:00',endTime:'13:30',people:[{id:'sam',name:'Sam',spending:{style:'mindful',priority:'dinner'}}]});
    const plan=await buildItinerary(engine([venue('one',[tag])]),request);
    assert.equal(plan.status,'complete');assert.equal(plan.stops.length,1);assert.equal(plan.stops[0].bufferAfterMinutes,0);
    assert.equal(plan.budget.allocations.length,1);assert.equal(plan.budget.allocations[0].amount+plan.budget.reserve+plan.budget.transport,request.budget);
    const directions=new URL(plan.links.directions);assert.ok(directions.searchParams.get('destination'));assert.equal(directions.searchParams.has('origin'),false);assert.equal(directions.searchParams.has('waypoints'),false);
    assert.equal(plan.tasteMap.nodes.filter(n=>n.kind==='stop').length,1);
  }
  assert.throws(()=>parseItinerary({activities:['dinner'],startTime:'12:00',endTime:'12:30'}),/not enough time/);
  const empty=await buildItinerary(engine([]),parseItinerary({activities:['dinner']}));assert.equal(empty.status,'partial');assert.equal(empty.links.directions,null);
});

test('bounded distinct assignment does not spend a flexible venue on the wrong slot', () => {
  const flexible = { id: 'both', score: 1 }, coffee = { id: 'coffee', score: .8 };
  assert.deepEqual(selectStops([[flexible, coffee], [flexible]]).map(x => x.id), ['coffee', 'both']);
  assert.equal(selectStops([[flexible], [flexible]]).filter(Boolean).length, 1);
});
test('schedule fits compressed windows with real minimum durations and buffers', () => {
  const r = parseItinerary({ startTime: '11:00', endTime: '13:00', activities: ['coffee', 'dinner'] });
  const slots = makeSchedule(r);
  assert.equal(slots[0].start, '11:00');
  assert.ok(slots[0].durationMinutes >= 30 && slots[1].durationMinutes >= 45);
  assert.ok(slots[1].end <= '13:00');
  assert.equal(slots[0].bufferAfterMinutes, 30);
  assert.throws(() => parseItinerary({ startTime: '11:00', endTime: '12:00' }), /not enough time/);
});
test('budget allocations add up exactly and never claim quoted prices', () => {
  for (const budget of [50, 51, 799, 100000]) {
    const r = parseItinerary({ budget, activities: ['coffee', 'activity', 'dinner'] });
    const b = allocateBudget(r, ['coffee', 'dinner']);
    assert.equal(b.allocations.reduce((sum, a) => sum + a.amount, b.reserve + b.transport), budget);
    assert.equal(b.allocations[1].assigned, false);
    assert.equal(b.quotedTotal, null);
    assert.equal(b.basis, 'spending_allowances');
  }
});
test('spending tastes change reserves and priorities without raising the group budget',()=>{
  const person=(id,style,priority)=>({id,name:id,spending:{style,priority}});
  const budget=people=>allocateBudget(parseItinerary({people,party:{adults:people.length},budget:801}),['coffee','dinner']);
  const balanced=budget([person('Alex','balanced','even')]);
  const mindful=budget([person('Alex','mindful','even')]),treat=budget([person('Alex','treat','even')]);
  assert.ok(mindful.reserve>balanced.reserve&&balanced.reserve>treat.reserve);
  const coffee=budget([person('Alex','balanced','coffee')]);assert.ok(coffee.allocations[0].amount>balanced.allocations[0].amount);
  const group=budget([person('Alex','mindful','coffee'),person('Sam','treat','dinner')]);
  assert.equal(group.reserve,Math.round(801*.125));assert.equal(group.influences[1].personId,'Sam');assert.equal(group.quotedTotal,null);
  for(const b of [balanced,mindful,treat,coffee,group])assert.equal(b.allocations.reduce((n,a)=>n+a.amount,b.transport+b.reserve),801);
  assert.deepEqual(budget([person('Alex','balanced','activity')]).allocations,balanced.allocations);
  for(const spending of [{style:'rich'},{priority:'flight'},{style:'mindful',actualPrice:20},null])assert.throws(()=>parseItinerary({people:[{name:'Sam',spending}]}),e=>e.status===400);
});
test('malformed locations, dates, ambiguous activities and invalid family briefs fail before search', () => {
  for (const r of [{ area: '' }, { date: '2026-02-30' }, { budget: 0 }, { date: null }, { endTime: '25:00' }, { startTime: '22:00', endTime: '01:00' }, { activities: ['coffee', 'coffee'] }, { activities: ['coffee','activity','dinner','drinks'] }, { party: { children: 1 }, activities: ['dinner', 'drinks'] }, { pins: { coffee: 'a', dinner: 'a' } }, { accessible: true }, { people: [{ name: 'Sam', artists: ['a','b','c','d','e','f','g'] }] }, { party: { adults: 1 }, people: [{ name: 'a' }, { name: 'b' }] }]) assert.throws(() => parseItinerary(r), e => e.status === 400);
});
test('itinerary uses Qloo contributions per person and per entity; inputs are not invented evidence', async () => {
  const cafe = venue('cafe', ['cafe'], [{ entity_id: 'amaarae', score: .72 }, { entity_id: 'unrelated', score: 1 }]);
  const meal = venue('meal', ['restaurant', 'african'], [{ entity_id: 'tems', score: .8 }]);
  const r = parseItinerary({ people: [{ name: 'Sam', artists: ['Amaarae', 'Missing'], vibes: ['v-cafe'] }, { name: 'Sam', artists: ['Tems'], vibes: ['v-african'] }] });
  const output = await buildItinerary(engine([cafe, meal]), r);
  assert.equal(output.status, 'complete');
  const edges = output.tasteMap.edges.filter(e => e.kind !== 'preference');
  assert.equal(edges.find(e => e.from === 'person-0-artist-0' && e.to === 'stop-0').contribution, .72);
  assert.equal(edges.find(e => e.from === 'person-1-artist-0' && e.to === 'stop-1').contribution, .8);
  assert.equal(edges.find(e => e.from === 'person-0-artist-0' && e.to === 'stop-1').kind, 'search_signal');
  assert.ok(!edges.some(e => e.from === 'person-0-artist-1'));
  assert.equal(edges.find(e => e.from === 'person-0-vibe-0' && e.to === 'stop-0').kind, 'tag_match');
  assert.ok(!edges.some(e => e.from === 'person-0-vibe-0' && e.to === 'stop-1'));
  assert.ok(output.warnings.some(w => w.includes('Missing')));
  assert.equal(output.people[0].name, output.people[1].name);
  assert.notEqual(output.people[0].id, output.people[1].id);
  assert.equal(output.links.directions.startsWith('https://www.google.com/maps/dir/'), true);
  assert.ok(output.checks.some(c => c.label === 'Opening hours' && c.status === 'unverified'));
});
test('a member cannot inherit evidence from another member’s Qloo result', async () => {
  const discovery = createDiscovery({ provider: { name: 'qloo', resolveArtist: async name => ({ status: 'resolved', name, entityId: name }), discover: async ({signalIds}) => [venue('cafe', ['cafe'], [{ entity_id: signalIds[0], score: .5 }]), venue('meal', ['restaurant'])] } });
  const output = await buildItinerary(discovery, parseItinerary({ people: [{name:'A',artists:['a']},{name:'B',artists:['b']}] }));
  const edges = output.tasteMap.edges.filter(e => e.kind === 'affinity');
  assert.deepEqual(edges.map(e => [e.personId,e.evidence[0].entityId]), [['person-0','a'],['person-1','b']]);
});
test('food and activity tastes make per-person evidence paths only from relevant place tags',async()=>{
  const restaurant=venue('seafood',['restaurant','seafood']);
  const gallery=venue('gallery',['art_gallery']);
  gallery.tags.push({id:'urn:tag:nearby_attraction:qloo:seafood',name:'Nearby seafood'});
  const result=await buildItinerary(engine([restaurant,gallery]),parseItinerary({activities:['activity','dinner'],people:[{id:'sam',name:'Sam',vibes:['v-art','v-seafood']}]}));
  const matches=result.tasteMap.edges.filter(e=>e.kind==='tag_match');
  assert.equal(matches.length,2);assert.equal(matches.find(e=>e.to==='stop-0').from,'sam-vibe-0');assert.equal(matches.find(e=>e.to==='stop-1').from,'sam-vibe-1');assert.ok(matches.every(e=>e.personId==='sam'));
});
test('empty taste profiles do not overpower explicit preferences or borrow their evidence',async()=>{
  let calls=0;const discovery=createDiscovery({provider:{name:'qloo',resolveArtist:async name=>({status:'resolved',entityId:'sza',name}),discover:async({signalIds})=>{calls++;assert.deepEqual(signalIds,['sza']);return [venue('italian',['restaurant','italian'],[{entity_id:'sza',score:.8}])];}}});
  const result=await buildItinerary(discovery,parseItinerary({activities:['dinner'],people:[{id:'host',name:'Alex'},{id:'sam',name:'Sam',artists:['SZA'],vibes:['v-italian']}]}));
  assert.equal(calls,1);assert.equal(result.status,'complete');assert.equal(result.request.people.length,2);
  assert.ok(result.stops[0].connections.every(e=>e.personId==='sam'));assert.equal(result.budget.influences.length,2);
});

test('a swap keeps the other stops and reports an unfilled slot when no replacement exists', async () => {
  const d = engine([venue('cafe1', ['cafe']), venue('cafe2', ['cafe']), venue('meal', ['restaurant'])]);
  const first = await buildItinerary(d, parseItinerary());
  const next = await buildItinerary(d, parseItinerary({ ...first.request, pins: { dinner: 'qloo:meal' }, excludeIds: [first.stops[0].item.id] }));
  assert.notEqual(first.stops[0].item.id, next.stops[0].item.id);
  assert.equal(next.stops[1].item.id, first.stops[1].item.id);
  const empty = await buildItinerary(d, parseItinerary({ ...next.request, excludeIds: ['qloo:cafe1', 'qloo:cafe2'] }));
  assert.equal(empty.status, 'partial');
  assert.equal(empty.stops[0].item, null);
  assert.equal(empty.stops[1].item.id, 'qloo:meal');
  assert.equal(empty.budget.allocations[0].assigned, false);
});
test('family activity needs venue evidence and excludes nightlife without claiming child suitability', async () => {
  const nightlife = venue('bad', ['cafe', 'nightclub']);
  const interestOnly = venue('fake-park', []); interestOnly.tags = [{id:'urn:tag:interests:qloo:park'}];
  const d = engine([nightlife, interestOnly, venue('cafe', ['cafe']), venue('park', ['park']), venue('meal', ['restaurant'])]);
  const output = await buildItinerary(d, parseItinerary({ party: {children:1},activities:['coffee','activity','dinner'] }));
  assert.equal(output.status, 'complete');
  assert.deepEqual(output.stops.map(s => s.item.entityId), ['cafe','park','meal']);
  assert.ok(output.checks.some(c => c.label === 'Child suitability' && c.status === 'unverified'));
});
test('typed plans make no model call and retrieve once per identical taste query', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected network call'));
  let count = 0;
  const d = createDiscovery({ provider: { name: 'qloo', discover: async () => { count++; return [venue('c', ['cafe']), venue('m', ['restaurant'])]; } } });
  const first = await buildItinerary(d, parseItinerary());
  assert.equal(count, 1);
  await buildItinerary(d, parseItinerary({...first.request,budget:500}));
  assert.equal(count, 1);
});
test('legacy outings also preserve pinned stops and distinct assignments', async () => {
  const output = await buildOuting(engine([venue('a',['cafe','restaurant']),venue('b',['cafe'])]), parseOutingRequest({stops:[{intent:'coffee'},{intent:'dinner',pinnedId:'qloo:a'}]}));
  assert.equal(output.status,'complete');
  assert.deepEqual(output.stops.map(s=>s.item.id),['qloo:b','qloo:a']);
  assert.throws(()=>parseOutingRequest({stops:[{intent:'coffee'},{intent:'coffee'}]}),/once/);
});


test('undecided activities never invent coffee or query places', async () => {
  for(const body of [{},{party:{children:1}},{activities:[]}]) {
    const draft=parseBrief(body);
    assert.deepEqual(draft.activities,[]);
    await assert.rejects(buildItinerary({byIntents:()=>assert.fail('No discovery before an activity choice')},draft),/Choose what/);
  }
});

test('new plans use activity-specific names and reject explicit unset budgets',()=>{
  assert.throws(()=>parseItinerary({area:'Accra',budget:null,activities:['dinner']}),/Group budget/);
  const dinner=parseItinerary({area:'Accra',budget:600,activities:['dinner'],title:''});
  const coffee=parseItinerary({area:'Accra',budget:600,activities:['coffee'],title:''});
  assert.match(dinner.title,/Dinner/);
  assert.match(coffee.title,/Coffee/);
  assert.notEqual(dinner.title,coffee.title);
});
