import { byId,matchesTasteTag } from "./deck.js";
import { explainCandidate } from "./explain.js";
import { ProviderError } from "./qloo.js";

// Venue category evidence is required. Interest/decor tags cannot establish a venue type.
const VENUE = /(?:^|_)(restaurant|cafe|coffee_shop|bar|pub|lounge|nightclub|night_club|bistro|eatery|pizzeria|steakhouse)(?:$|_)/;
function intentEvidence(tags, intent) {
  if (intent === "activity") return tags.filter((t) => /^urn:tag:(category|genre):(place|qloo):/.test(t.id) && /(?:^|_)(museum|gallery|art_gallery|park|garden|zoo|aquarium|cultural_center|landmark|tourist_attraction|beach|market|marketplace|bookstore|bookshop|library|monument|memorial)(?:$|_)/.test(t.id.split(":").at(-1)));
  const categories = tags.filter((t) => /^urn:tag:(category|genre):(place|qloo):/.test(t.id) && VENUE.test(t.id.split(":").at(-1)));
  if (!categories.length) return [];
  if (intent === "any") return categories;
  const allowed = {
    dinner: /(?:restaurant|bistro|eatery|pizzeria|steakhouse|dinner|dining)/,
    coffee: /(?:cafe|coffee|tea)/,
    drinks: /(?:bar|pub|lounge|nightclub|night_club|cocktail|beer|wine|alcohol)/,
  };
  return tags.filter((t) => /^urn:tag:(category|genre|offerings|beverage_offering|dining_options|culinary_style):(place|qloo):/.test(t.id) && allowed[intent].test(t.id.split(":").at(-1)));
}
const NOISY = new Set(["live_music", "loud", "noisy", "nightclub", "night_club", "dance_club"]);
const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const contains = (text, phrase) => ` ${norm(text)} `.includes(` ${norm(phrase)} `);
const safeString = (s, max = 240) => typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null;
const url = (value) => {
  try { const parsed = new URL(value); return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null; }
  catch { return null; }
};
const tagsOf = (p) => Array.isArray(p.tags) ? p.tags.filter((t) => t && typeof t.id === "string") : [];
const slug = (id) => id.split(":").at(-1);
const priceOf = (p) => Number.isInteger(p.properties?.price_level) && p.properties.price_level >= 1 && p.properties.price_level <= 4 ? p.properties.price_level : null;
const hotel = (p, tags) => /\b(hotel|resort|suites?|residence|apartments?|lodge|guest ?house|inn|hostel)\b/i.test(p.name || "") ||
  tags.some((t) => /hotel|lodging|accommodation/.test(t.id)) ||
  !!(p.properties?.hotel_class || p.properties?.star_rating || p.properties?.number_of_rooms || p.properties?.check_in_time);

function locationEvidence(p, area, locality) {
  if(locality?.query===area&&locality.id&&locality.radius===0)return {field:"query.localities.filter",value:locality.label,method:"qloo_locality_filter",localityId:locality.id};
  const candidates = [
    ["properties.address", p.properties?.address], ["location.city", p.location?.city],
    ["location.neighborhood", p.location?.neighborhood], ["properties.neighborhood", p.properties?.neighborhood],
    ["disambiguation", p.disambiguation], ...Object.entries(p.properties?.geocode||{}).filter(([,v])=>typeof v==='string').map(([k,v])=>[`properties.geocode.${k}`,v]),
  ].filter(([, value]) => typeof value === "string" && value.trim());
  if(!['Accra','Osu','East Legon','Cantonments','Labone','Airport Residential'].includes(area)){
    const combined=candidates.map(([,v])=>v).join(' '),parts=area.split(',').map(s=>s.trim()).filter(Boolean);
    return parts.every(part=>contains(combined,part))?{field:'provider_location_text',value:combined,method:'provider_text_match'}:null;
  }
  const country = p.location?.country ?? p.properties?.country;
  if (typeof country === "string" && !["ghana", "gh", "gha"].includes(norm(country))) return null;
  if (typeof p.location?.city === "string" && !contains(p.location.city, "Accra")) return null;
  // A location query alone is not evidence that each returned candidate is in that area.
  const hasCity = candidates.some(([, text]) => contains(text, "Accra"));
  const match = candidates.find(([, text]) => contains(text, area));
  return hasCity && match ? { field: match[0], value: match[1], method: "provider_text_match" } : null;
}

export function shapePlace(p, source, retrievedAt) {
  const pr = p.properties ?? {};
  const lat = p.location?.lat;
  const lng = p.location?.lon ?? p.location?.lng;
  const coords = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const gid = safeString(p.external?.google_place?.[0]?.place_id ?? pr.external?.google_place?.place_id);
  const map = new URL("https://www.google.com/maps/search/");
  map.searchParams.set("api", "1");
  map.searchParams.set("query", coords ? `${lat},${lng}` : `${p.name} ${pr.address ?? ""}`);
  if (gid) map.searchParams.set("query_place_id", gid);
  const priceLevel = priceOf(p);
  return {
    id: `${source}:${p.entity_id}`, entityId: p.entity_id, name: p.name,
    address: safeString(pr.address) ?? safeString(p.disambiguation) ?? "",
    coordinates: coords ? { lat, lng } : null,
    description: safeString(pr.short_description ?? pr.description, 400),
    affinityEvidence: Array.isArray(p.query?.explainability?.["signal.interests.entities"])
      ? p.query.explainability["signal.interests.entities"].filter((e) => typeof e?.entity_id === "string" && Number.isFinite(e.score) && e.score >= 0 && e.score <= 1).map((e) => ({ entityId: e.entity_id, contribution: e.score, sourceField: "query.explainability.signal.interests.entities" })) : [],
    image: url(pr.images?.[0]?.url ?? (typeof pr.image === "string" ? pr.image : pr.image?.url)),
    links: {
      map: map.href, website: url(pr.website), menu: url(pr.menu_url),
      phone: typeof pr.phone === "string" && /^\+?[0-9 ()-]{6,20}$/.test(pr.phone.trim()) ? `tel:${pr.phone.replace(/[ ()-]/g, "")}` : null,
    },
    tagNames: tagsOf(p).filter((t) => /^urn:tag:(category|genre|cuisine|setting|culinary_style|ambience|amenity|beverage_offering):/.test(t.id)).map((t) => safeString(t.name, 80)).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 6),
    facts: {
      price: { level: priceLevel, status: priceLevel === null ? "unknown" : "provider_reported", sourceField: priceLevel === null ? null : "properties.price_level" },
      hours: { status: "unverified" }, availability: { status: "unknown" },
      childSuitability: { status: tagsOf(p).some((t) => /:(kid_friendly|family_friendly|good_for_kids)$/.test(t.id)) ? "provider_reported" : "unknown" },
    },
    provenance: { provider: source, entityId: p.entity_id, retrievedAt, freshness: "provider_update_time_unknown" },
    uncertainty: ["Opening hours and availability have not been verified.", "Provider details may be outdated; confirm with the venue."],
  };
}

export function rankPlaces(places, request, { source = "qloo", retrievedAt = new Date().toISOString(), resolved = [], locality } = {}) {
  const excluded = {};
  const reject = (reason) => { excluded[reason] = (excluded[reason] ?? 0) + 1; };
  const seen = new Set();
  const feedbackIds = new Set(request.feedback.map((f) => f.candidateId));
  const dislikesNoise = request.feedback.some((f) => f.reason === "too_noisy");
  const selectedVibes = request.taste.vibes.map((id) => byId[id]);
  const ranked = [];
  places.forEach((p, index) => {
    if (!p || typeof p.entity_id !== "string" || !p.entity_id || !safeString(p.name)) return reject("missing_identity");
    if (seen.has(p.entity_id)) return reject("duplicate");
    seen.add(p.entity_id);
    const id = `${source}:${p.entity_id}`;
    if (request.constraints.excludeIds.includes(id) || feedbackIds.has(id)) return reject("excluded_by_user");
    const tags = tagsOf(p);
    if (p.properties?.is_closed === true) return reject("permanently_closed");
    if (request.constraints.excludeHotels && hotel(p, tags)) return reject("hotel");
    const administrative = /\b(ministry of|government office|police station|embassy|consulate)\b/i.test(p.name) || tags.some((t) => /^urn:tag:(category|genre):/.test(t.id) && /(?:^|_)(government_office|police_station|embassy|consulate)(?:$|_)/.test(slug(t.id)));
    if (administrative) return reject("non_outing_venue");
    const intentTags = intentEvidence(tags, request.intent);
    if (!intentTags.length) return reject("intent_not_supported");
    const location = locationEvidence(p, request.location.area,locality);
    if (!location) return reject("location_not_supported");
    if (request.constraints.excludeTags.some((excludedTag) => tags.some((t) => t.id === excludedTag || slug(t.id) === excludedTag))) return reject("excluded_tag");
    if (request.constraints.maxPriceLevel !== undefined) {
      if (priceOf(p) === null) return reject("price_unknown");
      if (priceOf(p) > request.constraints.maxPriceLevel) return reject("over_price_limit");
    }
    const matched = selectedVibes.filter((v) => tags.some((t) => matchesTasteTag(v,t.id)));
    const noiseTags = tags.filter((t) => NOISY.has(slug(t.id)));
    const base = 1 - index / Math.max(places.length, 1);
    const boost = Math.min(0.15 * matched.length, 0.45);
    const penalty = dislikesNoise && noiseTags.length ? 0.25 : 0;
    const item = shapePlace(p, source, retrievedAt);
    const intentText = request.intent === "any" ? "outing" : request.intent;
    item.reasons = [
      { code: "intent_match", text: `Provider tags match your ${intentText} request.`, evidence: intentTags.map((t) => ({ field: "tags", value: t.id })) },
      { code: "location_match", text: locality?`Qloo filtered places to ${locality.name}.`:`Provider location text matches ${request.location.area}.`, evidence: [location] },
    ];
    if (resolved.length) item.reasons.push({ code: "taste_affinity", text: source === "demo" ? "Demo ordering uses your resolved sample signals." : "Qloo ordered these candidates using your resolved artist signals.", evidence: resolved.map((s) => ({ field: "signal.interests.entities", value: s.entityId })) });
    if (matched.length) item.reasons.push({ code: "vibe_match", text: `Matching tags: ${matched.map((v) => v.label).join(", ")}.`, evidence: matched.flatMap((v) => tags.filter((t) => matchesTasteTag(v,t.id)).map((t) => ({ field: "tags", value: t.id }))) });
    if (penalty) item.reasons.push({ code: "noise_penalty", text: "Ranked lower after your noise feedback because of music or nightlife tags.", evidence: noiseTags.map((t) => ({ field: "tags", value: t.id })) });
    if (request.constraints.maxPriceLevel !== undefined) item.reasons.push({ code: "price_match", text: `Provider price tier ${priceOf(p)} is within your cap.`, evidence: [{ field: "properties.price_level", value: priceOf(p) }] });
    item.score = +Math.max(0, base + boost - penalty).toFixed(4);
    item.scoreComponents = { providerOrder: +base.toFixed(4), vibeBoost: boost, noisePenalty: penalty };
    item.matchedVibes = matched.map((v) => v.label);
    item.why = explainCandidate(item);
    ranked.push(item);
  });
  return { ranked: ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)), excluded };
}

export function relaxationOptions(request) {
  const options = [];
  if (["Osu","East Legon","Cantonments","Labone","Airport Residential"].includes(request.location.area)) options.push({ code: "widen_area", label: "Search across Accra", changes: { location: { area: "Accra" } } });
  if (request.intent !== "any") options.push({ code: "change_intent", label: "Try any outing type", changes: { intent: "any" } });
  if (request.constraints.maxPriceLevel !== undefined) {
    const { maxPriceLevel, ...constraints } = request.constraints;
    options.push({ code: "remove_price_cap", label: "Remove price cap (unknown prices may appear)", changes: { constraints } });
  }
  return options;
}

export function createDiscovery({ provider, now = Date.now }) {
  const cache = new Map();
  async function retrieve(request,intents=[]) {
    const resolution = await Promise.all(request.taste.artists.map(async (requested) => {
      try {
        const result = await provider.resolveArtist(requested);
        return result?.status === "resolved" && result.entityId
          ? { requested, name: result.name, entityId: result.entityId }
          : { requested, reason: result?.reason ?? "no_exact_artist_match" };
      } catch (e) {
        if (["provider_auth_error", "provider_rate_limited", "provider_not_configured"].includes(e.code)) throw e;
        return { requested, reason: "resolution_unavailable" };
      }
    }));
    const resolved = resolution.filter((s) => s.entityId);
    const unresolved = resolution.filter((s) => !s.entityId);
    const signalIds = [...new Set(resolved.map((s) => s.entityId))].sort();
    const tagSignals=provider.resolveTasteTags?await provider.resolveTasteTags(request.taste.vibes):[];
    const includeActivity=intents.includes('activity');
    const key = JSON.stringify([request.location.area,request.location.id, signalIds,...(provider.resolveTasteTags?[tagSignals,includeActivity]:[])]);
    let entry = cache.get(key);
    const cached = !!entry && now() - entry.at < 600000;
    if (!cached) {
      let places;
      try { places = await provider.discover({ signalIds, area: request.location.area,locationId:request.location.id,tagSignals,includeActivity }); }
      catch (e) { throw e instanceof ProviderError ? e : new ProviderError(); }
      if (!Array.isArray(places)) throw new ProviderError("provider_response_invalid");
      entry = { places, locality:places.locality||null, at: now() };
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, entry);
    }
    const provenance = { provider: provider.name, retrievedAt: new Date(entry.at).toISOString(), cached,...(entry.locality?{locality:entry.locality}:{}), cacheAgeMs: Math.max(0, now() - entry.at) };
    return { places: entry.places, taste: { mode: resolved.length ? "artist_affinity" : request.taste.vibes.length ? "vibe_refinement" : "discovery", resolved, unresolved, vibes: request.taste.vibes,...(tagSignals.length?{tagSignals}:{}) }, provenance, fetched: entry.places.length };
  }
  function rank(retrieved, request) {
    const { places, ...metadata } = retrieved;
    return { ...rankPlaces(places, request, { source: provider.name, retrievedAt: metadata.provenance.retrievedAt, resolved: metadata.taste.resolved,locality:metadata.provenance.locality }), ...metadata };
  }
  async function person(request) {
    return rank(await retrieve(request), request);
  }
  return {
    location:provider.getLocation,
    person,
    async byIntents(request, intents) {
      const retrieved = await retrieve(request,intents);
      return intents.map((intent) => rank(retrieved, { ...request, intent }));
    },
    async recommend(request) {
      const p = await person(request);
      const items = p.ranked.slice(0, request.limit);
      const insufficient = items.length < request.limit;
      return {
        version: "1.0", status: insufficient ? "insufficient_matches" : "ok", request, items, taste: p.taste, provenance: p.provenance,
        diagnostics: { fetched: p.fetched, eligible: p.ranked.length, excluded: p.excluded },
        relaxationOptions: insufficient ? relaxationOptions(request) : [],
        warnings: [
          ...(provider.name === "demo" ? ["Synthetic demo data; these are not real venue recommendations."] : []),
          ...(p.taste.unresolved.length ? ["Some artists could not be resolved and were not used as taste signals."] : []),
          ...(!p.taste.resolved.length ? ["No artist affinity signals were used. Ranking uses provider order and any selected vibe tags."] : []),
          ...(insufficient ? ["Fewer candidates met the evidence checks than requested. No constraints were relaxed."] : []),
        ],
        feedbackPolicy: { scope: "request_only", exclusions: request.feedback.map((f) => f.candidateId), noisePenaltyActive: request.feedback.some((f) => f.reason === "too_noisy") },
      };
    },
  };
}

export function mergeGroup(people, limit = 8) {
  if (!people.length) return { items: [], summary: [] };
  const candidates = new Map();
  people.forEach((p, pi) => p.ranked.forEach((r, ri) => {
    const entry = candidates.get(r.id) ?? { ...r, scores: new Map(), ranks: new Map() };
    entry.scores.set(pi, r.score); entry.ranks.set(pi, ri);
    entry.matchedVibes = [...new Set([...entry.matchedVibes, ...r.matchedVibes])];
    candidates.set(r.id, entry);
  }));
  const items = [...candidates.values()].map(({ scores, ranks, ...item }) => {
    const values = people.map((_, i) => scores.get(i) ?? 0.05);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const minimum = Math.min(...values);
    const favoriteMembers = people.flatMap((p, i) => ranks.has(i) && ranks.get(i) < 5 ? [{ id: p.id, name: p.name }] : []);
    const inAll = people.every((_, i) => scores.has(i));
    const reasons = item.reasons.filter((r) => ["intent_match", "location_match", "price_match"].includes(r.code));
    reasons.push({ code: "group_rank", text: `Appears in ${scores.size} of ${people.length} members' candidate lists.`, evidence: [{ field: "group_formula", value: "0.6 * minimum + 0.4 * mean; missing score = 0.05" }] });
    const result = { ...item, score: +(0.6 * minimum + 0.4 * mean).toFixed(4), scoreComponents: { minimum, mean, missingScore: 0.05 }, reasons, favoriteMembers, inAll };
    result.why = explainCandidate(result);
    return result;
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
  const summary = [
    `${items.filter((i) => i.inAll).length} of ${items.length} picks appear in every member's candidate list.`,
    "Group scores are a ranking heuristic. Missing candidates are unknown preferences, not dislikes.",
    ...people.map((p) => `${p.name}: ${items.filter((i) => i.favoriteMembers.some((m) => m.id === p.id)).length} of their top five made this shortlist.`),
  ];
  return { items, summary };
}
