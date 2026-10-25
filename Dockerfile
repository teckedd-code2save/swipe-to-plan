FROM node:22-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
COPY shared /build/shared
RUN npm test
RUN npm run build

FROM node:22-bookworm-slim AS backend
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /build/backend
COPY backend/package*.json ./
COPY backend/prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force
COPY backend/src ./src
COPY backend/test ./test
# Backend regression tests reuse browser-independent planning helpers.
COPY frontend/src /build/frontend/src
COPY shared /build/shared
RUN npm test

FROM node:22-bookworm-slim AS runner
LABEL org.opencontainers.image.source="https://github.com/teckedd-code2save/swipe-to-plan"
LABEL org.opencontainers.image.title="Unstressed"
LABEL org.opencontainers.image.licenses="MIT"
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data && chown node:node /data
WORKDIR /app/backend
COPY --from=backend /build/backend/node_modules ./node_modules
COPY --chown=node:node backend/package*.json ./
COPY --chown=node:node backend/prisma ./prisma
COPY --chown=node:node backend/src ./src
COPY --from=frontend /build/frontend/dist /app/frontend/dist
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 ACCOUNT_DATA_FILE=/data/accounts.json DAY_DATA_FILE=/data/days.json
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
