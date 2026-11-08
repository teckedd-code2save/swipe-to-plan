// Selectively adapted from Outing Actions route evidence (MIT), source revision 16b1c63.
// Copyright (c) 2026 Outing Actions contributors; see backend/licenses/outing-actions-MIT.txt.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { createDemoProvider } from '../src/demo-provider.js';
import { createRouteActions, parseRouteRequest } from '../src/route-actions.js';

// Synthetic addresses and measurements only. Never use environment keys or a live provider.
const NOW = Date.parse('2026-11-08T06:00:00Z');
const now = () => NOW;
const raw = () => ({
  requestId: 'route-1', itineraryRevision: 3, mode: 'DRIVE',
  origin: { id: 'coffee-first', entityId: 'qloo:venue-one', name: 'First fixture', coordinates: { lat: 0, lng: 0 } },
  stops: [{ id: 'coffee-second', entityId: 'qloo:venue-two', name: 'Second fixture', address: 'Destination fixture' }],
  departureAt: '2026-11-08T18:00:00+02:00',
});
const measuredRoute = () => ({ distanceMeters: 3000, duration: '300.5s', legs: [{ distanceMeters: 3000, duration: '300.5s' }] });
const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
const service = (payload = { routes: [measuredRoute()] }, options = {}) => createRouteActions({
  apiKey: 'fixture-not-a-real-key', now, fetchImpl: async () => response(payload), ...options,
});
const invalid = body => assert.throws(() => parseRouteRequest(body, { now }), { code: 'invalid_request', status: 400 });
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

test('one-journey evidence keeps slot and venue identities without schedule or input mutations', async () => {
  const body = freeze(raw()), original = structuredClone(body);
  let sent;
  const result = await service(undefined, { fetchImpl: async (url, options) => {
    assert.equal(url, 'https://routes.googleapis.com/directions/v2:computeRoutes');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['X-Goog-Api-Key'], 'fixture-not-a-real-key');
    assert.equal(options.headers['X-Goog-FieldMask'], 'routes.duration,routes.distanceMeters,routes.legs.duration,routes.legs.distanceMeters,fallbackInfo');
    sent = JSON.parse(options.body);
    assert.ok(options.signal instanceof AbortSignal);
    return response({ routes: [measuredRoute()] });
  } }).estimate(body);
  assert.deepEqual(sent, {
    origin: { location: { latLng: { latitude: 0, longitude: 0 } } }, destination: { address: 'Destination fixture' },
    travelMode: 'DRIVE', computeAlternativeRoutes: false, units: 'METRIC', routingPreference: 'TRAFFIC_AWARE',
    departureTime: '2026-11-08T16:00:00.000Z',
  });
  assert.equal(result.source, 'google_routes');
  assert.equal(result.measuredAt, '2026-11-08T06:00:00.000Z');
  assert.equal(result.requestId, body.requestId);
  assert.equal(result.itineraryRevision, body.itineraryRevision);
  assert.equal(result.departureAt, sent.departureTime);
  assert.equal(result.distanceMeters, 3000);
  assert.equal(result.durationSeconds, 300.5);
  assert.equal(result.trafficAware, true);
  assert.equal(result.scheduleFeasibility, 'not_evaluated');
  assert.equal(result.includesVisitDurations, false);
  assert.equal(result.includesPlanningBuffers, false);
  assert.deepEqual(result.selectedStops, body.stops);
  assert.deepEqual(result.legs, [{ from: body.origin, to: body.stops[0], source: 'google_routes',
    measuredAt: result.measuredAt, mode: 'DRIVE', departureAt: result.departureAt, distanceMeters: 3000, durationSeconds: 300.5 }]);
  assert.deepEqual(body, original);
  assert.notEqual(result.selectedStops[0], body.stops[0]);
  const navigation = new URL(result.navigationUrl);
  assert.equal(navigation.searchParams.get('origin'), '0,0');
  assert.equal(navigation.searchParams.get('destination'), body.stops[0].address);
  assert.equal(navigation.searchParams.get('travelmode'), 'driving');
  assert.doesNotMatch(JSON.stringify(result), /fixture-not-a-real-key/);
});

test('walk and transit use supported provider semantics; omitted departure is never inferred', async () => {
  for (const mode of ['WALK', 'TRANSIT']) {
    const sent = [];
    const routes = service(undefined, { fetchImpl: async (_url, options) => {
      sent.push(JSON.parse(options.body)); return response({ routes: [measuredRoute()] });
    } });
    const scheduled = await routes.estimate({ ...raw(), mode });
    const leavingNow = await routes.estimate({ ...raw(), mode, departureAt: undefined });
    assert.equal(scheduled.trafficAware, false);
    assert.equal(sent[0].routingPreference, undefined);
    assert.equal(sent[0].travelMode, mode);
    assert.equal(sent[0].departureTime, mode === 'TRANSIT' ? scheduled.departureAt : undefined);
    assert.equal(scheduled.legs[0].departureAt, mode === 'TRANSIT' ? scheduled.departureAt : null);
    assert.equal(sent[1].departureTime, undefined);
    assert.equal(leavingNow.departureAt, undefined);
    assert.equal(leavingNow.legs[0].departureAt, null);
  }
});

test('traffic-unaware driving fallbacks never produce estimates labeled traffic-aware', async () => {
  for (const reason of ['SERVER_ERROR', 'LATENCY_EXCEEDED', 'FALLBACK_REASON_UNSPECIFIED', undefined]) {
    const input = freeze(raw());
    const routes = service({ routes: [measuredRoute()], fallbackInfo: { routingMode: 'FALLBACK_TRAFFIC_UNAWARE', ...(reason ? { reason } : {}) } });
    await assert.rejects(routes.estimate(input), { code: 'routes_traffic_unavailable', status: 502 });
    assert.deepEqual(input, raw());
  }
});

test('absent or traffic-aware fallback retains driving evidence and non-driving modes stay non-traffic-aware', async () => {
  for (const fallbackInfo of [undefined, { routingMode: 'FALLBACK_TRAFFIC_AWARE', reason: 'SERVER_ERROR' },
    { routingMode: 'FALLBACK_TRAFFIC_AWARE', reason: 'LATENCY_EXCEEDED' }, { routingMode: 'FALLBACK_TRAFFIC_AWARE' }]) {
    const result = await service({ routes: [measuredRoute()], ...(fallbackInfo ? { fallbackInfo } : {}) }).estimate(raw());
    assert.equal(result.trafficAware, true);
    assert.equal(result.durationSeconds, 300.5);
    assert.equal(result.requestId, 'route-1');
    assert.equal(result.itineraryRevision, 3);
    assert.equal(result.departureAt, '2026-11-08T16:00:00.000Z');
    assert.deepEqual(result.selectedStops, raw().stops);
  }
  for (const mode of ['WALK', 'TRANSIT']) {
    for (const routingMode of ['FALLBACK_TRAFFIC_UNAWARE', 'FALLBACK_TRAFFIC_AWARE']) {
      const result = await service({ routes: [measuredRoute()], fallbackInfo: { routingMode, reason: 'SERVER_ERROR' } }).estimate({ ...raw(), mode });
      assert.equal(result.trafficAware, false);
      assert.equal(result.mode, mode);
      assert.equal(result.durationSeconds, 300.5);
      assert.equal(result.legs[0].departureAt, mode === 'WALK' ? null : result.departureAt);
    }
  }
});

test('malformed or unknown fallback metadata cannot certify provider routing semantics', async () => {
  for (const fallbackInfo of [null, [], {}, 'FALLBACK_TRAFFIC_AWARE', { reason: 'SERVER_ERROR' },
    { routingMode: 'FALLBACK_ROUTING_MODE_UNSPECIFIED' }, { routingMode: 'UNKNOWN' }, { routingMode: 2 },
    { routingMode: 'FALLBACK_TRAFFIC_AWARE', reason: {} }, { routingMode: 'FALLBACK_TRAFFIC_AWARE', reason: 'UNKNOWN' },
    { routingMode: 'FALLBACK_TRAFFIC_UNAWARE', reason: null }]) {
    await assert.rejects(service({ routes: [measuredRoute()], fallbackInfo }).estimate(raw()), { code: 'routes_bad_response', status: 502 });
  }
});

test('repeated intent slots and repeated venues retain their separate identities', async () => {
  const body = raw();
  body.stops[0].entityId = body.origin.entityId;
  const result = await service().estimate(body);
  assert.equal(result.legs[0].from.id, 'coffee-first');
  assert.equal(result.legs[0].to.id, 'coffee-second');
  assert.equal(result.legs[0].from.entityId, result.legs[0].to.entityId);
  assert.equal(result.selectedStops.length, 1);
});

test('strict, bounded request schema rejects origins guessed from locality, extra stops and ownership hints', async () => {
  for (const body of [null, [], {}, { ...raw(), origin: undefined }, { ...raw(), origin: { name: 'Planning area' } },
    { ...raw(), stops: [] }, { ...raw(), stops: null }, { ...raw(), stops: [raw().stops[0], raw().stops[0]] },
    { ...raw(), sourcePlanId: 'not-ownership' }, { ...raw(), visitorId: 'not-ownership' }, { ...raw(), optimize: false },
    { ...raw(), revision: 1 }, { ...raw(), userId: 'not-ownership' }, { ...raw(), mode: 'BICYCLE' }, { ...raw(), mode: 'drive' },
    { ...raw(), mode: null }, { ...raw(), mode: {} }, { ...raw(), origin: { address: 'Fixture', secret: 'no' } },
    { ...raw(), stops: [{ ...raw().stops[0], intent: 'coffee' }] },
  ]) invalid(body);
  for (const coordinates of [null, [], {}, { lat: '1', lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 },
    { lat: NaN, lng: 0 }, { lat: 0, lng: Infinity }, { lat: 0, lng: 0, altitude: 1 }]) {
    invalid({ ...raw(), origin: { coordinates, address: 'Do not hide invalid coordinates' } });
  }
  for (const [key, max] of [['id', 160], ['entityId', 200], ['name', 200], ['address', 300]]) {
    for (const value of ['', ' ', null, 3, 'x'.repeat(max + 1), 'bad\nvalue', '<bad>']) invalid({ ...raw(), stops: [{ address: 'Fixture', [key]: value }] });
    assert.equal(parseRouteRequest({ ...raw(), stops: [{ address: 'Fixture', [key]: 'x'.repeat(max) }] }, { now }).stops[0][key].length, max);
  }
  for (const requestId of ['', null, 10, 'x'.repeat(161), 'request\nvalue']) invalid({ ...raw(), requestId });
  assert.equal(parseRouteRequest({ ...raw(), requestId: 'x'.repeat(160) }, { now }).requestId.length, 160);
  for (const itineraryRevision of [-1, 1.5, '2', null, Number.MAX_SAFE_INTEGER + 1]) invalid({ ...raw(), itineraryRevision });
  assert.equal(parseRouteRequest({ ...raw(), itineraryRevision: Number.MAX_SAFE_INTEGER }, { now }).itineraryRevision, Number.MAX_SAFE_INTEGER);
  let calls = 0;
  await assert.rejects(service(undefined, { fetchImpl: async () => { calls++; } }).estimate({ ...raw(), sourcePlanId: 'x' }), { code: 'invalid_request' });
  assert.equal(calls, 0);
});

test('departure validation uses injected time, real calendar dates and explicit offsets', () => {
  for (const departureAt of [null, 123, '', '2026-11-08', '2026-11-08T18:00:00', '2026-11-08T18:00:00 UTC',
    '2026-11-08T24:00:00Z', '2026-11-08T18:60:00Z', '2026-11-08T18:00:60Z', '2026-11-08T18:00:00+24:00',
    '2026-11-08T18:00:00+00:60', '2027-02-29T18:00:00Z', '2028-02-30T18:00:00Z', '2027-04-31T18:00:00Z',
    '2027-13-01T18:00:00Z', '2026-11-08T05:59:59.999Z', '2026-11-08T07:00:00+02:00',
    '2026-11-08T18:00:00.1234567890Z', '2026-11-08T18:00:00Z\n',
  ]) invalid({ ...raw(), departureAt });
  for (const departureAt of ['2028-02-29T18:00:00Z', '2026-11-08T06:00:00Z', '2026-11-08T07:00+01:00', '2026-11-08T18:00:00.123456789-04:30']) {
    assert.equal(parseRouteRequest({ ...raw(), departureAt }, { now }).departureAt, new Date(departureAt).toISOString());
  }
});

test('malformed provider data never produces invented measurements or attached leg identities', async () => {
  const valid = measuredRoute();
  const invalidRoutes = [null, {}, { ...valid, legs: undefined }, { ...valid, legs: [] }, { ...valid, legs: [valid.legs[0], valid.legs[0]] },
    { ...valid, legs: [null] }, { ...valid, distanceMeters: -1 }, { ...valid, distanceMeters: 1.5 }, { ...valid, distanceMeters: '1' },
    { ...valid, distanceMeters: Number.MAX_SAFE_INTEGER + 1 }, { ...valid, duration: '-1s' }, { ...valid, duration: '1..5s' },
    { ...valid, duration: '9'.repeat(400) + 's' }, { ...valid, duration: '1.1234567890s' }, { ...valid, duration: 1 },
    { ...valid, legs: [{ duration: '100s' }] }, { ...valid, legs: [{ distanceMeters: -1, duration: '100s' }] },
    { ...valid, legs: [{ distanceMeters: 100, duration: '-1s' }] }, { ...valid, legs: [{ distanceMeters: 100, duration: '1..2s' }] },
  ];
  for (const route of invalidRoutes) await assert.rejects(service({ routes: [route] }).estimate(raw()), { code: 'routes_bad_response', status: 502 });
  for (const payload of [null, [], 'bad', { routes: null }, { routes: {} }, { error: { message: 'secret' } }]) {
    await assert.rejects(service(payload).estimate(raw()), { code: 'routes_bad_response' });
  }
  for (const payload of [{}, { routes: [] }]) await assert.rejects(service(payload).estimate(raw()), { code: 'route_not_found', status: 422 });
  const zero = { distanceMeters: 0, duration: '0s' };
  const result = await service({ routes: [{ ...zero, legs: [zero] }] }).estimate(raw());
  assert.equal(result.distanceMeters, 0);
  assert.equal(result.durationSeconds, 0);
  assert.equal(result.legs[0].durationSeconds, 0);
});

test('configuration, quotas, transport failures and malformed JSON have safe distinct failures', async () => {
  let calls = 0;
  const disabled = createRouteActions({ now, fetchImpl: async () => { calls++; } });
  assert.deepEqual(disabled.capabilities(), { routeEstimates: false, routeProvider: 'google_routes', modes: ['DRIVE', 'WALK', 'TRANSIT'], bookingSubmission: false, confirmedBookings: false });
  await assert.rejects(disabled.estimate(raw()), { code: 'provider_not_configured', status: 503 });
  assert.equal(calls, 0);
  assert.equal(service().capabilities().routeEstimates, true);
  const cases = [
    [async () => { throw new Error('provider credential fixture-not-a-real-key'); }, 'routes_unreachable', 502],
    [async () => response({ secret: 'fixture-not-a-real-key' }, 429), 'routes_rate_limited', 429],
    [async () => response({ secret: 'fixture-not-a-real-key' }, 403), 'routes_provider_error', 502],
    [async () => response({ secret: 'fixture-not-a-real-key' }, 500), 'routes_provider_error', 502],
    [async () => ({ ok: true, json: async () => { throw new Error('fixture-not-a-real-key'); } }), 'routes_bad_response', 502],
  ];
  for (const [fetchImpl, code, status] of cases) {
    const input = freeze(raw());
    await assert.rejects(service(undefined, { fetchImpl }).estimate(input), error => {
      assert.equal(error.code, code); assert.equal(error.status, status); assert.doesNotMatch(error.message, /fixture-not-a-real-key/); return true;
    });
    assert.deepEqual(input, raw());
  }
});

test('timeouts bound both response headers and body and abort without retrying', async () => {
  for (const stalledBody of [false, true]) {
    let signal, calls = 0;
    const routes = service(undefined, { timeoutMs: 10, fetchImpl: async (_url, options) => {
      calls++; signal = options.signal;
      const pending = new Promise(() => {});
      return stalledBody ? { ok: true, json: () => pending } : pending;
    } });
    await assert.rejects(routes.estimate(raw()), { code: 'routes_timeout', status: 504 });
    assert.equal(signal.aborted, true); assert.equal(calls, 1);
  }
});

test('out-of-order estimates retain their own correlation and departure context', async () => {
  let finish;
  const old = service(undefined, { fetchImpl: () => new Promise(resolve => { finish = resolve; }) }).estimate(raw());
  const newer = { ...raw(), requestId: 'route-2', itineraryRevision: 4, departureAt: '2026-11-09T18:00:00Z' };
  const latest = await service().estimate(newer);
  finish(response({ routes: [measuredRoute()] }));
  const earlier = await old;
  assert.equal(latest.requestId, 'route-2'); assert.equal(latest.itineraryRevision, 4);
  assert.equal(earlier.requestId, 'route-1'); assert.equal(earlier.itineraryRevision, 3);
  assert.equal(earlier.departureAt, '2026-11-08T16:00:00.000Z');
  assert.equal(latest.departureAt, '2026-11-09T18:00:00.000Z');
});

async function serve(t, options = {}) {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Live provider calls forbidden'); });
  const server = createApp({ provider: createDemoProvider(), rateLimit: false, now, ...options }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return (path, body, headers = {}, rawBody) => new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: server.address().port, path,
      method: body === undefined && rawBody === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, res => {
      let data = ''; res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }));
    });
    request.on('error', reject); request.end(rawBody ?? (body === undefined ? undefined : JSON.stringify(body)));
  });
}

test('HTTP capabilities and unavailable route estimates work without a service key or account', async t => {
  const call = await serve(t);
  const capabilities = await call('/api/actions/capabilities');
  assert.equal(capabilities.status, 200); assert.equal(capabilities.body.routeEstimates, false);
  assert.equal(capabilities.body.bookingSubmission, false); assert.equal(capabilities.body.confirmedBookings, false);
  assert.equal(capabilities.headers['cache-control'], 'no-store');
  const estimate = await call('/api/actions/routes/estimate', raw());
  assert.equal(estimate.status, 503); assert.equal(estimate.body.code, 'provider_not_configured');
  assert.deepEqual(Object.keys(estimate.body).sort(), ['code', 'error']);
  assert.equal((await call('/api/actions/routes/estimate', {})).status, 400);
  assert.equal((await call('/api/actions/bookings', {})).status, 404);
});

test('route HTTP calls never consult planning, identity, analytics or persistence, even with identity headers', async t => {
  const forbidden = () => { throw new Error('Planning or persistence was accessed'); };
  const accounts = { mount() {}, identity: forbidden, planTarget: forbidden, keepPlan: forbidden };
  const call = await serve(t, { routeActions: service(), accounts, dayStore: new Proxy({}, { get: forbidden }), metrics: { record: forbidden } });
  for (const headers of [{}, { Cookie: 'session=fixture', 'X-Visitor-Id': 'fixture-visitor', Authorization: 'Bearer fixture' }]) {
    const result = await call('/api/actions/routes/estimate', raw(), headers);
    assert.equal(result.status, 200); assert.equal(result.body.requestId, 'route-1');
    assert.equal(result.body.itineraryRevision, 3); assert.equal(result.body.durationSeconds, 300.5);
    assert.equal(result.headers['cache-control'], 'no-store');
  }
  assert.equal((await call('/api/actions/routes/estimate', { ...raw(), sourcePlanId: 'saved-plan' })).status, 400);
});

test('HTTP routes preserve scoped statuses, sanitize unexpected failures and retain the JSON body bound', async t => {
  const call = await serve(t, { routeActions: service(undefined, { fetchImpl: async () => response(null, 429) }) });
  const quota = await call('/api/actions/routes/estimate', raw());
  assert.equal(quota.status, 429); assert.equal(quota.body.code, 'routes_rate_limited');
  assert.equal((await call('/api/actions/routes/estimate', undefined, {}, '{bad')).status, 400);
  const large = await call('/api/actions/routes/estimate', { ...raw(), requestId: 'x'.repeat(51 * 1024) });
  assert.equal(large.status, 413); assert.equal(large.body.code, 'body_too_large');
  const broken = await serve(t, { routeActions: { capabilities() { throw new Error('fixture-secret'); }, estimate() { throw Object.assign(new Error('fixture-secret'), { status: 400, code: 'invalid_request' }); } } });
  for (const [path, body] of [['/api/actions/capabilities', undefined], ['/api/actions/routes/estimate', raw()]]) {
    const result = await broken(path, body); assert.equal(result.status, 502); assert.equal(result.body.code, 'routes_provider_error');
    assert.doesNotMatch(JSON.stringify(result.body), /fixture-secret/);
  }
});

test('HTTP driving fallback fails explicitly without returning a downgraded estimate or provider details', async t => {
  const call = await serve(t, { routeActions: service({ routes: [measuredRoute()],
    fallbackInfo: { routingMode: 'FALLBACK_TRAFFIC_UNAWARE', reason: 'LATENCY_EXCEEDED', detail: 'fixture-provider-secret' } }) });
  const result = await call('/api/actions/routes/estimate', raw());
  assert.equal(result.status, 502);
  assert.deepEqual(result.body, {
    code: 'routes_traffic_unavailable',
    error: 'Google Routes could not provide a traffic-aware driving estimate. Directions are still available.',
  });
  assert.doesNotMatch(JSON.stringify(result.body), /fixture-provider-secret|durationSeconds|trafficAware/);
});

test('existing IP limiter bounds provider cost across case, slash and spoofed visitor variations', async t => {
  let calls = 0;
  const routes = service(undefined, { fetchImpl: async () => { calls++; return response({ routes: [measuredRoute()] }); } });
  const call = await serve(t, { routeActions: routes, rateLimit: true, trustProxy: false });
  for (let i = 0; i < 12; i++) {
    const result = await call(i % 2 ? '/API/ACTIONS/ROUTES/ESTIMATE/' : '/api/actions/routes/estimate', raw(), { 'X-Forwarded-For': `203.0.113.${i}`, 'X-Visitor-Id': `visitor-${i}` });
    assert.equal(result.status, 200);
  }
  const limited = await call('/api/actions/routes/estimate', raw());
  assert.equal(limited.status, 429); assert.equal(limited.body.code, 'rate_limited'); assert.equal(calls, 12);
});
