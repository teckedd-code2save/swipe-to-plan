# Production deployment

Unstressed runs as one non-root Node process on the existing VPS, with the built React app and API on the same HTTPS origin: `https://unstressed.serendepify.com`.

## Release path

Pushes to `main` run syntax checks, all backend tests and the frontend build, then publish an immutable commit-tagged image to GHCR. The workflow transfers that image over pinned-host SSH. Registry credentials stay on the ephemeral GitHub runner, never on the VPS.

`deploy/release.sh` checks the candidate on loopback port 13001 with temporary data before replacing `unstressed-web` on loopback port 13000. A failed live health check restores the previous image. Caddy terminates HTTPS and proxies to that loopback port. The app trusts exactly one proxy hop, so visitor rate limits remain independent. Keep the application port private.

Cloudflare DNS is managed through Ground Control. The domain has a DNS-only A record pointing to the existing server; Caddy manages its certificate. The site configuration is `deploy/site.caddy`, installed as `/etc/caddy/sites/56-unstressed.caddy`.

The initial release and model update passed the GitHub checks and public HTTPS smoke test. Production uses `gemini-3.5-flash-lite`; direct launch checks of the earlier default, `gemini-3.1-flash-lite`, returned timeouts and HTTP 503. The replacement was checked with actual planning and participant tools, not just a text greeting.

## Ground Control builds

Do not retry `deployment.source.deploy` while its Compose build inherits a digest-pinned `UNSTRESSED_IMAGE`: Docker cannot use a digest reference as an output build tag. A digest is appropriate for running a previously built image, not naming a new build.

The normal release path is the GitHub workflow above, which builds with the exact commit SHA as its tag and preserves the candidate health check, data backup and rollback. If Ground Control is needed instead, use `deployment.build_publish` for an exact commit, inspect its verified result, then `deployment.release` for that successful build operation. Do not run both release paths concurrently. Keep runtime digest pinning; do not replace the running image with a mutable tag merely to make a source build pass.

## Runtime configuration

The only application secret file on the server is `/opt/unstressed/.env` (root-owned, mode 600). It holds the Qloo, model and Google OAuth credentials plus these deployment values:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=4000
TRUST_PROXY=1
APP_ORIGIN=https://unstressed.serendepify.com
ACCOUNT_DATA_FILE=/data/accounts.json
DAY_DATA_FILE=/data/days.json
```

The Infisical service was unavailable during the initial deployment, so this release uses the skill's static environment-file fallback. No app credentials are stored in GitHub Secrets or the image. Restore Infisical separately before configuring secret sync; no scheduled sync is installed against the unavailable service.

GitHub uses only `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` and `VPS_KNOWN_HOSTS` for SSH bootstrap. Configure those with values supplied through standard input. The host key must match an already trusted entry. Never commit credentials or print the runtime environment.

Register `https://unstressed.serendepify.com/api/auth/google/callback` on the Google web client. Keep development callbacks separately. The OAuth scopes remain `openid email profile`.

## Durable data

`/opt/unstressed/data` is mounted at `/data`, owned by UID/GID 1000 with mode 700. Accounts, circles and shared days survive container replacement. This release starts with fresh production data; local development accounts and invitations are not uploaded. One API process is required for the file stores. Add a transactional database before horizontal scaling.

The release script takes a protected archive of this directory in `/opt/unstressed/backups` before replacing the live container. Archives and their directory are private to the deployment user. Image rollback does not undo data edits. No automated off-host backup is configured yet; monitor available disk and manage backup retention.

Signed-in generated plans are stored under each account's optional `savedPlans` collection in `accounts.json`. Older accounts load unchanged. Each entry keeps the current server-generated plan and one previous version for undo, with monotonic revisions to reject late overwrites. The account library holds up to 100 days and never evicts days silently. A plan's area is independent of the account's default planning area. Shared days can be copied by authenticated participants without storing their private access credentials in the account library. Only summaries are listed; individual snapshots require the owning account session. Saving errors leave the result visible and offer an explicit device copy.

## Operations

```sh
# On the server:
docker logs --tail 100 unstressed-web
curl --fail http://127.0.0.1:13000/api/health
bash /opt/unstressed/release.sh "$(cat /opt/unstressed/previous-image.txt)"
```

The health endpoint confirms the app is running and configured; it does not independently verify Qloo or the model. After release, also test location search, a real plan, chat, sharing and Google sign-in through the public origin. Avoid copying logs that contain personal planning content into public issues.

## Private usage dashboard

Set `ADMIN_EMAILS` to a comma-separated allowlist of verified Google sign-in addresses; there is no default administrator. The account menu exposes **Usage & people** only to an allowed account, and `/api/admin/usage` independently checks the authenticated session on every request. Never put admin emails or account data into client configuration.

Set `USAGE_DATA_FILE=/data/usage.json` in production. It uses the same single-process atomic-file model as accounts. Back it up with the other durable files. It stores up to 90 days / 50,000 first-party usage events, with no conversation text, taste values, IP addresses, venue IDs or private links. Account identity comes from the server session, not client-supplied user IDs. The dashboard distinguishes all-time accounts from feature usage collected since instrumentation began. A calendar open is not a confirmed saved event.

The timing release adds optional `timing` metadata to planning briefs; older saved/shared plans remain readable and retain their existing dates and fixed start times. Newly started studio plans ask for missing date/time choices. Before release, back up accounts and days on the server; rollback restores the prior image while retaining durable files.
