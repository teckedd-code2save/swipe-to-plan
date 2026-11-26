# Reservation submission boundary

Unstressed currently prepares details and lets people continue on the venue’s
site or through a manual contact route. Preparing, opening a contact route, and
a user-entered report do not count as submitting or confirming a reservation.
Live approval, dispatch and confirmation remain disabled in the public app.

## Internal synthetic acceptance path

The synthetic driver reuses the saved-plan execution ledger and the durable,
single-writer account store. It is not exposed over HTTP, does not read credentials,
does not open browsers or contact venues, and refuses non-`.example` recipients.
Run `node --test backend/test/execution-ledger.test.js backend/test/synthetic-reservation-driver.test.js`.

1. Prepare, review and approve the exact immutable snapshot, which binds the
   owner, plan revision, venue and recipient, date, local time, timezone, party,
   message, limited personal fields, terms, total cost and expiry.
2. Reserve and claim a single dispatch in one durable transaction. The approval
   is consumed; replayed or concurrent commands cannot claim this action again.
   An unresolved action also prevents a competing submission for that venue out
   of another saved day in the same account.
3. A matching, authenticated synthetic acceptance is stored as awaiting
   response; only a separate affirmative confirmation changes that state to
   confirmed. These are synthetic ledger states only, not booking evidence.
4. Treat a missing response after the claim as uncertain, not failed. A restart
   retains the duplicate block. Reconcile evidence before any replacement;
   do not automatically retry a write or infer confirmation from an accepted request.

## Before enabling a real provider

Use a documented booking API only after explicit venue authorization, provider
approval where required, and verification of the exact location, terms, fees,
permission scopes and supported recovery behavior. Keep credential values
server-side. Never replay a third-party website’s private calls, use the generic
preview browser to submit, or click through anti-bot challenges.

[Wix Create Reservation](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/create-reservation)
is a candidate, not a configured integration. Authenticate with a venue-authorized
identity at the specific reservation location. Wix distinguishes `REQUESTED`
(venue approval still required) from `RESERVED` (confirmed). Respect the venue’s
availability/approval rules and never override conflicts or force a status.
Obtain authenticated matching evidence after a lost response rather than
re-submitting. Webhook verification, duplicate event handling, status mapping,
fee/payment boundaries and a rollout check in a venue-authorized test setup
remain required before real dispatch.
