FROM oven/bun:1-debian

WORKDIR /app

# Install workspace manifests first for Docker layer caching
COPY package.json ./
COPY packages/schema/package.json ./packages/schema/package.json
COPY packages/outlets/package.json ./packages/outlets/package.json
COPY tools/crawler/package.json ./tools/crawler/package.json

RUN bun install

# Install Chromium and OS dependencies matching Playwright version in node_modules
RUN bunx playwright install chromium --with-deps

# Copy source packages required by @jachaikori/crawler
COPY packages/schema ./packages/schema
COPY packages/outlets ./packages/outlets
COPY tools/crawler ./tools/crawler

ENV NODE_ENV=production

ENTRYPOINT ["bun", "run", "tools/crawler/src/gcp/worker.ts"]
