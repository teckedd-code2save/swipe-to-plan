# Selected visits and repeat-venue regression checks

A place is a provider entity. A visit is an ordered occurrence of that place in
an outing. The same place may be explicitly chosen for more than one visit.
The default discovery planner still chooses distinct places.

## Contract

- `activities` holds unique retrieval categories. `stopIntents` holds the ordered
  visit categories, which may repeat. Neither field alone selects a venue.
- `route` selects an exact place ID for each occurrence. Explicit pins can select
  the same place in separate slots. All selections must still pass provider,
  location, exclusion, price and family constraints.
- `planContext.stops` describes every selected occurrence in route order, with a
  separate `stopId` and provider place `id`. Filtering comparison options does
  not filter this current route. `requestedStopCount` exposes unfilled visits.
- `edit_stops` applies one insertion, replacement, removal or move to exact
  occurrence references. Code carries all untouched visits forward. Unsupported
  references, unresolved partial routes, and edits outside the one-to-three-visit
  bound fail before execution; no existing visit is silently dropped.
- `select_places` remains available for an intentionally chosen complete route.
  Duplicate IDs mean explicit return visits, not additional discovery candidates.
- Relevance review cannot remove selected places. Missing or excluded selected
  places remain unfilled. Repeated visits get their own time slots, allowances,
  taste-map nodes and practical-hour checks. Provider facts are never invented.
- Selection action narration is not a completion receipt. The UI describes the
  actual returned route, including missing visits and unscheduled timing.
- Comparison inputs use the current route and evidence, excluding historical
  proposed-action narration. Free-form comparisons remain model-generated;
  deterministic receipts do not prove every model sentence is correct.

## Offline regression coverage

All new fixtures use synthetic provider-shaped data and stub model responses.
They do not call a live model, Qloo, Maps or any paid service.

1. Start with Cafe A then Dinner B. Insert Cafe A after Dinner B. Keep exactly
   three visits: Cafe A, Dinner B, Cafe A; preserve people, budget, timing, area,
   exclusions and other requirements.
2. Reproduce the former failure mechanism: pinning only the third visit reserves
   Cafe A and causes the unpinned first coffee slot to choose Cafe Alternative.
   Verify occurrence-based insertion also selects the original first visit.
3. Exercise discovery, fixed scheduling, relevance review, explicit pins, past
   timing and reported-closed fallback. A return visit remains a separate visit.
4. Exclude/remove provider evidence for the selected venue, or apply a conflicting
   price cap. Keep the visit unfilled instead of silently substituting a venue.
5. Remove, move or replace one occurrence; preserve the others. Reject invented
   IDs, ambiguous occurrence references and capacity overflow.
6. Persist a shared day, revise member tastes and restart storage. Keep the exact
   selected route and owner-only mutation rules.
7. Verify booking snapshots and route fingerprints distinguish visits to the same
   entity. Removing a visit invalidates its prior booking review.
8. Verify venue comparisons have unique option cards/queries while the model's
   current route preserves ordered visits and occurrence-specific hour evidence.
9. In shared days, reject edits from stale or still-updating selected snapshots,
   and send the captured revision to protect the final mutation race. Local
   selections retain newer draft budget/date/taste constraints while retrieval
   catches up.
10. Remove or append through the rendered UI by occurrence, preserving different
   categories for the same venue. Fail closed on individual edits to partial
   routes rather than silently dropping an unresolved visit. Comparison keys
   include the complete ordered visits and their windows.
11. Exercise the actual React app with delayed complete/partial responses. Do not
   display a model's proposed success statement before retrieval; the receipt must
   list the actual returned visits and gaps.

Run `npm run lint`, `npm test` and `npm run build` from the repository root.

## Post-release live check still required

Use the ordinary guest and signed-in conversations with currently returned
venues. Request an intentional return visit while keeping the earlier stops.
Verify the selected tool, exact final route, later comparison text, menu/hour
checks, shared-day revision and mobile rendering. Also test a normal request for
three distinct stops and the existing no-meal requirement.

Offline fixtures establish deterministic preservation and truthful receipt
rendering, not live model interpretation or current provider inventory. If a live
comparison contradicts the actual route, record it separately; do not broaden
place-selection rules or add message-specific contradiction keyword gates.

## Selected evidence across category-query changes

A selected venue can be absent from a new discovery pool even when it was eligible in a recent pool. For example, a dining search includes a restaurant supplement that a coffee-only search does not. Absence from the new pool is not proof of category or location ineligibility.

Only explicit route/pin IDs may reuse server-held raw provider evidence. Discovery examines at most its existing 100 cache entries and three selected IDs. Reuse requires an unexpired original ten-minute lifetime, identical requested area/location ID/radius, identical input tastes and resolved artist/tag/context signals, identical experience inputs, and identical resolved provider locality evidence. Resolved context sets are canonicalized so cold/warm search completion order cannot change compatibility; the original input taste order remains exact. Optional-signal outages disable recovery. A recovery never renews or inserts the old venue into the current discovery cache.

Current-pool presence always wins. A selected ID present but rejected in the current pool cannot fall back to an older favorable version. When absent, the newest compatible cached observation is reranked with every current hard filter, including user exclusions, feedback, venue category, area, hotel/family restrictions and price tier. Current scheduling/hour checks still run. A group member's hard rejection cannot be overridden by another member's favorable cached snapshot. Explicit selected IDs remain outside the ordinary group discovery cap. Mixed fresh/cached groups retain current venue facts plus each contributing member’s original evidence timestamp, with cached provenance on their taste edges. Original per-venue retrieval time, contact provenance, locality proof and explainability remain attached; a reuse marker and result warning disclose the older evidence. No client-supplied venue facts or new lookup endpoint are involved.

Ordinary discovery does not add old venues or allow implicit repeat visits. Only selected IDs recover, and default distinctness remains unchanged. Missing selected evidence uses `selected_evidence_unavailable`; current hard rejection uses `selected_place_rejected` plus a specific `selectionEvidence.reason`. The receipt and next steps distinguish these cases, retain the requested empty occurrence, and do not substitute a different venue.

Offline coverage includes the real provider adapter with injected fetch, category-pool loss, expiry and eviction, query/locality mismatches, fresh negative evidence, current hard filters, per-person group conflicts, timestamp/contact/affinity preservation, scheduling, HTTP guest behavior, shared/account persistence and Undo, plus actual React receipt rendering. This proves the mechanisms, not the precise cause of any prior live café miss. That still requires the actual selected action/request and provider evidence from that run.
