# Unstressed native planning preview

A real Expo + React Native app alongside the existing Vite web app and Express API. Native `View`, `Text`, `TextInput`, `ScrollView`, `Modal` and platform location APIs are used throughout. No WebView, replacement server or synthetic runtime recommendations.

## What works in this slice

- Conversation with the existing `/api/agent` endpoint as a guest or through the native account session, including clarification, location confirmation, brief changes, people edits and grounded selected-place edits.
- Manual area search and deliberate one-shot foreground location. Only rounded coordinates go to `/api/locations/nearby`; no background tracking or persisted GPS fixes.
- Structured review without requiring a model: activities, party size, optional artist/taste inputs, optional allowance/date/time and pace. Unknown allowance/timing stays unknown.
- Existing `/api/itineraries` NDJSON discovery and completed result through `expo/fetch`, with cancellation, timeout, stale response protection and visible provisional state.
- Native itinerary timeline, alternatives, swap, occurrence-aware move/remove, undo and explicit external Maps handoff. Untouched selected IDs stay selected, including unavailable visits and repeated occurrences. The server rechecks venue evidence.
- Separate device-local Saved outings and Circles screens. Explicit immutable saved copies, rename, restore, recoverable removal, per-person circle editing and application to a draft. Local circles can be resolved by exact ID in guest chat.
- Get ready with actual venue photos, reported descriptions/tags and relative price bands, selected-visit taste/allowance evidence, explicit reported-hours checks, safe contact/menu links, Maps route modes and per-leg transit links, plus selectable unsent enquiry drafts. No venue is contacted automatically.
- Serialized device-local draft/last-result restore. Chat, coordinates and account/session metadata are excluded. Interrupted work keeps the last completed plan and labels it as an older snapshot when the draft differs.

## Run

Node 22.13+, 24.3+, or 26+ is required by this Expo SDK (use Node 24 LTS). The root web/backend dependency versions and production scripts are unchanged. Install the existing backend for contract tests and the mobile package separately:

```sh
npm run setup
npm run mobile:setup
cp mobile/.env.example mobile/.env
npm --prefix mobile run start:go
```

The default API is `https://unstressed.serendepify.com`. `EXPO_PUBLIC_API_ORIGIN` is a **public origin only**, never a secret. Production builds require HTTPS. Local HTTP is permitted only in development for localhost/private-network addresses. For Android emulator local API use `http://10.0.2.2:4000`; for a physical device use the development computer's LAN origin. The current backend binds loopback by default: expose it to a private test network deliberately, not by changing production settings.

For Android, install Expo Go from Google Play, keep the phone and development computer on the same Wi-Fi, then scan the QR printed by `start:go` inside Expo Go. No Expo account is required for this LAN preview. Keep the computer awake and Metro running. The QR changes when the computer's LAN address changes.

This project uses Expo SDK 58; a matching Expo Go is required. Official install route: https://expo.dev/go?device=true&platform=android&sdkVersion=58

For a locally built development client:

```sh
cd mobile
npx expo run:ios       # requires macOS + Xcode
npx expo run:android   # requires Android SDK/emulator or device
```

`npm run ios` / `npm run android` start Metro and open an already available target. `eas.json` has development, internal-preview and simulator profiles, but no EAS project/account has been created or linked. App identifiers are proposed local configuration, not a claim of registration or signing. No cloud build, payment, deployment or store submission was performed.

For a web-renderer layout preview only, `npm run web`. This is a development aid for native components, not the existing web product and not native acceptance testing. The production API does not grant that separate browser origin CORS access. Do not weaken browser protections to make the preview work.

## Checks

```sh
npm run mobile:check
npm run lint
npm test
npm run build
```

The mobile aggregate runs TypeScript, Node unit/HTTP contract tests, Expo dependency validation and iOS/Android Hermes exports. A reusable native CI job runs from both the PR/main Checks workflow and as a prerequisite of deployment; these workflow changes have not yet run remotely. Its HTTP contract test starts the **existing Express implementation** against the repository's explicitly synthetic test provider, on an ephemeral local port. No mock provider ships in the mobile app, and tests never call production or load credentials.

`expo export` validates JS/native module bundling, not native compilation, signing or physical-device interaction. Platform acceptance still requires a simulator/device: foreground permission grant/deny, keyboard/large text/screen reader, Android Back, background interruption, airplane mode, terminated-app restore and external Maps return.

## Authentication boundary

Native accounts are implemented behind the backend's disabled-by-default `NATIVE_AUTH_ENABLED` feature flag. The app uses an explicit system-browser Google sign-in and matching-code approval, then a single-use S256 PKCE exchange. There is no new Google client or callback scheme. A separate eight-hour native bearer lives only in memory, is revocable on logout, and is never copied from a web cookie or written to AsyncStorage. Details and staging acceptance steps are in `../backend/docs/native-accounts.md`.

Account includes own and circle-shared cloud plans, profile taste editing, selected account-circle application, and in-app invitation send/update/withdraw/respond with a restricted read-only recipient itinerary. Only actual connected account people can receive invitations. Existing server ownership, revision, membership and invitation revocation checks remain authoritative. Guest planning remains available when account access is disabled or not yet deployed. Expired native requests fail rather than silently becoming guest requests.

While signed in, the working draft and account views remain in memory. Signing out or changing accounts cancels outstanding work and dialogs, clears private UI state and restores the previous device guest draft. Explicitly choosing Save copy creates a separate unencrypted local copy. Account circles are not automatically copied into the local circle library. Browser/guest account protections and shared-day capabilities remain separate. No real sign-in, external invitation, deployment or store submission has been performed.

## Privacy and evidence

The app explains location transmission before the permission action. Drafts include names/tastes the user enters and venue snapshots in AsyncStorage, which is not encrypted by the app; use **Account and app information → Start a fresh outing** to clear the current draft/conversation. Saved copies and circles are separate: remove them in their own tabs, then explicitly delete from Recently removed if desired. Guest chat sends the current draft and active saved circle profiles to Unstressed and its configured model so it can recognize a named circle. No mobile analytics identifier is sent. Chat is not persisted after restart. Budget envelopes are never venue prices. Provider connections are shown only for the selected place whose evidence was returned; alternatives do not borrow another venue's taste evidence.

## Layout and shared code

- `App.tsx`: native planning experience, bottom sheets, keyboard handling and app lifecycle.
- `src/transport.js`: public API and bounded NDJSON reader; only agent/itinerary calls may carry the separate native session.
- `src/account-session.js`, `account-planning.js`, and `components/AccountScreen.tsx`: memory-only authentication, private draft boundaries, cloud plans, circles and invitation UI.
- `src/planning.js`: mobile adapters reusing `shared/stop-intents.js`, `selected-route.js` and `plan-title.js`.
- `src/lifecycle.js`: latest-request epochs and serialized local persistence.
- `src/library.js` and `src/components/SavedLibrary.tsx`: serialized, bounded local saved outings and circle library.
- `src/day-details.js` and `src/components/DayDetails.tsx`: validated practical evidence, deliberate public checks and external handoffs.
- `src/validation.js`: runtime checks before restored/server data reaches rendering.
- `test/`: transport, preservation, privacy, race, validation and real Express contract tests.

The Expo package has its own dependency/lockfile boundary, so React Native's React version does not upgrade the existing React 18 website. Metro watches the pure shared directory. No root workspace reorganization or production container changes are needed.

## Approved native brand

The native preview applies the approved open-U and detached sun-dot mark, lowercase `unstressed.` wordmark, forest/paper/celery palette and full Manrope fonts (400/500/600/700) from the official Expo Google Fonts package. Canonical assets are in `assets/brand`; the design reference and specification are in `../brand-reference`. No generated mockup is used as the app interface.

App and adaptive icons plus splash configuration are ready for a native build. Expo Go shows the in-app identity, but its own installed launcher icon remains Expo Go. Web production branding is unchanged.

The initial branded slice was opened successfully by the user on Android. The expanded guest feature set has separate automated checks and still needs physical-device acceptance for new screens. Browser-renderer checks do not validate native permissions, keyboards, lifecycle or screen-reader behavior.

Dependency note: npm audit currently reports five moderate advisory paths in Expo CLI/fingerprint glob/minimatch tooling. Its suggested automatic fix changes Expo to an incompatible older major. No forced downgrade or unrelated dependency updates were applied. Review compatible upstream fixes before a public build.

## Remaining parity

The new account flow needs an authorized backend release/flag and real device/system-browser acceptance before use. Cloud circle creation/join/member management, shared-day capability links/collaboration and native account deletion are not in the UI yet. Persistent refresh sessions and any iOS store-required sign-in alternatives need separate work before public release. Embedded maps, configured route-time estimates, the full web contextual taste-card/autopilot experience and durable private reservation outcome tracking are not in this slice. Maps is an explicit external handoff. Enquiries are selectable drafts, not sent messages or bookings. Refreshed venue checks are scoped to the visible visit and are not persisted as fresh guarantees.
