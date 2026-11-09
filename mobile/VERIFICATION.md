# Verification record

## Current release evidence, 2026-11-09

- Production release `c2a939b0d5642a7d112579c2367e701c9e3054ce`, tree `3373817442c0f3cabbbdeeec3324f2c25b3934a4`, merged PR #20, passed remote CI and deployed. The release ran 631 backend, 409 frontend and 88 mobile tests, TypeScript and native exports. Native authentication remains disabled. This records the completed release/CI verification; no live request was made during the mobile documentation update.
- The initial branded guest app was opened by the user on a physical Android device. A later Mac-hosted Android emulator loaded native JavaScript. Neither event is acceptance of the expanded native guest screens or the complete account/system-browser journey. The Mac was offline during this follow-up.
- Native account sessions, cloud plans, account circles and in-app invitations are implemented and covered by synthetic local integration tests. No real native Google sign-in, account mutation, invitation or full cross-device sync acceptance has been performed.
- Separate staging preparation was local only. The recorded public DNS lookup for the proposed staging hostname returned NXDOMAIN on this date. The later direction is to reuse the existing production Google configuration/callback for a reviewed limited, time-bound account pilot. Preparation and this checklist do not activate that pilot or globally enable native authentication.
- See `ACCOUNT-PILOT-CHECKLIST.md` for the gated Expo Go launch and acceptance record. Real-account read-only comparison must precede any specifically approved synthetic outing. Backend pilot isolation, activation authority and the selected device/account remain prerequisites.

## Local destination-clarity follow-up, 2026-11-09

- Added an exact public API-origin notice to Account and app information, plus a persistent non-production banner. It does not certify that an alternate server is working, isolated or provider-enabled.
- Corrected the app-information browser link to use the configured API origin, only after the user presses it. Production remains the default. Native and browser authentication boundaries are unchanged.
- Account availability can be rechecked after a disabled result. Disabled account copy no longer promises guest planning on an accounts-only server.
- Issued exchange mode stays memory-only. Missing/unknown mode is read-only; public config cannot upgrade it. Read-only mode disables account mutations/planning, uses an in-memory account-plan preview without provider refresh or local-copy controls, and preserves the prior guest draft/device libraries for sign-out. Explicit account-sync mode keeps the approved bounded sync path available. An issued-deadline timer clears the private session/preview, and foreground validation covers OS-paused timers; cancelled old timers cannot clear a newer session. Independent review also reproduced a cancelled sign-in's delayed profile response resetting a newer login; the reset is now scoped to the original sign-in epoch, with delayed success, HTTP 401 and network-failure regressions.
- Local TypeScript and all 104 mobile unit/HTTP-contract tests passed, including seven destination-label/wiring regressions, eight session-mode/wiring checks and a real local Express read-only session test. Android and iOS Hermes exports passed. The native-component web export also passed as a bundling check, not visual acceptance. Expo dependency validation passed against installed SDK metadata with `EXPO_OFFLINE=1` and its explicit reliability warning. No remote compatibility lookup, live API request, native compilation, screenshot, device interaction or pilot activation was performed in this follow-up.
- Tests used the matching mobile lockfile's existing local dependencies. The 104-test run was repeated on the clean production-pilot branch with its restricted backend and synthetic existing Google-linked test identities; no staging infrastructure code was transferred. Source-wiring assertions are not native UI rendering or accessibility tests. Final integrated release checks/CI and real-device acceptance remain separate gates.

## Historical record: first native planning slice, 2026-11-09

The following entries preserve the original checkpoint, before the expanded account implementation and released CI integration. Its “not run” and “next” statements describe that checkpoint, not the current release. This is implementation evidence, not a signed-app release or device acceptance certificate.

### Passed at the initial checkpoint

- TypeScript UI check.
- 26 mobile unit/contract tests: public guest headers, clean API origin, timeouts/cancel, split UTF-8 NDJSON, incomplete streams, request epochs, serialized save/clear, malformed drafts, preserved occurrence identity (including repeats and unavailable selected visits), independent evidence for alternatives, stable people IDs, coarse location, destination timezone and existing Express integration.
- iOS and Android Hermes exports through Expo SDK 58 / React Native 0.88.1. These compile JavaScript bundles, not native binaries.
- Existing repository lint, 1,028 backend/frontend tests (619 + 409), and production web build. Baseline reconciled with deployed release `2478598cfc0fb57b8b24c1f6336d47c00ab6a49d`, tree `245034294eb0d3c673208f69c66a5c897914577e`.
- Independent code review. Evidence attribution, unresolved selection preservation, guest profile identity, boundary validation, contract bounds and destination-date findings were fixed and regression-tested. Final review found no residual code blocker.
- One bounded live API smoke through the mobile guest transport after the web release cutover: searched the provider's returned Osu/Accra area, requested one coffee stop with empty tastes and no allowance, received one discovery event and a valid completed Qloo result (Moka's Resto Cafe). No cookies, private account data or account save were involved. This validates the shared API contract, not iOS/Android networking on a device.
- Web-renderer export succeeds as a developer layout aid. It is not a WebView app or a replacement web product.

### Limits / not run at the initial checkpoint

- No native simulator/emulator or physical-device session. Native compilation, installation, signing, keyboard/focus, screen readers, large text, Android Back, actual foreground permission flow, background/resume, OS termination/restore and Maps return still need device acceptance.
- Visual browser smoke could not load the local preview server across isolated tool-session networks (`ERR_CONNECTION_REFUSED`). No application screenshots were captured. No production browser tab was changed.
- Expo's remote React Native Directory compatibility request timed out behind the environment proxy. Dependency compatibility was checked against the SDK's bundled versions with offline mode; that command passed with the expected offline reliability warning. This is not a full online Expo Doctor audit.
- No EAS project/account/credential creation, cloud build, paid simulator, deployment, app-store submission or native sign-in setup.
- Native account sync, invitations, calendars, embedded maps, notifications, booking submission and payments remain out of this first guest-planning slice. Existing web features remain intact.

### Device acceptance planned at the initial checkpoint

1. Install a development build on iOS and Android. Use the real configured API.
2. Search a manual area, close/reopen the picker, review a solo brief, send a chat clarification and create an actual plan.
3. Deny location and continue manually; then test an explicit permitted one-shot fix. Confirm no background permission request.
4. Interrupt a stream with Stop, backgrounding and airplane mode. Confirm last completed places remain and old results never replace a newer draft.
5. Replace, move, remove and undo a repeated visit; test an unresolved selected visit. Confirm untouched identities and evidence stay correct.
6. Kill/reopen after a completed draft, clear it, reopen again and verify no old draft returns.
7. Check small-screen/large-text layouts, VoiceOver/TalkBack, keyboard composition, modal Close/Back and Maps-return navigation.
8. Implement/review proper native account sessions before enabling account features. Never relax web Origin/cookie protections to accommodate mobile.
