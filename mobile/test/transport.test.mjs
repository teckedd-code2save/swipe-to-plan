import test from "node:test";
import assert from "node:assert/strict";
import { apiOrigin, createApi, readPlanStream } from "../src/transport.js";
function stream(chunks) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks)
          controller.enqueue(
            typeof chunk === "string" ? encoder.encode(chunk) : chunk,
          );
        controller.close();
      },
    }),
    { headers: { "content-type": "application/x-ndjson" } },
  );
}
test("release API requires clean HTTPS and development only permits local HTTP", () => {
  assert.equal(apiOrigin(), "https://unstressed.serendepify.com");
  assert.equal(apiOrigin("http://10.0.2.2:4000", true), "http://10.0.2.2:4000");
  for (const value of [
    "http://example.com",
    "https://name:password@example.com",
    "https://example.com/api",
    "https://example.com/?token=secret",
  ])
    assert.throws(() => apiOrigin(value, true));
  assert.throws(() => apiOrigin("http://localhost:4000"));
});
test("stream handles arbitrary chunk boundaries and multibyte place names", async () => {
  const encoded = new TextEncoder().encode(
    JSON.stringify({ type: "discovery", plan: { title: "Café" } }) +
      "\n" +
      JSON.stringify({ type: "complete", plan: { title: "Café final" } }),
  );
  const chunks = Array.from(encoded, (byte) => new Uint8Array([byte]));
  const seen = [];
  assert.deepEqual(
    await readPlanStream(stream(chunks), (plan) => seen.push(plan)),
    { title: "Café final" },
  );
  assert.deepEqual(seen, [{ title: "Café" }]);
});
test("unfinished preview and stream error never become a completed plan", async () => {
  await assert.rejects(
    readPlanStream(stream(['{"type":"discovery","plan":{"stops":[]}}\n'])),
    /interrupted/,
  );
  await assert.rejects(
    readPlanStream(
      stream(['{"type":"error","error":"Provider unavailable"}\n']),
    ),
    /Provider unavailable/,
  );
  await assert.rejects(readPlanStream(stream(["bad json\n"])), SyntaxError);
});
test("stream supports existing JSON endpoint response and sanitized HTTP errors", async () => {
  assert.deepEqual(await readPlanStream(Response.json({ stops: [] })), {
    stops: [],
  });
  await assert.rejects(
    readPlanStream(Response.json({ error: "Slow down" }, { status: 429 })),
    (error) => error.status === 429 && error.message === "Slow down",
  );
});
test("public native adapter omits cookies and all account/share credentials", async () => {
  const requests = [];
  const api = createApi({
    origin: "https://example.com",
    fetch: async (url, options) => {
      requests.push({ url, options });
      return Response.json({ locations: [] });
    },
  });
  await api.locations("East Legon");
  await api.nearby({ latitude: 5.68, longitude: -0.12 });
  assert.equal(
    requests[0].url,
    "https://example.com/api/locations?q=East%20Legon",
  );
  for (const { options } of requests) {
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.origin, undefined);
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.headers.cookie, undefined);
  }
  assert.equal(requests[1].options.body, '{"latitude":5.68,"longitude":-0.12}');
});
test("transport aborts in-flight requests and distinguishes timeout from deliberate cancellation", async () => {
  const fetch = async (url, { signal }) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) reject(new Error("aborted"));
      else signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  const api = createApi({ origin: "https://example.com", fetch, timeout: 10 });
  await assert.rejects(api.health(), /taking too long/);
  const controller = new AbortController();
  const work = api.health(controller.signal);
  controller.abort();
  await assert.rejects(work, /aborted/);
});

test('native session is confined to planner calls and only explicit revision headers pass through',async()=>{
 const calls=[];
 const api=createApi({origin:'https://example.com',fetch:async(url,options)=>{calls.push({url,options});return Response.json({});},getAuthorization:()=> 'Bearer native-test-token',getPlanHeaders:()=>({'x-unstressed-plan-id':'plan-id','x-unstressed-plan-revision':'3',origin:'https://forged.example',cookie:'secret'})});
 await api.health(); await api.locations('Accra'); await api.nearby({latitude:5,longitude:0}); await api.deck();
 await api.agent({message:'hello'});await api.itinerary({});
 for(const {options} of calls.slice(0,4)) assert.equal(options.headers.authorization,undefined);
 for(const {options} of calls.slice(4)) {
  assert.equal(options.headers.authorization,'Bearer native-test-token');assert.equal(options.headers['x-unstressed-plan-revision'],'3');
  assert.equal(options.headers.origin,undefined);assert.equal(options.headers.cookie,undefined);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
 }
});
test('unauthorized account planning reports the captured credential without retrying as guest',async()=>{
 let calls=0,invalidated;
 const api=createApi({origin:'https://example.com',fetch:async()=>{calls++;return Response.json({error:'Session expired'},{status:401});},getAuthorization:()=> 'Bearer old-session',onUnauthorized:(token)=>{invalidated=token;}});
 await assert.rejects(api.agent({}),/Session expired/);assert.equal(calls,1);assert.equal(invalidated,'Bearer old-session');
});
