# Attentive outing planning

Unstressed remains an outing companion. When someone expresses frustration, the agent should acknowledge the specific concern and suggest a relevant outing direction, then ask one useful question if their intent is unclear. It should not become a research adviser or therapist, or immediately ask for location, dates and tastes.

Mentioning a supervisor, friend or partner is not an instruction to create their profile. A clear request for a place for two people can set the party size without inventing another person's name or preferences. Explicit roster and circle requests still use the existing participant tools.

Action tools carry a bounded `message` alongside the validated action. The studio displays it with the relevant card or action, rather than discarding the context in favor of a generic response. Narrative never becomes venue evidence or a field in the shareable planning brief. The chat keeps its opening exchanges and recent corrections within a sixteen-message context window.

Guided first-plan review keeps tastes optional and visible. Adding a person through chat does not automatically open taste cards. Existing circle tastes, direct taste editing, location/currency confirmation and the explicit first-plan review remain available.

Malformed model actions get one interpretation retry before any action executes. Requirements are not silently dropped to satisfy the schema. A second invalid response fails normally.

## Validation

- `npm run lint`, `npm test`, `npm run build` cover syntax, deterministic planning, narration transport and history boundaries.
- `node scripts/evaluate-conversation.mjs` is an opt-in live-model evaluation using synthetic conversations only. It checks the research/supervisor sequence, the transition to a café plan, Autopilot, budget worries, frustration with the agent, taste edits and circles. It uses the configured local model key without printing it. Review the wording as well as the structural assertions; model responses vary.
- In the browser, replay a concern, a meeting mention and an explicit place request. Check that the first two remain conversational, the roster stays unchanged, and the accepted request reaches a review with editable tastes, location, time and allowance.

The selection/evidence fixtures use future dates so that running the suite after 11:00 does not accidentally test the separate past-start scheduling guard. Scheduling tests still explicitly cover past times and destination-local dates.

## Nearby planning and the composer

“Plan near me” on the welcome screen, the area card’s current-location button, and an explicit nearby chat request offer a one-shot browser location lookup. The browser asks permission. The client rounds coordinates to two decimal places; the no-store POST endpoint validates and rounds again before calling Qloo’s documented `/search` locality/distance filters. Coordinates are neither cached nor added to model context, accounts or shared plans. Only the chosen named locality is kept, with its currency/time zone and the existing per-plan/default choice. Denied, inaccurate, timed-out and empty results leave manual search available. There is no geolocation request on page load and no continuous tracking.

The Autopilot switch sits beside Send as a compass-and-spark control, with a visible active treatment and an accessible label and tooltip. Its existing on/off explanation stays in the conversation, including on mobile.

Browser checks also exposed coffee offerings incorrectly qualifying a fast-food restaurant for a café stop. Coffee stops now require an actual café, coffee shop or tea-room category; serving coffee alone is insufficient.
