import { isBrief, isPlan, validTimeZone } from "./validation.js";
import { planTitle } from "./planning.js";
import { safeContactWebsite, phoneFormat } from "../../shared/venue-contact.js";
import { INTEREST_TYPES } from "../../shared/research-context.js";

export const LIBRARY_VERSION = 2;
export const LIBRARY_LIMITS = { plans: 20, circles: 12, profiles: 6, bytes: 1500000 };
export const CIRCLE_TASTES = [
  ["v-cafe", "Cozy cafés"], ["v-livemusic", "Live music"],
  ["v-art", "Art & galleries"], ["v-nature", "Parks & gardens"],
  ["v-books", "Books & browsing"], ["v-markets", "Markets & local finds"],
  ["v-beach", "Beach time"], ["v-cinema", "Film nights"],
];
const intentValues = ["coffee", "activity", "dinner", "drinks"];
const plain = (v) => !!v && typeof v === "object" && !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const fail = (label) => { throw new Error(`Check ${label}. The previous saved library is kept.`); };
const object = (v, label) => plain(v) ? v : fail(label);
const text = (v, max, label, required = false) => typeof v === "string" && v.length <= max &&
  (!required || !!v.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v) ? v : fail(label);
const choice = (v, choices, label) => choices.includes(v) ? v : fail(label);
const integer = (v, min, max, label) => Number.isInteger(v) && v >= min && v <= max ? v : fail(label);
const boolean = (v, label) => typeof v === "boolean" ? v : fail(label);
const list = (v, max, fn, label) => Array.isArray(v) && v.length <= max ? v.map(fn) : fail(label);
const strings = (v, max, length, label) => list(v, max, (s) => text(s, length, label), label);
const id = (v, label = "the saved ID") => typeof v === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(v) ? v : fail(label);
const timestamp = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && v.length <= 32 && Number.isFinite(Date.parse(v)) ? v : fail("the saved date");
const clock = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : fail("the saved time");
const copy = (v) => JSON.parse(JSON.stringify(v));
const byteLength = (value) => { let bytes = 0; for (const character of value) { const code = character.codePointAt(0); bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4; } return bytes; };
const optional = (source, target, key, parse) => { if (source[key] !== undefined && source[key] !== null) target[key] = parse(source[key]); };
const optionalTexts = (source, target, fields) => { for (const [key, length] of Object.entries(fields)) optional(source, target, key, (v) => text(v, length, key)); };
export const localIdentity = (prefix = "local") => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

// Every nested object is reconstructed. Unknown data (including account fields,
// credentials, chat, coordinates and provider payloads) never reaches storage.
export function sanitizePerson(input) {
  const v = object(input, "the person");
  const result = {
    id: id(v.id, "the person's ID"), name: text(v.name, 24, "each person's name", true).trim(),
    artists: strings(v.artists, 6, 160, "the artists"), vibes: strings(v.vibes, 64, 160, "the tastes"),
  };
  if (v.spending != null) {
    const spending = object(v.spending, "the spending preferences");
    result.spending = {
      style: choice(spending.style, ["mindful", "balanced", "treat"], "the spending style"),
      priority: choice(spending.priority, ["even", ...intentValues], "the spending priority"),
    };
  }
  if (v.context != null) {
    const context = object(v.context, "the personal context"), safe = {};
    optional(context, safe, "role", (s) => text(s, 80, "the context"));
    optional(context, safe, "audiences", (a) => list(a, 3, (s) => typeof s === "string" && /^urn:audience:(professional_area|hobbies_and_interests|leisure|life_stage):[a-z0-9_]+$/.test(s) ? text(s, 160, "the audience") : fail("the audience"), "the audiences"));
    optional(context, safe, "interests", (a) => list(a, 6, (entry) => {
      const item = object(entry, "the interest");
      return { type: choice(item.type, INTEREST_TYPES, "the interest type"), name: text(item.name, 160, "the interest name", true) };
    }, "the interests"));
    if (Object.keys(safe).length) result.context = safe;
  }
  return result;
}
function people(input) {
  const result = list(input, 6, sanitizePerson, "up to six taste profiles");
  if (!result.length || new Set(result.map((p) => p.id)).size !== result.length) fail("distinct person IDs");
  return result;
}
export function sanitizeBrief(input) {
  const v = object(input, "the outing"), timing = object(v.timing, "the timing"), party = object(v.party, "the headcount");
  const date = text(v.date, 10, "the date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail("the date");
  const result = {
    title: text(v.title, 80, "the outing title"), titleSource: choice(v.titleSource, ["auto", "custom", "legacy"], "the title source"),
    area: text(v.area, 160, "the planning area"), currencyMode: choice(v.currencyMode, ["local", "custom"], "the currency mode"),
    date, timing: { dateConfirmed: boolean(timing.dateConfirmed, "the date choice"), timeConfirmed: boolean(timing.timeConfirmed, "the time choice"), mode: choice(timing.mode, ["fixed", "flexible"], "the timing mode") },
    party: { adults: integer(party.adults, 1, 100, "the adult count"), children: integer(party.children, 0, 100, "the child count") },
    people: people(v.people), budget: v.budget === null ? null : integer(v.budget, 1, 10000000, "the budget"),
    currency: typeof v.currency === "string" && /^[A-Z]{3}$/.test(v.currency) ? v.currency : fail("the currency"),
    startTime: clock(v.startTime), endTime: clock(v.endTime), pace: choice(v.pace, ["easy", "balanced"], "the pace"),
    activities: list(v.activities, 3, (s) => choice(s, intentValues, "the activity"), "the activities"),
    pins: {}, excludeIds: strings(v.excludeIds, 100, 160, "the excluded places"),
  };
  if (result.endTime <= result.startTime || result.people.length > result.party.adults + result.party.children || new Set(result.activities).size !== result.activities.length) fail("the outing details");
  optional(timing, result.timing, "window", (s) => choice(s, ["any", "morning", "afternoon", "evening", "custom"], "the time window"));
  optional(v, result, "locationId", (s) => text(s, 160, "the area ID", true));
  optional(v, result, "stopIntents", (a) => list(a, 3, (s) => choice(s, result.activities, "the stop sequence"), "the stops"));
  optional(v, result, "route", (a) => list(a, 3, (entry) => {
    const stop = object(entry, "the route stop");
    return { intent: choice(stop.intent, result.activities, "the route activity"), placeId: text(stop.placeId, 160, "the selected place", true) };
  }, "the route"));
  const sequence = result.stopIntents || result.activities;
  if (result.stopIntents && (!result.stopIntents.length || result.activities.some((intent) => !result.stopIntents.includes(intent)))) fail("the stop sequence");
  if (result.route && (!result.route.length || result.stopIntents && JSON.stringify(result.route.map((stop) => stop.intent)) !== JSON.stringify(result.stopIntents))) fail("the route sequence");
  if (result.party.children && result.activities.includes("drinks")) fail("the family outing activities");
  const pins = object(v.pins, "the kept places");
  const allowedPins = [...result.activities, ...sequence.map((_, i) => `stop-${i}`)];
  for (const key of Object.keys(pins)) if (allowedPins.includes(key)) result.pins[key] = text(pins[key], 160, "the kept place", true);
  if (sequence.some((intent, i) => sequence.indexOf(intent) === i && result.pins[intent] && result.pins[`stop-${i}`])) fail("one kept place per visit");
  optional(v, result, "searchRadiusKm", (n) => choice(n, [0, 20, 50, 100], "the search radius"));
  optional(v, result, "maxPriceLevel", (n) => integer(n, 1, 4, "the price level"));
  if (v.experience != null) {
    const experience = object(v.experience, "the outing preferences"), safe = {};
    optionalTexts(experience, safe, { cuisine: 80, atmosphere: 80, occasion: 80, notes: 220 });
    optional(experience, safe, "explore", (b) => boolean(b, "the exploration choice"));
    optional(experience, safe, "searchTags", (a) => strings(a, 8, 160, "the outing topics"));
    result.experience = safe;
  }
  if (!isBrief(result)) fail("the saved outing");
  return result;
}
function safeUrl(value) {
  const safe = safeContactWebsite(value);
  if (!safe) return null;
  if ([...new URL(safe).searchParams.keys()].some((key) => /token|secret|password|auth|api.?key|session|^code$/i.test(key))) return null;
  return safe;
}
function contactSource(value) {
  if (value == null) return null;
  const source = object(value, "the contact source"), result = {};
  optionalTexts(source, result, { provider: 100, entityId: 160, field: 100, retrievedAt: 100, providerUpdatedAt: 100 });
  return result;
}
function sanitizeVenue(input) {
  const v = object(input, "the place");
  const result = { id: text(v.id, 160, "the place ID", true), name: text(v.name, 500, "the place name", true) };
  optionalTexts(v, result, { entityId: 160, address: 2000, category: 200, description: 12000 });
  if (v.image != null) { const image = safeUrl(text(v.image, 2048, "the place image URL")); if (image) result.image = image; }
  for (const field of ["tagNames", "highlights", "practicalTags", "cuisineTags"]) optional(v, result, field, (a) => strings(a, 100, 500, field));
  optional(v, result, "isClosed", (b) => boolean(b, "the reported closure"));
  if (v.hours != null) {
    const hours = object(v.hours, "the reported hours"); result.hours = {};
    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
      for (const key of [day, day.toLowerCase()]) if (hours[key] !== undefined) result.hours[key] = hours[key] === null ? null : list(hours[key], 12, (entry) => {
        const interval = object(entry, "the hours interval");
        const safe = { opens: clock(interval.opens), closes: interval.closes === "24:00" ? "24:00" : clock(interval.closes) };
        optional(interval, safe, "overnight", (b) => boolean(b, "the overnight hours")); return safe;
      }, "the reported hours");
    }
  }
  if (v.facts != null) {
    const facts = object(v.facts, "the place facts"); result.facts = {};
    if (facts.price != null) {
      const price = object(facts.price, "the reported price");
      result.facts.price = { level: price.level == null ? null : integer(price.level, 1, 4, "the reported price level"), status: choice(price.status, ["provider_reported", "unknown"], "the price status") };
      optionalTexts(price, result.facts.price, { sourceField: 100 });
    }
    if (facts.childSuitability != null) result.facts.childSuitability = { status: text(object(facts.childSuitability, "the child suitability").status, 100, "the child suitability status") };
  }
  if (v.provenance != null) { result.provenance = {}; optionalTexts(object(v.provenance, "the place source"), result.provenance, { provider: 100, entityId: 160, retrievedAt: 100, freshness: 100 }); }
  if (v.links != null) {
    const links = object(v.links, "the contact links"); result.links = {};
    for (const field of ["website", "menu", "map"]) if (links[field] != null) {
      const url = safeUrl(text(links[field], 2048, "the contact URL")); if (url) result.links[field] = url;
    }
    if (links.phone != null) {
      const number = text(links.phone, 200, "the phone link"), parsed = phoneFormat(number.replace(/^tel:/, ""));
      if (parsed.format !== "invalid" && parsed.display) result.links.phone = parsed.dialUrl || parsed.display;
    }
  }
  // Preserve source IDs, including conflicts. Flattening contact into links
  // would incorrectly turn another venue's contact into trusted legacy data.
  if (v.contact != null) {
    const contact = object(v.contact, "the contact evidence"); result.contact = {};
    for (const field of ["phone", "website"]) if (contact[field] != null) {
      const entry = object(contact[field], "the contact detail"), safe = {};
      optionalTexts(entry, safe, { status: 100, format: 100, ownership: 100, reachability: 100 });
      if (field === "phone" && entry.display != null) { const number = phoneFormat(text(entry.display, 200, "the phone number")); safe.display = number.display; }
      if (field === "website" && entry.url != null) safe.url = safeUrl(text(entry.url, 2048, "the website URL"));
      if (entry.source !== undefined) safe.source = contactSource(entry.source);
      result.contact[field] = safe;
    }
    // A normalized conflict may no longer contain the original source IDs.
    // Retain that veto and remove all destinations rather than laundering the
    // remaining URLs into legacy contact evidence on a later read.
    if (contact.identityStatus === "conflicting") {
      result.contact = { identityStatus: "conflicting" };
      result.links = {};
    }
  }
  if (v.experienceFit != null) {
    const fit = object(v.experienceFit, "the place preference match"); result.experienceFit = {};
    for (const key of ["cuisine", "atmosphere"]) if (fit[key] != null) { const match = object(fit[key], "the preference match"); result.experienceFit[key] = { requested: text(match.requested, 220, "the requested preference"), status: text(match.status, 100, "the preference match status") }; }
  }
  return result;
}
export function sanitizePlan(input) {
  const v = object(input, "the saved plan");
  const result = {
    request: sanitizeBrief(v.request), status: choice(v.status, ["complete", "partial"], "the plan status"),
    stops: list(v.stops, 3, (inputStop) => {
      const stop = object(inputStop, "the stop");
      const safe = { id: text(stop.id, 160, "the stop ID", true), intent: choice(stop.intent, intentValues, "the stop activity"), item: stop.item === null ? null : sanitizeVenue(stop.item), alternatives: list(stop.alternatives, 20, sanitizeVenue, "the alternatives") };
      optional(stop, safe, "start", clock); optional(stop, safe, "end", clock);
      optional(stop, safe, "bufferAfterMinutes", (n) => integer(n, 0, 1440, "the travel buffer"));
      optionalTexts(stop, safe, { unfilledReason: 2000, reason: 500, label: 500, status: 80, timeStatus: 80 });
      optional(stop, safe, "connections", (a) => list(a, 420, (inputEdge) => {
        const edge = object(inputEdge, "the taste connection");
        return { personId: id(edge.personId), kind: text(edge.kind, 64, "the connection kind"), label: text(edge.label, 2000, "the connection description") };
      }, "the taste connections"));
      return safe;
    }, "the saved stops"),
  };
  optionalTexts(v, result, { phase: 100 });
  optional(v, result, "warnings", (a) => strings(a, 100, 4000, "the warnings"));
  optional(v, result, "timingNotes", (a) => strings(a, 100, 4000, "the timing notes"));
  if (v.timeZone != null) result.timeZone = validTimeZone(v.timeZone) ? v.timeZone : fail("the time zone");
  if (v.provenance != null) { const p = object(v.provenance, "the source"), safe = {}; optionalTexts(p, safe, { provider: 100, retrievedAt: 100 }); result.provenance = safe; }
  if (v.qualityReview != null) { const q = object(v.qualityReview, "the review"); result.qualityReview = { status: text(q.status, 100, "the review status") }; }
  if (v.budget != null) {
    const budget = object(v.budget, "the plan budget");
    result.budget = { total: budget.total === null ? null : integer(budget.total, 1, 10000000, "the plan budget"), currency: text(budget.currency, 3, "the budget currency") };
    optionalTexts(budget, result.budget, { note: 4000, basis: 100 });
    for (const field of ["transport", "reserve"]) if (budget[field] !== undefined) result.budget[field] = budget[field] === null ? null : integer(budget[field], 0, 10000000, "the allowance");
    optional(budget, result.budget, "allocations", (a) => list(a, 3, (entry) => {
      const allocation = object(entry, "the stop allowance"), safe = { intent: choice(allocation.intent, intentValues, "the allowance activity"), amount: allocation.amount === null ? null : integer(allocation.amount, 0, 10000000, "the stop allowance"), assigned: boolean(allocation.assigned, "the assigned allowance") };
      optionalTexts(allocation, safe, { stopId: 160 });
      optional(allocation, safe, "perPerson", (n) => integer(n, 0, 10000000, "the per-person allowance")); return safe;
    }, "the stop allowances"));
  }
  if (v.allowance != null) {
    const allowance = object(v.allowance, "the suggested allowance");
    result.allowance = { amount: allowance.amount === null ? null : integer(allowance.amount, 0, 10000000, "the allowance") };
    optionalTexts(allowance, result.allowance, { currency: 3, basis: 100, kind: 100 });
    optional(allowance, result.allowance, "pricesVerified", (b) => boolean(b, "the allowance evidence"));
  }
  if (!isPlan(result)) fail("the saved plan");
  return result;
}
export function sanitizeDraft(input) {
  const v = object(input, "the current draft");
  const result = { brief: sanitizeBrief(v.brief), confirmed: boolean(v.confirmed, "the confirmed choice"), plan: v.plan === null ? null : sanitizePlan(v.plan) };
  if (v.planningTimeZone != null) result.planningTimeZone = validTimeZone(v.planningTimeZone) ? v.planningTimeZone : fail("the planning time zone");
  return result;
}
function baseRecord(v) {
  object(v, "the saved record");
  const result = { id: id(v.id), name: text(v.name, 80, "a name", true).trim(), createdAt: timestamp(v.createdAt), updatedAt: timestamp(v.updatedAt) };
  optional(v, result, "removedAt", timestamp);
  return result;
}
const planRecord = (v) => { const record = { ...baseRecord(v), draft: sanitizeDraft(v.draft) }; if (!record.draft.plan) fail("the saved plan snapshot"); return record; };
const circleRecord = (v) => ({ ...baseRecord(v), name: text(v.name, 40, "the circle name", true).trim(), people: people(v.people) });
const emptyLibrary = () => ({ version: LIBRARY_VERSION, plans: [], circles: [] });
export function decodeLibrary(raw) {
  if (raw == null) return emptyLibrary();
  if (typeof raw !== "string" || byteLength(raw) > LIBRARY_LIMITS.bytes) fail("the saved library size");
  let v; try { v = JSON.parse(raw); } catch { fail("the saved library data"); }
  object(v, "the saved library");
  // v1 has the same explicit-copy records, without a recovery section. Reading
  // migrates in memory; the next successful deliberate edit commits v2.
  if (![1, LIBRARY_VERSION].includes(v.version)) throw new Error("This saved library is from an unsupported version. It has not been changed.");
  const result = { version: LIBRARY_VERSION, plans: list(v.plans, LIBRARY_LIMITS.plans, planRecord, "the saved plan limit"), circles: list(v.circles, LIBRARY_LIMITS.circles, circleRecord, "the saved circle limit") };
  for (const records of [result.plans, result.circles]) if (new Set(records.map((r) => r.id)).size !== records.length) fail("distinct saved IDs");
  return result;
}

// Separate screen instances share one queue for a storage/key pair. Reads join
// it too, so reload cannot race an in-flight save. Capture inputs before enqueue.
const queues = new WeakMap();
export function createLibraryStore(storage, key = "unstressed.native.library.v1") {
  let keys = queues.get(storage);
  if (!keys) { keys = new Map(); queues.set(storage, keys); }
  if (keys.has(key)) return keys.get(key);
  let pending = Promise.resolve();
  const enqueue = (fn) => { const job = pending.catch(() => {}).then(fn); pending = job; return job; };
  const load = async () => decodeLibrary(await storage.getItem(key));
  const mutate = (fn) => enqueue(async () => {
    const library = await load();
    const next = fn(library);
    const encoded = JSON.stringify(next);
    if (byteLength(encoded) > LIBRARY_LIMITS.bytes) throw new Error("This library is too large. Permanently delete an older removed copy before saving another.");
    const clean = decodeLibrary(encoded);
    // Never update UI/in-memory records until the durable write succeeds.
    await storage.setItem(key, JSON.stringify(clean));
    return copy(clean);
  });
  const editRecord = (kind, recordId, edit) => mutate((library) => {
    const record = library[kind].find((r) => r.id === recordId);
    if (!record) throw new Error("That saved item is no longer available. Reload the library.");
    edit(record, library);
    return library;
  });
  const api = {
    load: () => enqueue(load),
    addPlan(draft, name) {
      let snapshot, label;
      try { snapshot = sanitizeDraft(draft); if (!snapshot.plan) throw new Error("Find a plan before saving a copy."); label = text(name ?? planTitle(snapshot.plan.request), 80, "the saved plan name", true).trim(); }
      catch (error) { return Promise.reject(error); }
      return mutate((library) => {
        if (library.plans.length >= LIBRARY_LIMITS.plans) throw new Error("Keep up to 20 saved plans, including Recently removed. Delete a removed copy permanently to make room.");
        const now = new Date().toISOString(); library.plans.unshift({ id: localIdentity("plan"), name: label, createdAt: now, updatedAt: now, draft: snapshot }); return library;
      });
    },
    saveCircle(input) {
      let safe, recordId;
      try { object(input, "the circle"); safe = { name: text(input.name, 40, "a circle name", true).trim(), people: people(input.people) }; recordId = input.id === undefined ? undefined : id(input.id); }
      catch (error) { return Promise.reject(error); }
      return mutate((library) => {
        const now = new Date().toISOString(), existing = recordId ? library.circles.find((c) => c.id === recordId && !c.removedAt) : null;
        if (recordId && !existing) throw new Error("That circle is no longer available. Reload before editing.");
        if (existing) Object.assign(existing, safe, { updatedAt: now });
        else {
          if (library.circles.length >= LIBRARY_LIMITS.circles) throw new Error("Keep up to 12 circles, including Recently removed. Delete a removed circle permanently to make room.");
          library.circles.unshift({ id: localIdentity("circle"), ...safe, createdAt: now, updatedAt: now });
        }
        return library;
      });
    },
    renamePlan(recordId, name) {
      let label; try { label = text(name, 80, "the saved plan name", true).trim(); } catch (error) { return Promise.reject(error); }
      return editRecord("plans", recordId, (record) => { if (record.removedAt) throw new Error("Restore this plan before renaming it."); record.name = label; record.updatedAt = new Date().toISOString(); });
    },
    remove(kind, recordId) {
      if (!["plans", "circles"].includes(kind)) return Promise.reject(new Error("Unknown library section."));
      return editRecord(kind, recordId, (record) => { record.removedAt = new Date().toISOString(); });
    },
    restore(kind, recordId) {
      if (!["plans", "circles"].includes(kind)) return Promise.reject(new Error("Unknown library section."));
      return editRecord(kind, recordId, (record) => { delete record.removedAt; });
    },
    deletePermanently(kind, recordId) {
      if (!["plans", "circles"].includes(kind)) return Promise.reject(new Error("Unknown library section."));
      return editRecord(kind, recordId, (record, library) => { if (!record.removedAt) throw new Error("Move this item to Recently removed first."); library[kind] = library[kind].filter((r) => r.id !== recordId); });
    },
  };
  keys.set(key, api);
  return api;
}

export function applyCircleToBrief(currentBrief, circle) {
  const brief = sanitizeBrief(currentBrief), incoming = people(circle.people);
  const first = brief.people[0];
  const placeholder = brief.people.length === 1 && first.id === "you" && first.name === "You" && !first.artists.length && !first.vibes.length && !first.spending && !first.context;
  const current = placeholder ? [] : brief.people;
  // Existing people win conflicts: saved preferences never silently overwrite
  // a person's more recent edits in the current outing.
  const merged = [...current, ...incoming.filter((p) => !current.some((c) => c.id === p.id))];
  if (merged.length > 6) throw new Error("This outing has room for six taste profiles. Remove a profile before applying this circle.");
  return sanitizeBrief({ ...brief, people: merged, party: { ...brief.party, adults: Math.max(brief.party.adults, merged.length - brief.party.children) } });
}
