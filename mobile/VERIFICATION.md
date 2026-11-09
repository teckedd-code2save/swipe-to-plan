# Verification record

First native planning slice, 2026-11-09. This is implementation evidence, not a signed-app release or device acceptance certificate.

## Passed

- TypeScript UI check.
- 26 mobile unit/contract tests: public guest headers, clean API origin, timeouts/cancel, split UTF-8 NDJSON, incomplete streams, request epochs, serialized save/clear, malformed drafts, preserved occurrence identity (including repeats and unavailable selected visits), independent evidence for alternatives, stable people IDs, coarse location, destination timezone and existing Express integration.
- iOS and Android Hermes exports through Expo SDK 58 / React Native 0.88.1. These compile JavaScript bundles, not native binaries.
- Existing repository lint, 1,028 backend/frontend tests (619 + 409), and production web build. Baseline reconciled with deployed release `2478598cfc0fb57b8b24c1f6336d47c00ab6a49d`, tree `245034294eb0d3c673208f69c66a5c897914577e`.
- Independent code review. Evidence attribution, unresolved selection preservation, guest profile identity, boundary validation, contract bounds and destination-date findings were fixed and regression-tested. Final review found no residual code blocker.
- One bounded live API smoke through the mobile guest transport after the web release cutover: searched the provider's returned Osu/Accra area, requested one coffee stop with empty tastes and no allowance, received one discovery event and a valid completed Qloo result (Moka's Resto Cafe). No cookies, private account data or account save were involved. This validates the shared API contract, not iOS/Android networking on a device.
- Web-renderer export succeeds as a developer layout aid. It is not a WebView app or a replacement web product.

## Limits / not run

- No native simulator/emulator or physical-device session. Native compilation, installation, signing, keyboard/focus, screen readers, large text, Android Back, actual foreground permission flow, background/resume, OS termination/restore and Maps return still need device acceptance.
- Visual browser smoke could not load the local preview server across isolated tool-session networks (`ERR_CONNECTION_REFUSED`). No application screenshots were captured. No production browser tab was changed.
- Expo's remote React Native Directory compatibility request timed out behind the environment proxy. Dependency compatibility was checked against the SDK's bundled versions with offline mode; that command passed with the expected offline reliability warning. This is not a full online Expo Doctor audit.
- No EAS project/account/credential creation, cloud build, paid simulator, deployment, app-store submission or native sign-in setup.
- Native account sync, invitations, calendars, embedded maps, notifications, booking submission and payments remain out of this first guest-planning slice. Existing web features remain intact.

## Device acceptance next

1. Install a development build on iOS and Android. Use the real configured API.
2. Search a manual area, close/reopen the picker, review a solo brief, send a chat clarification and create an actual plan.
3. Deny location and continue manually; then test an explicit permitted one-shot fix. Confirm no background permission request.
4. Interrupt a stream with Stop, backgrounding and airplane mode. Confirm last completed places remain and old results never replace a newer draft.
5. Replace, move, remove and undo a repeated visit; test an unresolved selected visit. Confirm untouched identities and evidence stay correct.
6. Kill/reopen after a completed draft, clear it, reopen again and verify no old draft returns.
7. Check small-screen/large-text layouts, VoiceOver/TalkBack, keyboard composition, modal Close/Back and Maps-return navigation.
8. Implement/review proper native account sessions before enabling account features. Never relax web Origin/cookie protections to accommodate mobile.
