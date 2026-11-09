import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApi } from '../src/transport.js';
import { createAccountSession, connectedPeople, signInRetryDelay } from '../src/account-session.js';
const origin = 'https://unstressed.example';
const token = `ust_native_${'a'.repeat(43)}`;
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
function fixture(overrides = {}) {
  const calls = [], browser = [];
  const fetch = async (url, options) => {
    calls.push({ url, ...options });
    const path = new URL(url).pathname;
    if (path.endsWith('/start')) return response({ flowId: 'flow', browserUrl: `${origin}/api/auth/native/browser?flow=flow`, expiresAt: Date.now()+60000, userCode: 'ABCD1234', pollInterval: 2 });
    if (path.endsWith('/exchange')) return response({ accessToken: token, tokenType: 'Bearer', expiresAt: Date.now()+60000 });
    if (path.endsWith('/account')) return response({ user: { id: 'owner' }, circles: [] });
    return response({ ok: true });
  };
  const session = createAccountSession({ origin, fetch, randomBytes: async () => new Uint8Array(32).fill(7), sha256: async value => createHash('sha256').update(value).digest('base64'), openBrowser: async url => browser.push(url), ...overrides });
  return { session, calls, browser };
}
test('PKCE verifier stays in POST body and bearer is memory-only, scoped and never in browser URL', async () => {
  const { session, calls, browser } = fixture();
  await session.signIn();
  assert.equal(session.getSnapshot().userId, 'owner');
  assert.equal(session.getAuthorization(), `Bearer ${token}`);
  assert.equal(browser[0], `${origin}/api/auth/native/browser?flow=flow`);
  const start = calls.find(c => c.url.endsWith('/start')), exchange = calls.find(c => c.url.endsWith('/exchange'));
  const verifier = JSON.parse(exchange.body).codeVerifier;
  assert.equal(JSON.parse(start.body).codeChallenge, createHash('sha256').update(verifier).digest('base64url'));
  assert.equal(start.headers.authorization, undefined);
  assert.equal(exchange.headers.authorization, undefined);
  for (const call of calls) { assert.equal(call.credentials, 'omit'); assert.equal(call.redirect, 'error'); assert.ok(!call.url.includes(token)); assert.ok(!call.url.includes(verifier)); }
  assert.ok(!JSON.stringify(session.getSnapshot()).includes(token));
  await assert.rejects(session.account('/../../days'), /Unsupported/);
  await session.logout();
  assert.equal(session.getAuthorization(), null);
  assert.equal(session.getSnapshot().userId, null);
});
test('untrusted browser destinations and malformed approval code are rejected before opening', async () => {
  for (const browserUrl of ['https://evil.example/api/auth/native/browser?flow=flow', `${origin}/redirect?flow=flow`, `${origin}/api/auth/native/browser?flow=flow&redirect=https://evil.example`]) {
    let opened = false;
    const { session } = fixture({ fetch: async () => response({ flowId: 'flow', browserUrl, userCode: 'ABCD1234', expiresAt: Date.now()+60000 }), openBrowser: async () => { opened = true; } });
    await assert.rejects(session.signIn(), /not trusted/); assert.equal(opened, false); assert.equal(session.getAuthorization(), null);
  }
});
test('logout clears local session even when revocation fails', async () => {
  const f = fixture(); const original = f.session;
  await original.signIn();
  // A separate fixture exercises a failing logout without exposing session internals.
  const g = fixture({ fetch: async (url) => {
    if (url.endsWith('/start')) return response({ flowId: 'flow', browserUrl: `${origin}/api/auth/native/browser?flow=flow`, userCode: 'ABCD1234', expiresAt: Date.now()+60000 });
    if (url.endsWith('/exchange')) return response({ accessToken: token, expiresAt: Date.now()+60000 });
    if (url.endsWith('/account')) return response({ user: { id: 'owner' } });
    throw new Error('offline');
  } });
  await g.session.signIn(); await assert.rejects(g.session.logout(), /Server revocation could not be confirmed/); assert.equal(g.session.getAuthorization(), null);
});
test('expired session and matching unauthorized bearer clear identity', async () => {
  let now = Date.now(); const f = fixture({ now: () => now }); await f.session.signIn();
  f.session.invalidateAuthorization('Bearer old'); assert.ok(f.session.getAuthorization());
  f.session.invalidateAuthorization(`Bearer ${token}`); assert.equal(f.session.getAuthorization(), null);
  const g = fixture({ now: () => now }); await g.session.signIn(); now += 120000; assert.throws(() => g.session.getAuthorization(), /session expired/); assert.equal(g.session.getAuthorization(), null); assert.equal(g.session.getSnapshot().userId, null);
});
test('cancelled exchange cannot restore token or identity', async () => {
  let finish, exchangeStarted;
  const started = new Promise(resolve => { exchangeStarted = resolve; });
  const f = fixture({ fetch: async url => {
    if (url.endsWith('/start')) return response({ flowId: 'flow', browserUrl: `${origin}/api/auth/native/browser?flow=flow`, userCode: 'ABCD1234', expiresAt: Date.now()+60000 });
    if (url.endsWith('/exchange')) { exchangeStarted(); return new Promise(resolve => { finish = resolve; }); }
    return response({ ok: true });
  } });
  const task = f.session.signIn(); await started; await f.session.cancelSignIn(); finish(response({ accessToken: token, expiresAt: Date.now()+60000 }));
  await assert.rejects(task, /cancelled/); assert.equal(f.session.getAuthorization(), null);
});
test('only accepted account people become invitation candidates, never guest names', () => {
  const owner = { id: 'self', name: 'Me' }, friend = { id: 'friend', name: 'Friend' }, guest = { id: 'guest', name: 'Guest' };
  assert.deepEqual(connectedPeople({ user: owner, circles: [{ people: [owner, friend, guest], accountIds: ['self', 'friend'] }, { people: [friend], accountIds: ['friend'] }] }), [friend]);
});
test('a stale account read cannot return after logout, and 401 clears the current session', async () => {
  let release, readStarted, reads = 0;
  const started = new Promise(resolve => { readStarted = resolve; });
  const f = fixture({ fetch: async url => {
    if (url.endsWith('/start')) return response({ flowId: 'flow', browserUrl: `${origin}/api/auth/native/browser?flow=flow`, userCode: 'Q_-Z1234', expiresAt: Date.now()+60000 });
    if (url.endsWith('/exchange')) return response({ accessToken: token, expiresAt: Date.now()+60000 });
    if (url.endsWith('/account') && reads++ === 0) return response({ user: { id: 'owner' } });
    if (url.endsWith('/plans')) { readStarted(); return new Promise(resolve => { release = resolve; }); }
    return response({ ok: true });
  } });
  await f.session.signIn(); const request = f.session.account('/plans'); await started; await f.session.logout(); release(response({ plans: [{ title: 'Private' }] })); await assert.rejects(request, /cancelled/);
  const g = fixture({ fetch: async url => {
    if (url.endsWith('/start')) return response({ flowId: 'flow', browserUrl: `${origin}/api/auth/native/browser?flow=flow`, userCode: 'ABCD1234', expiresAt: Date.now()+60000 });
    if (url.endsWith('/exchange')) return response({ accessToken: token, expiresAt: Date.now()+60000 });
    if (url.endsWith('/account')) return response({ user: { id: 'owner' } });
    return response({ error: 'Session expired' }, 401);
  } });
  await g.session.signIn(); await assert.rejects(g.session.account('/plans'), /Session expired/); assert.equal(g.session.getAuthorization(), null);
});

test('undeployed native config reports unavailable, but network failures remain visible', async () => {
  const f = fixture({ fetch: async () => ({ ok: false, status: 404, json: async () => { throw new Error('HTML fallback'); } }) });
  assert.deepEqual(await f.session.config(), { enabled: false, available: false });
  const g = fixture({ fetch: async () => { throw new Error('offline'); } });
  await assert.rejects(g.session.config(), /offline/);
});
test('expired account planning never falls back to an unauthenticated guest request', async () => {
  let now = Date.now(), fetches = 0;
  const f = fixture({ now: () => now }); await f.session.signIn(); now += 120000;
  const api = createApi({ origin, fetch: async () => { fetches++; return response({}); }, getAuthorization: f.session.getAuthorization });
  await assert.rejects(api.agent({}), /session expired/);
  assert.equal(fetches, 0); assert.equal(f.session.getSnapshot().signedIn, false); assert.equal(f.session.getSnapshot().userId, null);
});

test('explicit exchange 429 backs off, honors Retry-After, and then completes', async () => {
  let now = Date.now(), exchanges = 0;
  const waits = [], statuses = [];
  const f = fixture({ now: () => now, wait: async ms => { waits.push(ms); now += ms; }, fetch: async url => {
    if (url.endsWith('/start')) return response({ flowId: 'flow', browserUrl: `${origin}/api/auth/native/browser?flow=flow`, userCode: 'ABCD1234', expiresAt: now+60000 });
    if (url.endsWith('/exchange')) {
      exchanges++;
      if (exchanges === 1) return { ...response({ error: 'Busy' }, 429), headers: new Headers({ 'Retry-After': '7' }) };
      if (exchanges === 2) return response({ error: 'Busy' }, 429);
      if (exchanges === 3) return response({ status: 'pending' }, 202);
      return response({ accessToken: token, expiresAt: now+60000 });
    }
    return response({ user: { id: 'owner' } });
  } });
  f.session.subscribe(state => statuses.push(state.signInStatus));
  await f.session.signIn(); assert.deepEqual(waits, [7000, 10000, 2000]); assert.equal(exchanges, 4);
  assert.ok(statuses.some(status => status?.includes('Retrying automatically'))); assert.equal(f.session.getSnapshot().signInStatus, null);
  assert.equal(f.session.getSnapshot().signedIn, true);
});
test('rate-limit backoff ends at the original flow deadline without another exchange', async () => {
  let now = Date.now(), exchanges = 0; const waits = [];
  const f = fixture({ now: () => now, wait: async ms => { waits.push(ms); now += ms; }, fetch: async url => {
    if (url.endsWith('/start')) return response({ flowId: 'flow', browserUrl: `${origin}/api/auth/native/browser?flow=flow`, userCode: 'ABCD1234', expiresAt: now+3000 });
    exchanges++; return { ...response({}, 429), headers: new Headers({ 'Retry-After': '999999' }) };
  } });
  await assert.rejects(f.session.signIn(), /Sign-in expired/); assert.deepEqual(waits, [3000]); assert.equal(exchanges, 1); assert.equal(f.session.getSnapshot().signingIn, false);
});
test('rate-limited polling remains immediately cancellable', async () => {
  let retrying; const ready = new Promise(resolve => { retrying = resolve; }); let exchanges = 0;
  const f = fixture({ fetch: async url => {
    if (url.endsWith('/start')) return response({ flowId: 'flow', browserUrl: `${origin}/api/auth/native/browser?flow=flow`, userCode: 'ABCD1234', expiresAt: Date.now()+60000 });
    if (url.endsWith('/exchange')) { exchanges++; return response({}, 429); }
    return response({ ok: true });
  } });
  f.session.subscribe(state => { if (state.signInStatus) retrying(); });
  const task = f.session.signIn(); const rejected = assert.rejects(task, /cancelled/); await ready; await f.session.cancelSignIn(); await rejected;
  assert.equal(exchanges, 1); assert.equal(f.session.getSnapshot().signingIn, false); assert.equal(f.session.getSnapshot().signInStatus, null);
});
test('uncertain exchange outcomes and non-429 failures never retry', async () => {
  for (const failure of [() => { throw new Error('network failed'); }, () => response({}, 500), () => response({}, 403), () => ({ ok: true, status: 200, json: async () => { throw new Error('truncated success'); } })]) {
    let exchanges = 0, waits = 0;
    const f = fixture({ wait: async () => { waits++; }, fetch: async url => {
      if (url.endsWith('/start')) return response({ flowId: 'flow', browserUrl: `${origin}/api/auth/native/browser?flow=flow`, userCode: 'ABCD1234', expiresAt: Date.now()+60000 });
      exchanges++; return failure();
    } });
    await assert.rejects(f.session.signIn()); assert.equal(exchanges, 1); assert.equal(waits, 0); assert.equal(f.session.getSnapshot().signedIn, false);
  }
});
test('429 does not retry start or account mutations', async () => {
  let requests = 0;
  const f = fixture({ fetch: async () => { requests++; return response({}, 429); }, wait: async () => assert.fail('Unexpected retry') });
  await assert.rejects(f.session.signIn()); assert.equal(requests, 1);
  let mutations = 0;
  const g = fixture({ fetch: async url => {
    if (url.endsWith('/start')) return response({ flowId: 'flow', browserUrl: `${origin}/api/auth/native/browser?flow=flow`, userCode: 'ABCD1234', expiresAt: Date.now()+60000 });
    if (url.endsWith('/exchange')) return response({ accessToken: token, expiresAt: Date.now()+60000 });
    if (url.endsWith('/account')) return response({ user: { id: 'owner' } });
    mutations++; return response({}, 429);
  } });
  await g.session.signIn(); await assert.rejects(g.session.account('/profile', { method: 'PATCH', body: { name: 'Test' } })); assert.equal(mutations, 1);
});

test('Retry-After parser accepts seconds and HTTP dates with safe fallback and polling floors', () => {
  const now = Date.UTC(2026, 10, 9);
  assert.equal(signInRetryDelay('12', 0, now), 12000);
  assert.equal(signInRetryDelay(new Date(now + 19000).toUTCString(), 0, now), 19000);
  assert.equal(signInRetryDelay('0', 0, now), 2000);
  assert.equal(signInRetryDelay('-1', 0, now), 5000);
  assert.equal(signInRetryDelay('garbage', 1, now), 10000);
  assert.equal(signInRetryDelay(null, 99, now), 60000);
});
test('cancelled old backoff cannot resume exchanges or overwrite a replacement session', async () => {
  let resumeOld, waiting, flowNumber = 0, oldExchanges = 0;
  const ready = new Promise(resolve => { waiting = resolve; });
  const f = fixture({ wait: async () => { waiting(); return new Promise(resolve => { resumeOld = resolve; }); }, fetch: async (url, options) => {
    if (url.endsWith('/start')) { const flowId = `flow${++flowNumber}`; return response({ flowId, browserUrl: `${origin}/api/auth/native/browser?flow=${flowId}`, userCode: 'ABCD1234', expiresAt: Date.now()+60000 }); }
    if (url.endsWith('/exchange')) {
      if (JSON.parse(options.body).flowId === 'flow1') { oldExchanges++; return response({}, 429); }
      return response({ accessToken: token, expiresAt: Date.now()+60000 });
    }
    if (url.endsWith('/account')) return response({ user: { id: 'replacement-owner' } });
    return response({ ok: true });
  } });
  const old = f.session.signIn(); const rejection = assert.rejects(old, /cancelled/); await ready; await f.session.cancelSignIn();
  await f.session.signIn(); const replacementEpoch = f.session.getSnapshot().sessionEpoch;
  resumeOld(); await rejection; assert.equal(oldExchanges, 1); assert.equal(f.session.getSnapshot().userId, 'replacement-owner'); assert.equal(f.session.getSnapshot().sessionEpoch, replacementEpoch);
});
