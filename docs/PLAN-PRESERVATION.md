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
