# Unstressed

React/Vite frontend in `frontend/`; Express API and Node tests in `backend/`.

- Install: `npm run setup`. Check: `npm run lint`, `npm test`, `npm run build`.
- Keep Qloo evidence and deterministic planning separate from model-authored text. Never fabricate venue details or individual taste evidence.
- Do not commit `.env`, account data, shared-day credentials or private logs. Runtime secrets live in `/opt/unstressed/.env`; see `docs/DEPLOYMENT.md`.
- Production is a single API process with durable file storage. Do not add replicas without replacing the file stores.
- Changes to `main` deploy through GitHub Actions. Preserve the isolated network, loopback ports and rollback path. Never change another app's infrastructure as part of an Unstressed release.
- Check first-plan review, taste edits, circles, location/currency and mobile result visibility when changing the studio.
