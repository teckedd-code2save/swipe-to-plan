import { InputError, parseRequest } from "./contract.js";

const INTENTS = ["coffee", "dinner", "drinks"];
const LABELS = { coffee: "Start with coffee", dinner: "Sit down for dinner", drinks: "Make it a night" };

export function parseOutingRequest(body = {}) {
  const allowed = ["stops", "location", "taste", "liked", "constraints", "feedback"];
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new InputError(`Supported outing fields: ${allowed.join(", ")}.`);
  }
  const { stops = [{ intent: "dinner" }, { intent: "drinks" }], ...preferences } = body;
  if (!Array.isArray(stops) || stops.length < 1 || stops.length > 3) throw new InputError("Choose one to three outing stops.");
  const parsedStops = stops.map((stop) => {
    if (!stop || typeof stop !== "object" || Array.isArray(stop) || Object.keys(stop).some((key) => !["intent", "pinnedId"].includes(key)) || !INTENTS.includes(stop.intent)) {
      throw new InputError("Each stop needs a coffee, dinner or drinks intent; only an optional pinnedId is also supported.");
    }
    if (stop.pinnedId !== undefined && (typeof stop.pinnedId !== "string" || !stop.pinnedId.trim() || stop.pinnedId.length > 160)) {
      throw new InputError("A pinnedId must be a non-empty candidate ID of at most 160 characters.");
    }
    return { intent: stop.intent, ...(stop.pinnedId !== undefined ? { pinnedId: stop.pinnedId.trim() } : {}) };
  });
  if (new Set(parsedStops.map((stop) => stop.intent)).size !== parsedStops.length) throw new InputError("Use each stop type only once.");
  const pinned = parsedStops.map((stop) => stop.pinnedId).filter(Boolean);
  if (new Set(pinned).size !== pinned.length) throw new InputError("Keep a different place for each stop.");
  const { intent, limit, ...request } = parseRequest(preferences);
  return { ...request, stops: parsedStops };
}

// At most 9^3 assignments. Fill the most stops first, then maximize total rank
// score; a flexible restaurant/bar must not consume the only dinner candidate.
export function selectStops(pools) {
  let best = { items: [], count: -1, score: -1 };
  function visit(index, items, used, count, score) {
    if (index === pools.length) {
      if (count > best.count || (count === best.count && score > best.score)) best = { items: [...items], count, score };
      return;
    }
    for (const item of [...pools[index], null]) {
      if (item && used.has(item.id)) continue;
      if (item) used.add(item.id);
      items.push(item);
      visit(index + 1, items, used, count + Number(!!item), score + (item?.score ?? 0));
      items.pop();
      if (item) used.delete(item.id);
    }
  }
  visit(0, [], new Set(), 0, 0);
  return best.items;
}

export async function buildOuting(discovery, request) {
  const results = await discovery.byIntents(request, request.stops.map((stop) => stop.intent));
  const reserved = new Set(request.stops.map((stop) => stop.pinnedId).filter(Boolean));
  const pools = results.map((result, index) => {
    const { pinnedId } = request.stops[index];
    return pinnedId ? result.ranked.filter((item) => item.id === pinnedId) : result.ranked.filter((item) => !reserved.has(item.id)).slice(0, 8);
  });
  const selected = selectStops(pools);
  const stops = request.stops.map((stop, index) => ({
    intent: stop.intent, label: LABELS[stop.intent], item: selected[index],
    status: selected[index] ? "matched" : "unfilled",
    ...(selected[index] ? {} : { reason: stop.pinnedId ? "kept_place_unavailable" : pools[index].length ? "no_distinct_place" : "no_eligible_places" }),
    eligible: results[index].ranked.length,
    excluded: results[index].excluded,
  }));
  const { taste, provenance, fetched } = results[0];
  const filled = stops.filter((stop) => stop.item).length;
  return {
    version: "1.0", status: filled === stops.length ? "complete" : "partial", request, stops, taste, provenance,
    diagnostics: { fetched, filled, requested: stops.length },
    selectionPolicy: "Maximize filled stops, then total ranking score. Use distinct venues and preserve eligible pinned stops. No route or time optimization.",
    warnings: [
      ...(provenance.provider === "demo" ? ["Synthetic demo data; these are not real venue recommendations."] : []),
      ...(taste.unresolved.length ? ["Some artists could not be resolved and were not used as taste signals."] : []),
      ...(!taste.resolved.length ? ["No artist affinity signals were used. Ranking uses provider order and selected vibe tags."] : []),
      ...(filled < stops.length ? ["Some stops could not be filled. No constraints were relaxed."] : []),
      "This is a suggested sequence, not a reservation. Check opening hours, prices and availability with each venue.",
      "Travel times and distances have not been checked. Review each location before heading out.",
    ],
  };
}
