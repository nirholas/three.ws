# pump-claims: real-time GitHub social-fee-PDA claim listener.
#
# Build from the REPO ROOT (it reaches outside its own directory for shared
# decode/attribution logic; see the COPY comments below):
#
#   docker build -f services/pump-claims/Dockerfile -t pump-claims .
#   docker run --env-file .env pump-claims
#
# Long-lived WebSocket subscription, not a request/response function. Deploy
# with --no-cpu-throttling and --min-instances=1 so it keeps listening between
# health probes. See cloudbuild.yaml.

FROM node:20-alpine

WORKDIR /app

# Install this service's own deps straight from its package.json (not the root
# lockfile: pulling that in would require every other workspace's package.json
# present too, just for npm ci's consistency check), landing node_modules at
# /app so Node's walk-up resolution finds it from both api/_lib and
# services/pump-claims (a --prefix install scopes node_modules too narrowly).
COPY services/pump-claims/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

# Repo code the service imports from OUTSIDE its own directory:
#   pipeline.js -> api/_lib/pump-events.js, api/_lib/pump-claims.js
#   pipeline.js -> api/_lib/pump-claims.js  -> api/_lib/pump.js, api/_lib/db.js,
#                  api/_lib/pump-claims-attribution.js, api/_lib/pump-claims-github.js,
#                  api/_lib/solana/*, src/pump/first-claims.js
#   api/_lib/pump-claims-github.js -> api/_lib/pump-search.js -> src/ipfs.js
#   index.js/backfill.js -> api/_lib/solana/connection.js, api/_lib/solana/programs.js
# Omitting any of these makes the image BUILD fine and then crash on boot with
# "Cannot find module".
COPY api/_lib ./api/_lib
COPY src/pump ./src/pump
COPY src/ipfs.js ./src/ipfs.js

# Service source.
COPY services/pump-claims ./services/pump-claims

ENV NODE_ENV=production

CMD ["node", "services/pump-claims/index.js"]
