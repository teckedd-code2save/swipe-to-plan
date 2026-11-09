# Selected visit roles

Venue identity and requested visit purpose are separate inputs. A café may have appeared in a meal discovery pool, but that old pool assignment must not override a later coffee-only request.

## Semantic action contract

- `select_places` carries the complete ordered `placeIds` and one requested `stopIntents` entry for each occurrence. Repeated IDs and repeated roles are valid.
- `stopIntents: null` means no requested role change. Existing occurrences retain their roles in order. Newly introduced occurrences use their existing option category.
- `edit_stops` uses occurrence IDs and an explicit role or null. Null replacement preserves the existing visit's role. Unaffected visits remain intact.
- Both actions can carry simultaneous date, time, budget, party and experience edits. Geography still uses location confirmation, and explicit naming still uses its own action.
- A missing role declaration is repaired once by the interpreter, rather than silently dropping a requested composition change.

The action returns a validated brief and ordered route. The frontend checks selected identities against current results and keeps its owner, account, local-version and shared-revision guards. It does not require the new purpose to equal an old discovery bucket. The planner then reruns provider category eligibility, exclusions, price limits and reported-hours scheduling. A requested role is never provider evidence. Unsupported or unavailable selections remain unfilled, without substitutes.

Automatic titles follow the revised composition and completed result. Custom and unmarked legacy names remain intact. Exact visits are preserved by the selected route rather than stale category pins.

## Booking preparation

Booking snapshots include each occurrence's role, including the ordered route. A role-only edit can therefore stale a reviewed enquiry even if venue and times stay the same. Staleness is sticky through Undo. Historical reports remain historical, with no external cancellation or submission.

Legacy records without role fields remain readable. Their next plan edit/revalidation conservatively requires fresh preparation; there is no read-time migration or runtime data rewrite.

## Verification scope

The regression uses the exact native-UI QA requests, synthetic provider-shaped venues and deterministic model-tool responses. It covers a venue previously offered under a meal bucket being explicitly selected as the second café, plus simultaneous timing edits, repeated IDs with different purposes, malformed roles, current hard constraints, title provenance, guest/account application and stale response guards. The production model's original tool call was not observed. Passing these tests does not establish live-model interpretation or any historical venue-loss root cause.

Run `npm run lint`, `npm test` and `npm run build`. After deployment, repeat the fresh two-café request in the rendered app and verify both roles, IDs/order, schedule, title and subsequent assistant comparison. No booking or provider action is needed for that check.
