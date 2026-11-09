import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { apiServerInfo, PRODUCTION_API_ORIGIN } from '../src/transport.js';
import { createAccountSession } from '../src/account-session.js';

test('server label recognizes only the complete normalized production origin', () => {
  assert.deepEqual(apiServerInfo(), { origin: PRODUCTION_API_ORIGIN, isProduction: true });
  assert.deepEqual(apiServerInfo('https://UNSTRESSED.serendepify.com:443/'), { origin: PRODUCTION_API_ORIGIN, isProduction: true });
  for (const origin of [
    'https://staging.unstressed.serendepify.com',
    'https://unstressed.serendepify.com:8443',
    'https://unstressed.serendepify.com.example.test',
    'https://preview.example.test',
  ]) assert.deepEqual(apiServerInfo(origin), { origin, isProduction: false });
});

test('non-production label never relaxes origin validation or local HTTP restrictions', () => {
  assert.deepEqual(apiServerInfo('http://10.0.2.2:4000', true), { origin: 'http://10.0.2.2:4000', isProduction: false });
  for (const origin of [
    'https://user:password@staging.example.test',
    'https://staging.example.test/api',
    'https://staging.example.test/?token=secret',
    'https://staging.example.test/#secret',
    'http://staging.example.test',
  ]) assert.throws(() => apiServerInfo(origin, true));
  assert.throws(() => apiServerInfo('http://10.0.2.2:4000'));
});

// Source-wiring regressions only. These do not substitute for device rendering,
// large-text/accessibility checks, or a real browser/native sign-in session.
test('non-production destination is visible across tabs and the browser handoff uses the configured origin', async () => {
  const source = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(source, /<ApiServerNotice origin=\{origin\} nonProductionOnly \/>/);
  assert.match(source, /label="Open this server in browser"/);
  assert.match(source, /label="Open this server in browser"\s+icon="open-outline"\s+onPress=\{\(\) =>\s+Linking\.openURL\(origin\)/);
  assert.doesNotMatch(source, /Linking\.openURL\(["']https:\/\/unstressed\.serendepify\.com/);
});

test('account screen shows its actual session destination and can recheck a disabled flag', async () => {
  const source = await readFile(new URL('../src/components/AccountScreen.tsx', import.meta.url), 'utf8');
  assert.match(source, /<ApiServerNotice origin=\{session\.origin\} \/>/);
  assert.match(source, /!auth\.signingIn && <Button label="Check account availability"/);
  assert.match(source, /setEnabled\(null\); const config = await session\.config\(\); setEnabled\(config\.enabled === true\)/);
  assert.match(source, /disabled=\{enabled !== true \|\| busy\}/);
  assert.doesNotMatch(source, /You can keep planning as a guest/);
});

test('server notice preserves the full selectable origin and does not claim an isolated or ready service', async () => {
  const source = await readFile(new URL('../src/components/ApiServerNotice.tsx', import.meta.url), 'utf8');
  assert.match(source, /'Non-production server'/);
  assert.match(source, /<Text selectable style=\{styles\.origin\}>\{server\.origin\}<\/Text>/);
  assert.doesNotMatch(source, /numberOfLines|ellipsizeMode/);
  assert.match(source, /Planning may be unavailable/);
});

test('account configuration never opens a browser; explicit sign-in stays bound to the selected origin', async () => {
  for (const origin of [PRODUCTION_API_ORIGIN, 'https://staging.unstressed.serendepify.com']) {
    const requests = [], opened = [];
    const session = createAccountSession({
      origin, randomBytes: async () => new Uint8Array(32).fill(7), sha256: async () => 'challenge',
      openBrowser: async url => { opened.push(url); },
      fetch: async (url, options) => {
        requests.push({ url, options });
        const path = new URL(url).pathname;
        if (path.endsWith('/config')) return Response.json({ enabled: true });
        if (path.endsWith('/start')) return Response.json({ flowId: 'flow', browserUrl: `${origin}/api/auth/native/browser?flow=flow`, userCode: 'ABCD1234', expiresAt: Date.now() + 60000 });
        if (path.endsWith('/exchange')) return Response.json({ accessToken: 'ust_native_synthetic', expiresAt: Date.now() + 60000 });
        if (path.endsWith('/account')) return Response.json({ user: { id: 'synthetic' } });
        throw new Error('Unexpected fixture request');
      },
    });
    assert.deepEqual(requests, []); assert.deepEqual(opened, []);
    await session.config(); assert.deepEqual(opened, []);
    await session.signIn();
    assert.deepEqual(opened, [`${origin}/api/auth/native/browser?flow=flow`]);
    for (const { url, options } of requests) {
      assert.equal(new URL(url).origin, origin);
      assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
      assert.equal(options.headers.cookie, undefined); assert.equal(options.headers.origin, undefined);
    }
  }
});

test('production and preview browser approval URLs cannot cross the selected API origin', async () => {
  for (const [origin, other] of [[PRODUCTION_API_ORIGIN, 'https://staging.unstressed.serendepify.com'], ['https://staging.unstressed.serendepify.com', PRODUCTION_API_ORIGIN]]) {
    let opened = false;
    const session = createAccountSession({
      origin, randomBytes: async () => new Uint8Array(32).fill(7), sha256: async () => 'challenge',
      openBrowser: async () => { opened = true; },
      fetch: async () => Response.json({ flowId: 'flow', browserUrl: `${other}/api/auth/native/browser?flow=flow`, userCode: 'ABCD1234', expiresAt: Date.now() + 60000 }),
    });
    await assert.rejects(session.signIn(), /not trusted/);
    assert.equal(opened, false); assert.equal(session.getAuthorization(), null);
  }
});
