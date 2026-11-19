# Raw CDP containment capability probe

Status: **blocked before Chromium startup; no containment claim**.

`node probe.mjs` is a standalone, single-CDP-owner experiment. It imports only ws,
not Puppeteer, and never navigates to a provider or production service. The only
permitted fixture destination is an ephemeral HTTP server bound to 127.0.0.1.
This is an explicit local test exception, not the production public-HTTPS policy.

The current run fails because Chromium cannot create its Unix singleton socket:
`FATAL process_singleton_posix.cc:297 socket() failed: Operation not permitted`.
A sanctioned escalated run encounters the same restriction. Do not bypass it.
Use an execution environment with authorized Chromium Unix-socket support.

The capability probe attempts:
- Single-owner recursive paused autoattachment before worker execution.
- Fetch.enable request interception acknowledged before resume; timeout/unsupported
  command keeps target paused and fails the experiment.
- Positive dedicated/nested-worker first-instruction GETs (must execute).
- Negative worker POST, new worker after freeze, native form POST after freeze.
- Asynchronous delayed policy check completing after freeze (must recheck state).
- Acknowledged Network offline commands for every guarded target; failure aborts.
- Browser process exit and fixture socket cleanup, persisted in report.json.

Unimplemented/unproven: frame/new context cases, service/shared workers (rejected),
worker termination barrier, initial script request ownership on the specific engine,
cached resources, sockets/peer transports, redirect/DNS rebinding protection,
controller-disconnect fail-closed enforcement, external public-HTTPS resolver policy,
concurrent freeze and target-detach races. Do not integrate this into production.

Even a passing local run would demonstrate only the listed HTTP capability tests,
not comprehensive privacy, SSRF isolation, Wix compatibility or Cloudflare support.
No personal data is placed in any fixture.

## Authorized isolated CI route (not run here)

Requires Docker/Chromium Unix sockets in a fresh runner. Build uses only official
Node/Debian package sources. The **run** has no network beyond its own loopback:

```sh
docker build -t worker-containment-probe ./experiments/worker-containment
docker run --rm --network=none --read-only --tmpfs /tmp:rw,nosuid,size=512m --shm-size=256m --cap-drop=ALL --security-opt=no-new-privileges --pids-limit=512 --memory=1g --cpus=2 worker-containment-probe
```

No secrets, Docker socket mounts, host mounts, credentials or production services.
CI can collect stdout (`REPORT_JSON:` line) without a host mount. Use a job timeout.
`--no-sandbox` is inside the isolated, networkless, capability-dropped container;
this is not permission to bypass the current execution environment's policy.
The probe uses Node22 global WebSocket: no npm dependency or sibling checkout.

10 deterministic **mocked CDP** tests run locally. They prove controller ordering
and deny decisions, not real Chromium/CDP capabilities. In particular worker
protocol commands may not acknowledge until execution resumes. This experiment
intentionally times out/fails closed rather than resume blindly. It does not
claim that pre-resume Fetch.enable is actually supported.

### First CI harness correction
The first networkless CI run started Chromium but hit its 128-process/thread cap
(`pthread_create EAGAIN`) before worker execution. The fixture cap is now bounded
at 512; network isolation, memory/CPU bounds and dropped capabilities remain.
Root and recursive target filters exclude only browser/tab containers and CDP's
`browser_ui` (internal Chrome WebUI), retaining the catch-all for unknown targets.
No worker class is filtered out. Source: https://chromedevtools.github.io/devtools-protocol/index.html
