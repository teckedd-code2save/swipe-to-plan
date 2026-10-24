# Unstressed API v1

The human UI and agents use the same HTTP JSON API. Recommendations are stateless: send the current taste, constraints and feedback on each request. Structured planning requires no language model or agent-specific SDK. Only the optional conversational `/api/agent` route calls a model.

## Plan a complete day

`POST /api/itineraries` executes the `plan_day` tool without a language model.

```json
{
  "title": "An easy Saturday, together",
  "area": "Accra",
  "date": "2026-10-24",
  "party": { "adults": 2, "children": 0 },
  "people": [
    { "name": "Ama", "artists": ["Amaarae"], "vibes": ["v-cafe"] },
    { "name": "Kojo", "artists": ["Kojo Antwi"], "vibes": ["v-african"] }
  ],
  "budget": 800,
  "startTime": "11:00",
  "endTime": "18:00",
  "pace": "easy",
  "activities": ["coffee", "dinner"],
  "pins": {},
  "excludeIds": []
}
```

All fields have defaults. `budget` is a whole-group spending allowance (integer 1–10000000), with optional ISO 4217 `currency` (default `GHS`). Currency changes never perform exchange conversion. Optional `locationId` is a Qloo locality UUID from `/api/locations`; the server resolves its canonical label, boundary and currency. `currencyMode` is `local` or `custom`. With a selected locality, `local` chooses its currency and `custom` preserves the explicit code; an unknown local currency requires a custom choice. The amount is unchanged. `area` accepts a city or neighborhood anywhere, 2–160 characters; add country/region for clarity. Adults: 1–8; children: 0–6. One to six taste profiles are supported, no more than the attendee count. Each profile accepts a name, up to six artist names and eighteen supported food/activity/mood IDs in `vibes`. Profiles need not cover every attendee; unprofiled attendees count toward the party size but have no inferred tastes. Empty profiles do not vote in venue rankings when another participant has supplied tastes; everyone still participates in the budget calculation.

Choose one to three unique, ordered activities: `coffee`, `activity`, `dinner`, `drinks`. `dinner` identifies dining venues and may be scheduled at lunchtime. `activity` requires provider museum/gallery/park/garden/zoo/aquarium/cultural-center/landmark/tourist-attraction category evidence. Children cannot be combined with `drinks`. Explicit nightlife tags are excluded for children, but missing tags do not certify child suitability.

Times use HH:MM and must describe the same day. `pace` is `easy` (30-minute travel buffers) or `balanced` (20 minutes). Impossible windows fail before any provider call. Profiles may include `spending: {style: "mindful"|"balanced"|"treat", priority: "even"|"coffee"|"activity"|"dinner"|"drinks"}`. Reserve averages individual style votes (20%, 10%, 5%); omitted spending defaults to balanced/even. Transport receives 15%. Remaining allocation weights coffee/activity/dining/drinks 1/2/3/2, with each person’s priority multiplied by 1.75, normalized and averaged equally. The response includes `budget.influences`; preferences never change the group total. Rounding sums exactly to the supplied budget. These figures are not venue quotes, verified travel times or opening-hour checks.

Successful responses contain:

- `request`: normalized brief; send it back when refining.
- `status`: `complete` or `partial`.
- `stops`: suggested start/end/duration/buffer, activity, selected `item` or null, alternatives, unfilled reason and evidence connections.
- `budget`: total, transport, reserve, activity allocations and `basis: "spending_allowances"`; `quotedTotal` is always null.
- `timeZone`: destination IANA time zone from Qloo locality coordinates, or null if unavailable; calendar export requires a zone.
- `provenance.locality`: optional `{query,id,name,label,method,radius,timeZone}`.
- `people`: individually resolved and unresolved artist signals.
- `tasteMap`: nodes and edges, described below.
- `checks`: algorithmic distinctness/time/budget checks; hours/travel/child suitability remain unverified.
- `activity`: factual records of completed work, not simulated live progress.
- `links.directions`: a Google Maps route link for real plans with at least one filled stop (a single destination uses Maps’ current-location origin); null for synthetic demo data.
- `provenance` and `warnings`: provider, retrieval time, missing coverage and limitations.

### Evidence graph

Nodes have kinds `person`, `artist`, `vibe` or `stop`. Preferences belong to a `personId`; stops reference actual selected entity/candidate IDs.

| Edge kind | Meaning | UI |
| --- | --- | --- |
| `preference` | A person supplied this preference | Person-to-taste path |
| `affinity` | This person's candidate has Qloo `query.explainability["signal.interests.entities"]` evidence for this exact artist | Solid; source value inspectable |
| `tag_match` | An explicit vibe matches provider venue tags | Solid; tag IDs inspectable |
| `search_signal` | This resolved artist was included in the query, but Qloo supplied no individual contribution for the place | Dotted; no claimed individual affinity |

Relative contributions are not ratings, probabilities or predicted satisfaction. Unresolved artists have no recommendation edges. A group stop cannot inherit one member's contribution evidence for another member. A candidate absent from a person's filtered pool has no preference-to-stop edges for that person.

### Keep, swap and revise

`pins` maps activities to stable candidate IDs. Kept places must still meet every constraint. To swap coffee while preserving the meal, copy the normalized request, set `pins.dinner` to the dining candidate ID, and add the current coffee ID to `excludeIds`. A new distinct place is selected or that slot remains unfilled. Undo by restoring the previous request/response locally. Optional `maxPriceLevel` applies the strict provider-tier filter from discovery.

## Planning areas

- `GET /api/locations?q=...`: search 2–160 characters; up to eight real Qloo locality options, 60 requests/minute. Each has `{id,name,label,country,countryCode,currency,timeZone,kind,source}`; unknown currency/zone values are null.
- `GET /api/locations/:id`: resolve a locality UUID server-side. Search results cache for one hour (100 queries); resolved localities for one day (512 entries).
- `PATCH /api/account/planning-location`: authenticated, same-origin `{locationId}` to remember a canonical locality, or `{locationId:null}` to forget it. Returned user data includes private `planningLocation`; other circle members cannot read it. Guests remember their preference only in local browser storage.

The UI confirms area independently of budget, tastes and discovery. Selecting an area does not search for venues. It opens taste cards or a review card; the user can edit activities, timing and allowance before Plan it. A new area defaults to its local currency unless a custom currency was requested. No exchange conversion occurs.

## Conversational agent

`GET /api/agent/tools` exposes OpenAI-compatible function schemas for planning, revisions, people, circles, interface cards and replies, plus the `plan_day` HTTP mapping. External agents can invoke the tool without the built-in model adapter.

`POST /api/agent` accepts `{ "message": "…", "context": { ...currentItineraryRequest }, "history": [{ "role": "user", "text": "…" }] }`. Message length: 1–1600 characters. Context and history are optional. Optional `locationContext: {confirmed,preferredLabel?}` tells the agent whether the area was confirmed. Unconfirmed or changed areas return `{status:"action",action:"set_location",request,query,scope}` for the UI confirmation step, without venue discovery. The request preserves all proposed changes, including single-stop activities, dates, party and budget. `scope:"default"` is reserved for an explicit remember/always-use request. Optional `circles` contains up to twelve `{id,name,people}` records (names ≤40 characters, stable member IDs, one to six profiles each). Optional `planContext` contains up to three `{id,intent,name,connections}` stops and up to thirty short warnings. Each connection supplies an existing `personId`, `kind` (`affinity`, `tag_match`, `search_signal`), `label` and optional `preference`. This is validated, untrusted client context, not independent provider verification. History supports up to eight turns with role `user` or `assistant` and text up to 1600 characters each. System-role history is rejected.

The model must return exactly one recognized tool call. `plan_day` arguments pass the strict itinerary validator before Qloo retrieval and deterministic assembly. `ask_question` returns `{ "status": "needs_input", "question": "…" }` without searching. A successful plan includes `agent: { model, action: "plan_day" }`. `revise_day` overlays only the supplied trip fields, preserving all people and durable exclusions/pins. `show_ui` returns `{status:"show_ui",panel,personId?}` for `tastes`, `circles`, `people`, `share`, `location`, `budget` or `itinerary`. `reply` returns `{status:"reply",text}`. Neither response searches for places. The model cannot return a venue list. Exclusions persist across refinements; kept stops persist for retained activities. Release pins in the UI or change them explicitly through the structured tool.

Configuration: `GEMINI_API_KEY` for the default `gemini-3.1-flash-lite`, or `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL` for another compatible endpoint. Keys stay server-side. Anthropic-specific variables are not used. Missing credentials return `503 agent_not_configured`; malformed model output/provider failures return sanitized `503 agent_unavailable`. Unsupported tool arguments return 400.

## Compact legacy outing tool

`POST /api/outings` accepts discovery preferences (`location`, `taste`, `liked`, `constraints`, `feedback`) plus one to three distinct `stops`: `{ "intent": "coffee|dinner|drinks", "pinnedId": "optional candidate ID" }`. It reuses one Qloo retrieval and returns distinct assignments with `complete`/`partial` status, evidence and unfilled reasons. Use `/api/itineraries` for budgets, schedules and the per-person graph.

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

All fields are optional. Defaults: any outing, Accra, no taste, hotels excluded, no price cap, no feedback, eight results. Unsupported fields are rejected with 400; sending `openNow`, a monetary budget, arbitrary coordinates, an invalid location string, or an unsupported intent does not silently weaken the request.

| Field | Accepted values |
| --- | --- |
| intent | `any`, `dinner`, `drinks`, `coffee` |
| location.id | Optional Qloo locality UUID from `/api/locations`; resolved server-side |
| location.area | City or neighborhood query, 2–160 characters, such as `London, United Kingdom` or `Shibuya, Tokyo, Japan` |
| taste.artists | Up to 16 artist names, each up to 160 characters |
| taste.vibes | Up to eighteen food/activity/mood card IDs returned by `GET /api/deck` |
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

`facts.price.status` is `provider_reported` or `unknown`; a reported tier is not a current price quote. `facts.hours.status` is `unverified`, and `facts.availability.status` is `unknown`. The client must not turn these into “open now”, “available”, or “verified price”. Live locality evidence records Qloo’s matched locality and radius-zero filter, not an independent boundary calculation. Conservative provider-text checks are used when locality metadata is absent. Requests never silently widen to Accra. `location_not_found` and `location_ambiguous` are 400 errors requiring a more specific location.

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

- `GET /api/health`: process health, provider mode, whether rooms and the agent are configured. This is not a live provider, model or database health check.
- `GET /api/schema`: machine-readable capabilities, defaults, limits, example and limitations. This is a capability document, not an OpenAPI/JSON Schema validator.
- `GET /api/deck`: cards with public `group` values `music`, `food`, `activity`, `mood`. Food/activity IDs remain in `vibes` for compatibility.
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

Artist calls run in parallel with an eight-second timeout; candidate retrieval has its own fifteen-second timeout. No LLM is in the discovery or typed itinerary path. The optional conversational endpoint gives the model a 60-second timeout before running the planning tool. Cached candidates last ten minutes, bounded to 100 queries. Failed resolutions are not negatively cached and can be retried. Synthetic demo mode makes no outbound service calls.

Express defaults to a loopback listener. Rate limits are process-local and use the direct peer address. A public deployment needs an explicitly reviewed proxy/network configuration and shared rate limiting if scaled across processes.

## Shared days and circles

`POST /api/days` accepts `{ "request": <itinerary brief> }` and returns a shared-day snapshot plus an organizer `token`. All subsequent routes require `Authorization: Bearer <token>`. Tokens are capability links: organizers can read participant tokens, participants cannot. The UI places keys in the URL fragment and sends them in the authorization header, never a server query string. Share these links only with intended participants.

| Route | Body | Access |
| --- | --- | --- |
| `GET /api/days/:id` | — | Organizer, member, invite |
| `POST /api/days/:id/members` | `{id?, name, artists?, vibes?, spending?}` | Organizer |
| `POST /api/days/:id/circle` | `{name, people: [{id?, name, artists?, vibes?, spending?}]}` | Organizer |
| `POST /api/days/:id/join` | `{name, artists?, vibes?, spending?}` | Invite only; returns own token |
| `PATCH /api/days/:id/members/:memberId` | `{name, artists?, vibes?, spending?}` | Organizer or that member |
| `DELETE /api/days/:id/members/:memberId` | — | Organizer; cannot remove organizer |
| `PATCH /api/days/:id` | `{request, revision}` | Organizer; stale revision is 409 |
| `POST /api/days/:id/retry` | `{}` | Organizer or member |

Snapshots include `revision`, `planRevision`, `status` (`updating`, `ready`, `error`), `request`, redacted `members`, `plan`, `planError`, recent `events`, `access` and `expiresAt`. Mutations return immediately and rebuild asynchronously. Read again to obtain the latest plan. Stale computation never replaces a newer revision. On provider failure the old complete plan remains with an explicit error; retry resumes the latest brief. Brief updates never overwrite members. Circle merges preserve existing members' current tastes, deduplicate IDs, and add the remaining profiles atomically. All roster changes validate the six-profile bound before saving.

Shared data survives server restarts through `DAY_DATA_FILE`; this store supports a single API process and needs persistent deployment storage. Guest circles are device-local; signed-in circles use the account store described below. The selected members reach the server when applying a circle; optional freeform chat also sends the saved-circle context to the configured model so it can identify a requested circle.

`POST /api/agent` may also return `{status:"action", action:"add_person"|"update_person", person}` or `{status:"action", action:"remove_person", personId}`. `bring_circle` returns `{status:"action",action:"bring_circle",circleId}` for a supplied saved-circle ID, after checking the merged roster bound. These are validated proposals, executed by the client against its local day or the authenticated shared-day routes. Shared-day routes remain the authority for permissions; a model cannot grant access. `plan_day` preserves the group, kept stops and exclusions.


## Google accounts and persistent circles

All account mutations require a session cookie, exact `APP_ORIGIN` and JSON content type (sign-in start is unauthenticated). Google OAuth exchanges and verifies tokens on the server with PKCE, nonce and browser-bound state. Sessions expire after 30 days; sign-in state after ten minutes. The account store uses `ACCOUNT_DATA_FILE` (default `backend/data/accounts.json`) with serialized atomic writes and private file permissions; one API process only.

| Route | Body / purpose |
| --- | --- |
| `GET /api/account` | `{configured,user,circles}`; guest user is null |
| `POST /api/auth/google/start` | `{returnTo?: "/"}`; also allows existing day/circle fragment links; returns Google URL |
| `GET /api/auth/google/callback` | Consumes state once, verifies Google identity, sets HttpOnly session and redirects |
| `POST /api/auth/logout` | Invalidates current session |
| `PATCH /api/account/profile` | `{name,artists,vibes,spending?}`; own account only |
| `POST /api/account/circles` | `{name,people}`; includes creator; at most six profiles |
| `GET /api/circle-invites/:id` | `X-Circle-Invite` token; returns names and claimable placeholders only |
| `POST /api/account/circles/:id/join` | `{inviteToken,replaceId?}`; explicit placeholder claim or new member |
| `PATCH /api/account/circles/:id/members/:memberId` | `{name,artists,vibes,spending?}`; organizer edits unjoined profiles only |
| `DELETE /api/account/circles/:id` | Organizer deletes the circle; a member leaves it |

A circle returns `{id,name,owner,people,accountIds,inviteToken?}`. Only its organizer receives the reusable invite token. Joining never copies another person’s tastes into the account. Registered members’ profiles are resolved fresh on every read. There is no email/name-based automatic account merge. Invalid sessions return 401; unauthorized mutations return 403; raced placeholder claims return 409. Saved itinerary snapshots remain browser-local and separated by account ID.
