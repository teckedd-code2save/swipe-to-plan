# Native preview validation

## Release reconciliation and current acceptance plan, 2026-11-09

The records below describe earlier local preparation. They are retained as history, not current claims that the backend/CI never shipped. Production release `c2a939b0d5642a7d112579c2367e701c9e3054ce` (tree `3373817442c0f3cabbbdeeec3324f2c25b3934a4`, merged PR #20) passed remote CI and deployed with native authentication disabled. Its checks included 631 backend, 409 frontend and 88 mobile tests, TypeScript and iOS/Android exports.

The current mobile destination-clarity follow-up has 104 local passing tests plus TypeScript, offline SDK metadata validation and both native exports. It corrects the configured-origin browser handoff, visibly identifies non-production servers, and enforces the issued read-only/account-sync session mode in memory. Synthetic local Express fixtures exercise both modes. See `VERIFICATION.md` for scope and limits. No real native sign-in, account mutation or device acceptance was added by those checks.

The current acceptance plan is a reviewed, limited and time-bound production account pilot using the existing Google configuration/callback, not a new staging setup or global native enablement. `ACCOUNT-PILOT-CHECKLIST.md` separates read-only comparison from the later explicitly approved synthetic-outing gate. The Mac was offline, so no preview update or new device acceptance was performed. The earlier Android emulator loaded native JavaScript but did not establish visual or account-journey acceptance.

## Historical account and invitation increment, 2026-11-09

At this checkpoint, the increment was implemented in an isolated cloud worktree from the exact version 2 Mac source archive. It had not yet been deployed or copied back to the offline Mac.

- TypeScript: passed.
- Removed empty-string conditional children from native View/ScrollView containers after Mac preview warnings; boolean guards prevent React Native Web text-node warnings.
- Mobile unit, storage, privacy, lifecycle, transport and real HTTP integration tests: 85/85 passed.
- Full backend suite on Linux: 630/630 passed, including native authentication and rate-limit regressions.
- Existing frontend tests: 409/409 passed. Root lint and frontend production build passed.
- Android and iOS Hermes exports: passed, about 2 MB each. Native-component web export also passed.
- Expo's installed SDK metadata reports dependencies up to date in offline mode. Online compatibility lookup timed out through the HTTP proxy, so this is not an online dependency validation pass. The newly added expo-crypto version was selected by Expo's compatible installer.
- Independent review and real local HTTP integration used the actual mobile session/transport and Express APIs with a temporary durable store, synthetic people/provider data and mocked Google exchange only. Covered browser login/callback, matching-code approval, single-use PKCE exchange, two account identities, ownership, server-generated plan autosave, invitations and limited recipient projection, membership revocation, stale reads, expiry, logout and guest regression.
- Fixed during review: mismatched approval-code format, expired session falling back to guest, stale confirmation dialogs crossing accounts, and private review-sheet state surviving logout. Private account views and working drafts stay in memory; returning to guest restores the prior local draft.
- Browser visual verification of the new Account screen was blocked: the cloud browser could not reach the local static preview server. Bundle compilation and unit/integration tests do not substitute for real device UI acceptance.

No actual Google sign-in, account creation, real invitation, payment, new production credential, production deployment, EAS build or store submission was performed. Native auth is disabled unless NATIVE_AUTH_ENABLED is explicitly enabled on an authorized backend. At that checkpoint, production remained on its earlier release.

## Historical pre-enable hardening, 2026-11-09

Independent release review found and reproduced route-spelling and polling problems before enablement. Express case/trailing-slash aliases now use the matched planner route identity, so invalid or expired native tokens cannot fall back to guest behavior. Proof-validated flow quotas, a separate cancellation quota and an aggregate IP guard support concurrent devices without allowing arbitrary flow IDs to create unlimited buckets. Pending polls are read-only; durable rename/fsync regressions confirm no account-file commits until real state changes. Approved exchange remains single-use and atomic.

The client retries only explicit pre-execution exchange HTTP 429, honors Retry-After with deadline-bounded backoff, remains immediately cancellable, and never retries uncertain network/5xx exchanges or account mutations automatically. Tests cover three concurrent same-IP devices, invalid proofs, abusive rotating IDs, cancellation after throttling, and approved-but-throttled flows with no token consumption. The feature flag suspends access while off; it does not permanently revoke stored sessions.

Native TypeScript/tests, dependency validation and Android/iOS exports are now a reusable CI job called by Checks on PR/main and required before the deployment job. Workflow YAML and gate structure were locally checked; no remote CI run, push or deployment occurred. The online Expo check remains blocked by a proxy timeout; the offline aggregate passed using installed SDK metadata, with its reliability warning retained.

## Remaining acceptance and scope

After the limited pilot implementation is reviewed and the exact device/account/window are approved, reconnect the development computer and transfer the verified source without overwriting device data. Install its compatible dependencies and restart the LAN Expo preview. Follow `ACCOUNT-PILOT-CHECKLIST.md`: begin with read-only account/plan comparison, cancellation, keyboard/Back/font scaling and lifecycle tests. A synthetic outing, profile edits, circle changes and invitations are separate approval gates, not implied by opening an account. Never weaken web Origin/cookie checks or copy browser cookies. A successful pilot does not authorize global production enablement.

Cloud circle creation/join/member management, secure shared-day capability links/collaboration, native account deletion and store-required sign-in alternatives remain outside this increment. Persistent refresh sessions are not implemented. Circle-shared plans and in-app plan invitations are implemented. Embedded maps, complete web autopilot/taste-card UI and durable private reservation outcome UI remain separate work.

## Earlier guest preview

The user opened the initial branded native preview successfully on Android. The expanded guest slice had 64 passing native tests and successful Android/iOS bundles, and the Mac LAN manifest/development bundle returned HTTP 200. Native-components browser layout was checked at 390 x 844 for Plan, Saved, Circles, circle editor and empty Get ready. That earlier browser check is not acceptance of this new Account screen.
