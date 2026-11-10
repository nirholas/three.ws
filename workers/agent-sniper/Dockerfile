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
# The root lockfile links bigint-buffer, deepmerge and elliptic to patched copies
# vendored in multiplayer/vendor (CVE fixes with no upstream release). Without these
# folders node_modules/bigint-buffer is a dangling link and @solana/spl-token's
# buffer-layout-utils fails to load, so the worker cannot boot.
COPY multiplayer/vendor/bigint-buffer ./multiplayer/vendor/bigint-buffer
COPY multiplayer/vendor/deepmerge ./multiplayer/vendor/deepmerge
COPY multiplayer/vendor/elliptic ./multiplayer/vendor/elliptic
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
# it builds (verifyImageBoots), and the finished image boots itself again
# (last RUN below), so a new runtime read outside it fails before any rollout.
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
COPY workers/agent-sniper ./workers/agent-sniper
RUN npm run build --prefix agent-payments-sdk

# There is deliberately no `npm prune --omit=dev` here. The image holds a partial
# workspace tree (most workspace folders are absent, and packages/agent-sniper and
# packages/avatar-agent-mcp are present only as slices with no package.json), so
# npm computes the dependency graph wrong when pruning it. On 2026-11-10 prune
# deleted the jito-tip-accounts.js slice (revision agent-sniper-00037 died at boot
# with ERR_MODULE_NOT_FOUND although its COPY had run) and, once that was moved,
# the runtime dependency bigint-buffer under @solana/spl-token. Keeping devDeps
# costs image size only; pruning cost the worker.
COPY packages/agent-sniper/src ./packages/agent-sniper/src
COPY packages/avatar-agent-mcp/src/lib/jito-tip-accounts.js ./packages/avatar-agent-mcp/src/lib/jito-tip-accounts.js
COPY packages/x402-server/src/facilitator ./packages/x402-server/src/facilitator

# Boot the worker inside the finished image: the module graph loads fully before
# config asks for DATABASE_URL, so reaching that error proves every import
# resolves. A missing module fails the build here instead of as a Cloud Run
# revision that never opens its health port.
RUN out="$(NODE_ENV=production SNIPER_MODE=simulate timeout 60 node workers/agent-sniper/index.js 2>&1 || true)"; \
    echo "$out" | grep -q "missing required env var: DATABASE_URL" \
    || { echo "$out" | head -20; echo "agent-sniper does not boot from this image"; exit 1; }

ENV NODE_ENV=production \
    SNIPER_MODE=simulate

CMD ["node", "workers/agent-sniper/index.js"]
