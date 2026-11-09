import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCircleToBrief, CIRCLE_TASTES, createLibraryStore, decodeLibrary,
  LIBRARY_LIMITS, sanitizeBrief, sanitizeDraft, sanitizePerson, sanitizePlan,
} from "../src/library.js";
import { newBrief } from "../src/planning.js";
import { parseItinerary } from "../../backend/src/itinerary.js";
import { venueDetailsData } from "../src/day-details.js";
import { DECK } from "../../backend/src/deck.js";
import { contactForItem, shapeProviderContact } from "../../shared/venue-contact.js";
const makeDraft = () => {
  const brief = { ...newBrief(new Date(2026, 10, 9)), area: "Accra, Ghana", activities: ["coffee"] };
  return { brief, confirmed: true, planningTimeZone: "Africa/Accra", plan: { request: structuredClone(brief), status: "complete", stops: [{ id: "stop-0", intent: "coffee", item: { id: "qloo:venue-a", entityId: "venue-a", name: "The actual returned café", address: "Accra" }, alternatives: [] }], budget: { total: null, currency: "GHS" } } };
};
function memoryStorage() {
  let value = null, writes = 0, failWrite = false;
  return {
    getItem: async () => value,
    setItem: async (key, next) => { if (failWrite) throw new Error("Disk full"); value = next; writes++; },
    get raw() { return value; }, set raw(next) { value = next; },
    get writes() { return writes; }, set failWrite(next) { failWrite = next; },
  };
}
const person = (id, name = id) => ({ id, name, artists: [], vibes: [] });
test("manual saves are isolated copies; no credential/account/chat/GPS trees persist", async () => {
  const storage = memoryStorage(), store = createLibraryStore(storage), draft = makeDraft();
  draft.account = { token: "private" }; draft.chat = [{ text: "private" }]; draft.coords = { latitude: 8 };
  draft.brief.accountId = "private"; draft.brief.timing.token = "private";
  draft.brief.party.coords = { latitude: 8 };
  draft.brief.people[0].account = { token: "private" };
  draft.plan.stops[0].item.auth = { token: "private" };
  draft.plan.stops[0].item.coordinates = { lat: 8, lng: 2 };
  draft.plan.stops[0].raw = { chat: "private" };
  const pending = store.addPlan(draft);
  draft.brief.title = "Changed after tapping save";
  await pending;
  assert.equal((await store.load()).plans[0].draft.brief.title, "");
  assert.doesNotMatch(storage.raw, /private|coordinates|latitude|account|auth|chat/);
  await store.addPlan(makeDraft());
  const saved = await store.load();
  assert.equal(saved.plans.length, 2); assert.notEqual(saved.plans[0].id, saved.plans[1].id);
  saved.plans[0].draft.brief.people[0].name = "Mutation";
  assert.equal((await store.load()).plans[0].draft.brief.people[0].name, "You");
});
test("shared store serializes concurrent saves, reads and removal without lost updates", async () => {
  const storage = memoryStorage(), disk = createLibraryStore(storage);
  assert.equal(createLibraryStore(storage), disk);
  let release, started;
  const begun = new Promise((resolve) => { started = resolve; });
  const original = storage.setItem;
  storage.setItem = async (...args) => { if (!release) { await new Promise((resolve) => { release = resolve; started(); }); } return original(...args); };
  const first = disk.addPlan(makeDraft(), "First");
  await begun;
  const second = disk.addPlan(makeDraft(), "Second");
  const read = disk.load();
  release(); await Promise.all([first, second]);
  assert.deepEqual((await read).plans.map((p) => p.name), ["Second", "First"]);
});
test("failed writes keep last good records and don't poison later queued operations", async () => {
  const storage = memoryStorage(), disk = createLibraryStore(storage);
  await disk.addPlan(makeDraft(), "Keep me"); const before = storage.raw;
  storage.failWrite = true;
  await assert.rejects(disk.addPlan(makeDraft(), "Cannot save"), /Disk full/);
  assert.equal(storage.raw, before); assert.equal((await disk.load()).plans.length, 1);
  storage.failWrite = false;
  await disk.addPlan(makeDraft(), "Can save again");
  assert.equal((await disk.load()).plans.length, 2);
});
test("unsafe nested types fail save and restore without overwriting valid records", async () => {
  const storage = memoryStorage(), disk = createLibraryStore(storage);
  await disk.addPlan(makeDraft()); const before = storage.raw;
  for (const alter of [
    (d) => { d.brief.pins.coffee = { token: "bad" }; },
    (d) => { d.brief.people[0].artists = [null]; },
    (d) => { d.brief.people[0].spending = { style: {}, priority: "even" }; },
    (d) => { d.plan.stops[0].item.links = { website: {} }; },
    (d) => { d.plan.stops[0].item.hours = { monday: [{ opens: "25:90", closes: "21:00" }] }; },
    (d) => { d.plan.stops[0].connections = [{ personId: "../unsafe", kind: "affinity", label: "No" }]; },
    (d) => { d.plan.budget.total = -1; },
    (d) => { d.planningTimeZone = "Invalid/Nowhere"; },
  ]) {
    const draft = makeDraft(); alter(draft);
    await assert.rejects(disk.addPlan(draft)); assert.equal(storage.raw, before);
    const envelope = JSON.parse(before); envelope.plans[0].draft = draft;
    assert.throws(() => decodeLibrary(JSON.stringify(envelope)));
  }
});
test("corrupt or future storage is never overwritten by a new save", async () => {
  for (const raw of ["not-json", "null", "[]", '{"version":99,"plans":[],"circles":[]}', '{"version":2,"plans":{},"circles":[]}']) {
    const storage = memoryStorage(); storage.raw = raw;
    const store = createLibraryStore(storage);
    await assert.rejects(store.load()); await assert.rejects(store.addPlan(makeDraft()));
    assert.equal(storage.raw, raw); assert.equal(storage.writes, 0);
  }
});
test("v1 migrates in memory, strips unknowns and commits v2 only with a deliberate edit", async () => {
  const storage = memoryStorage(), disk = createLibraryStore(storage);
  await disk.addPlan(makeDraft());
  const old = JSON.parse(storage.raw); old.version = 1; old.account = { token: "private" };
  storage.raw = JSON.stringify(old); const writes = storage.writes;
  const next = await disk.load(); assert.equal(next.version, 2); assert.equal(storage.writes, writes);
  assert.equal(JSON.parse(storage.raw).version, 1);
  await disk.renamePlan(next.plans[0].id, "An old favorite");
  assert.equal(JSON.parse(storage.raw).version, 2); assert.doesNotMatch(storage.raw, /private/);
});
test("record, total byte and migration bounds reject without trimming or losing copies", async () => {
  const storage = memoryStorage(), disk = createLibraryStore(storage);
  for (let i = 0; i < LIBRARY_LIMITS.plans; i++) await disk.addPlan(makeDraft(), `Plan ${i}`);
  const before = storage.raw; await assert.rejects(disk.addPlan(makeDraft()), /20 saved plans/); assert.equal(storage.raw, before);
  const envelope = JSON.parse(before); envelope.version = 1; envelope.plans.push({ ...envelope.plans[0], id: "another-id" });
  assert.throws(() => decodeLibrary(JSON.stringify(envelope)), /limit/);
  const otherStorage = memoryStorage(), other = createLibraryStore(otherStorage), large = makeDraft();
  large.plan.warnings = Array.from({ length: 100 }, () => "🌿".repeat(2000));
  await other.addPlan(large); const good = otherStorage.raw;
  assert.ok(Buffer.byteLength(good, "utf8") < LIBRARY_LIMITS.bytes);
  await assert.rejects(other.addPlan(large), /too large/); assert.equal(otherStorage.raw, good);
});
test("removed plans remain recoverable across restarts and permanent delete is guarded", async () => {
  const storage = memoryStorage(), disk = createLibraryStore(storage);
  const plan = (await disk.addPlan(makeDraft())).plans[0];
  await assert.rejects(disk.deletePermanently("plans", plan.id), /Recently removed/);
  await disk.remove("plans", plan.id);
  const decoded = decodeLibrary(storage.raw); assert.ok(decoded.plans[0].removedAt);
  await disk.restore("plans", plan.id); assert.equal((await disk.load()).plans[0].removedAt, undefined);
  await disk.remove("plans", plan.id); await disk.deletePermanently("plans", plan.id);
  assert.equal((await disk.load()).plans.length, 0);
});
test("renaming labels never changes the saved itinerary or active draft", async () => {
  const draft = makeDraft(), original = structuredClone(draft), disk = createLibraryStore(memoryStorage());
  const saved = await disk.addPlan(draft);
  const renamed = await disk.renamePlan(saved.plans[0].id, "  Friday favorite  ");
  assert.equal(renamed.plans[0].name, "Friday favorite");
  assert.deepEqual(renamed.plans[0].draft, original); assert.deepEqual(draft, original);
});
test("circles preserve stable IDs, optional empty tastes and only allow explicit profile edits", async () => {
  const disk = createLibraryStore(memoryStorage()), profiles = [person("ama", "Ama"), person("kofi", "Kofi")];
  const added = await disk.saveCircle({ name: "Friends", people: profiles });
  const circle = added.circles[0];
  assert.deepEqual(circle.people, profiles);
  profiles[0].name = "Changed outside";
  assert.equal((await disk.load()).circles[0].people[0].name, "Ama");
  const edited = await disk.saveCircle({ id: circle.id, name: "Sunday people", people: [{ ...circle.people[0], artists: ["SZA"] }, circle.people[1]] });
  assert.equal(edited.circles[0].id, circle.id); assert.equal(edited.circles[0].people[0].id, "ama");
  await assert.rejects(disk.saveCircle({ name: "Bad IDs", people: [person("same"), person("same")] }));
  await assert.rejects(disk.saveCircle({ name: "Too many", people: Array.from({ length: 7 }, (_, i) => person(`p${i}`)) }));
  await disk.remove("circles", circle.id); await disk.restore("circles", circle.id);
  assert.equal((await disk.load()).circles[0].people[0].artists[0], "SZA");
});
test("applying circles is deliberate, merges stable IDs, keeps current tastes and respects larger headcounts", () => {
  const brief = { ...newBrief(), party: { adults: 20, children: 3 }, people: [{ ...person("ama"), artists: ["SZA"] }] };
  const before = structuredClone(brief), circle = { people: [{ ...person("ama"), artists: ["BTS"] }, person("kofi")] };
  const next = applyCircleToBrief(brief, circle);
  assert.deepEqual(brief, before); assert.deepEqual(next.people.map((p) => p.id), ["ama", "kofi"]);
  assert.deepEqual(next.people[0].artists, ["SZA"]); assert.deepEqual(next.party, { adults: 20, children: 3 });
  assert.doesNotThrow(() => parseItinerary(next, { allowMissingLocation: true }));
  assert.deepEqual(applyCircleToBrief(newBrief(), circle).people.map((p) => p.id), ["ama", "kofi"]);
  const personal = { ...newBrief(), people: [{ ...person("you", "You"), vibes: ["v-art"] }] };
  assert.equal(applyCircleToBrief(personal, circle).people.length, 3);
  const six = { people: Array.from({ length: 6 }, (_, i) => person(`p${i}`)) };
  assert.throws(() => applyCircleToBrief(personal, six), /six taste profiles/);
});
test("circle choices are actual supported tastes; no profile defaults invent tastes", () => {
  for (const [id] of CIRCLE_TASTES) assert.ok(DECK.some((card) => card.id === id && card.kind === "vibe"));
  assert.deepEqual(sanitizePerson(person("you", "You")).artists, []);
  const context = { ...person("a"), context: { role: "Designer", roleQuote: "Private message", interests: [{ type: "book", name: "Dune", quote: "Private message", token: "private" }] } };
  assert.deepEqual(sanitizePerson(context).context, { role: "Designer", interests: [{ type: "book", name: "Dune" }] });
});
test("venue evidence survives snapshots, unsafe URLs are dropped and contact identity conflicts cannot be laundered", () => {
  const draft = makeDraft(), venue = draft.plan.stops[0].item;
  venue.hours = { monday: [{ opens: "10:00", closes: "24:00", overnight: false, token: "private" }], tuesday: null };
  venue.facts = { price: { level: 2, status: "provider_reported", sourceField: "properties.price_level", token: "private" }, childSuitability: { status: "unknown" }, token: "private" };
  venue.links = { website: "https://venue.example/", menu: "javascript:alert(1)", map: "https://example.com/?token=private" };
  venue.contact = shapeProviderContact({ entity_id: "another-venue", properties: { phone: "+233201234567", website: "https://other.example" } }, "qloo", "2026-11-09T12:00:00Z");
  venue.contact.phone.source.account = { token: "private" };
  draft.plan.budget = { total: 500, currency: "GHS", transport: 75, reserve: 50, allocations: [{ stopId: "stop-0", intent: "coffee", amount: 375, assigned: true }] };
  const restored = sanitizeDraft(draft), item = restored.plan.stops[0].item;
  assert.equal(item.hours.monday[0].closes, "24:00"); assert.equal(item.facts.price.level, 2);
  assert.equal(item.links.menu, undefined); assert.equal(item.links.map, undefined);
  assert.equal(contactForItem(item).identityStatus, "conflicting");
  assert.equal(contactForItem(item).website.url, null);
  assert.equal(restored.plan.budget.allocations[0].amount, 375);
  assert.doesNotMatch(JSON.stringify(restored), /private|javascript/);
});
test("wrong-shape briefs and planless saved records are rejected on restore", async () => {
  for (const brief of [
    { ...newBrief(), date: "2026-02-30" },
    { ...newBrief(), people: [person("one"), person("two")] },
    { ...newBrief(), activities: ["coffee"], stopIntents: [] },
    { ...newBrief(), activities: ["coffee"], stopIntents: ["coffee"], route: [{ intent: "dinner", placeId: "x" }] },
  ]) assert.throws(() => sanitizeBrief(brief));
  const storage = memoryStorage(), disk = createLibraryStore(storage);
  await disk.addPlan(makeDraft()); const envelope = JSON.parse(storage.raw); envelope.plans[0].draft.plan = null;
  assert.throws(() => decodeLibrary(JSON.stringify(envelope)), /snapshot/);
  await assert.rejects(disk.addPlan({ ...makeDraft(), plan: null }), /Find a plan/);
});

test("a changed draft and previous results both survive a manual copy and restore", async () => {
  const draft = makeDraft(); draft.brief.area = "A newly chosen area"; draft.brief.date = "2026-12-12";
  draft.brief.people[0].artists = ["SZA"]; draft.confirmed = false;
  const disk = createLibraryStore(memoryStorage());
  const restored = (await disk.addPlan(draft)).plans[0].draft;
  assert.equal(restored.brief.area, "A newly chosen area");
  assert.equal(restored.plan.request.area, "Accra, Ghana");
  assert.equal(restored.brief.date, "2026-12-12"); assert.equal(restored.plan.request.date, "2026-11-09");
  assert.deepEqual(restored.brief.people[0].artists, ["SZA"]); assert.deepEqual(restored.plan.request.people[0].artists, []);
  assert.equal(restored.confirmed, false);
});

test("normalized contact conflicts stay closed after saved-library round trips", async () => {
  const draft = makeDraft(), item = draft.plan.stops[0].item;
  item.contact = { identityStatus: "conflicting" };
  item.links = { website: "https://wrong.example", menu: "https://wrong.example/menu", phone: "tel:+233201234567" };
  const disk = createLibraryStore(memoryStorage());
  const record = (await disk.addPlan(draft)).plans[0];
  const saved = sanitizePlan(record.draft.plan).stops[0].item;
  assert.equal(saved.contact.identityStatus, "conflicting"); assert.deepEqual(saved.links, {});
  assert.equal(venueDetailsData(saved).conflicting, true);
  assert.equal(venueDetailsData(saved).websiteUrl, null);
  assert.equal(contactForItem(saved).phone.dialUrl, null);
  assert.equal(contactForItem(saved).website.url, null);
});
