# Unstressed

React/Vite frontend in `frontend/`; Express API and Node tests in `backend/`.

- Install: `npm run setup`. Check: `npm run lint`, `npm test`, `npm run build`.
- Keep Qloo evidence and deterministic planning separate from model-authored text. Never fabricate venue details or individual taste evidence.
- Do not commit `.env`, account data, shared-day credentials or private logs. Runtime secrets live in `/opt/unstressed/.env`; see `docs/DEPLOYMENT.md`.
- Production is a single API process with durable file storage. Do not add replicas without replacing the file stores.
- Changes to `main` deploy through GitHub Actions. Preserve the isolated network, loopback ports and rollback path. Never change another app's infrastructure as part of an Unstressed release.
- Check first-plan review, taste edits, circles, location/currency and mobile result visibility when changing the studio.

## Product goal

Unstressed is a Qloo-powered planning companion and hackathon candidate. Turn loose solo or group intent into useful, grounded place suggestions with minimal effort. The agent does the research and comparison; the person steers. Do not turn examples or numeric feedback into a growing collection of keyword gates or onboarding rules.

- Location selection returns to chat. Understand intent before opening contextual decision components.
- Existing people, saved tastes and prior outing patterns reduce questions. A solo person needs no group setup; unnamed companions need no fabricated profiles.
- Unknown budgets remain unset. A venue category is a search strategy, not a claimed purchase or user preference. Found-place claims require actual returned venues.
- Taste cards are relevant choices, not mandatory questionnaires. Menu, hours, allowance and group-fit comparisons must distinguish provider evidence from suggestions.
- Validate ordinary journeys in the live product, including a place to sit after work and a Friday group starting in East Legon. Check focus and mobile interaction, not only build health.
