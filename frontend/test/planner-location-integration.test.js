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
  await click(area()); await click('A specific place');
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
    await mount(); await click('Add usual areas'); await click('A specific place');
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
