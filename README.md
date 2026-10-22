# Swipe2Plan

A swipe-led Accra discovery app for people, with the same structured API available to agents. Swipe artists and vibes, then get real Qloo places whenever you are ready. This is a standalone Serendepify experiment; it is not connected to RentAWeekend.

The compact orange-and-teal interface preserves the original Swipe2Plan design. Drag right to like, left to skip, or use the buttons / arrow keys. Undo with the curved arrow or Z. **See my picks now** works before all 20 cards, including with no likes. Intent and area stay compact; price and group planning are under More options. Result evidence is behind Why this pick.

## What works

- `POST /api/recommend` is the same structured interface used by the human UI. No agent SDK is needed. See [API.md](API.md) and `GET /api/schema`.
- Qloo supplies candidate places and affinity ordering. Only exact-name, unambiguous artist entities are used; unresolved artists are reported separately.
- Local code applies hard intent, location-evidence and price constraints, excludes closed venues and optionally hotels/resorts, and ranks with transparent vibe boosts.
- Deterministic reasons and provider evidence are returned immediately. **There are no Anthropic or other language-model calls**, even if an old model key remains in the environment. The previous model comparison endpoint returns `410`.
- Not relevant excludes that candidate. Too noisy excludes that candidate and lowers music/nightlife matches by a documented amount. Undo or clear feedback to restore the original ranking. No feedback is stored server-side.
- Existing Postgres group rooms combine individual rankings. No database schema changes were made.

## Run the real app locally

Node 20 or newer is required. Both packages have npm lockfiles. For a fresh checkout:

```sh
cd frontend
npm ci
npm run build
cd ../backend
npm ci
npm start
```

Before starting, supply `QLOO_API_KEY` in `backend/.env` or the server environment. See `backend/.env.example` for variable names. Existing local configuration is used in place; never commit environment files. `QLOO_API_URL` optionally sets the existing Qloo base. Solo discovery needs **no database or language model**. Startup loads the existing backend environment and does not run migrations.

Open **http://127.0.0.1:4000/**. Express serves the built frontend and API together. For UI development, run `cd frontend && npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` in another terminal, then open **http://127.0.0.1:5173/**. Vite proxies the same real API on port 4000. Changes hot-reload in development; rebuild and refresh the page for the production preview. Normal startup never substitutes sample venues.

Backend installation runs the declared Prisma client generation step and may download Prisma engines. Set `HOST=0.0.0.0` only when deliberately exposing a deployed service. Local startup defaults to loopback. There is no automatic deployment or infrastructure provisioning.

## Tests and optional developer demo

```sh
cd backend
npm test
```

Tests use Node's built-in runner, mocked providers and a mocked database; HTTP tests bind ephemeral loopback ports. Tests do not load environment files or call external services. The suite covers hard constraints, failed/partial artist resolution, no-model operation, group ranking, session feedback, API contracts, swipe thresholds and undo.

An explicitly separate developer demo is available with `cd backend && npm run demo`. Stop the normal backend first, or choose a different port. This demo does not load `.env`, call Qloo or access a database. Its synthetic venues are visibly labelled and are not the normal product experience.

## Group rooms

Only group rooms need `DATABASE_URL` for an existing Postgres database using `backend/prisma/schema.prisma`. The schema is unchanged. Starting the server never runs `prisma db push`. Initialize a new disposable database deliberately only after checking the target. The optional Docker Compose file requires your own `POSTGRES_PASSWORD` and binds its port to localhost; it is not started automatically.

Names and likes are persisted to the existing group room. Anyone with its link can see the members and plan. Solo tastes and result feedback stay in browser session memory and reset on refresh; there is no cross-user profile or tracking.

## Verification in this increment

- Frontend `npm ci` and production build passed with the declared dependencies.
- 41 automated tests passed with mocked providers and no credentials.
- The normal configured Qloo path was exercised locally using public artist names. Live source tag conflicts revealed by the smoke test received regression coverage.
- Desktop drag, button, keyboard and undo controls and a 390 × 844 mobile layout were checked in Chrome. Venue images and map links came from Qloo responses.
- Live group database operations, physical touch hardware and deployment were not tested. This bounded smoke test is not a broad relevance evaluation; source details can still be incomplete or inconsistent.

## Ranking and limits

1. Resolve optional artists in parallel. A failed, ambiguous or wrong-type lookup is disclosed and contributes no signal.
2. Fetch up to 50 Qloo candidates for the requested area. The cache stores provider candidates for ten minutes, not personal feedback. It is bounded to 100 request keys; positive artist resolution is bounded to 256 entries with a one-day lifetime.
3. Require stable source IDs, venue tags matching intent, and provider address/locality text supporting both Accra and the requested neighborhood. Contradictory structured city/country values are rejected. No filter is relaxed automatically.
4. A price cap excludes missing prices. Excluded tag constraints match exact tag IDs or final slugs. Missing tags cannot prove the absence of an attribute. Opening hours, current prices and availability are never labelled verified.
5. Score by original provider order (`1 - index / fetched_count`) plus `0.15` per matched vibe (maximum `0.45`), minus `0.25` for tagged music/nightlife when session noise feedback is active, floored at zero. Scores are ranking heuristics, not probabilities.
6. Return up to eight candidates, reasons, evidence, provenance, uncertainty, exclusion counts and explicit optional changes when there are too few matches. Nothing applies those changes until the caller requests it.

Location matching is conservative provider-text matching, **not a verified administrative boundary or radius search**. Sparse provider addresses/tags can produce no matches. Provider retrieval timestamps are not venue-data update timestamps. There is no bookings integration, geocoding, availability check, event calendar, or automatic retry against a second provider.

Group ranking uses `0.6 × minimum + 0.4 × mean`. A candidate missing from someone's list receives `0.05`; absence is unknown preference, not dislike. Duplicate names are tracked by member IDs. Group names and likes remain persisted in the existing database; shared room codes grant access. This prototype has no account authentication, room owner controls, or profile editing. Avoid treating it as a production shared-memory service.

The local smoke test confirms the integration works with the existing configuration, not that every artist, neighborhood or candidate is well covered. A next quality evaluation should measure useful shortlist rate across representative intents and areas.

## Stack

React 18 + Vite, Express, Node built-in test runner, and optional Prisma/Postgres for rooms. See [API.md](API.md) for request/response examples and uncertainty semantics.
