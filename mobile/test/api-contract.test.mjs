// Test fixtures only. The app runtime never imports the synthetic provider.
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../../backend/src/app.js";
import { createDemoProvider } from "../../backend/src/demo-provider.js";
import { createApi } from "../src/transport.js";
import { newBrief, editStop } from "../src/planning.js";
import { isPlan } from "../src/validation.js";

test("native transport speaks directly to existing Express NDJSON and edits without account auth", async (t) => {
  const server = createApp({
    provider: createDemoProvider(),
    rateLimit: false,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const safeFetch = (url, options) => {
    assert.ok(url.startsWith(origin + "/api/"));
    return fetch(url, options);
  };
  const api = createApi({ origin, fetch: safeFetch });
  const request = {
    ...newBrief(),
    area: "Osu",
    activities: ["coffee", "dinner"],
    currency: "GHS",
  };
  const previews = [];
  const plan = await api.itinerary(request, {
    onDiscovery: (preview) => previews.push(preview),
  });
  assert.equal(previews.length, 1);
  assert.ok(isPlan(previews[0]));
  assert.ok(isPlan(plan));
  assert.equal(plan.provenance.provider, "demo");
  assert.ok(plan.stops.every((stop) => stop.item));
  assert.equal(plan.savedPlan, undefined);
  assert.equal(plan.request.budget, null);
  const changed = await api.itinerary(editStop(plan, 0, "swap"));
  assert.notEqual(changed.stops[0].item.id, plan.stops[0].item.id);
  assert.equal(changed.stops[1].item.id, plan.stops[1].item.id);
  await assert.rejects(
    api.agent({ message: "Hello", context: request }),
    (error) => error.status === 503,
  );
  const forbidden = await safeFetch(`${origin}/api/account/planning-location`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ locationId: null }),
  });
  assert.ok([401, 403].includes(forbidden.status));
});
