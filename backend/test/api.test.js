import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import { createDemoProvider } from "../src/demo-provider.js";
import { parseItinerary } from "../src/itinerary.js";
async function serve(t, options = {}) {
  t.mock.method(globalThis, "fetch", () => { throw new Error("External requests forbidden"); });
  const server = createApp({ provider: createDemoProvider(), rateLimit: false, ...options }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return (path, body, method = body === undefined ? "GET" : "POST", headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path, method, headers: { "Content-Type": "application/json", ...headers } }, (res) => {
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

test('one trusted proxy keeps separate visitor rate limits and ignores spoofed earlier hops', async t => {
  const call = await serve(t, { rateLimit: true, trustProxy: 1 });
  for (let i = 0; i < 30; i++) assert.equal((await call('/api/recommend', {}, 'POST', {'X-Forwarded-For': `198.51.100.${i}, 203.0.113.1`})).status, 200);
  assert.equal((await call('/api/recommend', {}, 'POST', {'X-Forwarded-For': '198.51.100.99, 203.0.113.1'})).status, 429);
  assert.equal((await call('/api/recommend', {}, 'POST', {'X-Forwarded-For': '203.0.113.2'})).status, 200);
});

test('forwarded headers cannot bypass rate limits without a configured proxy', async t => {
  const call = await serve(t, { rateLimit: true, trustProxy: false });
  for (let i = 0; i < 30; i++) assert.equal((await call('/api/recommend', {}, 'POST', {'X-Forwarded-For': `203.0.113.${i}`})).status, 200);
  assert.equal((await call('/api/recommend', {}, 'POST', {'X-Forwarded-For': '203.0.113.200'})).status, 429);
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

test('itinerary HTTP contract exposes evidence and supports external tool consumers without a model', async t => {
  const call = await serve(t);
  const tools = (await call('/api/agent/tools')).body;
  assert.equal(tools.tools[0].function.name,'plan_day');
  assert.equal(tools.transport.plan_day.path,'/api/itineraries');
  const result = await call('/api/itineraries',{people:[{name:'Sam',artists:['Amaarae'],vibes:['v-cafe']}]});
  assert.equal(result.status,200);
  assert.equal(result.body.status,'complete');
  assert.equal(result.body.provenance.provider,'demo');
  assert.equal(result.body.links.directions,null);
  assert.ok(result.body.tasteMap.edges.length);
  assert.equal(result.body.budget.basis,'spending_allowances');
  assert.equal((await call('/api/agent',{message:'Plan a day'})).body.code,'agent_not_configured');
  assert.equal((await call('/api/itineraries',{startTime:'12:00',endTime:'12:15'})).status,400);
});
test('agent route executes the validated planning tool and returns clarifications without searching',async t=>{
  let query;
  const agent={configured:()=>true,interpret:async input=>{query=input;return input.message==='clarify'?{status:'needs_input',question:'Which area?'}:{status:'ready',request:parseItinerary(),model:'test-model'};}};
  const call=await serve(t,{agent});
  assert.equal((await call('/api/health')).body.agentConfigured,true);
  const clarified=await call('/api/agent',{message:'clarify',history:[]});
  assert.equal(clarified.body.status,'needs_input');
  assert.equal(clarified.body.stops,undefined);
  const planned=await call('/api/agent',{message:'plan'});
  assert.equal(planned.status,200);
  assert.equal(planned.body.agent.action,'plan_day');
  assert.ok(planned.body.stops.length);
  assert.equal(query.message,'plan');
  assert.equal((await call('/api/agent',{message:'plan',venue:'invented'})).status,400);
});

test('chat cards, circle actions and replies pass through without searching for places',async t=>{
  const results=[{status:'show_ui',panel:'circles'},{status:'action',action:'bring_circle',circleId:'sunday'},{status:'reply',text:'Your day considers both people.'}];
  let received;
  const call=await serve(t,{provider:{name:'qloo',discover:()=>assert.fail('A chat action must not search for places')},agent:{configured:()=>true,interpret:async input=>{received=input;return results[Number(input.message)];}}});
  for(let i=0;i<results.length;i++){
    const result=await call('/api/agent',{message:String(i),circles:[],planContext:{stops:[],warnings:[]}});
    assert.equal(result.status,200);assert.deepEqual(result.body,results[i]);
  }
  assert.deepEqual(received.planContext,{stops:[],warnings:[]});
});


test('shared-day HTTP routes require scoped credentials and support circle and personal changes',async t=>{
  const call=await serve(t);
  const created=await call('/api/days',{request:{people:[{id:'alex',name:'Alex'}]}});
  assert.equal(created.status,201);
  const day=created.body,path=`/api/days/${day.id}`,auth={Authorization:`Bearer ${day.token}`};
  assert.equal((await call(path)).status,403);
  const circle=await call(`${path}/circle`,{name:'Sunday people',people:[{id:'sam',name:'Sam',vibes:['v-cafe']}]},'POST',auth);
  assert.equal(circle.status,200);assert.equal(circle.body.request.people.length,2);
  const memberKey=circle.body.participantLinks.find(p=>p.id==='sam').token;
  const personal={Authorization:`Bearer ${memberKey}`};
  const read=await call(path,undefined,'GET',personal);assert.equal(read.body.access.role,'member');assert.equal(read.body.participantLinks,undefined);
  assert.equal((await call(`${path}/members/alex`,{name:'Changed'},'PATCH',personal)).status,403);
  assert.equal((await call(`${path}/members/sam`,{name:'Sam',artists:['Tems'],vibes:['v-cafe']},'PATCH',personal)).status,200);
  assert.equal((await call(path,{request:day.request,revision:1},'PATCH',auth)).status,409);
});
