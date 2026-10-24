# Unstressed

[Live app](https://unstressed.serendepify.com) · [Devpost project](https://devpost.com/software/unstressed) · [MIT license](LICENSE)

**Good days. Less planning.** Unstressed turns the tastes of a person, a couple, a family or a group into a suggested day in a city or neighborhood with Qloo coverage: distinct places, a timed itinerary, spending envelopes, and an interactive map of the connections behind each choice.

The agent interprets a brief and calls a real planning tool. Qloo resolves artists, retrieves places through cultural affinities, and supplies per-entity contribution evidence. Deterministic code filters candidates, balances group rankings, selects distinct stops, fits the time window and allocates the budget. A language model cannot supply venues, prices or affinity evidence.

This is the `swipe-to-plan` Serendepify experiment. Swiping now feeds the main itinerary directly. Existing legacy room links remain supported under `#/room/:code`. It is not connected to RentAWeekend.

## Experience

- A conversation-first studio with inline taste cards, circle selection, people and sharing. The composer stays visible. The day stays beside the chat on desktop and opens as a focused panel on smaller screens. A persistent route overview jumps directly to any stop.
- Visible Tastes, People, Circles and Review plan controls stay above the composer. Choosing an area opens taste discovery without searching for venues. New outings remain drafts while you edit; Review plan shows the group, preferences, activities and allowance before the explicit Plan it action. Existing plans still respond to taste edits; choosing a new area pauses them for review.
- Editable party size, date, city or neighborhood, budget and currency, time window, pace and one to three ordered moments: coffee, discovery, a meal or drinks.
- Up to six individual taste profiles, each with editable food, activity, music and mood tastes, plus spending style and priorities. Profiles can represent some or all attendees; unprofiled attendees count toward the group budget but have no inferred tastes.
- A **taste map** connects people → their preferences → selected stops. Selecting a node highlights its paths and exposes source evidence. Solid paths mean a provider contribution or matched tag; dotted paths mean a search input with no individual contribution evidence. Unresolved artists do not acquire recommendation paths.
- Keep a place, swap another, undo the revision, adjust spending envelopes, or rebuild from edited details. No filters are silently relaxed to fill missing stops.
- Budget breakdown, directions link and a personal before-you-go checklist. Save up to eight days on this device, copy a complete itinerary, print it, or download whole-group and personal HTML daybooks and calendar files.
- Optional freeform planning through a configurable OpenAI-compatible model. Gemini 3.5 Flash-Lite is the default; Anthropic variables are neither required nor read.

## Run locally

Node 20+ is required. Both packages include lockfiles.

```sh
cd frontend
npm ci
npm run build
cd ../backend
npm ci
npm start
```

Set `QLOO_API_KEY` in `backend/.env` or the server environment before starting. See [backend/.env.example](backend/.env.example). Open **http://127.0.0.1:4000/**. Express serves the built frontend and API together. Normal startup never substitutes synthetic places.

For UI development, start the backend, then in another terminal:

```sh
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open **http://127.0.0.1:5173/**. Rebuild the frontend to update the production preview on port 4000.

### Google sign-in and persistence

Create a Google OAuth **Web application** client and set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and `APP_ORIGIN` in the backend environment. Register the exact redirect `${APP_ORIGIN}/api/auth/google/callback`; local development uses `http://127.0.0.1:5173/api/auth/google/callback`. A port-4000 preview needs its own registered redirect and matching origin. Production requires HTTPS. The deployed Google application is in production mode, with both the public callback and the local development callback registered.

Sign-in uses only `openid email profile`, a browser-bound one-time state, PKCE and nonce, and an HttpOnly session cookie. Identity is the verified Google subject, not a matching email. Google access tokens are not stored. Signing in preserves the in-progress guest day. Account tastes, circles and the optional usual planning area persist in `backend/data/accounts.json` (`ACCOUNT_DATA_FILE` override); deploy one API process with durable storage. Local accounts do not migrate guest circles automatically.

Music cards span Afrobeats, R&B, pop, Latin music, K-pop, jazz, rock, electronic and classical music. The Music view also accepts any artist name; the deck is not an allowlist. Qloo must resolve a name before it becomes an affinity signal. Food and activities are explicit, editable tastes, not guesses from music. Food cards cover cuisines and dining styles; activity cards cover art, nature, history, beaches, markets and books. Preference-to-place connections require matching provider tags. Plant-forward preferences do not certify allergen safety or dietary suitability.

### Connect the conversational agent

For the default model, add `GEMINI_API_KEY` to the backend environment. Restart the backend and reload the page. For another OpenAI-compatible provider, configure `LLM_API_KEY`, `LLM_BASE_URL` and `LLM_MODEL`. The base URL must include the provider API prefix and is extended with `chat/completions`. Never put keys in frontend variables or commit `.env`.

The model selects a planning, participant, circle or interface tool, asks a clarification, or answers from the current evidence. Tool arguments are validated before Qloo is called. Budget/time allocation and evidence generation stay outside the model. Up to eight recent conversation turns, the current brief, saved circles and a bounded summary of participant-to-preference evidence accompany a refinement, while exclusions and kept stops remain durable. The UI's guided planner and external tool endpoint work without a model key; freeform chat explicitly reports when it is not connected.

Official references: [Qloo explainability](https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md), [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing). Provider availability and pricing may change; the model is configurable.

## Agent and API surfaces

- `GET /api/agent/tools`: schemas for day planning, revisions, participant/circle actions, interactive cards and replies; HTTP transport for `plan_day`.
- `POST /api/itineraries`: full structured day-planning tool; no model required.
- `POST /api/agent`: optional conversational interpretation, then the same planning tool.
- `POST /api/recommend`: legacy single-activity discovery; model independent.
- `POST /api/outings`: compact one-to-three-stop planning for the legacy discovery view.
- `GET /api/schema`: capabilities and supported inputs.

See [API.md](API.md) for contracts, errors, evidence and limits.

## How the day is assembled

1. Resolve each person's explicitly supplied artist names. Only unambiguous exact-name artists become Qloo entity signals; unresolved artists are disclosed.
2. Resolve food/activity preferences to Qloo tag IDs, then retrieve up to 50 candidates per distinct artist/tag/area query with `feature.explainability=true`. Days with a discovery stop also retrieve a targeted activity pool. Tags come from Qloo, never model-generated IDs. Candidates are cached for ten minutes, bounded to 100 queries; resolved artists are cached for a day, bounded to 256 entries.
3. Require stable IDs, provider category evidence for the activity, and a Qloo locality filter with radius zero. The response records the matched locality; when metadata is absent, conservative address/locality text checks are used. Exclude known-closed places, hotels/resorts, administrative venues, explicit skipped IDs and explicit nightlife categories for groups with children. Optional provider price-tier caps reject unknown prices.
4. Rank by provider order (`1 - index / fetched_count`), plus `0.15` per matching explicit vibe, capped at `0.45`. Group rankings use `0.6 × minimum + 0.4 × mean`; a missing candidate gets `0.05`, meaning unknown rather than dislike. When some participants have supplied tastes, empty profiles have no venue-ranking vote; they still count toward the party and budget. If everyone is new, use general discovery. No score is a match probability.
5. Search bounded combinations of up to eight candidates per unpinned activity. First maximize filled distinct stops, then total rank score; eligible pins are preserved. Missing slots remain open rather than using a place twice or widening requirements.
6. Fit suggested durations and fixed 20/30-minute travel buffers inside the same-day time window. Divide the **user's budget** into weighted activity allowances, 15% transport and a reserve averaged from each person’s spending style (20% mindful, 10% balanced, 5% treat), with exact rounding. An explicit spending priority increases that person’s preferred activity weight by 1.75; normalized individual votes are averaged equally. These calculations do not estimate venue prices or real travel times.
7. For each selected stop, join evidence from each person's own returned candidate. An artist's Qloo contribution, a matching venue tag and an unsupported individual attribution remain three different things in the graph.

## What is and is not verified

Planning areas use live Qloo locality search for cities, towns and neighborhoods worldwide. Choose a specific result through chat or the composer’s location control; ambiguous names are shown as separate choices. The server resolves the selected entity ID and filters to its boundary with `filter.location.radius=0`. Coverage depends on Qloo. A confirmed area suggests its local currency from provider country metadata and IANA geography; an unknown currency requires a choice. The numeric budget is not converted: review it in plan details before searching. An explicit custom currency remains available. Choose **Just this plan** or **Always use this**; saved areas are offered for confirmation on future plans, not treated as the user’s current physical location. Account defaults are private and durable; guest defaults stay on the device. Calendar exports convert destination wall time using the resolved locality’s coordinates and `geo-tz`; missing zones and ambiguous/nonexistent daylight-saving times stop calendar export with an explanation. Provider retrieval time does not establish when venue facts were updated. Affinities express cultural associations, not guarantees that a person will enjoy a venue.

Suggested times do not verify opening hours. Travel buffers are not route calculations. Spending envelopes are not prices or an affordability guarantee. Child suitability, dietary needs and accessibility must be confirmed with venues. There is no reservations, payments, weather or live event integration. Family plans exclude explicit nightlife categories but do not certify every venue as suitable for children. Incomplete provider coverage can produce partial plans.

## Data and optional rooms

The group planner uses a file store for shared days and needs no separate database service. Names, party details and the brief go to the optional configured model when chat is used. Artist names go to Qloo for resolution; resolved artist IDs, food/activity tag IDs and the chosen area drive Qloo discovery. Local itineraries and conversation live in browser memory. Sharing creates a server-side day with seven-day expiry; explicit **Save day** stores the plan and its taste evidence in this browser's local storage. Saved days are separated by account ID in browser storage; they are not synchronized across devices or encrypted from other people using the same browser profile. Deleting a saved day removes that local entry.

Legacy group rooms require `DATABASE_URL` and the unchanged `backend/prisma/schema.prisma`. They persist member names and likes. Room links grant unauthenticated access; there are no account or room-owner controls. Startup never runs migrations or `prisma db push`. The optional Docker Compose file is not started automatically.

## Validation

```sh
cd backend
npm test
```

105 automated tests cover searched and selected global localities, local/custom currencies, private saved planning areas, combined single-stop location requests, daylight-saving calendar conversion, one-place outings, Google session isolation, circle membership, food/activity evidence and spending preferences, alongside existing tests covering discovery and swipe behavior plus itinerary assignment, per-person evidence isolation, scheduling, budget arithmetic, preserved stops, swaps, partial plans, family constraints, malformed input, model tool validation, clarification history, missing keys and sanitized upstream errors. Tests use mocked providers and ephemeral local HTTP servers, never credentials or real external services.

The October 23, 2026 local check also exercised real Qloo two-person and family itineraries. Desktop interaction checks covered node selection, keep/swap/undo, saving and budget views. A 390px iframe viewport checked the mobile home, navigation and saved itinerary layout. This is a layout check, not a physical-device test. The circles increment additionally exercised real-Qloo swipes into the main itinerary, inline participant addition, circle save/reuse, a personal HTML download, a calendar download, and separate personal/group links whose taste edits and joining participant reached the organizer. A 390px viewport also exercised circle reuse. The chat redesign additionally checked circle selection with real Qloo results, an immediate swipe-and-done without losing the preference, persistent result navigation, direct stop jumps and Escape-to-chat at 1280×720 and a 390×700 iframe viewport. No page scrolling was needed to reach the composer or the result panel. The production frontend build passes. The October 24 increment additionally verified a live Gemini conversation, real Google sign-in with preserved planning context, and a real Qloo itinerary using food/activity signals. Global planning checks returned real venues in London, Paris, New York and Tokyo, including a chat-driven London-to-Paris move that retained the group and changed the budget to EUR 100. Desktop and 390×700 viewport checks covered readable preference chips, the inline location picker, the fixed composer and direct result access. Automated account tests substitute only Google’s network response. The October 24 production launch additionally verified HTTPS, live Qloo location search and group itineraries, Google sign-in and session persistence across a container release, conversational participant addition, taste changes, and a revision to one dinner stop. Production uses Gemini 3.5 Flash-Lite after Gemini 3.1 Flash-Lite returned timeouts and HTTP 503 during launch checks. A second live Google account has not been tested.

For a clearly labelled synthetic developer experience, run `cd backend && npm run demo` on a separate port or after stopping the normal server. It does not load `.env` or call Qloo/model/database services. Its synthetic places must never be presented as real recommendations.

## Submission readiness

The [live demo](https://unstressed.serendepify.com) and [public repository](https://github.com/teckedd-code2save/swipe-to-plan) are linked from the Devpost draft. The repository includes an [MIT license](LICENSE). Devpost remains at 4/5 steps; the final rules acceptance and submission have not been performed. Production packaging, isolated durable storage, health-checked releases and rollback are documented in [DEPLOYMENT.md](docs/DEPLOYMENT.md). GitHub Actions builds an immutable container on updates to `main`. Current rate limits and caches are per-process. Evaluate relevance across representative group tastes and areas before final submission.

## Stack and artwork

React 18 + Vite, Express, Node's built-in test runner, optional Prisma/Postgres for legacy rooms. Google authentication uses google-auth-library; destination time zones use geo-tz. No new frontend or agent-framework dependencies were added. Georgia and system sans-serif fonts require no external font service. The courtyard illustration is original generated artwork, not a venue photograph; [asset notes and prompt](frontend/public/images/README.md).

### Circles, a shared day, and the planning conversation

The studio is a normal chat with interactive cards inserted as needed; the + menu also works without a model key. Add someone inline, bring a saved circle, swipe a person's tastes, lower the spending envelope or slow the pace. Every change feeds the same itinerary; no separate recommendations screen is created. Automatic replanning preserves kept stops, coalesces rapid swipes, and rejects late results. Group insights distinguish shared evidence from people whose preferences have no individual evidence yet.

**Circles** are reusable groups. Guests keep circles on this device; signed-in users keep circles and their own tastes on the server. Invitees can sign in and join as an existing placeholder or a new member. Joined members manage their own account tastes; organizers can edit profiles that have not joined yet. Changes to an active account circle refresh a local day. Shared days retain their separate participant permissions and polling. Existing members keep current day preferences when a circle is first merged. Up to six profiles fit one day; there is no external contact search.

**Share & download** provides printable offline HTML daybooks, personal daybooks with that person's taste connections, and tentative `.ics` calendar events. A group invitation lets a new participant join. A personal link lets an existing participant edit only their own name/tastes. The organizer controls roster and trip details. Shared tastes and the plan are visible to link holders; links expire after seven days. Downloads are snapshots and never bookings. The UI polls for group changes every three seconds while visible.

Shared days use the API's serialized atomic JSON store, default `backend/data/days.json` (`DAY_DATA_FILE` override). It holds at most 200 unexpired days, expires records after seven days, and writes with owner-only file permissions. Deploy **one API process** with a persistent volume; use a transactional database before multiple replicas. Localhost links only work on the same computer: deploy the app behind its public HTTPS origin before sending real invitations. No email/SMS is sent by this feature.

The guided workflow needs Qloo but no LLM key. Optional freeform chat exposes validated `add_person`, `update_person`, `remove_person`, `bring_circle`, `revise_day`, `show_ui` and `reply` tools alongside `plan_day` and `ask_question`. Each turn executes one tool. Short day revisions preserve everyone’s profiles and retained pins automatically. Reply context labels search inputs separately from provider contributions and tag matches. It uses the configured OpenAI-compatible model, with no Anthropic requirement. Person tools preserve stable IDs and trip updates cannot silently overwrite individual tastes. Without a configured model, freeform chat is explicitly unavailable while guided actions remain functional.

### Before you go

Completed Qloo plans now retrieve detailed venue information and automatically compare each planned stop with Qloo-reported weekly hours. Timing conflicts appear in the day view. Click a venue photo or name for its description, menu highlights, price band, contact links, weekly schedule and the participants’ taste connections. The Before you go tab assembles these checks and a route link with walking, transit or driving options.

Each venue has an editable enquiry containing the date, time and party size. Users can copy it or call the venue; Unstressed does not contact or book venues. Weekly schedules may be outdated or differ on special dates. Exact menu prices, kitchen hours, reservations, dietary/accessibility suitability and traffic still need confirmation. Google Search grounding was evaluated but is not enabled: the current key returned a quota error. The shipped checks use live Qloo data and deterministic time comparisons, without model-invented facts.
