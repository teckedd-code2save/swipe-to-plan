# Existing-web-account native pilot

This is local source preparation, not activation. Production Compose and candidate deployment still explicitly pin `NATIVE_AUTH_ENABLED=false`. There is no staging environment, new OAuth client/callback, credential copy, account migration, provider access grant or policy identity in this change.

Reuse the existing production Google web client, same-origin `/api/auth/google/callback`, and durable account store. The native browser approval flow uses the existing browser session and exact Origin/CSRF checks. Google OAuth requests returning to a native approval page are bound to that live native flow and pilot policy; their callback rejects new or non-allowlisted Google identities before creating or changing a web account/session. Ordinary web sign-in/signup is unchanged. It never accepts a caller-supplied Google identity. Only previously existing Unstressed account IDs with a server-stored verified Google subject can be selected for the pilot.

## Exact approval needed later

Before activation, approve the selected existing account ID(s), production origin, explicit start/deadline, permitted native capabilities and test operations, and enabling native sign-in for this bounded pilot. Explain that this permits a native device to access that account using the existing server-side OAuth integration. Do not infer permission to send invitations, edit saved plans or run paid-provider planning from permission to compare saved plans and log out. No Google Cloud callback changes or private-subject export is needed.

An approved operator must securely create `/opt/unstressed/data/native-pilot-policy.json` (container path `/data/native-pilot-policy.json`), owned by UID1000, mode0600, regular single-link file with no symlink/alias, at most8192 bytes. Never put real account IDs or policy contents into Git, public API responses or build artifacts. The file must contain exactly:

- `version`:1.
- `epoch`: positive safe integer strictly greater than the durable high-water epoch for any replacement. Failed/unknown-account policies also retire their observed epoch.
- `origin`: exact existing production APP_ORIGIN.
- `issuedAt`, `expiresAt`: integer UTC epoch milliseconds, issuedAt not future, expiry not past, at most24 hours apart.
- `accessMode`: `read-only` (also the default when omitted), or explicitly `account-sync`. Read-only permits native account GET routes and logout only; server rejects all account mutations and native planning. Account-sync permits the existing native account/profile/plan/circle/invitation APIs and native planner, but not web-only email sending, shared-day/admin routes or booking execution. It needs separate explicit approval of those operations. Changing access mode changes the policy fingerprint and requires a greater epoch plus fresh device approval; an existing token never gains broader permissions.
- `accountIds`:1–5 unique existing internal Unstressed account IDs, not emails or caller-supplied Google subjects.

The [bounded private operator helper](../deploy/native-pilot/README.md) can resolve one exact approved existing identity locally, validate an approved window/mode/epoch and atomically install only the fixed policy file. It defaults to read-only dry-run and requires an explicitly approved operator action for writing. It never exports private account IDs or Google subjects, changes credentials/Compose, activates native access or stops/starts a service. No helper execution or activation has occurred. Before any eventual activation, review the actual IDs/window and explicit Compose change while preserving the same image/storage isolation and rollback precautions. Do not change credentials or weaken browser rules.

## Enforcement and retirement

Start, browser approval, exchange and every native API request observe the current policy. Existing account IDs are bound to a hash of their server-stored Google subject at policy activation. Approval, exchange and every native session resolution recheck policy/identity linkage. Flows and tokens carry the policy epoch/fingerprint/deadline; old unbound tokens are rejected. Issued tokens expire at the earlier of eight hours or the pilot deadline.

The durable account store holds the policy high-water mark. Policy replacement, removal, malformed content or expiry observed while native auth is enabled retires the prior active flows/sessions. Removing and readding an identity requires a greater epoch; reinstalling an observed retired policy cannot revive tokens. Transient policy-read failure fails closed at capability and session resolution. Reporting unavailable through the public config endpoint waits for durable retirement, so a later restored retired policy cannot revive the token. Identical active policy reads and repeated invalid/inactive observations do not rewrite/fsync the store. Transactions preserve unknown top-level fields, including the pilot ledger, across normal account writes/reloads; older code does not erase it merely by writing another account change.

There is no file watcher. A policy edit that is reverted before any request observes it cannot be detected; perform revocation through a recorded request/config verification and confirm `enabled:false` before restoring or replacing policy. Disabling the global native feature flag alone suspends access; it is not permanent revocation, and the same still-valid policy/session can work after re-enabling. Never roll back the account store or delete the high-water ledger to regain an epoch. Image rollback to an older implementation is not a secure way to preserve pilot restrictions: keep native auth disabled when rolling back.

The public config endpoint exposes only availability, accessMode and existing timing metadata, not identities/epoch/policy contents. Invalid or absent policy reports unavailable. Native planner authorization is checked before audience/provider work; guest and web planning retain their existing behavior.

Read-only is the conservative default, not a mandatory separate rollout. If exact action-time approval covers a bounded account-sync pilot and an own-account synthetic save/edit test, the operator may configure account-sync directly and perform read-only checks first. No actual approval or configuration exists yet.

## First acceptance

After exact approval and reviewed activation, use the tester's own device and existing web account. Verify the production origin and matching approval code, compare already-saved plan IDs/revisions with the web account, then log out and verify the token is rejected. Record outcomes only, never cookie/token/verifier/policy contents. Do not create plans, send invitations, edit profiles or execute bookings merely to demonstrate sign-in. No live sign-in, account read, policy creation or production activation has been performed by this code preparation.
