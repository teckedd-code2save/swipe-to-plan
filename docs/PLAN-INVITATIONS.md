# Plan invitation deployment protocol

Invitation records are additive durable account data. Removing an accepted connection revokes its invitation in aware code, but legacy writers do not record that revocation. Preserving records alone cannot prevent acceptance from resurfacing after a legacy interval.

## Epoch boundary

Invitation-aware images carry `io.unstressed.plan-invitations="1"` and include `src/invitation-epoch.js`. Invitations bind to the durable epoch in `/data/plan-invitation-epoch.json`. A mismatching epoch ends access without deleting invitation history. Runtime missing or invalid epoch disables invitation access, not the whole application. Only a deliberate new send may create a replacement invitation under the current epoch. A same-revision replacement must name the exact unavailable invitation ID; original or already-committed request retries cannot create another notification after rotation.

The retained release script checks both immutable image labels. Inspection failures or unknown protocol versions abort before cutover. Missing labels identify legacy images.

After stopping the sole writer, checking recovery intents, and taking the consistent backup:

- An aware destination runs its own immutable image's helper with `ensure`. Existing valid epochs remain unchanged.
- An aware-to-legacy transition runs the aware image's helper with `rotate`, invalidating prior invitation access before legacy code can modify connections.
- A legacy-to-legacy transition does not touch the epoch.

If a new release fails, the failed writer must be conclusively stopped and recovery intents checked first. The same transition rules apply to automatic rollback. In particular, failure of the first aware release still permits ordinary legacy rollback, but only after epoch rotation succeeds. A compatible aware rollback retains the epoch.

The helper runs without networking, credentials, service ports or writable root filesystem, as the runtime user, against the existing data mount. It uses the journaled account-store durability primitives. Helper failure, recovery uncertainty or failed label inspection leaves the writer stopped and does not launch a fallback. Preserve the data and reconcile with aware tooling before retrying. Pre-cutover backup failure can still resume the unchanged original writer without rotating anything.

## Supported deployment boundary

Use the CURRENT retained guarded release tool for all releases, including old image targets. This protocol does not make old deployment tooling safe. The GitHub workflow copies release tooling from its checkout; rerunning an old workflow/checkout that replaces the retained guard is an unsupported downgrade. Direct Docker launches also bypass this safety boundary. Revert application changes through reviewed current tooling, rather than restoring an old release script.

This is an invitation-specific revocation boundary, not a schema migration or data restoration. A supported rollback preserves the rest of the application and durable records. Restoring stale account/epoch backups or bypassing the release tool is outside this guarantee.

## Built-image CI check

Pull-request CI and the release workflow run `deploy/smoke-invitation-epoch.sh` after building the final runtime image. The release workflow requires it to pass before registry publication or deployment. The script resolves the built tag to its exact local image ID and checks the invitation protocol label and configured non-root runtime user.

The image runs without networking, credentials, ports, host mounts or persistent volumes, with a read-only root and a disposable `/data` tmpfs. It executes the packaged helper CLI to verify initial ensure, repeated ensure, rotation, post-rotation ensure, private file permissions and journal cleanup. This checks packaging and runtime execution without touching production data. Actual Docker execution occurs in approved CI; mocked local script tests do not establish that result or validate a production host filesystem.

## Local verification

`node --test backend/test/release-guard.test.js` runs the actual release script with isolated command mocks. Tests cover manual and automatic legacy transitions, compatible rollback, exact helper image and restrictions, ordered stop/backup/epoch preparation, failed inspections/helpers, unchanged original-writer resume, and the existing intent, filesystem-probe and storage-isolation guards. These tests do not deploy or access production data.

## Product and privacy boundary

Add changes only the planning roster. People remains open after Add and shows a named Invite action. It stays disabled until the updated day is durably saved and no edit, failed refresh, or shared bearer-day session is active. The confirmation identifies the person, title, chosen date and exact saved revision. Invitations never originate from a recalculation alone. Account offers the same manager and a small unread inbox badge.

Only mutually accepted account connections are eligible, verified server-side. A legacy guest name is not an account identity. No circle-wide sharing is added by this feature. Existing deliberate circle shares remain an independent permission: declining a person-specific invitation does not revoke an already-authorized circle share, and the manager says so when relevant.

Before acceptance, the inbox includes only organizer name, plan title, date when confirmed, revision and invitation state. Interested or Going atomically grants the exact immutable read-only itinerary projection. It contains only title/date/area/time zone and selected stop IDs, category, public name/address and confirmed suggested times. It never returns the saved request, roster, preferences, spending profiles, taste graph, explanations, warnings, contact/booking records or unrelated revisions. The recipient view is separate from the planner, its model context, Saved days, exports, daybook and browser storage. Copying or remembering already viewed information cannot be recalled.

Available in their inbox means a committed in-app record, not delivery. Viewed is recorded only by explicit opening of the preview. Interested/Going are the recipient's choices, not verified attendance. Decline, leave, organizer withdrawal, plan deletion and loss of the accepted connection end this invitation's access. Membership removal records a terminal tombstone before a later reconnect. New saved revisions do not change the authorized snapshot or send anything. A deliberate Send update replaces the invitation, preserves the previous response as history, and requires fresh acceptance.

Repeated sends for the same plan, recipient, live lifecycle and revision return the same invitation, including terminal status. Old invitation IDs cannot accept updates. Sends are limited to 20 distinct recipients per plan, 2,000 stored recipient records per owner and 50 new invitations/updates per owner per rolling day, with a 60-second same-person update cooldown. Replacements are bounded, not an append-only notification stream. Read/unread, per-plan mute and badge preference do not grant access.

## Storage and verification limits

Invitation records live in the additive top-level `planInvitations` collection in the existing single-writer account store. Saved plans carry a lifecycle marker, preserved by new rewrites; an old writer's whole-entry rewrite drops it and therefore fails closed on re-upgrade while leaving invitation records intact. Existing accounts/plans without invitation metadata remain readable. New protocol keys are not a runtime migration. The epoch sidecar is initialized/rotated only by the quiesced release helper, with the same protected `.intent` recovery protocol.

Synthetic tests cover pre-feature snapshots, old entry replacement, failed or ambiguous invitation commits, immutable projections, unrelated identities, repeated clicks, revocation, interrupted navigation, missing or invalid epochs, and fresh acceptance after rollback. Compatibility checks use pre-feature fixtures and command-mocked release execution. These checks do not establish actual browser rendering or Docker-host behavior; approved live browser and deployment QA remain required before release.
