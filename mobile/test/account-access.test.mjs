import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAccountSession, isReadOnlySession } from '../src/account-session.js';
import { createApi } from '../src/transport.js';

function fixture(accessMode, publicMode = 'account-sync', timerOptions = {}) {
  let now = 1000;
  const calls = [], origin = 'https://preview.example.test';
  const session = createAccountSession({
    ...timerOptions,
    origin, now: () => now, randomBytes: async () => new Uint8Array(32).fill(7), sha256: async () => 'challenge', openBrowser: async () => {},
    fetch: async (url, options) => {
      const path = new URL(url).pathname; calls.push({ path, method: options.method });
      if (path.endsWith('/config')) return Response.json({ enabled: true, accessMode: publicMode });
      if (path.endsWith('/start')) return Response.json({ flowId: 'flow', browserUrl: `${origin}/api/auth/native/browser?flow=flow`, userCode: 'ABCD1234', expiresAt: 61000 });
      if (path.endsWith('/exchange')) return Response.json({ accessToken: 'ust_native_synthetic', expiresAt: 61000, accessMode });
      if (path.endsWith('/account')) return Response.json({ user: { id: 'synthetic' } });
      return Response.json({ ok: true });
    },
  });
  return { session, calls, advance: () => { now = 62000; } };
}

test('issued mode is memory-only and public config cannot upgrade a read-only session', async () => {
  const f = fixture('read-only');
  assert.equal((await f.session.config()).accessMode, 'account-sync');
  await f.session.signIn(); assert.equal(f.session.getSnapshot().accessMode, 'read-only');
  await f.session.config(); assert.equal(f.session.getSnapshot().accessMode, 'read-only');
  assert.equal(isReadOnlySession(f.session.getSnapshot()), true);
  assert.ok(!JSON.stringify(f.session.getSnapshot()).includes('ust_native_'));
  await f.session.logout(); assert.equal(f.session.getSnapshot().accessMode, null);
  assert.equal(fixture('account-sync').session.getSnapshot().accessMode, null);
});

test('missing or unknown issued mode fails closed for account writes and planning before fetch', async () => {
  for (const mode of [undefined, null, 'unknown', 'READ-ONLY', 'read-only']) {
    const f = fixture(mode); await f.session.signIn();
    assert.equal(f.session.getSnapshot().accessMode, 'read-only');
    const before = f.calls.length;
    for (const method of ['POST', 'PATCH', 'DELETE', 'patch'])
      await assert.rejects(f.session.account('/profile', { method, body: {} }), /read-only/);
    let calls = 0;
    const api = createApi({ origin: 'https://preview.example.test', getAuthorization: f.session.getPlanningAuthorization, fetch: async () => { calls++; return Response.json({}); } });
    await assert.rejects(api.agent({}), /read-only/); await assert.rejects(api.itinerary({}), /read-only/);
    assert.equal(calls, 0); assert.equal(f.calls.length, before);
    await f.session.account('/plans'); await f.session.logout();
    assert.equal(f.session.getPlanningAuthorization(), null);
  }
});

test('only issued account-sync mode permits writes and expiry still fails before guest fallback', async () => {
  const f = fixture('account-sync', 'read-only'); await f.session.signIn();
  assert.equal(isReadOnlySession(f.session.getSnapshot()), false);
  assert.match(f.session.getPlanningAuthorization(), /^Bearer ust_native_/);
  await f.session.account('/profile', { method: 'PATCH', body: { name: 'Synthetic' } });
  assert.equal(f.calls.at(-1).method, 'PATCH');
  f.advance(); let calls = 0;
  const api = createApi({ origin: 'https://preview.example.test', getAuthorization: f.session.getPlanningAuthorization, fetch: async () => { calls++; return Response.json({}); } });
  await assert.rejects(api.agent({}), /expired/); assert.equal(calls, 0);
  assert.equal(f.session.getSnapshot().signedIn, false); assert.equal(f.session.getSnapshot().accessMode, null);
});

test('planning cannot use a just-issued token before the account identity and private workspace are established', async () => {
  let release, arrived;
  const started = new Promise(resolve => { arrived = resolve; });
  const origin = 'https://preview.example.test';
  const session = createAccountSession({
    origin, randomBytes: async () => new Uint8Array(32).fill(7), sha256: async () => 'challenge', openBrowser: async () => {},
    fetch: async url => {
      if (url.endsWith('/start')) return Response.json({ flowId: 'flow', browserUrl: `${origin}/api/auth/native/browser?flow=flow`, userCode: 'ABCD1234', expiresAt: Date.now() + 60000 });
      if (url.endsWith('/exchange')) return Response.json({ accessToken: 'ust_native_synthetic', expiresAt: Date.now() + 60000, accessMode: 'account-sync' });
      arrived(); await new Promise(resolve => { release = resolve; });
      return Response.json({ user: { id: 'synthetic' } });
    },
  });
  const signingIn = session.signIn(); await started;
  assert.throws(session.getPlanningAuthorization, /still finishing/);
  release(); await signingIn;
  assert.match(session.getPlanningAuthorization(), /^Bearer ust_native_/);
});

test('issued deadline resets private session state without a request and logout cancels its timer', async () => {
  const timers = [], cancelled = [], states = [];
  const timerOptions = { schedule: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; }, cancelSchedule: timer => cancelled.push(timer) };
  const f = fixture('read-only', 'read-only', timerOptions);
  f.session.subscribe(state => states.push(state)); await f.session.signIn();
  assert.equal(timers.length, 1); assert.equal(timers[0].delay, 60000);
  f.advance(); timers[0].callback();
  assert.equal(states.at(-1).signedIn, false); assert.equal(states.at(-1).accessMode, null);
  assert.equal(states.at(-1).userId, null); assert.equal(f.session.getAuthorization(), null);
  const g = fixture('account-sync', 'account-sync', timerOptions); await g.session.signIn();
  const oldTimer = timers.at(-1); await g.session.logout(); assert.ok(cancelled.includes(oldTimer));
  await g.session.signIn(); const active = g.session.getSnapshot();
  oldTimer.callback(); assert.equal(g.session.getSnapshot().sessionEpoch, active.sessionEpoch);
  assert.equal(g.session.getSnapshot().signedIn, true);
  await g.session.logout();
});

test('foreground snapshot validation clears an expired session when the OS paused its timer', async () => {
  let callback;
  const f = fixture('read-only', 'read-only', { schedule: fn => { callback = fn; return 1; }, cancelSchedule: () => {} });
  await f.session.signIn(); f.advance();
  assert.equal(f.session.getSnapshot().signedIn, false);
  assert.equal(f.session.getSnapshot().accessMode, null);
  callback(); assert.equal(f.session.getSnapshot().signedIn, false);
});

test('cancelled sign-in late profile success or failure cannot clear a newer completed session', async () => {
  for (const lateResponse of [
    () => Response.json({ user: { id: 'old' } }),
    () => Response.json({ error: 'Old session rejected' }, { status: 401 }),
    () => { throw new Error('Old connection failed'); },
  ]) {
    let starts = 0, releaseOld, oldStarted;
    const started = new Promise(resolve => { oldStarted = resolve; });
    const origin = 'https://preview.example.test';
    const session = createAccountSession({
      origin, randomBytes: async () => new Uint8Array(32).fill(7), sha256: async () => 'challenge', openBrowser: async () => {},
      fetch: async (url, options) => {
        if (url.endsWith('/start')) { starts++; return Response.json({ flowId: `flow${starts}`, browserUrl: `${origin}/api/auth/native/browser?flow=flow${starts}`, userCode: 'ABCD1234', expiresAt: Date.now() + 60000 }); }
        if (url.endsWith('/exchange')) return Response.json({ accessToken: `ust_native_token${starts}`, expiresAt: Date.now() + 60000, accessMode: starts === 1 ? 'read-only' : 'account-sync' });
        if (url.endsWith('/account')) {
          if (options.headers.authorization === 'Bearer ust_native_token1') {
            oldStarted(); await new Promise(resolve => { releaseOld = resolve; });
            return lateResponse();
          }
          return Response.json({ user: { id: 'new' } });
        }
        return Response.json({ ok: true });
      },
    });
    const oldAttempt = session.signIn();
    const rejected = assert.rejects(oldAttempt, /cancelled|Old connection failed/);
    await started; await session.cancelSignIn(); await session.signIn();
    const fresh = session.getSnapshot();
    assert.equal(fresh.signedIn, true); assert.equal(fresh.userId, 'new'); assert.equal(fresh.accessMode, 'account-sync');
    releaseOld(); await rejected;
    assert.deepEqual(session.getSnapshot(), fresh);
    assert.equal(session.getPlanningAuthorization(), 'Bearer ust_native_token2');
    assert.equal((await session.account()).user.id, 'new');
    await session.logout();
  }
});

test('read-only app preview avoids planner, local-copy and venue-refresh UI while preserving guest restoration wiring', async () => {
  // Wiring assertions only, not a claim of native rendering/device acceptance.
  const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(app, /getAuthorization: accountSession\.getPlanningAuthorization/);
  assert.match(app, /readOnly && section !== "account"/);
  assert.match(app, /if \(isReadOnlySession\(opening\)\) \{\s+setReadOnlyPlan\(plan\)/);
  assert.match(app, /filter\(item => !readOnly \|\| item\.value === "plan" \|\| item\.value === "account"\)/);
  assert.match(app, /accountWorkspace\.switchIdentity\(identity, current\.current\)/);
  assert.match(app, /setReadOnlyPlan\(null\)/);
  assert.match(app, /if \(state === "active"\) accountSession\.getSnapshot\(\)/);
  assert.match(app, /getPlanningAuthorization\(\) !== startingAuthorization/);
  const account = await readFile(new URL('../src/components/AccountScreen.tsx', import.meta.url), 'utf8');
  assert.match(account, /Read-only account pilot/);
  assert.match(account, /label="Edit account name and tastes" quiet disabled=\{busy \|\| readOnly/);
  assert.match(account, /label="Invite connected people" quiet disabled=\{busy \|\| readOnly/);
  assert.match(account, /label="Interested" quiet disabled=\{busy \|\| readOnly\}/);
  assert.match(account, /label="Sign out of this app"/);
});
