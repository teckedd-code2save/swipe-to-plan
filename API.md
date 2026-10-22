# Swipe2Plan API v1

The human UI and agents use the same HTTP JSON API. Recommendations are stateless: send the current taste, constraints and feedback on each request. No Claude/Anthropic key, chatbot conversation, or agent-specific SDK is needed.

## Discover

`POST /api/recommend`, `Content-Type: application/json`

```json
{
  "intent": "coffee",
  "location": { "area": "Osu" },
  "taste": { "artists": ["Amaarae"], "vibes": ["v-cafe"] },
  "constraints": { "excludeHotels": true, "maxPriceLevel": 2 },
  "feedback": [],
  "limit": 8
}
```

All fields are optional. Defaults: any outing, Accra, no taste, hotels excluded, no price cap, no feedback, eight results. Unsupported fields are rejected with 400; sending `openNow`, a monetary budget, arbitrary coordinates, an unknown city, or an unsupported intent does not silently weaken the request.

| Field | Accepted values |
| --- | --- |
| intent | `any`, `dinner`, `drinks`, `coffee` |
| location.area | `Accra`, `Osu`, `East Legon`, `Cantonments`, `Labone`, `Airport Residential` |
| taste.artists | Up to 16 artist names, each up to 160 characters |
| taste.vibes | Up to six vibe card IDs returned by `GET /api/deck` |
| constraints.excludeHotels | Boolean, default true |
| constraints.maxPriceLevel | Integer 1–4; unknown prices fail this constraint |
| constraints.excludeTags | Up to 20 exact Qloo tag IDs or final slugs such as `live_music` |
| constraints.excludeIds | Up to 100 stable candidate IDs |
| feedback | Up to 100 `{ "candidateId": "qloo:…", "reason": "not_relevant" }` entries; reason can also be `too_noisy` |
| limit | Integer 1–8 |

Legacy `area` and `liked` deck IDs are accepted. If both area forms are supplied, they must agree. Artist/vibe selections are deduplicated. Unknown deck IDs are rejected. Use the canonical `request` echoed in the response for subsequent agent calls.

A no-taste request is enough:

```sh
curl http://127.0.0.1:4000/api/recommend \
  -H 'Content-Type: application/json' \
  -d '{"intent":"coffee","location":{"area":"Osu"}}'
```

## Response contract

Every successful response has:

- `version`: `"1.0"`.
- `status`: `ok` or `insufficient_matches`. The latter is a successful search with fewer eligible results than `limit`, not evidence that no such venues exist.
- `request`: normalized request; all applied constraints remain visible.
- `items`: ordered candidates. `id` is namespaced as `qloo:<entity_id>` (or `demo:<fixture_id>`); it is stable across ranking changes and is the ID to send in feedback.
- `taste`: `mode` (`discovery`, `vibe_refinement`, `artist_affinity`), `resolved` entries with requested name, canonical name and entity ID, `unresolved` entries with a reason, and requested vibe IDs. Unresolved artists never influence the affinity query.
- `provenance`: provider, retrieval time, cache flag and cache age. Retrieval time does not verify the age of the source facts.
- `diagnostics`: fetched count, eligible count and mutually exclusive first-rejection counts. A candidate that fails multiple checks counts only under the first failure.
- `relaxationOptions`: labelled `changes` objects. An agent can propose them or issue a new request after an intentional choice; they have not already been applied.
- `warnings` and `feedbackPolicy`: truthful fallback information and the request-only effect of feedback.

Each candidate contains `id`, `entityId`, `name`, `address`, optional `image`, `links` (map, website, menu, phone), `tagNames`, `matchedVibes`, `score`, `scoreComponents`, `why`, structured `reasons` with evidence fields, `facts`, `provenance` and `uncertainty`.

`facts.price.status` is `provider_reported` or `unknown`; a reported tier is not a current price quote. `facts.hours.status` is `unverified`, and `facts.availability.status` is `unknown`. The client must not turn these into “open now”, “available”, or “verified price”. Location evidence is provider text matching, not verified boundary membership.

Model-independent `why` text is assembled from the returned evidence. An agent may summarize these facts but should preserve missing evidence and uncertainty. Scores are relative heuristics and should not be presented as match percentages.

## Feedback and corrections

To hide a result, send the same normalized request with:

```json
{
  "feedback": [
    { "candidateId": "qloo:the-returned-entity-id", "reason": "not_relevant" }
  ]
}
```

This snippet shows the changed field; retain intent/location/taste/constraints from the original request. Both feedback reasons exclude the named candidate. `too_noisy` also subtracts 0.25 from candidates tagged `live_music`, `loud`, `noisy`, `nightclub`, `night_club`, or `dance_club`. This is a transparent preference adjustment, not an assertion that another venue is quiet. No negative artist inference is made.

Undo by removing an entry; clear with `feedback: []`. Feedback is applied afresh even on cache hits and never written to a database. Solo browser state resets on reload. Other callers do not inherit it. Repeat entries for the same candidate use the last reason.

## Other routes

- `GET /api/health`: process health, provider mode, whether rooms are configured. This is not a live provider or database health check.
- `GET /api/schema`: machine-readable capabilities, defaults, limits, example and limitations. This is a capability document, not an OpenAPI/JSON Schema validator.
- `GET /api/deck`: artist/vibe cards for optional taste input.
- `POST /api/rooms`: intent and `location.area` (or legacy area); returns a room code, status 201. Only those fields are accepted because the existing room schema persists only intent and area.
- `GET /api/rooms/:code`: room intent, area and member IDs/names.
- `POST /api/rooms/:code/members`: `{name, liked}`; persists the member's deck selections, status 201. Up to eight members. Existing schema, no migration.
- `GET /api/rooms/:code/plan`: group shortlist using stored choices.
- `POST /api/rooms/:code/plan`: optional `{constraints, feedback, limit}` for this computation. Room intent and location cannot be changed here. Returns candidate evidence, per-member resolved/unresolved taste and provenance, plus a fairness summary. No automatic relaxation options are applied to rooms.
- `POST /api/baseline`: 410; the former LLM-only comparison is retired.

Group scores use each member's filtered candidate list, with a disclosed 0.05 score for missing candidates. They are not a guarantee that everyone likes each place. Rooms persist names/likes as before; feedback is request-only. Room code access is shared and unauthenticated, so use only in trusted local development until access controls are designed.

## Errors and operational behavior

Errors have `{ "code": "…", "error": "human-readable explanation" }`.

- 400: invalid input or unsupported fields; 404: missing room/route; 410: retired comparison.
- 413: body larger than 50 KB; 429: per-IP/path rate limit (wait one minute).
- 503: provider not configured/unavailable, malformed provider data, or unavailable database. A provider outage does not masquerade as an empty successful search.

Artist calls run in parallel with an eight-second timeout; candidate retrieval has its own eight-second timeout. No LLM is in the response path. Cached candidate retrieval lasts ten minutes and is bounded to 100 entries. Failed resolutions are not negatively cached and can be retried. The service makes no outbound call in synthetic demo mode.

Express defaults to a loopback listener. Rate limits are process-local and use the direct peer address. A public deployment needs an explicitly reviewed proxy/network configuration and shared rate limiting if scaled across processes.
