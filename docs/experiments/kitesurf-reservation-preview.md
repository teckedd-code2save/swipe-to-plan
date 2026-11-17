# Reservation form preview with Kitesurf

This experiment lives in Unstressed's existing **Getting Ready → booking preparation → Reservation request** flow. It does not add a separate demo app, create a booking, or change production. It uses the current stop's date, time, party size and edited message. Missing name/email/phone fields are entered by the user; no example guest details are injected.

## Try it on an isolated instance

1. Use the `experiment/kitesurf-reservation-preview` branch, a separate build, and nonproduction configuration. Do not push this branch to main: main deploys production.
2. Configure a Cloudflare Browser Run token in the server's secret storage as `CLOUDFLARE_BROWSER_TOKEN`. Set `KITESURF_CDP_URL` to `wss://api.cloudflare.com/client/v4/accounts/<your-account-id>/browser-run/devtools/browser?browser=kitesurf` and `RESERVATION_FORM_PREVIEW=true`.
3. Build the frontend with `VITE_RESERVATION_FORM_PREVIEW=true`. Both backend capability and frontend build opt-in are required. Anonymous playground endpoints are rejected by the application because real guest details must not accidentally enter a public demo service.
4. Plan an actual visit, select Reservation request in booking preparation, and choose **Find booking form**. Confirm the venue/branch and review the loaded fields. Actual date/time/party/message are prefilled where a native field can be mapped; missing identity fields stay empty.
5. Review the exact values and explicitly approve their use in Cloudflare's browser. **Fill form without submitting** returns a screenshot of the actual form and per-field results. It does not press a button, advance a step, or claim a reservation.

## Behavior and safety boundary

- Website comes from the existing provider-bound venue details, never an arbitrary user-provided URL. Discovery may follow one explicitly published same-origin booking link. Published partner links and recognizable booking iframe sources are shown for explicit destination review. Selecting a candidate inspects that exact server-recorded URL; arbitrary caller URLs are rejected. Custom calendar workflows are not auto-driven.
- A fresh browser page is used; no app cookies, user session, or credentials are passed into the venue. Only GET resources are allowed during discovery; local/private resolved addresses and non-HTTPS requests are rejected. Cloudflare's own outbound isolation remains important; client-side DNS checks alone are not a DNS-rebinding security boundary.
- Before copying guest values, interception blocks **all** requests and the browser is put offline. Form submission is suppressed. WebSockets/WebTransport/WebRTC constructors are disabled at document start so a live channel cannot outlast that freeze. If these controls are unsupported, filling fails closed.
- Native field values are filled without input/change callbacks, preventing autosave handlers. This is a **visual review preview**, not a claim that a website's React model, availability check, hidden date picker, or checkout is ready. Unknown/custom controls remain unfilled. No booking state is updated.
- Field descriptors expire after five minutes; the form is reloaded and its shape compared before filling. Changed forms require rediscovery. Actual values and screenshots are returned only to the requesting page and not saved in the discovery cache or booking ledger.
- Closing the panel or changing the itinerary discards/aborts the UI preview. A client abort can occur after the isolated server browser has started; the server still closes that page and never submits.

## Checks

- `npm run lint`, `npm test`, `npm run build`.
- `TEST_KITESURF=1 node --test backend/test/reservation-form-browser.test.js` uses Cloudflare's no-account playground with an in-memory test form only. It tests that filling runs after the network freeze, does not trigger input handlers or resource requests, and produces a screenshot. This is a test fixture, not product behavior or a live booking.
- `node backend/scripts/probe-kitesurf.mjs https://jerkharbour.com/book` is a read-only public-site probe. It contains no actual guest identity or booking values. In proxied test workspaces, it resolves public hostnames through Cloudflare DNS-over-HTTPS.

## Verified on 14 November 2026

Cloudflare's real Kitesurf CDP supported request interception and offline mode. It located native reservation inputs on Jerk Harbour's published `/book` page. The in-memory real-engine test filled fields and returned a screenshot with zero outgoing requests during the test. Backend and frontend automated checks are recorded in the delivery summary. No real guest data was entered into a third-party service, and no reservation was submitted.

Still to verify together: configure the isolated instance's own Cloudflare account; exercise the complete signed-in Unstressed UI with a real planned visit; inspect its resulting form screenshot; expand adapters for custom date/time controls, provider links and iframes. There is deliberately no submission endpoint.

References: [Cloudflare Kitesurf](https://developers.cloudflare.com/browser-run/kitesurf/), [public playground](https://kitesurf.dev/).

## Optional interactive hybrid (implemented, not live-verified)

Kitesurf has no managed Live View and cannot retain a session with `keep_alive` ([Cloudflare limitation](https://developers.cloudflare.com/browser-run/features/webmcp/#limitations)). Set `RESERVATION_FORM_LIVE_VIEW=true` **only on the isolated test instance** to use Kitesurf for discovery and Cloudflare's standard Chromium browser for filling and handoff. Chromium uses the same account/token and counts against its normal Browser Run quotas/billing; enabling this is not necessary for the default Kitesurf preview.

The hybrid asks Cloudflare's documented `Cloudflare.getLiveView` command for a tab-mode URL after filling and disconnecting page networking. The actual filled tab remains alive for review/editing; its network remains blocked, so it cannot fetch new availability or submit a booking. The app's Close button closes that tab; the application also schedules closure after two minutes and sets the browser's post-disconnect inactivity timeout to ten seconds. The Live View link has a one-minute connection deadline. The link is a bearer credential: never log, persist, publish, or share it. Local client state is cleared on changes and unmount.

This is not an unlocked checkout or a venue-state commit. Network interception and offline mode must be verified across the generated Live View connection in the configured Cloudflare account before enabling beyond a private experiment. In particular, test attempted button submits, new tabs, navigation, close/abort, server restart and session billing cleanup. Application timers are not durable across server crashes; an already connected viewer may keep a provider session alive. No real Cloudflare Chromium session or Live View URL has been created in this work because Browser Run account credentials are unavailable. Mocked lifecycle tests verify engine selection, returned lease, and close behavior; they do not prove provider interaction.


## 16 November usability follow-up

Published booking-provider links no longer disappear when the venue website has no native form. The user sees the exact same-site/partner destination and chooses **Inspect this booking page** before loading it. That step sends only an expiring candidate ID to Unstressed, not reservation fields. Preview consent and previously filled values are cleared on destination changes. Cross-provider redirects still stop for review.

Client-rendered forms get a short bounded mount check. Native combined date/time controls use the actual visit date and time. When date or time cannot be mapped, the interface says so rather than implying a complete reservation. No names, email addresses or phone numbers are invented. Discovery also reports recognizable embedded forms and an unsupported-form reason.

Automated checks cover selecting published partner destinations, rejecting caller URLs and cross-venue/expired candidates, destination change cleanup, date/time mapping and fallback messages. A new public Kitesurf homepage probe on 16 November timed out; a direct-page retry did not run because execution approval review was cancelled. The earlier 14 November real-page verification remains historical evidence, not a new successful live check. No guest details or booking were sent during these attempts.
