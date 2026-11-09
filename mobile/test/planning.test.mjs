import test from "node:test";
import assert from "node:assert/strict";
import {
  newBrief,
  confirmArea,
  chooseActivities,
  editStop,
  planContext,
  groundedRoute,
  coarsePoint,
  mapsUrl,
  personWithId,
  destinationTimeZone,
} from "../src/planning.js";
import { createRequestGate, createDraftStore } from "../src/lifecycle.js";
import { isBrief, isPlan, requireAreas } from "../src/validation.js";
import { parseItinerary } from "../../backend/src/itinerary.js";
const area = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  name: "Accra",
  label: "Accra, Ghana",
  currency: "GHS",
};
const venue = (id) => ({ id, name: `Place ${id}`, address: "Accra" });
const makePlan = () => {
  const request = {
    ...confirmArea(newBrief(), area),
    activities: ["coffee", "dinner"],
    stopIntents: ["coffee", "coffee", "dinner"],
    pins: {},
  };
  return {
    request,
    status: "complete",
    stops: [
      {
        id: "stop-0",
        intent: "coffee",
        item: venue("a"),
        alternatives: [venue("x")],
      },
      {
        id: "stop-1",
        intent: "coffee",
        item: venue("b"),
        alternatives: [venue("y")],
      },
      { id: "stop-2", intent: "dinner", item: venue("c"), alternatives: [] },
    ],
  };
};
test("new native draft is solo, with no fabricated location, taste, budget or timing confirmation", () => {
  const brief = newBrief(new Date(2026, 10, 9));
  assert.equal(brief.date, "2026-11-09");
  assert.equal(brief.party.adults, 1);
  assert.equal(brief.area, "");
  assert.equal(brief.budget, null);
  assert.deepEqual(brief.activities, []);
  assert.equal(brief.timing.dateConfirmed, false);
  assert.doesNotThrow(() =>
    parseItinerary(brief, { allowMissingLocation: true }),
  );
});
test("confirmed returned area clears incompatible selections and does not convert an allowance", () => {
  const brief = {
    ...newBrief(),
    budget: 100,
    pins: { coffee: "a" },
    route: [{ intent: "coffee", placeId: "a" }],
    activities: ["coffee"],
  };
  const next = confirmArea(brief, area);
  assert.equal(next.currency, "GHS");
  assert.equal(next.budget, null);
  assert.equal(next.route, undefined);
  assert.deepEqual(next.pins, {});
  assert.equal(
    confirmArea({ ...brief, currencyMode: "custom", currency: "GBP" }, area)
      .budget,
    100,
  );
  assert.throws(() => confirmArea(brief, { label: "invented" }));
});
test("category edits reuse shared preservation rules", () => {
  const brief = {
    ...makePlan().request,
    pins: { "stop-0": "a", "stop-1": "b", dinner: "c" },
  };
  const next = chooseActivities(brief, ["coffee"]);
  assert.deepEqual(next.stopIntents, ["coffee", "coffee"]);
  assert.deepEqual(next.pins, { "stop-0": "a", "stop-1": "b" });
  assert.doesNotThrow(() => parseItinerary(next));
});
test("swap preserves every other visit, including repeated category occurrences", () => {
  const next = editStop(makePlan(), 1, "swap");
  assert.deepEqual(next.pins, { "stop-0": "a", dinner: "c" });
  assert.deepEqual(next.excludeIds, ["b"]);
  assert.equal(next.route, undefined);
  assert.doesNotThrow(() => parseItinerary(next));
});
test("replacement and move retain actual occurrence identities and validate on existing backend", () => {
  const next = editStop(makePlan(), 1, "replace", "y");
  assert.deepEqual(next.route, [
    { intent: "coffee", placeId: "a" },
    { intent: "coffee", placeId: "y" },
    { intent: "dinner", placeId: "c" },
  ]);
  assert.doesNotThrow(() => parseItinerary(next));
  const moved = editStop(makePlan(), 2, "up");
  assert.deepEqual(
    moved.route.map((visit) => visit.placeId),
    ["a", "c", "b"],
  );
  assert.deepEqual(moved.stopIntents, ["coffee", "dinner", "coffee"]);
  assert.doesNotThrow(() => parseItinerary(moved));
  assert.throws(() => editStop(makePlan(), 0, "replace", "invented"));
});
test("remove updates unique activities and keeps an unfilled visit instead of inventing an ID", () => {
  const plan = makePlan();
  plan.stops[1].item = null;
  const next = editStop(plan, 2, "remove");
  assert.deepEqual(next.activities, ["coffee"]);
  assert.deepEqual(next.stopIntents, ["coffee", "coffee"]);
  assert.deepEqual(next.pins, { "stop-0": "a" });
  assert.equal(next.route, undefined);
  assert.doesNotThrow(() => parseItinerary(next));
});
test("swap of one repeat does not exclude the venue of an untouched visit", () => {
  const plan = makePlan();
  plan.stops[1].item = venue("a");
  const next = editStop(plan, 1, "swap");
  assert.deepEqual(
    next.route.map((visit) => visit.placeId),
    ["a", "y", "c"],
  );
  assert.deepEqual(next.excludeIds, []);
  plan.stops[1].alternatives = [];
  assert.throws(() => editStop(plan, 1, "swap"), /repeated visit/);
});
test("grounded chat route rejects invented places and retains repeated visits", () => {
  const plan = makePlan();
  const next = groundedRoute(plan, {
    route: [
      { intent: "coffee", placeId: "a" },
      { intent: "coffee", placeId: "a" },
    ],
  });
  assert.equal(next.route.length, 2);
  assert.doesNotThrow(() => parseItinerary(next));
  assert.throws(() =>
    groundedRoute(plan, {
      route: [{ intent: "coffee", placeId: "hallucinated" }],
    }),
  );
  assert.equal(planContext(plan).stops[1].stopId, "stop-1");
});
test("location is rounded and stale, broad or invalid positions fail", () => {
  const now = Date.now();
  const position = {
    coords: { latitude: 5.6789, longitude: -0.1234, accuracy: 40 },
    timestamp: now,
  };
  assert.deepEqual(coarsePoint(position, now), {
    latitude: 5.68,
    longitude: -0.12,
  });
  for (const bad of [
    { ...position, timestamp: now - 400000 },
    { ...position, coords: { ...position.coords, accuracy: 30000 } },
    { ...position, coords: { ...position.coords, latitude: Infinity } },
  ])
    assert.throws(() => coarsePoint(bad, now));
});
test("Maps handoff carries only venue name/address, no GPS or private profile", () => {
  const url = mapsUrl(makePlan().stops[0]);
  assert.match(url, /^https:\/\/www.google.com\/maps\/search\//);
  assert.equal(new URL(url).searchParams.get("query"), "Place a, Accra");
  assert.equal(mapsUrl({ item: null }), null);
});
test("epoch rejects stale discovery/completion even if network ignores abort", () => {
  const gate = createRequestGate(),
    old = gate.begin(),
    current = gate.begin();
  assert.equal(old.current(), false);
  assert.equal(old.signal.aborted, true);
  assert.equal(current.current(), true);
  gate.invalidate();
  assert.equal(current.current(), false);
  assert.equal(current.signal.aborted, true);
});
test("draft serializes writes and clear so delayed save cannot resurrect old outing", async () => {
  let stored, release;
  const calls = [];
  const storage = {
    getItem: async () => stored,
    setItem: async (key, value) => {
      calls.push("save");
      await new Promise((resolve) => {
        release = resolve;
      });
      stored = value;
    },
    removeItem: async () => {
      calls.push("clear");
      stored = null;
    },
  };
  const disk = createDraftStore(storage);
  const pending = disk.save({
    brief: newBrief(),
    confirmed: false,
    plan: null,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const clear = disk.clear();
  release();
  await pending;
  await clear;
  assert.deepEqual(calls, ["save", "clear"]);
  assert.equal(await disk.load(), null);
});
test("draft keeps successful snapshot, excludes chat and account ownership metadata", async () => {
  let stored;
  const disk = createDraftStore({
    getItem: async () => stored,
    setItem: async (k, v) => {
      stored = v;
    },
    removeItem: async () => {
      stored = null;
    },
  });
  const plan = {
    ...makePlan(),
    savedPlan: { id: "private-account-id" },
    accessToken: "secret",
  };
  await disk.save({
    brief: plan.request,
    confirmed: true,
    plan,
    chat: [{ text: "private conversation" }],
  });
  assert.equal((await disk.load()).plan.stops.length, 3);
  assert.ok(!stored.includes("private-account-id"));
  assert.ok(!stored.includes("secret"));
  assert.ok(!stored.includes("private conversation"));
  stored = '{"version":1}';
  await assert.rejects(disk.load(), /incompatible/);
});

test("alternative summaries do not borrow evidence from the selected venue", () => {
  const plan = makePlan();
  plan.stops[0].connections = [
    { personId: "you", kind: "affinity", label: "Artist A" },
  ];
  const context = planContext(plan);
  assert.equal(context.stops[0].connections.length, 1);
  assert.deepEqual(
    context.options.find((option) => option.id === "x").connections,
    [],
  );
});
test("unavailable explicit selections survive edits to another occurrence", () => {
  const plan = makePlan();
  plan.request.route = plan.stops.map((stop) => ({
    intent: stop.intent,
    placeId: stop.item.id,
  }));
  plan.stops[1].item = null;
  const next = editStop(plan, 2, "up");
  assert.deepEqual(
    next.route.map((visit) => visit.placeId),
    ["a", "c", "b"],
  );
  assert.doesNotThrow(() => parseItinerary(next));
});
test("guest people receive stable valid IDs before later chat/evidence use", () => {
  const person = personWithId(
    { name: "Sam", artists: [], vibes: [] },
    newBrief().people,
  );
  assert.match(person.id, /^[a-zA-Z0-9_-]{1,64}$/);
  assert.throws(() => personWithId(person, [person]), /already/);
});
test("malformed restored nested fields are rejected before native rendering", async () => {
  for (const brief of [
    { area: "Accra", activities: [], people: [] },
    { ...newBrief(), timing: null },
    { ...newBrief(), people: [{ name: "You" }] },
    { ...newBrief(), party: { adults: "two", children: 0 } },
  ]) {
    const disk = createDraftStore({
      getItem: async () =>
        JSON.stringify({ version: 1, brief, confirmed: true, plan: null }),
    });
    await assert.rejects(disk.load(), /incompatible/);
  }
});

test("destination dates use the selected area zone without carrying an old plan zone across cities", () => {
  const plan = { ...makePlan(), timeZone: "Asia/Tokyo" };
  const draft = { brief: plan.request, plan, planningTimeZone: "Africa/Accra" };
  assert.equal(destinationTimeZone(draft, "America/New_York"), "Asia/Tokyo");
  assert.equal(
    destinationTimeZone(
      { ...draft, brief: { ...draft.brief, area: "Accra" } },
      "America/New_York",
    ),
    "Africa/Accra",
  );
  assert.equal(
    destinationTimeZone(
      { brief: newBrief(), plan: null, planningTimeZone: "invalid/zone" },
      "America/New_York",
    ),
    "America/New_York",
  );
});
test("runtime bounds accept backend-supported 64 tastes and larger evidence groups", () => {
  const plan = makePlan();
  plan.request.people[0].vibes = Array.from({ length: 64 }, (_, i) => `v-${i}`);
  plan.stops[0].connections = Array.from({ length: 420 }, () => ({
    personId: "you",
    kind: "tag_match",
    label: "Provider match",
  }));
  assert.ok(isBrief(plan.request));
  assert.ok(isPlan(plan));
  assert.equal(planContext(plan).stops[0].connections.length, 144);
  plan.request.people[0].vibes.push("overflow");
  assert.equal(isBrief(plan.request), false);
  assert.throws(() => requireAreas({ locations: [{}] }), /incomplete/);
});


test("chat receives bounded practical venue evidence without borrowing selected facts for alternatives", () => {
  const plan = makePlan();
  plan.stops[0].start = "10:00";
  plan.stops[0].end = "11:00";
  plan.stops[0].item.description = "A reported courtyard cafe. ".repeat(200);
  plan.stops[0].item.tagNames = ["Courtyard", null, {bad: true}];
  plan.stops[0].item.facts = {price: {level: 2}};
  const context = planContext(plan);
  const selected = JSON.parse(context.stops[0].practical);
  assert.equal(selected.relativePriceBand, 2);
  assert.equal(selected.priceVerified, false);
  assert.equal(selected.start, "10:00");
  assert.deepEqual(selected.reportedTags, ["Courtyard"]);
  assert.ok(context.stops[0].practical.length <= 1200);
  const alternative = JSON.parse(context.options.find(item => item.id === "x").practical);
  assert.equal(alternative.relativePriceBand, null);
  assert.equal(alternative.start, undefined);
  assert.equal(alternative.description, undefined);
  assert.match(alternative.connectionCoverage, /not negative evidence/);
});


test("draft restart preserves bounded readiness allowance and timing notes without extra metadata", async () => {
  const plan = makePlan();
  plan.allowance = {amount: 350, kind: "suggested", pricesVerified: true, token: "never keep"};
  plan.timingNotes = ["Times need choosing", {unsafe: true}, "x".repeat(2001)];
  const values = new Map();
  const store = createDraftStore({getItem: async key => values.get(key), setItem: async (key, value) => values.set(key, value), removeItem: async key => values.delete(key)});
  await store.save({brief: plan.request, confirmed: true, plan});
  const restored = await store.load();
  assert.deepEqual(restored.plan.allowance, {amount: 350, kind: "suggested", pricesVerified: false});
  assert.deepEqual(restored.plan.timingNotes, ["Times need choosing"]);
  plan.allowance.amount = Infinity;
  await store.save({brief: plan.request, confirmed: true, plan});
  assert.equal((await store.load()).plan.allowance, undefined);
});


test("draft storage cap counts UTF-8 bytes for Android rather than only JS characters", async () => {
  const plan = makePlan(); plan.budget = {total: null, currency: "GHS", note: "🌿".repeat(380000)};
  let writes = 0;
  const store = createDraftStore({getItem: async () => null, setItem: async () => {writes++;}, removeItem: async () => {}});
  await assert.rejects(store.save({brief: plan.request, confirmed: true, plan}), /too large/);
  assert.equal(writes, 0);
});
