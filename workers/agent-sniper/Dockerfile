# agent-sniper — long-lived Node worker.
#
# Build from the REPO ROOT (it imports api/_lib/* and the @three-ws/agent-payments
# workspace, so it needs the full install):
#
#   docker build -f workers/agent-sniper/Dockerfile -t agent-sniper .
#   docker run --env-file .env agent-sniper
#
# Deploy target is Cloud Run (no HTTP port — it's a background worker; deploy
# with --no-cpu-throttling so the feed stays connected between requests).

FROM node:24-slim

WORKDIR /app

# Install deps first for layer caching.
#   .npmrc carries legacy-peer-deps=true — the Solana peer-dep graph
#   (@bonfida/spl-name-service vs @solana/spl-token) does NOT resolve under
#   strict npm, so without it the install dies ERESOLVE and the image never builds.
#   devDeps are installed on purpose: the agent-payments SDK ships only its built
#   dist/ (gitignored, and every export resolves into it), and its build tool
#   (tsup) is a devDependency — omitting dev here would break `npm run build` below.
COPY .npmrc package.json package-lock.json* ./
COPY agent-payments-sdk/package.json ./agent-payments-sdk/
RUN npm ci --ignore-scripts || npm install --ignore-scripts

# Bring in source needed at runtime, then build the SDK's dist/ explicitly
# (ignore-scripts skipped the postinstall build above). src/ is required too: the
# worker's first-claim path imports api/_lib/pump-claims.js → src/pump/first-claims.js.
# packages/agent-sniper/src is required too: mayhem-gate.js imports
# createMayhemFilter from packages/agent-sniper/src/mayhem-filter.js (self-contained,
# only depends on @solana/web3.js which is already a root dependency) — only src/ is
# copied, not the whole package (its own node_modules/tests/bin are unused at runtime).
# data/plans.json is read at module load by api/payments/_config.js, which the
# sniper reaches through api/_lib/pump-platform-fee.js (the trade fee). Without
# it the worker dies with ENOENT before it opens the health port, so Cloud Run
# refuses the revision. `npm run deploy:sniper` boots this exact COPY set before
# it builds (verifyImageBoots), so a new runtime read outside it fails there.
# packages/avatar-agent-mcp/src/lib/jito-tip-accounts.js is imported by
# api/_lib/execution-engine.js (the Jito bundle tip list every sniper buy and
# sell submits through). It has no imports of its own, so only that file is
# copied; without it the worker dies with ERR_MODULE_NOT_FOUND at boot.
# packages/x402-server/src/facilitator is imported by api/_lib/x402/self-facilitator.js
# (the self-hosted Solana x402 rail the paid-intel arm pays through). Its only
# npm imports (@solana/web3.js, @solana/spl-token, bs58, @noble/curves) are root
# dependencies, so only that directory is copied.
COPY agent-payments-sdk ./agent-payments-sdk
COPY api ./api
COPY data/plans.json ./data/plans.json
COPY src ./src
COPY packages/agent-sniper/src ./packages/agent-sniper/src
COPY packages/avatar-agent-mcp/src/lib/jito-tip-accounts.js ./packages/avatar-agent-mcp/src/lib/jito-tip-accounts.js
COPY packages/x402-server/src/facilitator ./packages/x402-server/src/facilitator
COPY workers/agent-sniper ./workers/agent-sniper
RUN npm run build --prefix agent-payments-sdk

# dist/ is built — drop devDeps for a leaner runtime image. Best-effort: a prune
# hiccup in the partial-workspace tree must never fail the build.
RUN npm prune --omit=dev --ignore-scripts || true

ENV NODE_ENV=production \
    SNIPER_MODE=simulate

CMD ["node", "workers/agent-sniper/index.js"]
