# Production deployment

Unstressed runs as one non-root Node process on the existing VPS, with the built React app and API on the same HTTPS origin: `https://unstressed.serendepify.com`.

## Release path

Pushes to `main` run syntax checks, all backend tests and the frontend build, then publish an immutable commit-tagged image to GHCR. The workflow transfers that image over pinned-host SSH. Registry credentials stay on the ephemeral GitHub runner, never on the VPS.

`deploy/release.sh` checks the candidate on loopback port 13001 with temporary data before replacing `unstressed-web` on loopback port 13000. A failed live health check restores the previous image. Caddy terminates HTTPS and proxies to that loopback port. The app trusts exactly one proxy hop, so visitor rate limits remain independent. Keep the application port private.

Cloudflare DNS is managed through Ground Control. The domain has a DNS-only A record pointing to the existing server; Caddy manages its certificate. The site configuration is `deploy/site.caddy`, installed as `/etc/caddy/sites/56-unstressed.caddy`.

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

Before a release that changes the file format, take a protected backup of this directory on the server. Image rollback does not undo data edits. The current release does not change the storage format. No automated off-host backup is configured yet.

## Operations

```sh
# On the server:
docker logs --tail 100 unstressed-web
curl --fail http://127.0.0.1:13000/api/health
bash /opt/unstressed/release.sh "$(cat /opt/unstressed/previous-image.txt)"
```

The health endpoint confirms the app is running and configured; it does not independently verify Qloo or the model. After release, also test location search, a real plan, chat, sharing and Google sign-in through the public origin. Avoid copying logs that contain personal planning content into public issues.
