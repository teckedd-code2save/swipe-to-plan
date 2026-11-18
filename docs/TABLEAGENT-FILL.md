# Tableagent timing preview

The Tableagent adapter is deliberately separate from generic form filling and
Wix. It recognizes the exact `tableagent.com` native `findtableform` signature
and offers three reviewed values: date, time and party size. It does not submit
Continue, create a reservation, or enter guest identity/contact details.

## Boundary

After explicit consent, the selected date and venue/service identifiers may be
sent to the source-verified `/api/business-hours/` and
`/api/business-hours-times/` endpoints. Tableagent's current page implements
these service/time lookups with PUT, despite their read-only purpose. Each
capability permits one exact encoded body to one exact HTTPS endpoint, from
the main frame only. Extra fields, other methods, redirect destinations,
replays, the booking POST and all other non-GET requests remain blocked.
The original public DNS guard remains active; capability revocation is checked
again after asynchronous DNS resolution.

Both lookups are bounded by 10-second timeouts and 100 KB responses. Returned
HTML is parsed without script execution and only option metadata is used.
Ambiguous services, missing service metadata, special/passcode services,
unsupported service types, missing requested times and out-of-range parties
fail closed rather than choosing alternatives. Optional integrations do not
supply a new source URL: normal provider-linked or user-selected expiring
candidate provenance is still required.

The form fingerprint is checked before and after lookups. The browser is then
disconnected, the form identity checked again, and visible native fields are
set without input/change events. A failed offline transition prevents fill.
Only provider-supported numeric party bounds allow restoring a choice removed
by the page's initial hydration; disabled choices are never selected. Required
extra fields (for example duration) make this three-field adapter ineligible.
The resulting review is not a claim of a booked table or a submission-ready
JavaScript application state.

## Verification

Unit tests exercise exact scopes, revocation during pending DNS, freeze failure,
changed identity, extra required fields and no-event native filling. Live
provider response and end-to-end app verification must be recorded separately;
fixture success alone is not proof of support for a real venue. Wix's worker
startup limitation is not addressed by this adapter.

An isolated live provider probe on 18 November 2026 returned service type 14,
Lunch - Dinner, minimum 5 and maximum 40 guests, with 19:00:00 among the time
options for 20 November. This establishes option semantics, not a booking. A
request for two guests must fail, not silently become five. Only the observed
ordinary service type 14 is currently enabled.
