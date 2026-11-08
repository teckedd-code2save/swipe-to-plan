# From a plan to a confirmed outing

The product goal is to complete the practical work for the customer, not simply give them more links. Research and reversible preparation should happen with minimal interruption; the customer reviews the details when consent, cost, uncertainty or a consequential change requires a decision.

## Local integration and current boundaries

The integration is in the existing Unstressed process and conversation. It does not require a second Outing Actions workload, a shared service key or a separate global booking file. Only selected behavior is adapted from Outing Actions, with its MIT notice in `backend/licenses/outing-actions-MIT.txt`.

The route slice provides explicit, optional Google Routes estimates for individual journeys and provider-independent navigation links. It estimates leaving now, not the scheduled outing time, and does not establish schedule feasibility. See the route API and deployment configuration.

The booking slice prepares an enquiry or reservation request for an exact selected stop and tracks the organizer's own reported outcome. Persisted records belong to the account plan owner or shared-day owner capability. They are separate from the plan, its exports and Circle views. Anonymous preparation remains available without signing in. No provider adapter, automatic contact, availability lookup, booking submission, payment execution or independently verified confirmation is enabled by this slice.

Preparation is a foundation, not the final execution model. `bookingSubmission:false` and `confirmedBookings:false` must remain truthful until actual configured adapters and reconciliation are implemented and tested. Opening a website, starting a call, copying text or recording the customer's report must never set a provider-confirmed status.

## Build stages: start useful, then execute

### 1. Sourced contacts and a safe dialer handoff (this local slice)

Use the venue data Unstressed already receives. Show the supplied telephone/website, exact source field, venue ID and retrieval time. Validate contact formatting without inventing a country prefix or missing digits. A local-only or unsafe number has no automatic dial link; the venue website or manual confirmation is the fallback. Only the customer's explicit selection opens their own phone app. Unstressed does not place or record the call.

Keep four claims separate: a provider supplied a number; its format is usable internationally; it belongs to this venue; and someone can currently answer it. This slice establishes only the first and a conservative format check. Retrieval time is not the provider's last update or a verification date. WhatsApp availability and opt-in remain unknown. A published number is not consent to automated business outreach.

Acceptance: missing, malformed and local-only numbers degrade clearly; sourced international numbers show the exact dial target; metadata-only refresh does not erase a reviewed booking; changing the destination does require a new review; no click or phone-app launch records a completed call or confirmation. Existing guests, account owners, shared-day roles and repeated stops stay isolated.

### 2. Corroborated venue contact directory

For a small initial venue set, compare provider evidence with the venue's official contact/booking page or an authorized venue representative. Save each independent source, observation date and exact venue identity/address. Conflicting numbers require a review rather than silently choosing one. A venue-confirmed business number is distinct from an official-page match and from a formatting/line-type check. Record when evidence expires or needs rechecking.

Normalize Ghana/local numbers only when the venue country is explicitly supported by matched venue evidence and a maintained numbering-plan validator; never derive country from the customer’s location, currency or timezone. Preserve the supplied number alongside the normalized result. An optional phone-validation provider can help with number format, country or line type, but cannot prove ownership or a willingness to receive reservation requests. Google Place Details may offer on-demand phone/website data for an existing place ID, subject to field billing and the applicable license, attribution, retention and downstream-use terms. Do not assume Google content may be permanently copied into the contact directory or voiced through a third-party calling system. No additional paid lookup or credential is configured in the current slice.

Acceptance: every callable destination has a known source and review state; duplicates and conflicting evidence are visible; partner venues have a preferred channel and documented contact consent; unsupported channels remain disabled.

### 3. One real reservation channel, end to end

Start with an official booking system for an eligible venue or an opted-in WhatsApp partner. Capture one bounded customer mandate, prepare the exact request, ask only for required decisions, send through an authorized adapter and match the reply to that action. Include the practical human/support escalation path required below. Do not assume operational staff exists until an actual route is staffed and tested.

Acceptance: sandbox/controlled tests cover accepted, rejected, changed, delayed and duplicate replies; a timeout reconciles before retry; confirmation requires the final venue/date/time/party match; an unanswered channel cannot trigger an unchecked duplicate reservation elsewhere.

### 4. Bounded automated phone calls

Begin with a supervised pilot using consenting partner venues before allowing bounded autonomous calls. Add a properly configured telephony account and verified, permitted business calling identity. Confirm country-specific eligibility, business/address documentation, destination permissions, rental and usage charges before buying or configuring a number; no account or number purchase is authorized by this implementation. The caller identifies Unstressed and its customer mandate, checks that the person can handle the reservation, reads back date/time/party and any conditions, and records structured evidence. Use maximum duration, spending and destination limits, retry/contact limits and a defined escalation route. Authenticate provider webhooks, deduplicate events, reconcile unknown call outcomes before another channel can retry, and provide an immediate operator kill switch. Escalation requires an actually available support route, not a fictional live agent. Respect recording consent and local requirements; a provider's “call completed” event is only a telephony outcome.

Acceptance: test Ghana number reachability and noisy/accented conversation quality, refusal, voicemail, no answer, wrong venue, unclear acceptance, transferred calls and changed terms. Ambiguous speech cannot become a confirmed booking. Request written confirmation or a clear reference where appropriate, while retaining the actual evidence and uncertainty. No real call is made by this code change.

### 5. Deposits and a complete confirmed outing

Add hosted customer-approved checkout only after reservation evidence, merchant responsibilities, supported Ghana payment methods, refunds and reconciliation are ready. Track the payment and reservation independently. Handle expired holds, partial multi-stop success, changed prices, paid-but-unconfirmed and confirmed-but-unpaid cases. No Ghana Paystack card-preauthorization assumption or Unstressed stored-value wallet is part of this plan.

Acceptance: exact payee, total/currency, deposit/balance and cancellation terms are reviewed; payment authentication is customer-completed when required; server-side evidence establishes payment; no duplicate charge or reservation after uncertain outcomes; a real support route owns unresolved cases.

## Next adapter architecture

1. **Discover supported contact and availability.** Use venue-sourced channels and an explicitly supported provider integration. A general website is not a booking endpoint; a public telephone number is not evidence of WhatsApp opt-in. Return the source, retrieval time, channel, capability and any unknowns. Do not invent contact addresses, availability, prices or capacity.
2. **Prepare the exact action.** Bind venue, occurrence, date, venue-local time and zone, party, request text, recipient, channel, personal data, price/currency, cancellation terms and the next execution step to an immutable version. A customer mandate can cover a clearly scoped action, but material changes invalidate it. Approval to copy/open/call does not authorize sending or spending later.
3. **Persist before sending.** Use an owner-scoped durable action ledger and a stable provider idempotency key before network execution. Separate each operation (availability, request, modification, cancellation, payment) and its permissions. Do not hold a global file-store transaction open across provider network work.
4. **Classify the response honestly.** A request accepted for processing is `submitted_awaiting_response`, not confirmed. A timeout or disconnected browser after submission is `submission_unknown`. Reconcile against provider records or correlated replies before retrying. Only matched authoritative evidence can establish `provider_confirmed`; model interpretation alone cannot.
5. **Track replies and changes.** Authenticate webhook signatures, deduplicate events and correlate them to the provider booking/action ID. Incoming content is evidence, not new customer authorization. Escalate changed prices, deposits, timing, terms or important uncertainty for review. A removal from the itinerary does not cancel the provider booking.
6. **Keep payment independent.** A successful payment is not a reservation confirmation; a reservation confirmation is not proof of payment. Track payment reference, verified amount/currency, recipient, state and refund state separately. Handle paid-but-unconfirmed and confirmed-but-unpaid cases explicitly. Never save card data in the booking record.

Suggested execution lifecycle: `prepared` → `awaiting_approval` → `submission_pending` → `submitted_awaiting_response` → `provider_confirmed` or `provider_rejected`. `submission_unknown` interrupts the path until reconciliation. Modifications, cancellations and refunds are their own actions, not edits to historical evidence. These execution states are a design contract, not a claim that this release implements them.

## Concrete channel path, researched 8 November 2026

Prioritize booking systems, opted-in WhatsApp and phone for fast fulfillment. Email is a fallback for venues that require it or for written details, not the primary path for time-sensitive requests. Choose the fastest supported channel within the customer mandate; an unanswered request on one channel does not authorize a duplicate reservation on another.

- **Official reservation providers first.** [Bistro 22's own site](https://www.bistro-22.com/) links to its [SevenRooms booking form](https://www.sevenrooms.com/reservations/bistro22kitchenbar). This verifies a venue-specific booking destination, not permission to use a private partner API or proof of inventory. Seek provider/venue integration access; where permitted, a supported browser flow can use the same reviewed details. Respect the provider's terms and required customer interaction.

- **Partner WhatsApp where consent supports it.** Zen Garden also publishes WhatsApp/telephone options. Under the [WhatsApp Business policy](https://whatsappbusiness.com/policy/), business-initiated contact requires recipient opt-in and an approved template where applicable. Publication of a number alone does not satisfy opt-in. Build an opted-in venue partner route or an explicitly supported user-initiated flow; do not send unsolicited template traffic.
  - Before launch, provide a prompt, clear escalation path in the automated WhatsApp conversation. Supported options can include transfer to a human agent, a staffed telephone/email route, web support, an in-store route or a support form. Publish only channels that actually work, with truthful hours and expected response time. A request to speak to a person must not loop through automated replies. If no operator or support route is available, say so and do not imply a live human is waiting; staffing and the handoff process are a release gate, including automation inside the 24-hour service window.
- **Bounded telephone fallback.** A future calling adapter needs an authorized telephony provider, truthful identity, permitted destinations, consent handling, a bounded script and clear escalation. Do not invent a transcript or claim a call answered. Confirmation still requires the agreed venue details and correlated evidence. This release does not make calls on the customer's behalf.
- **Email with reply correlation.** [Zen Garden's site](https://zengardengh.com/) publishes contact options, including email. A future email adapter needs an authorized sending identity, a verified recipient, a customer-approved payload and a correlated inbound path. A sent email remains awaiting reply. An unauthenticated or ambiguous response cannot become a confirmed booking without review.
- **Do not use Ghana two-way SMS as the default reply path.** [Twilio's Ghana SMS guidance](https://www.twilio.com/en-us/guidelines/gh/sms) does not support two-way SMS. Choose a supported inbound channel rather than assuming SMS replies will arrive.
- **Hosted Ghana payments, not assumed holds.** A future Paystack Ghana integration should use an appropriately configured merchant's hosted checkout and server-side transaction verification. [Paystack's preauthorization guidance](https://support.paystack.com/en/articles/10450882) limits its card-hold offering to South Africa; do not design Ghana bookings around authorization/capture holds. Verify supported payment methods, account eligibility, settlement and refund capabilities before enabling an adapter. No merchant account, credentials or payment flow is created by this change.

These examples guide adapter selection; they do not authorize contact with these venues or establish current availability. Provider access, commercial terms, sending identity, inbound security and customer approval handling remain release gates.

## Required evidence before enabling execution

- Verified ownership and access isolation across account plans, shared-day links, Circle views, guest state and copied plans.
- Exact payload review, stale-plan and stale-approval rejection, repeated-stop isolation, and no authority restored by undo.
- Idempotency under duplicate clicks, worker restarts, webhook replay, concurrent changes and network ambiguity.
- A recorded customer decision for the exact consequential action, with appropriate data-sharing, spending and terms scope.
- A tested provider sandbox or equivalent non-production contract for accepted, rejected, delayed, duplicate, unknown and changed-detail outcomes.
- Separate payment verification, duplicate-charge protection, reconciliation and refund handling before any paid action.
- Operational ownership for unresolved replies, failed callbacks and paid-but-unconfirmed cases. Do not leave an ambiguous external action hidden behind a success message.

Schedule feasibility, full outing costs and broader Circle recovery remain subsequent product work. They are not implied by travel estimates or booking preparation.

### Website contact comparison (read-only)

Venue contact panels now offer an explicit **Check website contacts** action. This compares source evidence from the provider-linked website, with source URLs and check time. It does not independently establish that a website is official. Only explicit published links/structured telephones are extracted; mixed branches and weak identity cues remain manual review. Different numbers can be alternate departments, and local numbers are never converted using an inferred country prefix.

This is a source-comparison step before human verification, not an execution adapter. It leaves reviewed booking snapshots, contact handoffs, permissions and capability flags unchanged. WhatsApp publication does not imply opt-in. Reservation links do not imply API access or live inventory. Future communication still needs an authorized sender, venue identity review, explicit customer mandate, supported provider integration and the reply/reconciliation safeguards above.
