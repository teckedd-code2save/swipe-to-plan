import test, { after, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const london = { id: 'london', name: 'London', label: 'London, United Kingdom', currency: 'GBP', timeZone: 'Europe/London' };
const paris = { id: 'paris', name: 'Paris', label: 'Paris, France', currency: 'EUR', timeZone: 'Europe/Paris' };
const profile = { id: 'test-user', name: 'Test person', artists: ['SZA'], vibes: ['v-nature'] };
const fresh = () => ({ title: '', area: '', date: '2026-11-07', timing: { dateConfirmed: false, timeConfirmed: false, mode: 'flexible' }, party: { adults: 1, children: 0 }, people: [profile], budget: null, currency: 'USD', currencyMode: 'custom', startTime: '09:00', endTime: '21:00', pace: 'easy', activities: [], pins: {}, excludeIds: [] });
let PlannerApp, createRoot, bundleDir, dom, root, state;
const originalFetch = globalThis.fetch;

before(async () => {
  setupDom();
  ({ createRoot } = await import('react-dom/client'));
  // Compile the actual app, not a duplicate of its state logic. Keep React shared
  // with the renderer and discard CSS because these are behavior, not layout tests.
  const frontend = fileURLToPath(new URL('..', import.meta.url));
  bundleDir = await mkdtemp(join(frontend, 'node_modules/.location-test-'));
  const outfile = join(bundleDir, 'planner.mjs');
  await build({ entryPoints: [join(frontend, 'src/PlannerApp.jsx')], outfile, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' } });
  PlannerApp = (await import(pathToFileURL(outfile).href)).default;
});

after(async () => { globalThis.fetch = originalFetch; await rm(bundleDir, { recursive: true, force: true }); });

function setupDom() {
  dom?.window.close();
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'location', 'history', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLDialogElement', 'Element', 'Node', 'MutationObserver', 'Event', 'MouseEvent', 'navigator']) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], writable: true, configurable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = callback => { callback(); return 0; };
  globalThis.cancelAnimationFrame = () => {};
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  HTMLElement.prototype.scrollTo = HTMLElement.prototype.scrollIntoView = () => {};
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
}

beforeEach(() => {
  setupDom();
  state = { user: null, requests: [], writes: 0, accountGate: null, accountError: false, shared: null, savedPlan: null };
  localStorage.setItem('unstressed.guest-profile.v1', JSON.stringify({ artists: ['Sarkodie'], vibes: ['v-nature'] }));
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input, location.origin), data = options.body ? JSON.parse(options.body) : {};
    let result = {};
    if (url.pathname === '/api/account') {
      if (state.accountError) throw new Error('Synthetic account lookup failure');
      if (state.accountGate) await state.accountGate;
      result = { user: state.user, circles: [], configured: true };
    } else if (url.pathname === '/api/account/planning-location') {
      state.writes++;
      const areas = data.removeLocationId ? state.user.planningLocations.filter(area => area.id !== data.removeLocationId)
        : [[london, paris].find(area => area.id === data.locationId), ...state.user.planningLocations.filter(area => area.id !== data.locationId)];
      state.user = { ...state.user, planningLocations: areas, planningLocation: areas[0] || null };
      result = { user: state.user };
    } else if (url.pathname === '/api/health') result = { agentConfigured: true };
    else if (url.pathname === '/api/deck') result = [];
    else if (url.pathname === '/api/locations') result = { locations: [london, paris].filter(area => area.name.toLowerCase().includes(url.searchParams.get('q').toLowerCase())) };
    else if (url.pathname === '/api/locations/suggest') result = { locations: [] };
    else if (url.pathname === '/api/account/plans' || url.pathname === '/api/account/circle-plans') result = { plans: [] };
    else if (url.pathname === '/api/account/plans/saved-day') result = state.savedPlan;
    else if (url.pathname.startsWith('/api/days/')) result = state.shared;
    else if (url.pathname === '/api/agent') { state.requests.push(data); result = { status: 'reply', text: 'Synthetic test response.' }; }
    return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
  };
});

afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; dom.window.close(); });

function account(preferred = null) { state.user = { id: profile.id, email: 'test@example.invalid', profile, planningLocation: preferred, planningLocations: preferred ? [preferred] : [] }; }
function guestDefault(preferred) {
  localStorage.setItem('unstressed.planning-area', JSON.stringify(preferred));
  localStorage.setItem('unstressed.planning-areas', JSON.stringify([preferred]));
}
async function mount() {
  if (root) await act(async () => root.unmount());
  await act(async () => {
    root = createRoot(document.getElementById('root'));
    root.render(React.createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, React.createElement(PlannerApp)));
  });
}
const button = name => [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === name || node.textContent.trim() === name);
async function click(name) { const node = button(name); assert.ok(node, `Missing button: ${name}`); await act(async () => node.click()); }
async function input(selector, value) {
  const node = document.querySelector(selector); assert.ok(node, `Missing input: ${selector}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const area = () => document.querySelector('button.cs-location-pill')?.getAttribute('aria-label');
async function select(place, remember = false) {
  await click(area()); await click('Search areas');
  await input('input[role="combobox"]', place.name);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
  const option = [...document.querySelectorAll('button[role="option"]')].find(node => node.textContent.includes(place.label));
  assert.ok(option, `Missing area result: ${place.label}`);
  await act(async () => option.click());
  if (remember) await act(async () => document.querySelector('input[value="default"]').click());
  await click('Let’s go');
  assert.equal(area(), `Planning area: ${place.label}`);
}
async function send() {
  const count = state.requests.length;
  await input('textarea[aria-label="Message Unstressed"]', 'A place to sit after work');
  await act(async () => document.querySelector('form.cs-composer').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(state.requests.length, count + 1, 'Each message must send a fresh planning request');
  return state.requests.at(-1);
}

for (const signedIn of [false, true]) {
  const label = signedIn ? 'account' : 'guest';
  test(`${label}: save default, new chat, reload, new chat retain area, planning context and tastes`, async () => {
    if (signedIn) account();
    await mount(); await select(london, true);
    for (const reload of [false, true]) {
      if (reload) await mount();
      assert.equal(area(), `Planning area: ${london.label}`);
      await click('New day');
      assert.equal(area(), `Planning area: ${london.label}`);
      const request = await send();
      assert.equal(request.context.locationId, london.id);
      assert.equal(request.context.currency, 'GBP');
      assert.equal(request.context.budget, null);
      assert.equal(request.locationContext.confirmed, true);
      assert.equal(request.locationContext.timeZone, london.timeZone);
      assert.deepEqual(request.context.people[0].artists, [signedIn ? 'SZA' : 'Sarkodie']);
    }
    assert.equal(state.writes, signedIn ? 1 : 0);
  });
  test(`${label}: a per-outing change does not replace the default, including on account refresh`, async () => {
    if (signedIn) account(london); else guestDefault(london);
    await mount(); await select(paris);
    await act(async () => window.dispatchEvent(new Event('focus')));
    assert.equal(area(), `Planning area: ${paris.label}`);
    assert.equal((await send()).context.currency, 'EUR');
    await click('New day');
    assert.equal(area(), `Planning area: ${london.label}`);
    assert.equal(state.writes, 0);
  });
  test(`${label}: forgetting the default keeps this outing but clears later chats and reload`, async () => {
    if (signedIn) account(london); else guestDefault(london);
    await mount();
    assert.equal(area(), `Planning area: ${london.label}`);
    await click(area()); await click('Forget London'); await click('Close location');
    assert.equal(area(), `Planning area: ${london.label}`);
    await click('New day');
    assert.equal(area(), 'Planning area: Not set');
    await mount();
    assert.equal(area(), 'Planning area: Not set');
  });
  test(`${label}: latest saved area is the default and removing it falls back to the previous one`, async () => {
    if (signedIn) account(london); else guestDefault(london);
    await mount(); await select(paris, true); await click('New day');
    assert.equal(area(), `Planning area: ${paris.label}`);
    await click(area()); await click('Forget Paris'); await click('Close location'); await click('New day');
    assert.equal(area(), `Planning area: ${london.label}`);
  });
}

test('new chat before account loading never confirms the device guest default', async () => {
  account(paris); guestDefault(london);
  let resolveAccount; state.accountGate = new Promise(resolve => { resolveAccount = resolve; });
  await mount(); await click('New day');
  assert.equal(area(), 'Planning area: Not set');
  await act(async () => { resolveAccount(); await state.accountGate; });
  assert.equal(area(), `Planning area: ${paris.label}`);
  assert.equal((await send()).context.currency, 'EUR');
});

test('sign-in checkpoint keeps its explicit area, custom currency and draft text', async () => {
  account(london);
  history.replaceState(null, '', '/?signin=success');
  sessionStorage.setItem('outing.signin-draft', JSON.stringify({ brief: { ...fresh(), area: paris.label, locationId: paris.id }, chat: [], message: 'My pending message', locationConfirmed: true, at: Date.now() }));
  await mount();
  assert.equal(area(), `Planning area: ${paris.label}`);
  assert.equal(document.querySelector('textarea').value, 'My pending message');
  assert.equal((await send()).context.currency, 'USD');
});

test('account switching and sign-out use the new identity defaults without leaking the old account', async () => {
  account(london); guestDefault(london); await mount();
  state.user = { ...state.user, id: 'second-user', profile: { ...profile, id: 'second-user' }, planningLocations: [paris], planningLocation: paris };
  await act(async () => window.dispatchEvent(new Event('focus')));
  assert.equal(area(), `Planning area: ${paris.label}`);
  state.user = null;
  await act(async () => window.dispatchEvent(new Event('focus')));
  assert.equal(area(), `Planning area: ${london.label}`);
});

test('shared-day location takes precedence over a personal default', async () => {
  account(london);
  state.shared = { id: 'test-day', revision: 1, planRevision: 0, status: 'draft', access: { role: 'owner' }, request: { ...fresh(), area: paris.label, locationId: paris.id }, events: [] };
  history.replaceState(null, '', '/#/day/test-day?key=test-only');
  await mount();
  assert.equal(area(), `Planning area: ${paris.label}`);
  assert.equal((await send()).context.currency, 'USD');
});


test('saved-day reload preserves its area and currency instead of adopting the default', async () => {
  account(london);
  state.savedPlan = { version: '1.0', phase: 'discovery', request: { ...fresh(), area: paris.label, locationId: paris.id }, stops: [], people: [profile], budget: { allocations: [], reserve: 0, transport: 0 }, tasteMap: { nodes: [], edges: [] }, timeZone: paris.timeZone, warnings: [], provenance: { provider: 'synthetic', retrievedAt: '2026-11-07T00:00:00Z' }, links: {} };
  history.replaceState(null, '', '/#/plan/saved-day');
  await mount();
  assert.equal(area(), `Planning area: ${paris.label}`);
  const request = await send();
  assert.equal(request.context.currency, 'USD');
  assert.equal(request.locationContext.timeZone, paris.timeZone);
  await click('New day');
  assert.equal(area(), `Planning area: ${london.label}`);
});

for (const signedIn of [false, true]) {
  test(`${signedIn ? 'account' : 'guest'}: saving a usual area only changes the next outing`, async () => {
    if (signedIn) account(london); else guestDefault(london);
    await mount(); await click('Add usual areas'); await click('Search areas');
    await input('input[role="combobox"]', paris.name);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
    const option = [...document.querySelectorAll('button[role="option"]')].find(node => node.textContent.includes(paris.label));
    assert.ok(option); await act(async () => option.click());
    await click('Save area'); await click('Done');
    assert.equal(area(), `Planning area: ${london.label}`);
    await click('New day');
    assert.equal(area(), `Planning area: ${paris.label}`);
  });
}


for (const signedIn of [false, true]) {
  test(`${signedIn ? 'account' : 'guest'}: a failed initial identity lookup cannot choose a guest default before recovery`, async () => {
    if (signedIn) account(paris);
    guestDefault(london); state.accountError = true;
    await mount();
    assert.equal(area(), 'Planning area: Not set');
    await click('Dismiss error'); await click('New day');
    assert.equal(area(), 'Planning area: Not set');
    state.accountError = false;
    await act(async () => window.dispatchEvent(new Event('focus')));
    assert.equal(area(), `Planning area: ${signedIn ? paris.label : london.label}`);
    assert.equal((await send()).context.currency, signedIn ? 'EUR' : 'GBP');
  });
}

function repeatedPlan(request = {}) {
  return {version:'1.0',phase:'discovery',request:{...fresh(),area:london.label,locationId:london.id,activities:['drinks'],stopIntents:['drinks','drinks'],...request},stops:['a','b'].map((id,index)=>({id:`stop-${index}`,intent:'drinks',item:{id,entityId:`fixture-${id}`,name:`Fixture ${id}`,address:'Synthetic test venue',links:{}},connections:[]})),people:[profile],budget:{allocations:[0,1].map(i=>({stopId:`stop-${i}`,intent:'drinks',amount:null})),reserve:0,transport:0},tasteMap:{nodes:[],edges:[]},warnings:[],provenance:{provider:'synthetic test fixture',retrievedAt:'2026-11-07T00:00:00Z'},links:{}};
}

test('repeated stops: keep one, replace the other, undo and edit details retain distinct slots',async()=>{
  account(london);state.savedPlan=repeatedPlan();history.replaceState(null,'','/#/plan/saved-day');
  const fetchBase=globalThis.fetch,builds=[];
  globalThis.fetch=async(input,options={})=>{
    if(new URL(input,location.origin).pathname==='/api/itineraries'){
      const request=JSON.parse(options.body);builds.push(request);const result=repeatedPlan(request);
      if(request.excludeIds.includes('b'))result.stops[1].item={...result.stops[1].item,id:'c',name:'Fixture c'};
      return new Response(JSON.stringify(result),{headers:{'content-type':'application/json'}});
    }
    return fetchBase(input,options);
  };
  await mount();
  const cards=()=>[...document.querySelectorAll('.outing-place')];
  assert.equal(cards().length,2);
  await act(async()=>cards()[0].querySelector('.outing-keep').click());
  assert.equal(cards()[0].querySelector('.outing-keep').getAttribute('aria-pressed'),'true');
  assert.equal(cards()[1].querySelector('.outing-keep').getAttribute('aria-pressed'),'false');
  await act(async()=>[...cards()[1].querySelectorAll('button')].find(b=>b.textContent==='Find another').click());
  assert.deepEqual(builds.at(-1).stopIntents,['drinks','drinks']);assert.deepEqual(builds.at(-1).pins,{'stop-0':'a'});
  assert.equal(cards()[1].getAttribute('aria-label'),'Fixture c');
  await click('Undo');assert.equal(cards()[1].getAttribute('aria-label'),'Fixture b');
  await click('Details');await input('.pl-trip-dialog input[type="date"]','2026-12-04');await click('Update this plan');
  assert.deepEqual(builds.at(-1).stopIntents,['drinks','drinks']);assert.deepEqual(builds.at(-1).pins,{'stop-0':'a'});assert.equal(builds.at(-1).date,'2026-12-04');
  await click('Save');
  // The chat context and actual saved snapshot retain the same ordered request.
  assert.deepEqual((await send()).context.stopIntents,['drinks','drinks']);
  const snapshots=Object.keys(localStorage).filter(key=>key.includes('saved')).flatMap(key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return [];}});
  assert.ok(snapshots.some(entry=>entry.plan?.request.stopIntents?.length===2));
});

// Synthetic route fixtures never make live provider calls.
async function installRouteFixture({sharedRole}={}) {
  const {syntheticRoutePlan,syntheticRouteResult,syntheticCapabilities}=await import('./fixtures/route-plan.js');
  if(!sharedRole)account(london);
  state.savedPlan=syntheticRoutePlan();
  if(sharedRole){
    state.shared={id:'synthetic-shared',revision:1,planRevision:1,status:'ready',access:{role:sharedRole,memberId:'synthetic-person'},request:state.savedPlan.request,plan:state.savedPlan,events:[]};
    history.replaceState(null,'','/#/day/synthetic-shared?key=synthetic-only');
  }else history.replaceState(null,'','/#/plan/saved-day');
  const base=globalThis.fetch,pending=[];
  globalThis.fetch=async(input,options={})=>{
    const path=new URL(input,location.origin).pathname;
    if(path==='/api/actions/capabilities')return new Response(JSON.stringify(syntheticCapabilities));
    if(path==='/api/actions/routes/estimate'){
      const body=JSON.parse(options.body);let resolve;const promise=new Promise(done=>resolve=done);pending.push({body,resolve,signal:options.signal});await promise;
      return new Response(JSON.stringify(syntheticRouteResult(body)));
    }
    return base(input,options);
  };
  return pending;
}
async function openRouteFixture(){
  await click('Getting ready');await click('Drive');await input('.pg-estimate-form input','Synthetic start, Accra');await click('Estimate this journey');
}

test('route integration: repeated venue details select the exact slot, not the first matching entity',async()=>{
  const pending=await installRouteFixture();await mount();
  await act(async()=>document.querySelector('[data-stop-id="second-drinks"] .outing-place-name').click());await click('Getting there');
  assert.equal(document.querySelector('select[aria-label="Place to review"]').value,'second-drinks');
  assert.equal(document.querySelector('.pg-route-guide select').value,'second-drinks');
  await click('Drive');await click('Estimate this journey');
  assert.equal(pending[0].body.origin.id,'first-drinks');assert.equal(pending[0].body.stops[0].id,'second-drinks');
  await act(async()=>pending[0].resolve());assert.ok(document.querySelector('.pg-route-estimate'));
  await act(async()=>{const picker=document.querySelector('select[aria-label="Place to review"]');picker.value='first-drinks';picker.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(document.querySelector('.pg-route-guide select').value,'first-drinks');assert.ok(document.querySelector('.pg-estimate-form input'));assert.equal(document.querySelector('.pg-route-estimate'),null);
});
for(const transition of ['Back to chat','New day','account switch','sign out','date edit'])test(`route integration: ${transition} rejects pending evidence without changing its selected venues`,async()=>{
  const pending=await installRouteFixture();await mount();await openRouteFixture();assert.equal(pending.length,1);
  if(transition==='account switch'||transition==='sign out'){
    state.user=transition==='sign out'?null:{...state.user,id:'another-account',profile:{...profile,id:'another-account'}};
    await act(async()=>window.dispatchEvent(new Event('focus')));
  }else if(transition==='date edit'){
    await click('Places');await click('Details');await input('.pl-trip-dialog input[type="date"]','2027-02-12');
  }else await click(transition);
  assert.equal(pending[0].signal.aborted,true);await act(async()=>pending[0].resolve());assert.equal(document.querySelector('.pg-route-estimate'),null);
  if(transition==='Back to chat'){
    await click('Your day');assert.equal(document.querySelector('.pg-estimate-form input').value,'');assert.equal(document.querySelector('.pg-route-estimate'),null);
  }
  assert.deepEqual(state.savedPlan.stops.map(stop=>stop.id),['first-drinks','second-drinks']);assert.equal(state.savedPlan.request.pins['first-drinks'],'catalog-item');
});
test('route integration: a guest can explicitly estimate a shared day; shared revision cancels evidence',async()=>{
  const pending=await installRouteFixture({sharedRole:'member'});await mount();await click('Your day');await openRouteFixture();
  assert.equal(pending.length,1);
  state.shared={...state.shared,revision:2,planRevision:1,status:'updating',request:{...state.shared.request,date:'2027-02-13'}};
  await act(async()=>document.dispatchEvent(new Event('visibilitychange')));
  assert.equal(pending[0].signal.aborted,true);await act(async()=>pending[0].resolve());assert.equal(document.querySelector('.pg-route-estimate'),null);
});
test('route integration: a restored local saved day starts with no previous estimate or origin',async()=>{
  const pending=await installRouteFixture();await mount();await openRouteFixture();await act(async()=>pending[0].resolve());assert.ok(document.querySelector('.pg-route-estimate'));
  await click('Places');await click('Save');await click('New day');await click('Saved days');
  const saved=[...document.querySelectorAll('.pl-saved-item>button')].find(node=>node.textContent.includes('Synthetic two-stop outing'));assert.ok(saved);await act(async()=>saved.click());
  await click('Getting ready');assert.equal(document.querySelector('.pg-estimate-form input').value,'');assert.equal(document.querySelector('.pg-route-estimate'),null);
  const serialized=Object.keys(localStorage).map(key=>localStorage.getItem(key)).join('');assert.doesNotMatch(serialized,/Synthetic start, Accra|durationSeconds|distanceMeters/);
});

for(const previewChange of ['empty slot','new venue entity','new catalog item','updated timing'])test(`route integration: streamed ${previewChange} cannot crash or retain another venue’s modal state`,async()=>{
  const pending=await installRouteFixture();
  const base=globalThis.fetch;let stream;
  globalThis.fetch=async(input,options={})=>{
    if(new URL(input,location.origin).pathname==='/api/itineraries')return new Response(new ReadableStream({start(controller){stream=controller;}}),{headers:{'content-type':'application/x-ndjson'}});
    return base(input,options);
  };
  await mount();
  // Start replacing this slot, then inspect its existing result while the search streams.
  await act(async()=>[...document.querySelector('[data-stop-id="second-drinks"]').querySelectorAll('button')].find(node=>node.textContent==='Find another').click());
  assert.ok(stream);
  await act(async()=>document.querySelector('[data-stop-id="second-drinks"] .outing-place-name').click());await click('Getting there');await click('Drive');await click('Estimate this journey');assert.equal(pending.length,1);
  const preview=structuredClone(state.savedPlan);
  if(previewChange==='empty slot')preview.stops[1].item=null;
  else if(previewChange==='new venue entity')preview.stops[1].item={...preview.stops[1].item,entityId:'different-entity',name:'Other synthetic venue'};
  else if(previewChange==='new catalog item')preview.stops[1].item={...preview.stops[1].item,id:'different-item',name:'Other synthetic item'};
  else {preview.stops[1].start='20:30';preview.stops[1].end='21:30';}
  const emit=event=>stream.enqueue(new TextEncoder().encode(JSON.stringify(event)+'\n'));
  await act(async()=>emit({type:'discovery',plan:preview}));
  assert.equal(pending[0].signal.aborted,true);await act(async()=>pending[0].resolve());assert.equal(document.querySelector('.pg-route-estimate'),null);
  if(previewChange==='updated timing'){
    assert.ok(document.querySelector('.pg-dialog'));await click('Booking');assert.match(document.querySelector('.pg-enquiry textarea').value,/20:30/);
  }else {
    assert.equal(document.querySelector('.pg-dialog'),null);
    // Restoring the original slot in another preview must not reopen a dismissed modal.
    await act(async()=>emit({type:'discovery',plan:state.savedPlan}));assert.equal(document.querySelector('.pg-dialog'),null);
  }
  await act(async()=>{emit({type:'complete',plan:state.savedPlan});stream.close();});
});

for(const signedIn of [false,true])test(`${signedIn?'account':'guest'}: current-location area explicitly saved persists across new day and reload without GPS`,async()=>{
  if(signedIn)account(london);else guestDefault(london);
  let gpsCalls=0;const lookup=[];Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success){gpsCalls++;success({coords:{latitude:48.856789,longitude:2.352345,accuracy:2000},timestamp:Date.now()});}}});
  const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{if(url==='/api/locations/nearby'){lookup.push(JSON.parse(options.body));return new Response(JSON.stringify({locations:[paris]}));}return original(url,options);};
  await mount();await click('Add usual areas');assert.equal(gpsCalls,0);await click('Use current location');assert.equal(gpsCalls,1);assert.deepEqual(lookup,[{latitude:48.86,longitude:2.35,radiusKm:20}]);
  const option=[...document.querySelectorAll('button[role="option"]')].find(node=>node.textContent.includes(paris.label));assert.ok(option);await act(async()=>option.click());assert.equal(state.writes,0);await click('Save area');await click('Done');assert.equal(area(),`Planning area: ${london.label}`);
  for(const key of Object.keys(localStorage))assert.doesNotMatch(localStorage.getItem(key),/48\.856789|2\.352345|accuracy/);
  await click('New day');assert.equal(area(),`Planning area: ${paris.label}`);await mount();assert.equal(area(),`Planning area: ${paris.label}`);assert.equal(gpsCalls,1);
});

for(const signedIn of [false,true])test(`${signedIn?'account':'guest'}: partial current planning area resolves catalog before default save and survives new day/reload`,async()=>{
  await installRouteFixture(signedIn?{}:{sharedRole:'member'});if(!signedIn)guestDefault(london);else{state.savedPlan.request.people=[profile];state.savedPlan.people=[profile];}
  state.savedPlan.request={...state.savedPlan.request,area:paris.label,locationId:paris.id};if(state.shared)state.shared.request=state.savedPlan.request;
  const base=globalThis.fetch,lookups=[];globalThis.fetch=async(url,options)=>{if(url===`/api/locations/${paris.id}`){lookups.push(url);return new Response(JSON.stringify(paris));}return base(url,options);};
  await mount();if(!state.user)await click('Your day');await click('Getting ready');await click(`Use ${paris.label} · approximate area`);await click('Save area as default');assert.equal(lookups.length,1);
  assert.equal(area(),`Planning area: ${paris.label}`);assert.match(document.body.textContent,/Area saved as your default/);
  if(!signedIn)assert.deepEqual(JSON.parse(localStorage.getItem('unstressed.planning-area')),paris);
  await click('New day');assert.equal(area(),`Planning area: ${paris.label}`);assert.equal((await send()).context.currency,'EUR');
  await mount();assert.equal(area(),`Planning area: ${paris.label}`);assert.equal((await send()).context.currency,'EUR');
});
for(const response of [{id:'paris',label:'Paris'},london])test(`unusable or mismatched catalog does not replace guest default: ${response.id}/${!!response.currency}`,async()=>{
  await installRouteFixture({sharedRole:'member'});guestDefault(london);state.savedPlan.request={...state.savedPlan.request,area:paris.label,locationId:paris.id};if(state.shared)state.shared.request=state.savedPlan.request;
  const base=globalThis.fetch;globalThis.fetch=async(url,options)=>url===`/api/locations/${paris.id}`?new Response(JSON.stringify(response)):base(url,options);
  await mount();if(!state.user)await click('Your day');await click('Getting ready');await click(`Use ${paris.label} · approximate area`);await click('Save area as default');assert.match(document.body.textContent,/could not be verified/);assert.doesNotMatch(document.body.textContent,/Area saved as your default/);assert.deepEqual(JSON.parse(localStorage.getItem('unstressed.planning-area')),london);
});

test('account switch during catalog resolution prevents saving into the new account',async()=>{
  await installRouteFixture();state.savedPlan.request={...state.savedPlan.request,area:paris.label,locationId:paris.id};let finish;const base=globalThis.fetch;
  globalThis.fetch=async(url,options)=>url===`/api/locations/${paris.id}`?new Promise(resolve=>{finish=()=>resolve(new Response(JSON.stringify(paris)));}):base(url,options);
  await mount();await click('Getting ready');await click(`Use ${paris.label} · approximate area`);await click('Save area as default');assert.ok(finish);
  state.user={...state.user,id:'other-account',profile:{...profile,id:'other-account'}};await act(async()=>window.dispatchEvent(new Event('focus')));await act(async()=>finish());assert.equal(state.writes,0);
});
