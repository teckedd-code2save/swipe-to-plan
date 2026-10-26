# An outing companion, through the decision

Unstressed should reduce the work between a wish and an outing. The conversation, taste swipes, people, spending, shortlist, menu preferences and route belong to the same planning state. A successful search is the start of decision support, not the end of the experience.

## Implemented foundation

- Radix Themes supplies shared cards, controls, typography primitives and menu selection controls. Manrope is the reading/interface face; Fraunces is reserved for expressive headings. Fonts are bundled, not requested from a third-party font service.
- One venue card serves selected stops, alternatives, chat shortlists and direct Qloo results. It has no implicit timeline column. Results use the available height on narrow screens.
- Suggested spending is distinguished from a user-set limit and from actual venue prices. Amount editing applies on blur or Enter; relevant spending preferences remain visible.
- Menu/comparison surfaces include the shortlist, not only selected stops. TanStack Query caches venue evidence per entity and exposes loading and retry states. Venue menu, website, phone and directions links are visible where available.
- The agent receives bounded option evidence and venue-specific menu preferences. A validated `select_places` action applies an existing result or ordered route without asking the customer to repeat it in a form. IDs must belong to the current options; the application revalidates them against the current shortlist.
- An ordinary mention of friends no longer forces profile entry before the agent can plan. Circle selection remains an identity decision, handled using supplied saved circles.
- Practical follow-through remains available beside the conversation and on the results surface.

## Evidence boundaries and unfinished work

Qloo relationships support discovery and taste reasoning; descriptions and relative price bands are not verified current menus, prices, capacity or accessibility. The current venue integration does not supply itemized prices. The UI therefore cannot honestly calculate an exact bill or savings. Priced-menu ingestion and freshness checks remain unfinished, as does automatic reconciliation of live route times with the schedule. A Maps link does not provide those results back to Unstressed.

Menu picks are outing preferences, not orders. Venue choices are planning edits, not bookings. Neither sends an external message. Do not claim the broader product rebuild is complete merely because the shared foundation is deployed.

## Verification for this change

Frontend unit tests cover inclusion of alternatives, budget provenance, unknown/overnight hours, and bounded agent option evidence. Backend tests reject fabricated and duplicate venue IDs. Browser interaction checks at 390, 768 and 1440 CSS pixels exercise full-width cards, budget editing and saved menu picks using synthetic fixtures. These are responsive component checks, not proof of every live provider or signed-in circle journey.
