# Mapbox routing local verification

Checked 2026-11-08. This implementation remains inactive until separate provider setup and activation. It includes the separately developed map-popup-control fix (source commit ba95dd9d4cb7b46290170fd9693a19aa35cbbf85), merged without dropping route geometry or popup focus/scroll behavior.

## Checks

- `npm run lint`: passed.
- `npm test`: 468 backend and 293 frontend tests passed, zero failures.
- `npm run build`: passed. Existing large-chunk warning remains.
- `git diff --check`: passed.
- Built frontend inspected for the server token variable, credential fixtures and `access_token=`: none found.
- Default capability snapshot: route estimates false, no configured provider/request limit, no geometry, booking submission false, confirmed bookings false.
- No local image build was performed. Exact-commit image validation is required in CI.
- No live provider, production setup, credential, account billing or browser traffic coverage check performed.

## Covered behavior

Both Mapbox profiles, no Transit, explicit provider/display/activation/token/request-limit gating, generic Google keys remaining inactive, OSM refusing Google results, real coordinate bounds, address/no-pin fallback, unsupported scheduled departure, request/selected-occurrence binding, duplicate submits, request completion out of order, stale mode/origin/date/time/account/day/revision changes, dismissal/reopening, accurate GPS versus approximate catalog centers, incomplete planning/default/search-area ID hydration and late-result rejection, malformed catalog metadata, real bounded geometry, geometry removal, map consent, attribution and popup-control behavior.

Provider tests cover valid fractional and zero measurements, malformed data, no route/no road segment, 401/403/422/429/5xx, network failure, timeouts through headers and streaming body, oversized bodies, no retries, credentials/extra upstream fields never reaching results, cancelled rejected bodies, stalled cancellation hooks and late header responses after a deadline.

Budget tests cover positive configuration, explicit new-ledger initialization, no auto-reset of missing/damaged state, concurrency, restart, UTC rollover, backward clock, invalid schema/personal records, temp/intent/rename/directory-sync failures, ambiguous outcomes, durable claim before outbound work, retaining failed/unknown slots and a process exit after claim. Single-writer durable storage remains mandatory. A restored older ledger requires conservative operator reconciliation before reactivation.

Independent local review found one rejected-response-body cleanup defect. It was fixed with active abort/nonblocking cancellation and dedicated regressions; follow-up review reported no remaining blocking findings. The final full checks above ran after all hardening changes.

## Metadata and remaining prerequisites

Production runtime and provider account configuration are not verified by the synthetic checks. No credential or account setup was performed.

Before activation: approved Mapbox account/terms/billing exposure, dedicated server-held least-privilege token with verified restriction behavior, positive approved UTC request limit, distinct initialized ledger on durable storage with verified filesystem behavior, account monitoring/disable plan, and separately approved bounded live checks. See [routing design and setup](../ROUTING.md). The app's request limit is not an exact dollar ceiling or proof of unused free quota.
