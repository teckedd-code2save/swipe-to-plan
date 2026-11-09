# Limited native account pilot: Expo Go acceptance

Prepared 2026-11-09. This is an operator/device checklist, not permission to activate a pilot or evidence that any step passed. Record actual outcomes below. Do not run sign-in or account actions while prerequisites are unresolved.

## Current status and scope

- The existing production origin is `https://unstressed.serendepify.com`. Release `c2a939b0d5642a7d112579c2367e701c9e3054ce` deployed with native authentication disabled. The pilot is separate follow-up work and needs its own exact release/CI verification.
- Reuse the existing Google client/callback and account store. Do not create another OAuth client, copy credentials, register a new callback, import production accounts elsewhere or provision staging for this plan.
- The proposed separate staging hostname was not usable at the earlier checkpoint. Do not fall back to it or silently change origins.
- The native pilot requires a reviewed private allowlist of **existing account IDs**, a monotonically increasing integer policy epoch, and an explicit deadline no more than 24 hours away. These are backend safeguards, not public Expo environment variables. Actual account IDs, tokens and approval codes must not appear in Git, screenshots, shared notes or logs.
- Keep `NATIVE_AUTH_ENABLED=false` until the exact limited policy, release, selected account/device, window and activation action are approved. Never enable a flag without the reviewed pilot restriction. A successful pilot does not authorize global native access.
- Initial acceptance starts with read-only account/plan comparison plus sign-in cancellation, lifecycle and logout. The default policy mode is `read-only`. An already explicitly approved bounded sync test can start in `account-sync`; there is no mandatory separate release ceremony. If an active read-only policy is later expanded, use the reviewed higher-epoch policy and fresh device approval rather than upgrading an existing token. Signing in itself creates a temporary native session and requires the user's explicit device approval. Profile changes, circles, invitations, provider requests and saved-plan writes are not part of initial comparison.
- The Mac was offline during preparation. The initial branded guest app was opened on a physical Android device; a later emulator loaded native JavaScript. Neither is expanded-screen or account-pilot acceptance.

## Gates before a device session

1. Verify the exact reviewed pilot commit/image and its full checks, including independent policy/expiry review. Ensure missing/invalid policy fails closed, old epochs cannot revive sessions, denied accounts cannot obtain access, and native denial happens before provider work. Preserve web cookie/Origin protections, guest behavior, one durable writer and the existing callback.
2. Obtain the explicit approval naming this production origin, the user's existing account, selected device, bounded time window, permitted initial read-only operations and eventual deactivation. Resolve the account through the existing secure operator process; do not ask for credentials in chat or put IDs in public app configuration.
3. Have the approved operator apply only the reviewed pilot controls through the authorized route. Check its actual effective state and expiry without printing secrets or account lists. Mere deploy success is not evidence of pilot activation. Do not perform ad hoc shell or OAuth changes from this checklist.
4. Confirm the development computer is online, the chosen device is available and both can reach the same trusted LAN. Use the exact tested source and Node 24 LTS. Preserve all existing device storage. Do not uninstall Expo Go, clear app storage or overwrite `.env`/private data just to refresh the source.
5. Check the supported Expo Go build for SDK 58 on each target OS. Android official route: https://expo.dev/go?device=true&platform=android&sdkVersion=58. If the installed iOS/Android Expo Go is incompatible, record the exact blocker and use an approved supported device/development-build route. An export is not native compilation, signing or a store release.

## Exact public-origin launch

From the reviewed repository root, with dependencies installed from its lockfiles:

```sh
npm ci --prefix backend
npm run mobile:setup
npm run mobile:check
```

These are local checks, including synthetic loopback account fixtures. Where external Expo compatibility lookup is unavailable, use the documented offline check and record its warning rather than claiming online validation:

```sh
CI=1 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 npm run mobile:check
```

Stop the old Metro process. Start this source with an explicit public origin and dotenv loading disabled for this command, so an old staging `.env` cannot choose the server:

```sh
EXPO_NO_DOTENV=1 \
EXPO_PUBLIC_API_ORIGIN=https://unstressed.serendepify.com \
npm --prefix mobile run start:go -- --clear
```

This starts Expo Go's LAN preview. It does not enable native authentication or configure the backend. Do not add a secret, account ID, bearer, cookie or approval code to any `EXPO_PUBLIC_*` variable. Keep Metro running and the computer awake; scan the newly displayed QR on the chosen device. Do not assume an old QR or cached JavaScript is current. Close/reopen the preview and verify the visible origin before signing in.

On **Account** and **Account and app information**, expect **Production server** with exactly `https://unstressed.serendepify.com`. Other origins show a persistent **Non-production server** notice. Stop if the origin differs, the expected UI is absent or a certificate warning appears. The notice identifies the destination only; it does not prove policy isolation or availability. The About browser button opens this configured origin only when pressed.

The same Expo project can retain its device-local guest draft, saved outings and circles across an origin change. They are not proof of cloud sync. Do not generate a plan, refresh provider details, upload a local snapshot or choose **Save copy** during read-only acceptance. The app's Account tab is the cloud view; Saved/Circles tabs are separate unencrypted device storage. During a read-only session, the device-library tabs are set aside and the Plan tab is a read-only account snapshot. Signing out restores the unchanged guest draft and device-library navigation.

## Initial acceptance: read-only account comparison

Run each case on the approved platform/device. Mark pass/fail/blocked/not run separately. Do not capture the user's identity, cloud content, bearer, PKCE proof, cookie or approval code in the record.

1. **Before activation / disabled:** Account reports native account access unavailable and browser continuation is disabled. **Check account availability** can recheck without restarting Metro. A network error must stay an error; do not switch to production/staging automatically to make it pass.
2. **Sign-in and cancellation:** After approved activation, recheck availability. Choose **Continue in browser** yourself. Verify the initial and returning Unstressed browser origin is the exact production origin; Google's existing sign-in page is an expected intermediate destination. Verify the intended existing Google account and matching eight-character code in the app/browser before explicitly approving. Never approve someone else's link or code. Return to the same app. Separately dismiss the browser/cancel from the app and confirm no late success restores the cancelled session. Test repeated taps and Android Back/iOS dismissal without introducing another account.
3. **Read-only comparison:** Open Account. Compare the existing account's plan count, selected plan title and revision against its web account without editing either. In read-only mode, choose **Open read-only plan** and verify the separate in-memory snapshot without replacing the guest draft. In account-sync mode, review the replace-draft confirmation before opening the same plan; do not edit it during initial comparison. If there are no saved plans, record the empty state as passed and existing-plan comparison as blocked. Do not invent a fixture, call providers or create a plan to fill the gap.
4. **No accidental mutation:** In read-only mode, verify profile/circle/invitation mutation controls are disabled, no chat/replan/provider-refresh or local-copy action is offered, and the read-only notice is clear. In account-sync mode, open then cancel edit/plan dialogs only within the approved scope. Do not submit profile edits, invitation responses, sends, withdrawals, circle membership actions, **Save copy**, replanning or venue refresh during initial comparison. If a UI path would require an unapproved action, stop that case and mark it blocked.
5. **Lifecycle and navigation:** Background/resume, temporary airplane mode, keyboard dismissal, Android Back, small screen/large text and TalkBack/VoiceOver. Errors must be visible; stale/private data must not cross logout, cancelled actions or identity changes. Do not treat a pending read as a reason to retry a mutation. Return from the system browser without an unexpected duplicate approval.
6. **Logout and restart:** Sign out of this app while online and confirm its private views close and the earlier guest draft returns. Browser sign-in should remain independent. Force-quit/reopen the app: no native session should restore from disk. If server revocation cannot be confirmed, record that warning rather than claiming a revoked token; explicit logout or expiry is still required on the server.
7. **Deadline/policy end:** Observe behavior at the approved end time or operator-driven pilot shutdown. Access must fail closed, the expired private preview/session must clear at its issued deadline or when returning from OS-paused background execution, and expired native planner requests must not silently become guest requests. If a full expiry window was not observed, mark it not run; automated clock tests do not make it a real-device pass. Do not change the device clock or re-enable an old policy to simulate success.

## Separate gate: one explicitly approved synthetic outing

After the initial read-only comparison, proceed only if the exact provider-backed outing, account save and bounded provider use are explicitly approved and the issued mode is `account-sync`. That approval may be obtained up front with the pilot. Do not request another rollout merely because read-only comparison finished. If the existing issued mode is read-only, the reviewed higher-epoch policy and fresh device approval are required for expansion:

- Specify the approved test area, activity, number of requests and which existing account will own the result. No invitations, contacts, payments or bookings are implied. Use non-sensitive synthetic brief content, not invented provider evidence or imported saved snapshots.
- Confirm reviewed pilot/provider controls cover these operations before proceeding. Do not bypass them through a loopback port, alternate origin or guest fallback.
- Generate the approved outing once. Confirm an authoritative server-saved plan ID/revision in the account UI, then compare the same saved result on the web. Record only the outcome/revision, not account data. An existing plan read is not proof that new writes/sync work.
- Revision-conflict edits, a second account, shared/circle plans and invitation acceptance each require their own approved scope and suitable identities. If unavailable, mark blocked. Do not send a real invitation merely to demonstrate the screen.
- Stop when the approved request budget or test window ends. Preserve the user's existing plans. Cleanup or deletion of a synthetic saved plan requires explicit approval and normal recovery semantics; rollback is not account-data cleanup.

## Closure and evidence record

The approved operator ends the pilot using the reviewed disable/retirement path. Verify rejection after shutdown and record the epoch/deadline outcome without exposing private policy contents. Client logout clears that client's memory; only the server's reviewed revocation/expiry behavior establishes when old access is unusable. Never use deleting state, clearing journals or rolling back the image as a substitute for session retirement.

For each session record:

- Reviewed commit/image, public API origin, date/time, platform/OS/Expo Go version and device class.
- Approved scope/window reference, without names, account IDs, tokens, cookies or codes.
- Each case: passed, failed, blocked or not run; concise expected/actual behavior.
- Existing-plan comparison versus newly generated/saved-plan acceptance as separate outcomes.
- Accessibility/lifecycle cases actually observed and any screenshots only after safe redaction.
- Actual pilot shutdown, logout/revocation result, unresolved blockers and next decision.

No acceptance cases have been performed from this checklist as of its preparation. Native compilation/signing, app-store readiness, long-lived refresh sessions and general production enablement remain outside this pilot.
