# Experiment only. Separate from every production image.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY guard-core.mjs guard-core.test.mjs probe.mjs ./
ENV REPORT_PATH=/tmp/report.json HOME=/tmp XDG_CONFIG_HOME=/tmp/config XDG_CACHE_HOME=/tmp/cache
USER node
CMD ["sh", "-c", "node --test guard-core.test.mjs && node probe.mjs"]
