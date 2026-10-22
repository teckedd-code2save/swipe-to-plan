import { byId } from "./deck.js";

export const INTENTS = ["any", "dinner", "drinks", "coffee"];
export const AREAS = ["Accra", "Osu", "East Legon", "Cantonments", "Labone", "Airport Residential"];
export const FEEDBACK_REASONS = ["not_relevant", "too_noisy"];

export class InputError extends Error {
  constructor(message) { super(message); this.status = 400; this.code = "invalid_request"; }
}
const bad = (message) => { throw new InputError(message); };
function object(value, path, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) bad(`${path} must be an object.`);
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length) bad(`Unsupported ${path} field: ${unknown.join(", ")}. See /api/schema.`);
  return value;
}
function strings(value, path, max, validate = () => true) {
  if (!Array.isArray(value) || value.length > max || value.some((s) => typeof s !== "string" || !s.trim() || s.length > 160 || !validate(s))) {
    bad(`${path} must contain at most ${max} valid strings.`);
  }
  return [...new Set(value.map((s) => s.trim()))];
}

export function parseRequest(body = {}) {
  object(body, "request", ["intent", "location", "taste", "constraints", "feedback", "limit", "liked", "area"]);
  const intent = body.intent ?? "any";
  if (!INTENTS.includes(intent)) bad(`intent must be one of: ${INTENTS.join(", ")}.`);
  const location = object(body.location ?? {}, "location", ["area"]);
  const area = location.area ?? body.area ?? "Accra";
  if (!AREAS.includes(area)) bad(`location.area must be one of: ${AREAS.join(", ")}.`);
  if (body.area !== undefined && body.area !== area) bad("area and location.area must agree.");
  const taste = object(body.taste ?? {}, "taste", ["artists", "vibes"]);
  const liked = strings(body.liked ?? [], "liked", 20, (id) => Object.hasOwn(byId, id));
  const cards = liked.map((id) => byId[id]);
  const artists = strings([...strings(taste.artists ?? [], "taste.artists", 16), ...cards.filter((c) => c.kind === "artist").map((c) => c.label)], "combined artists", 36);
  if (artists.length > 16) bad("Use at most 16 distinct artists.");
  const vibes = strings([...strings(taste.vibes ?? [], "taste.vibes", 6, (id) => byId[id]?.kind === "vibe"), ...cards.filter((c) => c.kind === "vibe").map((c) => c.id)], "combined vibes", 12);
  const c = object(body.constraints ?? {}, "constraints", ["excludeHotels", "maxPriceLevel", "excludeTags", "excludeIds"]);
  if (c.excludeHotels !== undefined && typeof c.excludeHotels !== "boolean") bad("constraints.excludeHotels must be boolean.");
  if (c.maxPriceLevel !== undefined && (!Number.isInteger(c.maxPriceLevel) || c.maxPriceLevel < 1 || c.maxPriceLevel > 4)) bad("constraints.maxPriceLevel must be an integer from 1 to 4.");
  const constraints = {
    excludeHotels: c.excludeHotels ?? true,
    ...(c.maxPriceLevel !== undefined ? { maxPriceLevel: c.maxPriceLevel } : {}),
    excludeTags: strings(c.excludeTags ?? [], "constraints.excludeTags", 20, (s) => /^[a-z0-9_:]+$/.test(s)),
    excludeIds: strings(c.excludeIds ?? [], "constraints.excludeIds", 100),
  };
  if (!Array.isArray(body.feedback ?? []) || (body.feedback ?? []).length > 100) bad("feedback must be an array of at most 100 entries.");
  const feedback = new Map();
  for (const item of body.feedback ?? []) {
    object(item, "feedback entry", ["candidateId", "reason"]);
    const [candidateId] = strings([item.candidateId], "feedback.candidateId", 1);
    if (!FEEDBACK_REASONS.includes(item.reason)) bad(`feedback.reason must be one of: ${FEEDBACK_REASONS.join(", ")}.`);
    feedback.set(candidateId, { candidateId, reason: item.reason });
  }
  const limit = body.limit ?? 8;
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) bad("limit must be an integer from 1 to 8.");
  return { intent, location: { area }, taste: { artists, vibes }, constraints, feedback: [...feedback.values()], limit };
}

export const API_SCHEMA = {
  version: "1.0",
  endpoint: "POST /api/recommend",
  intents: INTENTS,
  areas: AREAS,
  example: { intent: "coffee", location: { area: "Osu" }, taste: { artists: ["Amaarae"], vibes: ["v-cafe"] }, constraints: { maxPriceLevel: 2 }, feedback: [], limit: 8 },
  constraints: {
    excludeHotels: "Boolean; default true. Never relaxed automatically.",
    maxPriceLevel: "Integer 1–4; excludes unknown prices. A provider price tier is not a current quote.",
    excludeTags: "Up to 20 exact Qloo tag IDs or final tag slugs; unknown tags are not evidence of absence.",
    excludeIds: "Up to 100 stable candidate IDs.",
  },
  taste: { artists: "Up to 16 names; only unambiguous, exact-name artist matches become signals.", vibes: "Up to 6 vibe card IDs from GET /api/deck; local tag boosts only." },
  feedback: { reasons: FEEDBACK_REASONS, scope: "Request/session only. Both reasons exclude that candidate. too_noisy also subtracts 0.25 from places tagged live_music, loud, noisy, nightclub, night_club or dance_club. This does not verify quietness. Remove entries to undo." },
  statuses: ["ok", "insufficient_matches"],
  errors: { 400: "Invalid or unsupported input", 429: "Rate limit", 503: "Provider or database unavailable; never represented as zero matches" },
  limitations: ["Accra areas only; location checks use provider address/locality text, not administrative boundaries.", "No live availability, booking, open-now guarantee, or verified current prices.", "Unknown request fields are rejected rather than silently ignored.", "No language model is called. Agents can consume evidence directly."],
};
