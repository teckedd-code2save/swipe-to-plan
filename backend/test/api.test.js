import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import { createDemoProvider } from "../src/demo-provider.js";
async function serve(t, options = {}) {
  t.mock.method(globalThis, "fetch", () => { throw new Error("External requests forbidden"); });
  const server = createApp({ provider: createDemoProvider(), rateLimit: false, ...options }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return (path, body, method = body === undefined ? "GET" : "POST") => new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path, method, headers: { "Content-Type": "application/json" } }, (res) => {
      let text = ""; res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(text) }));
    });
    req.on("error", reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
test("HTTP contract: schema, no-taste shortlist, evidence, provenance, feedback", async (t) => {
  const call = await serve(t);
  assert.equal((await call("/api/schema")).body.version, "1.0");
  const first = await call("/api/recommend", { intent: "coffee", location: { area: "Osu" } });
  assert.equal(first.status, 200); assert.equal(first.body.status, "insufficient_matches");
  assert.equal(first.body.taste.mode, "discovery"); assert.equal(first.body.provenance.provider, "demo");
  assert.equal(first.headers["cache-control"], "no-store");
  const item = first.body.items[0];
  assert.ok(item.id.startsWith("demo:")); assert.ok(item.reasons[0].evidence.length);
  assert.ok(item.why); assert.ok(item.links.map); assert.ok(item.uncertainty.length);
  const next = await call("/api/recommend", { ...first.body.request, feedback: [{ candidateId: item.id, reason: "not_relevant" }] });
  assert.ok(!next.body.items.some((i) => i.id === item.id));
  const other = await call("/api/recommend", { intent: "coffee", location: { area: "Osu" } });
  assert.ok(other.body.items.some((i) => i.id === item.id));
});
test("HTTP errors and retired comparison do not invoke external services", async (t) => {
  const call = await serve(t);
  assert.equal((await call("/api/recommend", { constraints: { openNow: true } })).status, 400);
  assert.equal((await call("/api/baseline", {})).status, 410);
  assert.equal((await call("/api/rooms", {})).status, 503);
  assert.equal((await call("/api/missing")).status, 404);
});
test("provider failure returns sanitized HTTP 503", async (t) => {
  const call = await serve(t, { provider: { name: "qloo", discover: async () => { throw new Error("private upstream content"); } } });
  const response = await call("/api/recommend", {});
  assert.equal(response.status, 503); assert.equal(response.body.code, "provider_unavailable"); assert.doesNotMatch(JSON.stringify(response.body), /private/);
});
test("group HTTP plan preserves room constraints and accepts session feedback", async (t) => {
  const room = { id: "r1", code: "ABCDE", intent: "coffee", area: "Osu", members: [{ id: "m1", name: "Sam", liked: ["a-amaarae"] }, { id: "m2", name: "Sam", liked: [] }] };
  const call = await serve(t, { prisma: { room: { findUnique: async () => room } } });
  const response = await call("/api/rooms/ABCDE/plan");
  assert.equal(response.status, 200); assert.equal(response.body.people.length, 2);
  assert.equal(response.body.people[0].taste.resolved[0].name, "Amaarae");
  assert.ok(response.body.items.every((i) => i.address.includes("Osu")));
  const id = response.body.items[0].id;
  const next = await call("/api/rooms/ABCDE/plan", { feedback: [{ candidateId: id, reason: "too_noisy" }] });
  assert.ok(!next.body.items.some((i) => i.id === id));
  assert.equal((await call("/api/rooms/ABCDE/plan", { intent: "drinks" })).status, 400);
});
test("rate limit has structured HTTP 429 response", async (t) => {
  const call = await serve(t, { rateLimit: true });
  for (let i = 0; i < 30; i++) assert.equal((await call("/api/recommend", {})).status, 200);
  const response = await call("/api/recommend", {});
  assert.equal(response.status, 429); assert.equal(response.body.code, "rate_limited");
});

test("room creation and membership remain compatible with the existing schema", async (t) => {
  let stored, memberData;
  const prisma = {
    room: { create: async ({ data }) => { stored = { ...data, id: "room-1", members: [] }; return stored; }, findUnique: async () => stored },
    member: { create: async ({ data }) => { memberData = data; return { id: "member-1" }; } },
  };
  const call = await serve(t, { prisma });
  const created = await call("/api/rooms", { intent: "coffee", location: { area: "Osu" } });
  assert.equal(created.status, 201); assert.match(created.body.code, /^[A-Z2-9]{5}$/);
  assert.equal(stored.intent, "coffee"); assert.equal(stored.area, "Osu");
  assert.equal((await call("/api/rooms", { constraints: { maxPriceLevel: 1 } })).status, 400);
  const joined = await call(`/api/rooms/${stored.code}/members`, { name: "Sam", liked: ["a-amaarae", "a-amaarae"] });
  assert.equal(joined.status, 201); assert.deepEqual(memberData, { roomId: "room-1", name: "Sam", liked: ["a-amaarae"] });
});
