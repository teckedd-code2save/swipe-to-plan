# Booking Route Resolver v2

**Issue:** #48. **Feature branch:** feature/48-booking-route-resolver.
**Scope:** venue-specific, read-only destination resolution. No automatic booking submission or confirmed reservation.

Catalog source: https://github.com/public-apis/public-apis (MCP: ContextFetch, Octocrawl, Scrape.ly; Email: Unitpost and SendRaven). ContextFetch's REST implementation contract is also documented by https://github.com/lachy3433/contextfetch-mcp (MIT). Qloo provides the venue identity and tastes; it is not replaced.

## The six implementation steps

1. **Read-only resolver:** backend/src/booking-route-resolver.js ranks public leads for a supplied venue name/address and retains only valid HTTPS URLs. The existing Qloo venue UUID remains the scoping identity. A result is a *lead*, not ownership, availability or booking confirmation.
2. **Optional ContextFetch search:** backend/src/contextfetch-booking-search.js uses the documented POST https://api.contextfetch.dev/v1/search with a fixed JSON shape: query, numResults=10, userLocation=GH, language=en and pruned content. It uses an identifying venue name and public address only. It sends no customer details. Strict response size, 10-second timeout and single-attempt semantics apply. Disabled by default.
3. **Identity and security:** existing menuUrl normalization, provider entity binding, transient candidate identifiers, HTTPS restrictions, DNS/public-address checks and cross-domain review remain in force. A URL or name match does not prove the site belongs to the venue.
4. **Rank and reuse:** results are ranked deterministically on explicit venue-name match, locality signals, booking words in paths and text, preserving unverified evidence. After a real booking form was inspected, a queryless, HTTPS route can be held in a bounded in-memory cache for 24 hours, scoped to venue UUID + name + address. This saves search calls but **does not skip re-inspection**. URLs with query tokens are never retained. The cache disappears on restart.
5. **Existing browser handoff:** the candidate identifier must be selected by the user; only then can the existing guarded destination-inspection browser examine the page. For missing Qloo websites the UI goes straight to the already existing website-search panel. Same-origin public booking links can be examined for a maximum of two hops (previously one). Cross-domain redirects always require renewed review. Wix and TableAgent preparation adapters remain unchanged; form filling still occurs with browser networking frozen, and the booking POST is blocked.
6. **Regression coverage:** backend/test/booking-route-resolver.test.js covers the ContextFetch contract, rate/failure handling, deterministic ranking, unsafe/duplicate leads, venue scoping, cache expiry, no silent provider fallback, and selected-handoff behavior. Existing reservation-form, DNS, Wix, TableAgent and website-search tests remain relevant; add a two-hop form fixture and run targeted tests before any activation.

## Environment and provider choice

- CONTEXTFETCH_BOOKING_ENABLED=true (default) enables ContextFetch's keyless public search without extra credentials. An explicit false value disables it. Existing Serper/Brave remain separately selectable for later use.
- With default ContextFetch enabled, it is chosen **instead of** Serper/Brave for a booking-website search. There is no cascading spend across providers on failure.
- CONTEXTFETCH_API_KEY is optional; keyless mode uses the provider's published Bearer keyless access. It has a shared externally imposed free allowance (published as 25 requests/day per network). Account keys and quotas require explicit operator review.
- No key, token, private query, guest details, availability promise or result snapshots should enter Git.
- ContextFetch may return 402 (free allowance exhausted) or 429; these are reported as search-rate-limit errors, not silently retried or redirected to a paid provider.
- A prior inspected route can be used before invoking either provider and is revalidated in the actual form browser.
- Keyless route search is available without new environment keys. If the remote booking browser is disabled, the UI opens the search results as externally reviewable HTTPS booking leads; no form filling is claimed.
- This feature branch makes no environment changes or paid calls. An enabled flag merely selects a source; it does not guarantee a funded/working external service.

## Trust boundaries and gaps

- Search results, title/snippet evidence and a form existing at a URL **never verify business ownership**.
- The first page or a selected booking route may be an iframe, custom SPA widget, password gate or multiple-step flow; those remain unknown until supported by an adapter.
- Read-only discovery prevents POST/PUT except the tightly scoped TableAgent availability requests already reviewed in the project.
- Form preview disconnects networking before inserting user values, so it is **not an executable booking**; no new submission, payment, customer email, or restaurant contact is authorized here.
- An actual booking execution phase will require a provider-specific authorized adapter, scoped explicit consent, idempotent action ledger, provider confirmation and reconciliation for unknown outcomes. See docs/OUTING-ACTIONS.md.
- This changes neither Qloo planning nor existing personal-taste rankings; without a website, source acquisition becomes a public booking-site search.
- The resolver does not scrape arbitrary search results into persistent contact ownership claims.

## Test and release checklist

~~~
node --test backend/test/booking-route-resolver.test.js
node --test backend/test/booking-website-search.test.js backend/test/reservation-form.test.js backend/test/reservation-tableagent.test.js
npm run lint
npm test
npm run build
~~~

In a controlled environment, test Republic Bar & Grill (missing site), Capitol Cafe (redirect), Front/Back Accra (TableAgent group-size restriction), a Wix booking widget, and two venues with similar names. Measure correct destination, path-to-form, number of browser instances, latency, API calls, exact user review stages and no-submission guarantees.

Record the exact commit tested, test failures and real provider observations separately. Fixture success is not a production quality pass. Review and merge PR only after acceptance; the main branch deploys automatically, so do not fast-forward this experimental branch into main on assumption alone.

## Octocrawl venue-site maps

Website search uses the existing ContextFetch default (or the explicitly configured
Serper/Brave adapter) to find broader leads. It now also checks the public origin
of the Qloo-linked venue site, when available over HTTPS, using [Octocrawl’s hosted map API](https://octocrawl.dev/docs/reference/).
Only an origin is sent: no guest data, query strings, cookies, tokens, or search-derived
hosts. The app accepts only booking-looking, queryless same-origin leads from a successful
same-origin map. A lead is not proof of venue ownership or availability.

The keyless map runs once per uncached origin/venue pair with a 5-second wait, two
concurrent calls across the app and at most 12 map calls per UTC day. Positive maps are
cached for one hour and empty or failed maps for 15 minutes. The existing search provider
has no new cap. Search continues if mapping is unavailable, and mapped leads can still
appear if the search provider is rate-limited. Set `OCTOCRAWL_BOOKING_ENABLED=false` to
turn off only the map. No credentials or paid plan are required.

A user-selected search lead can now follow up to two booking links on the same
origin using the existing read-only browser. Cross-origin navigation still needs review,
and input filling still happens offline. No form submission is enabled.

## Deferred related options

- Scrape.ly, https://scrape.ly/docs/mcp : actor-specific extraction, not a general-purpose approved booking robot; not called by this PR.
- Product-wide transactional mail: consider Unitpost (https://www.unitpost.com/docs/email) and SendRaven (https://sendraven.ai/docs/api), separately scoped. This PR does not alter Resend or email delivery.
- Public-information/Qloo alternatives: see docs/PUBLIC_APIS_FUTURE.md.


## Public form handoff

After offline preparation, the user can continue to the exact HTTPS form page
from the preview in their own browser. We do not transfer fields automatically,
reuse the remote browser, append guest data to the URL, or send the request.
Individual prepared values can be explicitly copied for the user to paste.
Opening the page does not record a send. If the user says they sent it, the
current view labels that as their report, not as proof of delivery or a table
reservation. The venue can respond directly to the contact details the user enters.
