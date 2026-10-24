# agent-orders — long-lived Node worker (programmable orders engine).
#
# Build from the REPO ROOT (it imports api/_lib/* and the @three-ws/agent-payments
# workspace, so it needs the full install):
#
#   docker build -f workers/agent-orders/Dockerfile -t agent-orders .
#   docker run --env-file .env agent-orders
#
# Deploy target is Cloud Run as a background-daemon SERVICE. It's not
# request-driven, but index.js binds a tiny liveness endpoint on $PORT so the
# startup probe passes. Deploy with --no-cpu-throttling and --min-instances=1 so
# the sweep timer keeps ticking between probes. See workers/agent-orders/cloudbuild.yaml.

FROM node:24-slim

WORKDIR /app

# Install deps first for layer caching. See agent-sniper/Dockerfile for why
# .npmrc (legacy-peer-deps) and devDeps (the agent-payments SDK build) are needed.
COPY .npmrc package.json package-lock.json* ./
COPY agent-payments-sdk/package.json ./agent-payments-sdk/
RUN npm ci --ignore-scripts || npm install --ignore-scripts

# Source needed at runtime, then build the SDK's dist/ explicitly.
COPY agent-payments-sdk ./agent-payments-sdk
COPY api ./api
COPY src ./src
COPY workers/agent-orders ./workers/agent-orders
COPY workers/agent-sniper/amm-exit.js ./workers/agent-sniper/amm-exit.js
COPY workers/agent-sniper/exit-logic.js ./workers/agent-sniper/exit-logic.js
COPY workers/agent-sniper/scorer.js ./workers/agent-sniper/scorer.js
COPY workers/agent-sniper/intel ./workers/agent-sniper/intel
COPY public/risk-ack.js ./public/risk-ack.js
COPY data/plans.json ./data/plans.json
COPY community-skills/tools/registry.mjs ./community-skills/tools/registry.mjs
COPY packages/avatar-agent-mcp/src/lib/jito-tip-accounts.js ./packages/avatar-agent-mcp/src/lib/jito-tip-accounts.js
RUN npm run build --prefix agent-payments-sdk

RUN npm prune --omit=dev --ignore-scripts || true

ENV NODE_ENV=production \
    ORDERS_MODE=simulate

CMD ["node", "workers/agent-orders/index.js"]
