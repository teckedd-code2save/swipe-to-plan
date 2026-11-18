# Licensed website search (conditional, not activated)

The default in-app fallback uses the Brave **Web Search API**, not an embedded search-engine page or automated scraping. Six original result titles, URLs and snippets appear inside Unstressed. The user compares the provider-bound venue name/address, chooses a result, and explicitly acknowledges that review before opening the existing booking browser. Search hits are leads, not verified ownership, availability or reservations. No first-result auto-selection, form submission or guest details in search queries.

## Operator prerequisites

1. Create an owner-controlled Brave Search API account and activate an appropriate Web Search plan. Official quickstart requires a payment card/plan; this change does not do that.
2. Review current API terms, approve permitted spending, and provide applicable end-user terms/privacy disclosures covering API result-use restrictions before activation. The existing privacy page describes public venue queries. This code does not create a legal agreement for the operator or its customers.
3. Store `BRAVE_SEARCH_API_KEY` server-side and explicitly set `BRAVE_SEARCH_ENABLED=true` only after those prerequisites. Neither value has been installed in production. No browser-exposed key.
4. Test a real Republic/Accra search → compare result → select → booking discovery. Until the key and activation flag exist, the app honestly reports search not configured with contact/external fallback.

As checked 18 November 2026, Web Search is $5 per 1,000 requests with $5 monthly Search credits (about 1,000 searches), prepaid. Verify the dashboard before purchase. This is not a guarantee of zero cost. The adapter limits each process to two active requests, ten/minute and 100/rolling day; restarts/replicas reset or multiply these counters, so they are not a billing cap. Set provider-side billing limits too.

Results remain in the current UI only; backend candidate URLs expire after three minutes and are capped at 120, with no persistent result database. Selecting creates a five-minute existing booking destination token. API calls are bounded to ten seconds and 500KB; only public HTTPS candidate URLs are admitted. Existing booking navigation independently rechecks DNS/public-address and network guards. No ownership claim is inferred from a search match.

Sources: [pricing](https://api-dashboard.search.brave.com/documentation/pricing), [quickstart](https://api-dashboard.search.brave.com/documentation/quickstart), [Web Search](https://api-dashboard.search.brave.com/documentation/services/web-search), [API terms](https://api-dashboard.search.brave.com/terms-of-service). Attribution is optional under the checked terms; branded attribution must follow its approved logo/wording rules.

Google remote-browser search returned a human-verification challenge in testing. No retry/bypass is used. DuckDuckGo embedding and Bing consumer product-use terms were not suitable substitutes. Older constrained browser-search code remains isolated and is not the default UI.
