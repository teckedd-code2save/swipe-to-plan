# Journey map implementation review

## Integration

Import `JourneyMap` from `frontend/src/JourneyMap.jsx` into RouteGuide. Pass plan, origin, selectedStopId, onSelectStop and routeScope. Import `journey-map.css` at the top of the product stylesheet; it includes Leaflet's installed CSS. No RouteGuide or planner changes are included in this isolated component commit.

## Provider review (2026-11-08)

- Stable Leaflet 1.9.4: https://leafletjs.com/reference-1.9.4.html
- OSM tile policy: https://operations.osmfoundation.org/policies/tiles/
- OSM privacy policy: https://osmfoundation.org/wiki/Privacy_Policy
- OSM terms: https://wiki.osmfoundation.org/wiki/Terms_of_Use

The official tile policy permits normal human interactive map browsing. Native browser image loading honors caching and browser User-Agent. Images use strict-origin-when-cross-origin to send a valid origin Referer without page paths. Attribution remains visible on the map. Only visible tiles are requested (keepBuffer 0, updateWhenIdle). No proxy, prefetch, offline cache, automated tile browsing, geocoder, paid service or key is used. Production must not add a referrer-stripping proxy/CSP or cache-bypass rules. OSM is community-funded, best-effort, with no SLA; access can be withdrawn without notice, particularly for commercial scale. A guaranteed or high-volume deployment needs a separately reviewed provider. This integration is not a routing provider.

Load map is explicit and preceded by a short disclosure that OSM receives the IP, browser and viewed map area. Venue names/marker content are local DOM and not submitted. No GPS request or persistent storage occurs. Permission lasts for the caller’s routeScope only. Origin and stop edits within that scope refresh the map without another prompt. The caller binds routeScope to account identity, view-open state, day epoch, saved/shared identity and plan revisions. Scope changes unload the map and revoke permission, including when a previous scope returns. Late imports and callbacks are rejected after origin, scope or retry changes. Google Maps fallback is owned by RouteGuide. A 12-second timeout and tile/import failures display an inline fallback with Retry map without changing the plan. The adapter tracks outstanding failed tiles: an unrelated successful tile cannot hide a failure. Recovery or removal of failed tiles from the viewport clears the warning once successful tiles remain. Retry recreates the map with standard browser caching and no repeat consent.

## Truth and interaction

Only finite numeric lat/lng within geographical bounds become markers. No inferred coordinates, text geocoding, or invented route lines. Starts from areas are labeled approximate. Stop numbers preserve ordered repeated slots. Coincident points are grouped at their true coordinate with all slot numbers, and the popup lists individually selectable stops. The horizontal stop key supplies keyboard-accessible actions even when coordinates are missing. Fit-all includes explicit origin and all located stops; ResizeObserver keeps the map usable after layout changes. Leaflet supports keyboard pan/zoom and focusable marker popups. Synthetic fixtures only; tests do not request remote tiles.

## Remaining release verification

Release integrator must verify actual frontend CSS integration, narrow mobile layout, keyboard focus, Maps link, correct production Referer/CSP and attribution in the final deployed app. No live user location or authenticated personal data was used by this implementation task. Tile service availability is not a guarantee.

## Automated checks

`npm run lint`, full backend 364/364 and frontend 214/214 tests, production Vite build, and standalone esbuild of JourneyMap plus Leaflet CSS. Twelve map-specific tests cover invalid coordinates, repeated/coincident stops, consent/scope reset including returning to an older scope, missing pins, tile errors, late imports, and real Leaflet DOM coordinates/attribution/referrer attributes under jsdom. Follow-up assertions check actual marker coordinates and fitted bounds, same-scope origin/stop changes without repeat consent, stale callbacks/imports, tile error/recovery tracking, retry after tile/import failure, and timed-out tile recovery. No browser screenshot or live tile availability claim is made by this component-only task; integrated visual QA belongs to the release branch.
