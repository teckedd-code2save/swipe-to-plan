# Future open-data alternatives and complements to Qloo

**Status: documented for later development; not enabled, deployed, or wired into planning.**

This is the retained backlog for inexpensive public information in Unstressed. Qloo remains the active venue-discovery and taste-affinity source. The current product priority is turning an already selected venue into a secured outing, not swapping discovery engines.

Source catalog: https://github.com/public-apis/public-apis (reviewed 22 November 2026). The Wikimedia and MET Norway services below were also checked against their **official** documentation. A listing or a free API key is not evidence of current Ghana coverage or the right to reuse every image or snippet.

## 1. Wikipedia Geosearch: nearby heritage, history and culture

- Official API: https://www.mediawiki.org/wiki/API:Geosearch
- Request: GET https://en.wikipedia.org/w/api.php with query parameters: action=query, list=geosearch, gscoord=LAT|LON, gsradius (metres), gslimit, format=json.
- Returned: article IDs, names, coordinates and relative distances for geotagged articles, NOT a complete local-business directory.
- Follow up: the Wikimedia Action API can retrieve limited page metadata and canonical article links. Wikidata can provide structured topic relationships, cultural designations and identities when an article has a linked item.
- Wikimedia Commons: request eligible media metadata and file-level licences; never assume all Commons images have identical attribution or commercial rights. Track original author, work link, licence and derivative obligations per image.
- Product use later: "Why this place?", nearby art, memorials, heritage sites, history-led itineraries and richer discovery cards.
- Caveats: geotagging coverage is uneven; do not infer opening hours, reservation capacity, ticket prices or personal taste scores. Use a descriptive User-Agent, attribution, bounded caches, documented API limits, and user-visible source links.

Additional official references:
- https://www.mediawiki.org/wiki/API:Search_and_discovery
- https://www.wikidata.org/wiki/Wikidata:Data_access
- https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia
- https://www.mediawiki.org/wiki/API:Imageinfo

## 2. MET Norway Locationforecast: outdoor suitability

- Official API: https://api.met.no/weatherapi/locationforecast/2.0/documentation
- Terms: https://docs.api.met.no/doc/TermsOfService
- Global endpoint: GET https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=...&lon=...
- Use for: forecast temperature, precipitation and weather conditions around the planned time. An indoor/outdoor advisory can be calculated without changing Qloo's ranked venues.
- Authentication: no key, but **must send an identifying User-Agent**, including the product/site and a publicly accessible contact route; anonymous generic UAs can receive 403.
- The weather data is available under CC BY 4.0 and permits commercial reuse with attribution and indication of modifications.
- Rate/cache: truncate coordinates to at most four decimal places; use Expires/Last-Modified/If-Modified-Since and proxy/cache on the backend. Outside the Nordic region forecasts update around every six hours, and identical requests should not be repeated more frequently than every three hours. Do not schedule a simultaneous burst or exceed service traffic terms.
- Limitations: model forecasts are not observations, guarantees of safe weather, supplier opening status, or reservation availability. Differentiate a severe-weather warning from a normal precipitation probability.

## 3. Other public-apis candidates to retain

| Candidate | Product use later | Access caution |
| --- | --- | --- |
| OpenRouteService (https://openrouteservice.org/) | Real road travel times between selected stops instead of static schedule buffers | Free-tier quota/API key; validate Ghana road coverage and commercial terms |
| Geofabrik Ghana OSM extract (https://download.geofabrik.de/africa/ghana.html) | Offline place/category fallback and geographic coordinates | Respect ODbL attribution/share-alike obligations for derived databases |
| Geoapify Places (https://www.geoapify.com/places-api/) | Additional venue coverage only when Qloo misses a supported locality | Free quota with key, provider licence, overlapping OSM source |
| Lineup Atlas (https://lineupatlas.com/en/data-partners) | Real-world nightlife and festival leads with event dates and booking links | Ghana coverage unverified; ticket links do not prove availability |
| Nager.Date (https://date.nager.at/) | Holiday-aware outing scheduling where supported | Confirm Ghana holiday coverage before use |
| Currency API (https://github.com/fawazahmed0/exchange-api) | Budget presentation in local currency for travel plans | Rates are indicative, not locked merchant exchange quotes |
| Open Food Facts (https://world.openfoodfacts.org/data) | Food/product identities, dietary metadata for future commerce | ODbL and data licensing, coverage, no stock verification |

## Later implementation contract (NOT part of this PR)

1. Preserve the existing Qloo place IDs and cultural-affinity explanation; no invented Qloo matches from Wikimedia/OSM.
2. Build standalone, opt-in adapter interfaces with source URLs, timestamps, attribution and licence metadata.
3. Cache within the published provider limits and use per-provider quotas; never continuously poll public endpoints for every customer.
4. Compare at least 20 Ghana-focused art/history/outdoor plans and record coverage, latency, costs and missing fields before activation.
5. Separate historic descriptions, weather forecasts and actual venue availability. None confirms a reservation.
6. Do not ship UI changes, credentials or provider calls simply because this backlog is documented.

Deferred owner decision: prioritize these independent open sources when discovery/enrichment work resumes. For now, focus on the booking-route resolver.

