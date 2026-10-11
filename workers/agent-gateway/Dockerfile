# syntax=docker/dockerfile:1.7-labs
# agent-gateway: the chat gateway worker (Cloud Run service).
#
# Build from the REPO ROOT. The worker runs the shared gateway core in
# api/_lib/gateway, which reaches the copilot engine, the agent wallet and the
# trade engine, so the image carries the same install the API image does (root
# workspaces, built SDKs) plus the worker's own two dependencies (grammy,
# discord.js) and the distro ffmpeg the voice path transcodes with
# (api/_lib/gateway/audio.js reads FFMPEG_PATH).
#
#   docker build -f workers/agent-gateway/Dockerfile -t agent-gateway .
#   docker run --env-file .env.local -e TELEGRAM_BOT_TOKEN=... -p 8080:8080 agent-gateway
#
# Deploy: workers/agent-gateway/cloudbuild.yaml (README.md has the command).

FROM node:24-slim

WORKDIR /app

# node-gyp toolchain for the root install's native deps (no Node 24 prebuilts),
# and ffmpeg for voice notes in and spoken replies out.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PUPPETEER_SKIP_DOWNLOAD=1

# The npm that produced package-lock.json; see the root Dockerfile for why a
# floating npm breaks `npm ci` on an untouched lockfile.
ARG NPM_VERSION=11.9.0
RUN npm install -g npm@${NPM_VERSION}

# 1. Root manifests only, so the large `npm ci` layer survives source changes.
COPY --parents package.json package-lock.json .npmrc* **/package.json /app/
RUN npm ci --ignore-scripts --no-audit --no-fund

# 2. The worker's own dependencies, from its own lockfile. Node resolves them
#    from workers/agent-gateway/node_modules for the worker's files and falls
#    back to /app/node_modules for everything under api/.
COPY workers/agent-gateway/package.json workers/agent-gateway/package-lock.json ./workers/agent-gateway/
RUN npm --prefix workers/agent-gateway ci --omit=dev --no-audit --no-fund

# 3. Full source, then the deferred lifecycle scripts the API image runs too
#    (native rebuilds, the root postinstall that builds the workspace SDKs).
COPY . .
RUN npm rebuild && npm run postinstall

# 4. Drop the root devDependencies; the worker's tree was installed without them.
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

ENV NODE_ENV=production \
    NODE_OPTIONS=--no-deprecation \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    PORT=8080

# Same permission normalisation as the root image (it explains the find), then
# drop root: the worker never writes under /app.
RUN find /app \( \( -type d ! -perm -555 \) -o \( -type f \( ! -perm -444 -o \( -perm /111 ! -perm -111 \) \) \) \) -exec chmod a+rX {} +
USER node

EXPOSE 8080
CMD ["node", "workers/agent-gateway/src/index.js"]
