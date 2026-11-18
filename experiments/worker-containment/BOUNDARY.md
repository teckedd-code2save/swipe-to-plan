# Reservation worker containment: acceptance boundary

Status: research/prototype only. No production integration or security certification.

## Intended phases

1. Create a fresh, application-cookie-free browser/context with no pre-existing page/service worker. Install one CDP lifecycle owner before creating any navigable target.
2. Every new executable target is paused before its first script. Recursively arm attachment before resuming it. Reject unknown target classes or unsupported interception.
3. Bootstrap allows only reviewed public HTTPS GET requests. Every redirect is revalidated. This is a transport restriction, NOT proof that all GET endpoints are semantically non-mutating. Do not drive booking actions while online.
4. No guest/contact information enters the page until the freeze barrier completes. Restrict capabilities that bypass HTTP interception (WebSocket, WebTransport, WebRTC, service/shared worker if not proven covered).
5. Freeze atomically changes controller state to deny, before awaiting any operation; pending asynchronous DNS checks must recheck this epoch immediately before continuing requests. Revoke new worker creation. Every extant target acknowledges deny-network. Cancel outstanding requests and terminate workers, verifying detachment/termination or failing closed.
6. Only after the acknowledged barrier, permit specific reviewed widget interactions. Block form submit/requestSubmit, all network, new browsing contexts and navigation. Re-read date/party/time and node ownership after all selections.
7. Close owned browser/session on unsupported capabilities, protocol loss, timeout or any untracked target. A lost controller connection cannot leave a network-capable browser containing private fields.

## Required adversarial evidence

- First instruction in dedicated worker fetches; nested worker immediately fetches; initial worker script request is itself contained.
- POST, beacon, form submissions, GET query exfiltration, WS and peer transport attempts.
- New target created during freeze; target detached while installing guard; unsupported CDP method; async resolver completes after freeze.
- Delayed pre-freeze request continuation and response arriving after freeze.
- Frames/popups/service/shared workers and cached resources cannot restore network capabilities.
- Concurrent freeze requests and controller disconnect close all targets.
- Prove actual worker code executed in positive control, otherwise an empty server log is vacuous.
- Verify browser process is gone and local fixture sockets closed after tests.

## Known unresolved production problems

- Puppeteer TargetManager resumes attached worker targets independently, so a second listener is not an acceptable barrier.
- App-side DNS lookup is not a binding of the remote browser's network destination. It does not establish rebinding resistance.
- Fetch interception may not cover every target class or protocol in the provider. Documentation alone is insufficient.
- Worker termination can destroy Wix's interactive runtime, making offline filling impossible even when containment works.
- Some availability calculations genuinely require server requests. Never fabricate filled state; a safe supported read-only availability stage requires endpoint-specific semantics and separate design.
- CDP-only session control cannot by itself establish fail-closed behavior after controller disconnect. Consider provider-enforced egress isolation/revocation or an isolated local browser network boundary before claiming a security guarantee.

## Official provider constraints checked 2026-11-18

https://developers.cloudflare.com/browser-run/features/guardrails/
Hostname policies are fixed for the session, are not method-aware, and are unavailable on Kitesurf. They cannot serve as a dynamic freeze barrier.

https://developers.cloudflare.com/browser-run/features/outbound-workers/
Outbound Workers route exact configured hostnames, HTTP only; other traffic uses normal browser networking. Not a global HTTPS egress proxy.

https://chromedevtools.github.io/devtools-protocol/tot/Target/
Paused auto-attachment is available in protocol; support and timing must be demonstrated in the specific engine, not inferred from Chrome's documentation.
