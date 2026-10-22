import test from "node:test";
import assert from "node:assert/strict";
import { parseRequest } from "../src/contract.js";
import { createDiscovery, rankPlaces, mergeGroup } from "../src/plan.js";
import { createQlooClient } from "../src/qloo.js";
const venue = (id, tag = "cafe", address = "Osu, Accra, Ghana", properties = {}) => ({ entity_id: id, name: `Venue ${id}`, tags: [{ id: `urn:tag:category:qloo:${tag}`, name: tag }], properties: { address, ...properties } });
const request = (extra = {}) => parseRequest({ intent: "coffee", location: { area: "Osu" }, ...extra });
const provider = (places, resolveArtist = async (name) => ({ status: "resolved", entityId: name, name })) => ({ name: "qloo", resolveArtist, discover: async () => places });

test("strict constraints never relax on sparse results", () => {
  const places = [venue("valid"), venue("wrong-intent", "bar"), venue("wrong-area", "cafe", "Labone, Accra, Ghana"), venue("unknown-area", "cafe", "Ghana"), venue("closed", "cafe", undefined, { is_closed: true }), { ...venue("hotel"), name: "Sample Hotel" }, venue("other-city", "cafe", "Osu Road, Kumasi, Ghana")];
  const result = rankPlaces(places, request());
  assert.deepEqual(result.ranked.map((p) => p.id), ["qloo:valid"]);
  assert.equal(result.excluded.intent_not_supported, 1);
  assert.equal(result.excluded.location_not_supported, 3);
  assert.equal(result.excluded.hotel, 1);
});
test("any intent still needs venue evidence", () => assert.equal(rankPlaces([{ ...venue("district"), tags: [] }], request({ intent: "any" })).ranked.length, 0));
test("explicit country/city contradictions fail location evidence", () => {
  for (const location of [{ city: "Kumasi" }, { country: "Nigeria" }]) assert.equal(rankPlaces([{ ...venue("x"), location }], request()).ranked.length, 0);
});
test("price cap excludes unknown/excessive prices; no invented opening status", () => {
  const result = rankPlaces([venue("unknown"), venue("cheap", "cafe", undefined, { price_level: 1, hours: { monday: [{ closed: true }] } }), venue("costly", "cafe", undefined, { price_level: 4 })], request({ constraints: { maxPriceLevel: 2 } }));
  assert.deepEqual(result.ranked.map((p) => p.entityId), ["cheap"]);
  assert.equal(result.ranked[0].facts.price.status, "provider_reported");
  assert.equal(result.ranked[0].facts.hours.status, "unverified");
  assert.equal(result.ranked[0].facts.availability.status, "unknown");
});
test("stable IDs, deduplication and safe links", () => {
  const one = venue("stable", "cafe", undefined, { website: "javascript:alert(1)", menu_url: "https://user:pass@example.com", phone: "bad" });
  const a = rankPlaces([one, one, { name: "No ID" }], request());
  assert.equal(a.ranked.length, 1);
  assert.equal(a.ranked[0].id, rankPlaces([one], request()).ranked[0].id);
  assert.equal(a.ranked[0].links.website, null); assert.equal(a.ranked[0].links.menu, null);
  assert.match(a.ranked[0].links.map, /^https:/); assert.equal(a.excluded.duplicate, 1);
});
test("vibes produce deterministic evidence-based boosts", () => {
  const rooftop = venue("roof"); rooftop.tags.push({ id: "urn:tag:setting:qloo:rooftop", name: "Rooftop" });
  const result = rankPlaces([venue("plain"), rooftop], request({ taste: { vibes: ["v-rooftop"] } }));
  const item = result.ranked.find((i) => i.entityId === "roof");
  assert.equal(item.scoreComponents.vibeBoost, 0.15);
  assert.equal(item.reasons.find((r) => r.code === "vibe_match").evidence[0].value, "urn:tag:setting:qloo:rooftop");
});
test("partial resolution reports failures and uses only resolved IDs", async () => {
  let signals;
  const p = provider([], async (name) => {
    if (name === "Fail") throw new Error("private upstream detail");
    if (name === "Unknown") return { status: "unresolved", reason: "no_exact_artist_match" };
    return { status: "resolved", entityId: "artist-1", name };
  });
  p.discover = async ({ signalIds }) => { signals = signalIds; return [venue("ok")]; };
  const response = await createDiscovery({ provider: p }).recommend(request({ taste: { artists: ["Known", "Fail", "Unknown"] } }));
  assert.deepEqual(signals, ["artist-1"]); assert.equal(response.taste.resolved.length, 1);
  assert.equal(response.taste.unresolved.length, 2); assert.equal(response.taste.unresolved[0].reason, "resolution_unavailable");
  assert.doesNotMatch(JSON.stringify(response), /private upstream/);
});
test("all failed signals explicitly fall back without claiming affinity", async () => {
  const result = await createDiscovery({ provider: provider([venue("ok")], async () => { throw new Error(); }) }).recommend(request({ taste: { artists: ["Missing"] } }));
  assert.equal(result.taste.mode, "discovery"); assert.equal(result.taste.resolved.length, 0);
  assert.equal(result.items[0].reasons.some((r) => r.code === "taste_affinity"), false);
  assert.ok(result.warnings.some((w) => w.includes("No artist affinity")));
});
test("shortlist has deterministic explanations without any model or external fetch", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("No network allowed"); });
  const result = await createDiscovery({ provider: provider([venue("one")]) }).recommend(request());
  assert.equal(result.items.length, 1); assert.ok(result.items[0].why);
  assert.equal(result.status, "insufficient_matches"); assert.deepEqual(result.request.location, { area: "Osu" });
  assert.ok(result.relaxationOptions.some((o) => o.code === "widen_area"));
});
test("feedback is reversible, request-scoped, and reapplied to cached candidates", async () => {
  let calls = 0;
  const places = Array.from({ length: 10 }, (_, i) => venue(String(i)));
  places[1].tags.push({ id: "urn:tag:music:qloo:live_music", name: "Live music" });
  const p = provider(places); p.discover = async () => { calls++; return places; };
  const engine = createDiscovery({ provider: p });
  const original = await engine.recommend(request());
  const next = await engine.recommend(request({ feedback: [{ candidateId: "qloo:0", reason: "too_noisy" }] }));
  assert.ok(!next.items.some((i) => i.id === "qloo:0"));
  assert.equal(next.items.find((i) => i.id === "qloo:1").scoreComponents.noisePenalty, 0.25);
  assert.ok(next.items.findIndex((i) => i.id === "qloo:2") < next.items.findIndex((i) => i.id === "qloo:1"));
  const restored = await engine.recommend(request());
  assert.deepEqual(restored.items.map((i) => [i.id, i.score]), original.items.map((i) => [i.id, i.score]));
  assert.equal(calls, 1); assert.equal(next.provenance.cached, true);
});
test("not relevant excludes just the named venue", async () => {
  const result = await createDiscovery({ provider: provider([venue("a"), venue("b")]) }).recommend(request({ feedback: [{ candidateId: "qloo:a", reason: "not_relevant" }] }));
  assert.deepEqual(result.items.map((i) => i.id), ["qloo:b"]); assert.equal(result.items[0].scoreComponents.noisePenalty, 0);
});
test("cache expires and preserves original retrieval timestamps on hits", async () => {
  let time = 1000, calls = 0;
  const p = provider([]); p.discover = async () => { calls++; return [venue("a")]; };
  const engine = createDiscovery({ provider: p, now: () => time });
  const first = await engine.recommend(request()); time += 1000;
  const cached = await engine.recommend(request());
  assert.equal(cached.provenance.retrievedAt, first.provenance.retrievedAt); assert.equal(cached.provenance.cacheAgeMs, 1000);
  time += 600000; await engine.recommend(request()); assert.equal(calls, 2);
});
test("provider outages are errors, not empty results", async () => {
  const p = provider([]); p.discover = async () => { throw new Error("private upstream detail"); };
  await assert.rejects(createDiscovery({ provider: p }).recommend(request()), (e) => e.status === 503 && !e.message.includes("private"));
});
test("group fairness favors overlap, separates duplicate names and preserves personal rankings", () => {
  const ranked = rankPlaces([venue("a"), venue("b")], request()).ranked;
  const snapshot = structuredClone(ranked);
  const result = mergeGroup([{ id: "1", name: "Sam", ranked }, { id: "2", name: "Sam", ranked: [ranked[1]] }]);
  assert.equal(result.items[0].id, "qloo:b"); assert.equal(result.items[0].inAll, true);
  assert.equal(new Set(result.items[0].favoriteMembers.map((p) => p.id)).size, 2);
  assert.deepEqual(ranked, snapshot); assert.deepEqual(mergeGroup([]), { items: [], summary: [] });
  assert.equal(mergeGroup([{ id: "1", name: "Solo", ranked }]).items[0].score, ranked[0].score);
});
for (const body of [{ intent: "dancing" }, { location: { area: "London" } }, { constraints: { openNow: true } }, { constraints: { maxPriceLevel: 0 } }, { taste: { vibes: ["unknown"] } }, { feedback: [{ candidateId: "x", reason: "bad" }] }, { limit: 9 }, { area: "Osu", location: { area: "Labone" } }, { liked: ["constructor"] }]) {
  test(`reject unsupported input ${JSON.stringify(body)}`, () => assert.throws(() => parseRequest(body), (e) => e.status === 400));
}
test("legacy liked/area input remains supported", () => {
  const result = parseRequest({ area: "Osu", intent: "coffee", liked: ["a-amaarae", "v-cafe"] });
  assert.deepEqual(result.taste, { artists: ["Amaarae"], vibes: ["v-cafe"] }); assert.equal(result.location.area, "Osu");
});
test("Qloo adapter resolves only unambiguous exact-name artists", async () => {
  let payload, called;
  const p = createQlooClient({ getKey: () => "test-only", fetchImpl: async (address) => { called = new URL(address); return { ok: true, json: async () => payload }; } });
  payload = { results: [{ entity_id: "place", name: "Amaarae", types: ["urn:entity:place"] }, { entity_id: "artist", name: "Amaarae", types: ["urn:entity:artist"] }] };
  assert.equal((await p.resolveArtist("Amaarae")).entityId, "artist"); assert.equal(called.pathname, "/search");
  payload = { results: [{ entity_id: "x", name: "Other", types: ["urn:entity:artist"] }] };
  assert.equal((await p.resolveArtist("Missing")).status, "unresolved");
  payload = { results: [{ entity_id: "a", name: "Twin", types: ["urn:entity:artist"] }, { entity_id: "b", name: "Twin", types: ["urn:entity:artist"] }] };
  assert.equal((await p.resolveArtist("Twin")).reason, "ambiguous");
  payload = { results: { entities: [] } };
  await p.discover({ signalIds: ["artist"], area: "Osu" });
  assert.equal(called.searchParams.get("filter.location.query"), "Osu, Accra, Ghana");
  assert.equal(called.searchParams.get("signal.interests.entities"), "artist");
});
test("Qloo invalid responses, HTTP errors, missing keys and timeouts fail explicitly", async () => {
  for (const fetchImpl of [async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({ metadata: [] }) }), async () => { throw new Error("timeout"); }]) {
    const p = createQlooClient({ getKey: () => "test-only", fetchImpl });
    await assert.rejects(p.discover({ signalIds: [], area: "Accra" }), (e) => e.status === 503);
  }
  const p = createQlooClient({ getKey: () => "", fetchImpl: () => assert.fail("Must not fetch") });
  await assert.rejects(p.discover({ signalIds: [], area: "Accra" }), (e) => e.code === "provider_not_configured");
});

test("explicit exclusions and hotel opt-in preserve every other constraint", () => {
  const one = venue("music"); one.tags.push({ id: "urn:tag:music:qloo:live_music", name: "Live music" });
  const hotel = { ...venue("hotel"), name: "Sample Hotel Café" };
  assert.equal(rankPlaces([one], request({ constraints: { excludeTags: ["live_music"] } })).ranked.length, 0);
  assert.equal(rankPlaces([one], request({ constraints: { excludeTags: ["urn:tag:music:qloo:live_music"] } })).ranked.length, 0);
  assert.equal(rankPlaces([one], request({ constraints: { excludeIds: ["qloo:music"] } })).ranked.length, 0);
  assert.equal(rankPlaces([hotel], request({ constraints: { excludeHotels: false } })).ranked.length, 1);
  assert.equal(rankPlaces([hotel], request({ intent: "drinks", constraints: { excludeHotels: false } })).ranked.length, 0);
});

test("no-match response keeps input constraints and exposes opt-in changes", async () => {
  const input = request({ constraints: { maxPriceLevel: 1 }, taste: { artists: ["Known"] } });
  const original = structuredClone(input);
  const output = await createDiscovery({ provider: provider([venue("price-missing")]) }).recommend(input);
  assert.equal(output.status, "insufficient_matches"); assert.equal(output.items.length, 0);
  assert.deepEqual(input, original);
  const option = output.relaxationOptions.find((o) => o.code === "remove_price_cap");
  assert.ok(option); assert.equal(option.changes.constraints.maxPriceLevel, undefined);
  assert.equal(output.request.constraints.maxPriceLevel, 1);
});

test("feedback duplicates use last reason and bounded input does not create hidden profiles", () => {
  const input = request({ feedback: [{ candidateId: "qloo:one", reason: "too_noisy" }, { candidateId: "qloo:one", reason: "not_relevant" }] });
  assert.deepEqual(input.feedback, [{ candidateId: "qloo:one", reason: "not_relevant" }]);
  assert.throws(() => request({ feedback: Array.from({ length: 101 }, () => ({ candidateId: "x", reason: "not_relevant" })) }), /100/);
});

test("residential or street interests cannot qualify as dining venues", () => {
  const residence = venue('residence');
  residence.tags = [{ id: 'urn:tag:interests:qloo:fine_dining', name: 'Fine dining' }];
  assert.equal(rankPlaces([residence], request({ intent: 'any' })).ranked.length, 0);
  const restaurant = venue('real', 'restaurant');
  restaurant.tags.push({ id: 'urn:tag:offerings:place:coffee', name: 'Coffee' });
  assert.equal(rankPlaces([restaurant], request()).ranked.length, 1);
});
test("auth and quota errors stop discovery rather than falling back", async () => {
  for (const status of [401,403,429]) {
    let calls=0;
    const p=createQlooClient({getKey:()=> 'test-only',fetchImpl: async()=>{calls++;return {ok:false,status};}});
    await assert.rejects(createDiscovery({provider:p}).recommend(request({taste:{artists:['Amaarae']}})), e=>['provider_auth_error','provider_rate_limited'].includes(e.code));
    assert.equal(calls,1);
  }
});

// Live Qloo candidates can have conflicting restaurant tags; conservative exclusions win.
test("administrative places and resorts are not ordinary outing recommendations", () => {
  const places = [{ ...venue("office", "restaurant"), name: "Ministry of Information" }, { ...venue("resort", "restaurant"), name: "Example Beach Resort" }, venue("dinner", "restaurant")];
  const result = rankPlaces(places, request({ intent: "any" }));
  assert.deepEqual(result.ranked.map(p => p.entityId), ["dinner"]);
  assert.equal(result.excluded.non_outing_venue, 1);
  assert.equal(result.excluded.hotel, 1);
  assert.ok(rankPlaces([places[1]], request({ intent: "any", constraints: { excludeHotels: false } })).ranked.length);
});
