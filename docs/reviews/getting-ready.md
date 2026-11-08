# Map-led Getting Ready redesign

## Scope and hierarchy

Built on the inactive-routing release at 9d595ce25f4b3b8cf16fa61ba2fafebf46a74a2e. No backend, provider credentials, deployment settings or activation switches changed.

- Getting Ready uses a compact outing header immediately, keeps all plan tabs reachable, and removes its unrelated fixed spending footer. The other plan views retain their full title and spending controls.
- Time, Start and Contact summarize the outing above an automatically displayed map. One primary action follows the current state: choose time, choose a start, review conflicting hours, or open directions.
- Numbered ordered visit cards match map badges. Unfilled visits remain visible as numbered gaps; repeated visits and co-located markers keep separate occurrence identities. No coordinates or lines are fabricated.
- A unique marker opens that visit directly. A co-located marker keeps its bounded, keyboard-accessible chooser before opening the visit sheet. Fit-all remains outside the canvas, clear of popups and attribution. Selected markers have a distinct treatment.
- One contextual sheet contains focused start, timing, journey, visit, contact or enquiry views. Hours precede menu/contact information in a visit overview. Sources and extra venue detail are disclosed on demand. Timing no longer sends the user back into chat.
- Contact actions use existing canonical evidence. Enquiry review, handoff and private reporting reuse the original booking state machine. Unsupported phone links, WhatsApp consent, bookings, availability, prices and provider execution are not invented.

## Boundaries and accessibility

The native dialog supplies modal focus containment and an inert background. It has a named heading, clear Close/Back controls, focus entry/return, isolated scrolling, safe-area padding and dynamic viewport constraints. Escape and browser Back dismiss it. Rapid Close/Escape is guarded against multiple history traversals. Timing removes its sheet history entry before applying a request. Forward does not restore stale sheets. Scope invalidation never navigates back into another account or outing; if the old trigger disappeared, ordinary dismissal falls back to the map hub. The parent outing’s pull-to-dismiss gesture excludes map gestures.

Starts can use a saved or planning area, catalog search, a landmark or an explicit current-location gesture. Chosen partial catalog areas retain hydration and stale-callback guards. Default saving is separate, explicit and area-only. No precise location is persisted. Closing the picker rejects late GPS or catalog callbacks.

Automatic display requests only visible OpenStreetMap tiles. Attribution, privacy links, missing-pin messaging, tile recovery, retry and stale-import handling remain. No automatic GPS, Directions request, booking, call, send or payment is introduced. Estimates remain explicit, capability-gated and Mapbox/OSM compatible. Each route uses the exact occurrence and preceding selected stop. The public privacy page now describes these behaviors rather than obsolete Google Routes behavior.

## Verification

Final local aggregate: `npm run lint` passed; `npm test` passed 468 backend and 328 frontend tests; `npm run build` passed. Vite retains the existing main-chunk size warning. The 16 new Getting Ready cases include the mobile map-pan regression. The focused review covered navigation, occurrence binding and inactive-provider boundaries.

All test data is synthetic. GPS, provider estimates and persistence calls are mocked; no paid route calls, real GPS, booking, calling or payment were used.

Behavior coverage includes automatic map loading without GPS/estimate requests; loading/errors/retry; same-scope and account/day changes; saved/planning-area hydration; stale search/GPS/catalog results; default save and reload for guests/accounts; exact repeated-occurrence hours, directions and booking snapshots; unfilled gaps; native-modal structure; Close/Escape/Back/Forward and rapid dismissal; focus return and removed triggers; compact timing submission; disabled and mock-enabled estimates; incomplete plans and shared non-owner permissions; and mobile map-pan versus parent dismissal.

Rendered desktop/mobile layouts, native keyboard focus trapping, safe-area and virtual-keyboard behavior remain to be checked on the deployed build. The local checks above exercise DOM behavior and do not establish pixel or physical-device behavior. No production-complete claim is made by this local implementation.

Historical map review documents describe the old explicit tile-load gate. This redesign intentionally supersedes that gate with automatic display; provider estimate activation and request safety are unchanged.
