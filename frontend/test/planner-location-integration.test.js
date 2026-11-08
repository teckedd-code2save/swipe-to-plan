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
    if(path==='/api/locations/synthetic-area')return new Response(JSON.stringify({id:'synthetic-area',label:'Accra',center:{latitude:5.55,longitude:-0.2}}));
    if(path==='/api/actions/capabilities')return new Response(JSON.stringify(syntheticCapabilities));
    if(path==='/api/actions/routes/estimate'){
      const body=JSON.parse(options.body);let resolve;const promise=new Promise(done=>resolve=done);pending.push({body,resolve,signal:options.signal});await promise;
      return new Response(JSON.stringify(syntheticRouteResult(body)));
    }
    return base(input,options);
  };
  return pending;
}
async function closeReadySheet(){
  await click('Close and return to map');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
}
async function openRouteFixture(){
  await click('Getting ready');await click('Choose your starting point');await click('Use Accra · approximate area');await closeReadySheet();await click('Drive');await click('Estimate this journey');
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
    await closeReadySheet();await click('Places');await click('Details');await input('.pl-trip-dialog input[type="date"]','2027-02-12');
  }else {await closeReadySheet();await click(transition);}
  assert.equal(pending[0].signal.aborted,true);await act(async()=>pending[0].resolve());assert.equal(document.querySelector('.pg-route-estimate'),null);
  if(transition==='Back to chat'){
    await click('Your day');await click('Choose your starting point');assert.equal(document.querySelector('.gr-sheet input[type=text]').value,'');assert.equal(document.querySelector('.pg-route-estimate'),null);
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
  await closeReadySheet();await click('Places');await click('Save');await click('New day');await click('Saved days');
  const saved=[...document.querySelectorAll('.pl-saved-item>button')].find(node=>node.textContent.includes('Synthetic two-stop outing'));assert.ok(saved);await act(async()=>saved.click());
  await click('Getting ready');await click('Choose your starting point');assert.equal(document.querySelector('.gr-sheet input[type=text]').value,'');assert.equal(document.querySelector('.pg-route-estimate'),null);
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
  await mount();if(!state.user)await click('Your day');await click('Getting ready');await click('Choose your starting point');await click(`Use ${paris.label} · approximate area`);await click('Save area as default');assert.equal(lookups.length,1);
  assert.equal(area(),`Planning area: ${paris.label}`);assert.match(document.body.textContent,/Area saved as your default/);
  if(!signedIn)assert.deepEqual(JSON.parse(localStorage.getItem('unstressed.planning-area')),paris);
  await closeReadySheet();await click('New day');assert.equal(area(),`Planning area: ${paris.label}`);assert.equal((await send()).context.currency,'EUR');
  await mount();assert.equal(area(),`Planning area: ${paris.label}`);assert.equal((await send()).context.currency,'EUR');
});
for(const response of [{id:'paris',label:'Paris'},london])test(`unusable or mismatched catalog does not replace guest default: ${response.id}/${!!response.currency}`,async()=>{
  await installRouteFixture({sharedRole:'member'});guestDefault(london);state.savedPlan.request={...state.savedPlan.request,area:paris.label,locationId:paris.id};if(state.shared)state.shared.request=state.savedPlan.request;
  const base=globalThis.fetch;globalThis.fetch=async(url,options)=>url===`/api/locations/${paris.id}`?new Response(JSON.stringify(response)):base(url,options);
  await mount();if(!state.user)await click('Your day');await click('Getting ready');await click('Choose your starting point');await click(`Use ${paris.label} · approximate area`);await click('Save area as default');assert.match(document.body.textContent,/could not be verified/);assert.doesNotMatch(document.body.textContent,/Area saved as your default/);assert.deepEqual(JSON.parse(localStorage.getItem('unstressed.planning-area')),london);
});

test('account switch during catalog resolution prevents saving into the new account',async()=>{
  await installRouteFixture();state.savedPlan.request={...state.savedPlan.request,area:paris.label,locationId:paris.id};let finish;const base=globalThis.fetch;
  globalThis.fetch=async(url,options)=>url===`/api/locations/${paris.id}`?new Promise(resolve=>{finish=()=>resolve(new Response(JSON.stringify(paris)));}):base(url,options);
  await mount();await click('Getting ready');await click('Choose your starting point');await click(`Use ${paris.label} · approximate area`);await click('Save area as default');assert.ok(finish);
  state.user={...state.user,id:'other-account',profile:{...profile,id:'other-account'}};await act(async()=>window.dispatchEvent(new Event('focus')));await act(async()=>finish());assert.equal(state.writes,0);
});

for(const missing of [false,true])test(`return-visit chat uses actual ${missing?'partial':'complete'} itinerary, never the model's proposed completion`,async()=>{
  account(london);
  const initial=repeatedPlan({activities:['coffee','dinner'],stopIntents:['coffee','dinner']});
  initial.stops[0]={...initial.stops[0],intent:'coffee',item:{...initial.stops[0].item,id:'baker',name:'Cafe A'}};
  initial.stops[1]={...initial.stops[1],intent:'dinner',item:{...initial.stops[1].item,id:'dinner',name:"Dinner B"}};
  state.savedPlan=initial;history.replaceState(null,'','/#/plan/saved-day');
  const fetchBase=globalThis.fetch,builds=[];let release;const gate=new Promise(resolve=>release=resolve);
  globalThis.fetch=async(input,options={})=>{
    const path=new URL(input,location.origin).pathname;
    if(path==='/api/agent'){if(JSON.parse(options.body).task==='compare')return new Response(JSON.stringify({status:'reply',text:'Synthetic comparison.'}),{headers:{'content-type':'application/json'}});
      state.requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({status:'action',action:'select_places',route:[{intent:'coffee',placeId:'baker'},{intent:'dinner',placeId:'dinner'},{intent:'coffee',placeId:'baker'}],assistantMessage:'I have already added the same venue twice successfully.'}),{headers:{'content-type':'application/json'}});
    }
    if(path==='/api/itineraries'){
      const request=JSON.parse(options.body);builds.push(request);await gate;
      const result={...initial,request,status:missing?'partial':'complete',stops:[...initial.stops,{...initial.stops[0],id:'stop-2',...(missing?{item:null,status:'unfilled',reason:'kept_place_unavailable'}:{})}],budget:{...initial.budget,allocations:[...initial.budget.allocations,{stopId:'stop-2',intent:'coffee',amount:null}]}};
      return new Response(JSON.stringify(result),{headers:{'content-type':'application/json'}});
    }
    return fetchBase(input,options);
  };
  await mount();await input('textarea[aria-label="Message Unstressed"]','Add Cafe A again after dinner as a third stop, keeping the first two stops.');
  await act(async()=>document.querySelector('form.cs-composer').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  assert.deepEqual(builds[0].route.map(s=>s.placeId),['baker','dinner','baker']);
  assert.equal(document.body.textContent.includes('already added the same venue twice successfully'),false);
  await act(async()=>release());
  assert.match(document.body.textContent,missing?/Current outing: 1\. Cafe A → 2\. Dinner B → 3\. Still to find/:/Current outing: 1\. Cafe A → 2\. Dinner B → 3\. Cafe A/);
  assert.equal(document.body.textContent.includes('already added the same venue twice successfully'),false);
});

test('removing one return visit in the rendered itinerary keeps the other occurrence and supports undo',async()=>{
  account(london);const initial=repeatedPlan({activities:['coffee','dinner'],stopIntents:['coffee','dinner','coffee'],route:[{intent:'coffee',placeId:'a'},{intent:'dinner',placeId:'b'},{intent:'coffee',placeId:'a'}]});
  initial.stops[0].intent='coffee';initial.stops[1].intent='dinner';initial.stops.push({...initial.stops[0],id:'stop-2'});initial.budget.allocations.push({stopId:'stop-2',intent:'coffee',amount:null});
  state.savedPlan=initial;history.replaceState(null,'','/#/plan/saved-day');const fetchBase=globalThis.fetch,builds=[];
  globalThis.fetch=async(input,options={})=>{
    if(new URL(input,location.origin).pathname==='/api/itineraries'){
      const request=JSON.parse(options.body);builds.push(request);
      return new Response(JSON.stringify({...initial,request,stops:request.route.map((selected,index)=>({...initial.stops.find(s=>s.item.id===selected.placeId),id:`stop-${index}`}))}),{headers:{'content-type':'application/json'}});
    }
    return fetchBase(input,options);
  };
  await mount();const cards=()=>[...document.querySelectorAll('.outing-place')];assert.equal(cards().length,3);
  await act(async()=>[...cards()[2].querySelectorAll('button')].find(button=>button.textContent==='Remove stop').click());
  assert.deepEqual(builds.at(-1).route,[{intent:'coffee',placeId:'a'},{intent:'dinner',placeId:'b'}]);assert.equal(cards().length,2);
  assert.match(document.querySelector('.cs-result-card').closest('article').textContent,/Current outing: 1\. Fixture a → 2\. Fixture b\./);
  await click('Undo');assert.equal(cards().length,3);
  assert.match(document.querySelector('.cs-result-card').closest('article').textContent,/Current outing: 1\. Fixture a → 2\. Fixture b → 3\. Fixture a\./);
  assert.match(document.querySelector('.cs-result-card small').textContent,/3 stops/);
  await act(async()=>[...cards()[0].querySelectorAll('button')].find(button=>button.textContent==='Remove stop').click());
  assert.deepEqual(builds.at(-1).route,[{intent:'dinner',placeId:'b'},{intent:'coffee',placeId:'a'}]);
});

test('adding another place keeps existing occurrence categories even when a venue supports both coffee and dinner',async()=>{
  account(london);const initial=repeatedPlan({activities:['coffee','dinner'],stopIntents:['coffee','dinner'],route:[{intent:'coffee',placeId:'a'},{intent:'dinner',placeId:'a'}]});
  initial.stops[0].intent='coffee';initial.stops[1]={...initial.stops[1],intent:'dinner',item:initial.stops[0].item};
  initial.shortlist=[{intent:'dinner',item:initial.stops[0].item},{intent:'coffee',item:{id:'c',entityId:'fixture-c',name:'Fixture c',links:{}}}];
  state.savedPlan=initial;history.replaceState(null,'','/#/plan/saved-day');const fetchBase=globalThis.fetch,builds=[];
  globalThis.fetch=async(input,options={})=>{
    if(new URL(input,location.origin).pathname==='/api/itineraries'){const request=JSON.parse(options.body);builds.push(request);return new Response(JSON.stringify({...initial,request}),{headers:{'content-type':'application/json'}});}
    return fetchBase(input,options);
  };
  await mount();await click('Add stop');assert.deepEqual(builds.at(-1).route,[{intent:'coffee',placeId:'a'},{intent:'dinner',placeId:'a'},{intent:'coffee',placeId:'c'}]);
});

for(const polled of [true,false])test(`shared selection edits ${polled?'reject changed occurrence context':'send the captured revision across the last mutation race'}`,async()=>{
  const initial=repeatedPlan({activities:['coffee','dinner'],stopIntents:['coffee','dinner']});initial.stops[0].intent='coffee';initial.stops[1].intent='dinner';
  state.shared={id:'synthetic-shared',revision:1,planRevision:1,status:'ready',access:{role:'owner',memberId:'test-user'},request:initial.request,plan:initial,events:[]};
  history.replaceState(null,'','/#/day/synthetic-shared?key=synthetic-only');
  const fetchBase=globalThis.fetch,writes=[];let release;const gate=new Promise(resolve=>release=resolve);
  globalThis.fetch=async(input,options={})=>{
    const path=new URL(input,location.origin).pathname;
    if(path==='/api/agent'){if(JSON.parse(options.body).task==='compare')return new Response(JSON.stringify({status:'reply',text:'Synthetic comparison.'}),{headers:{'content-type':'application/json'}});state.requests.push(JSON.parse(options.body));await gate;return new Response(JSON.stringify({status:'action',action:'select_places',route:[{intent:'coffee',placeId:'a'},{intent:'dinner',placeId:'b'},{intent:'coffee',placeId:'a'}]}),{headers:{'content-type':'application/json'}});}
    if(path==='/api/days/synthetic-shared'&&options.method==='PATCH'){writes.push(JSON.parse(options.body));return new Response(JSON.stringify({error:'The shared day changed.'}),{status:409,headers:{'content-type':'application/json'}});}
    return fetchBase(input,options);
  };
  await mount();await send();
  const updated={...initial,request:{...initial.request,budget:90},stops:[{...initial.stops[1],id:'stop-0'},{...initial.stops[0],id:'stop-1'}]};
  state.shared={...state.shared,revision:2,planRevision:2,request:updated.request,plan:updated};
  if(polled)await act(async()=>document.dispatchEvent(new Event('visibilitychange')));
  await act(async()=>release());
  if(polled){assert.equal(writes.length,0);assert.match(document.body.textContent,/shared day changed while I was checking this edit/);}
  else {assert.equal(writes.length,1);assert.equal(writes[0].revision,1);}
});

test('individual UI remove and add fail closed rather than dropping an unresolved visit',async()=>{
  account(london);const initial=repeatedPlan({activities:['coffee','dinner'],stopIntents:['coffee','dinner','coffee']});
  const cafe={...initial.stops[0],intent:'coffee'},missing={...initial.stops[1],intent:'dinner',item:null,status:'unfilled',reason:'no_eligible_places'};
  initial.stops=[cafe,missing,{...cafe,id:'stop-2'}];initial.status='partial';initial.shortlist=[{intent:'coffee',item:{id:'c',entityId:'fixture-c',name:'Fixture c',links:{}}}];initial.budget.allocations.push({stopId:'stop-2',intent:'coffee',amount:null});
  state.savedPlan=initial;history.replaceState(null,'','/#/plan/saved-day');const fetchBase=globalThis.fetch,builds=[];
  globalThis.fetch=async(input,options={})=>{if(new URL(input,location.origin).pathname==='/api/itineraries'){builds.push(JSON.parse(options.body));return new Response(JSON.stringify(initial),{headers:{'content-type':'application/json'}});}return fetchBase(input,options);};
  await mount();const finalVisit=document.querySelector('[data-stop-id="stop-2"]');
  await act(async()=>[...finalVisit.querySelectorAll('button')].find(button=>button.textContent==='Remove stop').click());
  assert.equal(builds.length,0);assert.match(document.body.textContent,/Some requested visits are still unfilled/);
  await click('Add stop');assert.equal(builds.length,0);assert.ok(document.querySelector('[data-stop-id="stop-2"]'));
});

test('a shared pending-plan snapshot cannot expose or apply stale selected occurrences against its newer brief',async()=>{
  const initial=repeatedPlan({activities:['coffee','dinner'],stopIntents:['coffee','dinner']});initial.stops[0].intent='coffee';initial.stops[1].intent='dinner';
  state.shared={id:'synthetic-shared',revision:2,planRevision:1,status:'updating',access:{role:'owner',memberId:'test-user'},request:{...initial.request,budget:90},plan:initial,events:[]};
  history.replaceState(null,'','/#/day/synthetic-shared?key=synthetic-only');const fetchBase=globalThis.fetch,writes=[];
  globalThis.fetch=async(input,options={})=>{
    const path=new URL(input,location.origin).pathname;
    if(path==='/api/agent'){if(JSON.parse(options.body).task==='compare')return new Response(JSON.stringify({status:'reply',text:'Synthetic comparison.'}),{headers:{'content-type':'application/json'}});state.requests.push(JSON.parse(options.body));return new Response(JSON.stringify({status:'action',action:'select_places',route:[{intent:'coffee',placeId:'a'},{intent:'dinner',placeId:'b'},{intent:'coffee',placeId:'a'}]}),{headers:{'content-type':'application/json'}});}
    if(path==='/api/days/synthetic-shared'&&options.method==='PATCH'){writes.push(JSON.parse(options.body));return new Response(JSON.stringify(state.shared),{headers:{'content-type':'application/json'}});}
    return fetchBase(input,options);
  };
  await mount();const request=await send();assert.equal(request.planContext,undefined);assert.equal(request.context.budget,90);assert.equal(writes.length,0);assert.match(document.body.textContent,/shared day is still updating/);
});

test('a selection before local retrieval completes preserves the newest budget, date and tastes',async()=>{
  account(london);const initial=repeatedPlan({activities:['coffee','dinner'],stopIntents:['coffee','dinner']});initial.stops[0].intent='coffee';initial.stops[1].intent='dinner';
  state.savedPlan=initial;history.replaceState(null,'','/#/plan/saved-day');const fetchBase=globalThis.fetch,builds=[];let release;const gate=new Promise(resolve=>release=resolve);
  globalThis.fetch=async(input,options={})=>{
    const path=new URL(input,location.origin).pathname;
    if(path==='/api/agent'){
      const data=JSON.parse(options.body);if(data.task==='compare')return new Response(JSON.stringify({status:'reply',text:'Synthetic comparison.'}),{headers:{'content-type':'application/json'}});
      state.requests.push(data);return new Response(JSON.stringify({status:'action',action:'select_places',route:[{intent:'coffee',placeId:'a'},{intent:'dinner',placeId:'b'},{intent:'coffee',placeId:'a'}]}),{headers:{'content-type':'application/json'}});
    }
    if(path==='/api/itineraries'){
      const request=JSON.parse(options.body);builds.push(request);if(builds.length===1)await gate;
      return new Response(JSON.stringify({...initial,request}),{headers:{'content-type':'application/json'}});
    }
    return fetchBase(input,options);
  };
  await mount();await click('Details');await input('.pl-trip-dialog input[max="10000000"]','90');await input('.pl-trip-dialog input[type="date"]','2026-12-04');await click('Update this plan');assert.equal(builds.length,1);
  state.user={...state.user,profile:{...state.user.profile,artists:['Tems'],vibes:['v-art']}};await act(async()=>window.dispatchEvent(new Event('focus')));
  const sent=await send();assert.equal(sent.context.budget,90);assert.equal(sent.context.date,'2026-12-04');assert.deepEqual(sent.context.people[0].artists,['Tems']);assert.deepEqual(sent.context.people[0].vibes,['v-art']);
  await act(async()=>release());
  assert.equal(builds.length,2);assert.equal(builds[1].budget,90);assert.equal(builds[1].date,'2026-12-04');assert.deepEqual(builds[1].people[0].artists,['Tems']);assert.deepEqual(builds[1].people[0].vibes,['v-art']);assert.deepEqual(builds[1].route.map(s=>s.placeId),['a','b','a']);
});

async function installUndoReceiptFixture({guest=false,partial=false,failRestore=false,pendingComparison=false,pendingRestore=false,titleSource}={}){
  const {decisionStops,comparisonKey}=await import('../src/decision-evidence.js');
  const {resultRouteSummary,resultPlaceLabel}=await import('../src/result-receipt.js');
  const initial=repeatedPlan({title:'Synthetic return visits',...(titleSource?{titleSource}:{}),activities:['coffee','dinner'],stopIntents:['coffee','dinner','coffee'],route:[{intent:'coffee',placeId:'a'},{intent:'dinner',placeId:'b'},{intent:'coffee',placeId:'a'}]});
  initial.stops[0].intent='coffee';initial.stops[1].intent='dinner';initial.stops.push({...initial.stops[0],id:'stop-2'});initial.budget.allocations.push({stopId:'stop-2',intent:'coffee',amount:null});
  if(partial){initial.stops[1]={...initial.stops[1],item:null,reason:'no_eligible_places',status:'unfilled'};initial.status='partial';}
  if(guest)localStorage.setItem('outing.saved-plans.v1',JSON.stringify([{id:'local-day',savedAt:'2026-11-08T00:00:00Z',plan:initial}]));
  else {account(london);initial.savedPlan={id:'saved-day',revision:1};state.savedPlan=initial;history.replaceState(null,'','/#/plan/saved-day');}
  const turns=[{id:'user-history',role:'user',text:'Keep my original visits.'},{id:'current-receipt',role:'assistant',text:resultRouteSummary(initial),result:{title:initial.request.title,detail:resultPlaceLabel(initial)}},{id:'old-comparison',role:'assistant',text:'Historical comparison stays unchanged.',comparisonKey:comparisonKey(initial,decisionStops(initial))},{id:'old-advice',role:'assistant',text:'Earlier advice stays unchanged.'}];
  const chatKey=`outing.chat:${guest?'guest':profile.id}:${guest?'':'saved-day'}`;sessionStorage.setItem(chatKey,JSON.stringify(turns));
  const fetchBase=globalThis.fetch,builds=[],restores=[],comparisons=[];let releaseComparison,releaseRestore;const gate=new Promise(resolve=>releaseComparison=resolve),restoreGate=new Promise(resolve=>releaseRestore=resolve);
  globalThis.fetch=async(input,options={})=>{
    const path=new URL(input,location.origin).pathname;
    if(path==='/api/itineraries'){
      const request=JSON.parse(options.body);builds.push(request);const result={...initial,request,status:'complete',stops:request.route.map((selected,index)=>({...initial.stops.find(stop=>stop.item?.id===selected.placeId),id:`stop-${index}`})),...(!guest?{savedPlan:{id:'saved-day',revision:2}}:{})};
      return new Response(JSON.stringify(result),{headers:{'content-type':'application/json'}});
    }
    if(path==='/api/account/plans/saved-day'&&options.method==='PATCH'){
      restores.push(JSON.parse(options.body));if(pendingRestore)await restoreGate;return new Response(JSON.stringify(failRestore?{error:'Synthetic restore conflict.'}:{...initial,savedPlan:{id:'saved-day',revision:3,title:'Stale restored saved day'}}),{status:failRestore?409:200,headers:{'content-type':'application/json'}});
    }
    if(path==='/api/agent'&&JSON.parse(options.body).task==='compare'){
      comparisons.push(options);if(pendingComparison)await gate;return new Response(JSON.stringify({status:'reply',text:pendingComparison?'Stale removed-route comparison.':'Fresh comparison.'}),{headers:{'content-type':'application/json'}});
    }
    return fetchBase(input,options);
  };
  await mount();if(guest){await click('Saved days');await act(async()=>document.querySelector('.pl-saved-item > button').click());}
  return {initial,builds,restores,comparisons,releaseComparison,releaseRestore,chatKey};
}
const currentReceipt=()=>document.querySelector('.cs-result-card').closest('article').textContent;
async function shortenUndoFixture(partial){
 if(partial)await click('Keep these places');
 else await act(async()=>[...document.querySelector('[data-stop-id="stop-2"]').querySelectorAll('button')].find(button=>button.textContent==='Remove stop').click());
}
for(const guest of [true,false])for(const partial of [false,true])test(`${guest?'guest':'saved account'} Undo refreshes the ${partial?'partial':'complete'} current receipt without rewriting historical chat`,async()=>{
  const fixture=await installUndoReceiptFixture({guest,partial});await shortenUndoFixture(partial);assert.equal(fixture.builds.length,1);assert.match(document.querySelector('.cs-result-card small').textContent,/2 stops/);
  const before=currentReceipt();await click('Undo');assert.notEqual(currentReceipt(),before);
  assert.match(currentReceipt(),partial?/Current outing: 1\. Fixture a → 2\. Still to find → 3\. Fixture a\..*1 requested visit is still unfilled\./:/Current outing: 1\. Fixture a → 2\. Fixture b → 3\. Fixture a\..*Visit times are not set\./);
  assert.match(document.querySelector('.cs-result-card small').textContent,partial?/2 stops/:/3 stops/);
  for(const text of ['Keep my original visits.','Historical comparison stays unchanged.','Earlier advice stays unchanged.'])assert.equal([...document.querySelectorAll('.cs-turn')].filter(turn=>turn.textContent.includes(text)).length,1);
  assert.equal(document.querySelectorAll('.cs-result-card').length,1);assert.equal(button('Undo'),undefined);
  if(guest)assert.equal(fixture.restores.length,0);else {assert.deepEqual(fixture.restores,[{revision:2,restoreRevision:1}]);const savedChat=JSON.parse(sessionStorage.getItem(fixture.chatKey));assert.match(savedChat.find(turn=>turn.id==='current-receipt').text,/3\. Fixture a/);assert.equal(savedChat.find(turn=>turn.id==='old-comparison').text,'Historical comparison stays unchanged.');}
});

test('failed saved-plan Undo leaves the current receipt and route unchanged',async()=>{
  const fixture=await installUndoReceiptFixture({failRestore:true});await shortenUndoFixture(false);const before=currentReceipt();await click('Undo');assert.equal(currentReceipt(),before);assert.equal(document.querySelectorAll('.outing-place').length,2);assert.ok(button('Undo'));assert.match(document.body.textContent,/Synthetic restore conflict/);assert.doesNotMatch(document.body.textContent,/Your previous day is restored/);assert.equal(fixture.restores.length,1);
});

test('Undo aborts a pending comparison for the removed route without changing the historical comparison',async()=>{
  const fixture=await installUndoReceiptFixture({pendingComparison:true});await shortenUndoFixture(false);assert.equal(fixture.comparisons.length,1);await click('Undo');assert.equal(fixture.comparisons[0].signal.aborted,true);await act(async()=>fixture.releaseComparison());assert.match(currentReceipt(),/3\. Fixture a/);assert.doesNotMatch(document.body.textContent,/Stale removed-route comparison/);assert.match(document.body.textContent,/Historical comparison stays unchanged/);
});

test('shared-day revisions refresh the current receipt without exposing local Undo',async()=>{
  const initial=repeatedPlan();state.shared={id:'synthetic-shared',revision:1,planRevision:1,status:'ready',access:{role:'owner',memberId:'test-user'},request:initial.request,plan:initial,events:[]};history.replaceState(null,'','/#/day/synthetic-shared?key=synthetic-only');await mount();assert.equal(button('Undo'),undefined);
  const next={...initial,request:{...initial.request,stopIntents:['drinks','drinks','drinks']},stops:[...initial.stops,{...initial.stops[0],id:'stop-2'}]};state.shared={...state.shared,revision:2,planRevision:2,request:next.request,plan:next};await act(async()=>document.dispatchEvent(new Event('visibilitychange')));assert.match(currentReceipt(),/3\. Fixture a/);assert.match(document.querySelector('.cs-result-card small').textContent,/3 stops/);assert.equal(button('Undo'),undefined);
});

for(const failRestore of [false,true])for(const transition of ['New day','account switch','sign out'])test(`delayed saved Undo ${failRestore?'failure':'success'} after ${transition} cannot change the current outing, chat, saved cache or error`,async()=>{
  const fixture=await installUndoReceiptFixture({pendingRestore:true,failRestore});await shortenUndoFixture(false);await click('Undo');assert.deepEqual(fixture.restores,[{revision:2,restoreRevision:1}]);
  if(transition==='New day')await click('New day');
  else {state.user=transition==='sign out'?null:{...state.user,id:'another-account',profile:{...profile,id:'another-account'},planningLocations:[paris],planningLocation:paris};await act(async()=>window.dispatchEvent(new Event('focus')));}
  await send();await click('Saved days');const hash=location.hash,planningArea=area();assert.equal(document.querySelector('.pl-saved-item'),null);
  await act(async()=>fixture.releaseRestore());
  assert.equal(location.hash,hash);assert.equal(area(),planningArea);assert.equal(document.querySelector('.cs-result-card'),null);assert.equal(document.querySelector('.pl-saved-item'),null);
  assert.match(document.body.textContent,/Synthetic test response/);assert.doesNotMatch(document.body.textContent,/Your previous day is restored|Synthetic restore conflict|Stale restored saved day|Historical comparison stays unchanged/);
  assert.equal(sessionStorage.getItem('outing.chat:another-account:saved-day'),null);assert.equal(sessionStorage.getItem('outing.chat:guest:saved-day'),null);
});

for(const failRestore of [false,true])test(`delayed saved Undo ${failRestore?'failure':'success'} cannot replace a newer selected route`,async()=>{
  const fixture=await installUndoReceiptFixture({pendingRestore:true,failRestore});await shortenUndoFixture(false);await click('Undo');
  await act(async()=>[...document.querySelector('[data-stop-id="stop-1"]').querySelectorAll('button')].find(button=>button.textContent==='Remove stop').click());
  const receipt=currentReceipt();assert.match(receipt,/Current outing: 1\. Fixture a\./);assert.equal(document.querySelectorAll('.outing-place').length,1);
  await act(async()=>fixture.releaseRestore());assert.equal(currentReceipt(),receipt);assert.equal(document.querySelectorAll('.outing-place').length,1);assert.doesNotMatch(document.body.textContent,/Your previous day is restored|Synthetic restore conflict/);
});

test('delayed saved Undo cannot restore a URL or session after the planner unmounts',async()=>{
  const fixture=await installUndoReceiptFixture({pendingRestore:true});await shortenUndoFixture(false);await click('Undo');
  const chat=sessionStorage.getItem(fixture.chatKey);await act(async()=>root.unmount());root=null;history.replaceState(null,'','/#/');await act(async()=>fixture.releaseRestore());
  assert.equal(location.hash,'#/');assert.equal(sessionStorage.getItem(fixture.chatKey),chat);
});

for(const transition of ['account switch','sign out'])test(`${transition} cannot copy the previous account chat to the new session namespace`,async()=>{
  await installUndoReceiptFixture();state.user=transition==='sign out'?null:{...state.user,id:'another-account',profile:{...profile,id:'another-account'}};
  await act(async()=>window.dispatchEvent(new Event('focus')));
  assert.equal(sessionStorage.getItem(`outing.chat:${state.user?.id||'guest'}:saved-day`),null);assert.doesNotMatch(document.body.textContent,/Historical comparison stays unchanged/);
});

for(const guest of [true,false])for(const rejected of [true,false])test(`${guest?'guest':'account'} reopened result explains selected ${rejected?'hard rejection':'missing evidence'} without substituting a venue`,async()=>{
  const initial=repeatedPlan({activities:['coffee'],stopIntents:['coffee','coffee'],route:[{intent:'coffee',placeId:'a'},{intent:'coffee',placeId:'b'}]});initial.status='partial';initial.stops[0].intent='coffee';initial.stops[1]={...initial.stops[1],intent:'coffee',item:null,status:'unfilled',reason:rejected?'selected_place_rejected':'selected_evidence_unavailable',selectionEvidence:{placeId:'b',status:rejected?'rejected':'unavailable',reason:rejected?'over_price_limit':'selected_evidence_unavailable'}};
  if(guest)localStorage.setItem('outing.saved-plans.v1',JSON.stringify([{id:'selected-local',savedAt:'2026-11-08T00:00:00Z',plan:initial}]));
  else {account(london);initial.savedPlan={id:'saved-day',revision:1};state.savedPlan=initial;history.replaceState(null,'','/#/plan/saved-day');}
  await mount();if(guest){await click('Saved days');await act(async()=>document.querySelector('.pl-saved-item > button').click());}
  const expected=rejected?/exceeds the current provider price-tier limit/:/compatible recent provider evidence is unavailable/;
  assert.match(currentReceipt(),expected);assert.match(document.body.textContent,/no other place was substituted/);assert.doesNotMatch(document.body.textContent,/couldn.t find coffee in this area/);assert.equal(document.querySelectorAll('.outing-place').length,1);assert.match(document.querySelector('.cs-result-card small').textContent,/1 stop/);
});

for(const titleSource of ['auto','custom','legacy'])test(`guest saved days and Undo retain ${titleSource} title provenance`,async()=>{
  const fixture=await installUndoReceiptFixture({guest:true,titleSource});
  await shortenUndoFixture(false);assert.equal(fixture.builds.at(-1).titleSource,titleSource);
  await click('Undo');assert.equal((await send()).context.titleSource,titleSource);
  await click('Save');
  const saved=JSON.parse(localStorage.getItem('outing.saved-plans.v1'));assert.equal(saved[0].plan.request.titleSource,titleSource);
  await click('New day');await click('Saved days');await act(async()=>document.querySelector('.pl-saved-item > button').click());
  const restored=await send();assert.equal(restored.context.titleSource,titleSource);assert.equal(restored.context.title,fixture.initial.request.title);
});

for(const guest of [true,false])test(`${guest?'guest':'account'} explicit name edits mark custom, ordinary details preserve it, and clearing resets automatic naming`,async()=>{
  const fixture=await installUndoReceiptFixture({guest,titleSource:'auto'});
  await click('Details');await input('.pl-trip-dialog input[maxlength="80"]','A day out');await input('.pl-trip-dialog input[type="date"]','2099-01-01');await click('Update this plan');
  assert.equal(fixture.builds.at(-1).titleSource,'custom');assert.equal(fixture.builds.at(-1).title,'A day out');assert.equal(document.querySelector('.cs-day-header h2').textContent,'A day out');
  await click('Details');await input('.pl-trip-dialog input[max="10000000"]','75');await click('Update this plan');
  assert.equal(fixture.builds.at(-1).titleSource,'custom');assert.equal(fixture.builds.at(-1).title,'A day out');
  await click('Details');await input('.pl-trip-dialog input[maxlength="80"]','');await click('Update this plan');
  assert.equal(fixture.builds.at(-1).titleSource,'auto');assert.equal(fixture.builds.at(-1).title,'');
  if(guest){await click('Undo');assert.equal((await send()).context.titleSource,'custom');assert.equal(document.querySelector('.cs-day-header h2').textContent,'A day out');}
});
