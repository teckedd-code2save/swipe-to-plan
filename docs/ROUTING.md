# Optional route estimates

This adapter is implemented but **disabled by default**. Local tests use synthetic responses only. No live Mapbox request, token setup or account/billing validation is part of this implementation.

## Provider and display boundary

The app uses Leaflet/OpenStreetMap. Only the explicit `mapbox` provider is eligible for that display. Google Routes remains a separately tested adapter, permitted by the facade only for a future `google_map` display. The current runtime hard-codes `osm` and does not pass a Google credential. A generic `GOOGLE_MAPS_API_KEY` can no longer activate route content alongside OSM. Do not loosen this gate without verifying the applicable Google agreement and a compliant display.

The facade returns provider-independent capability flags, travel measurements, selected-occurrence identities, request ID/revision, measurement time, traffic semantics and fixed error codes. No raw provider text reaches the browser. Request credentials and complete provider URLs must never be logged by this app or outbound tracing infrastructure.

## User behavior

- Estimates require an explicit button press. No render, mode switch, default choice or map-load action requests Directions automatically.
- Drive requests `mapbox/driving-traffic`; Walk requests `mapbox/walking`. Driving uses live/typical data where available, not guaranteed current traffic on every road. Walking has no traffic claim. Transit and Compare retain Maps links.
- Only leaving-now estimates are implemented. The adapter rejects scheduled departure timestamps instead of pretending they were honored. Travel excludes visits/buffers and does not validate the outing schedule.
- Directions receives exactly the validated origin/destination coordinates, not names, addresses, venue IDs or account identities. There are no Mapbox geocoding calls. Address-only starts and unpinned venues retain clear area/current-location/Maps alternatives.
- Selecting an incomplete planning/saved/search area resolves that already-selected catalog ID through the existing location endpoint. Verified catalog centers are approximate. Nothing selects or saves an origin automatically. Late catalog/GPS results cannot cross choice, mode, stop, account, day or dismissal boundaries. GPS precision is not saved.
- The selected leg's actual provider GeoJSON is accepted only as a bounded LineString (2–5,000 numeric coordinate pairs, geographic bounds, endpoints within the requested 1,000 m snapping radius plus rounding tolerance). Malformed geometry rejects the result. No straight connecting lines or coordinates are invented.
- Mapbox's official attribution wordmark is shown next to route evidence and the map. Existing OSM attribution/privacy disclosure remains. Visible tiles load automatically when the map view opens. This does not request GPS or a provider route estimate.
- All route data is ephemeral, tied to the request and the exact selected visit occurrence. Changes invalidate both text and line. Co-located repeat visits remain separate choices.

## Transport and aggregate request limit

Each explicit estimate attempts at most one Directions HTTP call. There is no billable retry, redirect follow, alternative-profile fallback or automatic recovery. Headers and body share a 12-second deadline. Native response streams are limited to 1 MiB. 429, timeout, network, malformed-body and no-route errors become fixed redacted messages; provider error text is discarded.

The existing per-IP limiter remains. It is not an aggregate limit. The additional UTC-day request ledger reuses the account store's serialized, fsynced intent/snapshot commit protocol in a **separate file**. The app durably claims one slot before outbound I/O. Errors, unknown outcomes, process exits and cancellations never refund slots. Concurrent calls cannot exceed the configured limit in the supported single-process deployment.

The ledger stores a schema version, UTC date and request count, plus the store's four empty collection objects. It stores no tokens, locations, route geometry, user IDs or request bodies. Journal files contain only hashes and file metadata. Missing/malformed data, a future period, an outstanding journal or a failed/uncertain write blocks requests. A process with a storage failure remains blocked until an operator investigates and restarts it. No HTTP endpoint resets or reconciles the ledger.

This is **this app's request limit**, not an exact billing-account dollar ceiling. Other tokens/apps, pricing changes, retries elsewhere and account usage may incur other costs. Never delete/reset the ledger, point it at another file, restore an older count or enable multiple writers to recover quota. A stale restored ledger can undercount already issued requests. Keep routing disabled after restore/rollback until counts are reconciled conservatively. Use the existing protected durable volume and include this file/journal in backups. No replica support is added.

## Required approved setup before activation

1. Verify the intended Mapbox account, its actual current Directions terms/pricing, usage and billing status. No unused free allowance is assumed. Approve a positive per-UTC-day request limit and the possible account billing exposure. Confirm account-side monitoring/alerts and a disable/response plan.
2. Provision an approved dedicated least-privilege token for server-held Directions use. `MAPBOX_DIRECTIONS_TOKEN` is separate from Google OAuth and frontend variables. This does not require a secret-scope `sk` token or account-management scopes. Validate the actual token's allowed use. Mapbox URL restrictions depend on Referer and do **not** support IP addresses. URL-restricted tokens may reject server-side requests without Referer; this adapter does not fabricate one. Do not assume Google-style restrictions or silently broaden a token's permissions.
3. Choose a new absolute `ROUTE_REQUEST_BUDGET_FILE` on the existing durable mount, distinct from every other store, and set `ROUTE_REQUESTS_PER_UTC_DAY` to the approved positive integer. While routing is disabled and the single writer is stopped, explicitly initialize a genuinely new ledger via the exported `initializeRouteBudget({file})` operator function. It acquires an exclusive setup journal and publishes the synced snapshot with an atomic no-replace hard link. Concurrent setup cannot overwrite a ledger that appeared meanwhile. It refuses an existing ledger/journal, including damaged files and symlinks. The runtime filesystem must support same-directory hard links and directory fsync. Never use initialization as repair or quota reset. Verify durable permissions and the existing account filesystem preflight/commit protocol on the runtime filesystem.
4. Only after setup approval, set `ROUTE_ESTIMATE_PROVIDER=mapbox` and `ROUTE_ESTIMATES_ENABLED=1`. The configuration example keeps both off and leaves the token/limit/path empty. `routeEstimates` reports eligible configuration, not successful provider authentication or ledger health. A bad ledger fails closed at request time. Set the enable flag back to `0` to disable.
5. Obtain separate approval for a bounded live check. Verify actual Drive/Walk results, traffic labeling, attribution, geometry, no token leakage, account usage accounting and the kill switch. Mocked tests are not proof of traffic coverage, token validity or available allowance. Preserve Maps and disabled-provider behavior.

Initialization, credentials, live tests and activation were not performed in this slice. Production runtime and provider account configuration must be verified separately before activation.

## Official implementation references (checked 2026-11-08)

- [Directions API](https://docs.mapbox.com/api/navigation/directions/): supported profiles, longitude/latitude coordinate order, GeoJSON overview, snapping radiuses, traffic semantics and NoRoute/NoSegment.
- [Mapbox attribution](https://docs.mapbox.com/help/dive-deeper/attribution/): service attribution on non-Mapbox maps, including the official unmodified wordmark used here.
- [Token management](https://docs.mapbox.com/accounts/guides/tokens/): scopes, dedicated tokens and URL restriction limitations.
- [API overview](https://docs.mapbox.com/api/overview/): API rate limits are token-scoped, not a guaranteed total spend cap.
- [Pricing](https://www.mapbox.com/pricing): recheck the applicable account and current terms before activation.
