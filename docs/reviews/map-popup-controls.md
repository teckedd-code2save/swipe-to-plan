# Map popup controls review

## Fix

The fit button and loading/retry messages previously sat above the whole Leaflet canvas as absolute-positioned siblings. A grouped marker popup could appear beneath the fit button, leaving its first occurrence visible but unclickable.

- Put Show all stops in a normal-flow row above the canvas and status/retry messages below it. Neither overlays marker choices, native zoom controls or attribution.
- Bound popup content to the current canvas size and reserve space for zoom controls and attribution, including wrapped attribution. Long occurrence lists scroll inside the popup instead of exceeding a small map.
- Preserve the focused occurrence and scroll position when Leaflet rebuilds popup content during resize.
- Close an open popup before fitting all stops, so popup auto-pan does not counteract the requested bounds.
- Keep native buttons with at least 44px height and visible focus styling. Keep coincident stops at their actual shared coordinate with separate occurrence actions.

No tile-consent, tile-policy, route-provider, saved-default, GPS, scope-lifetime or geometry behavior was changed.

## Verification

Synthetic local tests cover the normal-flow control structure/CSS, independent first/third occurrence selection, native focusable marker and button elements, narrow/short canvas sizing, measured zoom/attribution clearance, scrollable popup content, resize focus retention, fit/reopen, cleanup, tile errors/retry, explicit load consent and stale-scope protection. The route suite also covers the repeated-stop key and existing dialog focus behavior.

Final local checks: focused map/route tests 94/94, full backend 436/436, full frontend 267/267, source lint and production Vite build passed. The build retains the existing warning for the main bundle exceeding 500 kB; this is not a build failure.

These are DOM/structural checks, not pixel hit testing. Post-deployment visual and pointer checks are required. No private QA screenshot is included.

## Release QA still required

After integration, verify on the supported production browser at desktop and narrow/short-height sizes:

1. Load the map only after its disclosure action. Open a coincident first/third stop marker and select each occurrence by pointer and keyboard.
2. Confirm Show all stops and loading/retry messages never cover popup choices or attribution. Verify zoom, popup close, scrolling a long list, and the Google Maps fallback.
3. Resize with an occurrence focused, then use Show all stops and reopen the popup. Confirm focus is retained through resize and all located stops fit afterward.
4. Change route scope or close/reopen the dialog and confirm old popup callbacks cannot select a stale stop and map-loading permission does not persist across scopes.
