# Pulse: collector, API and dashboard in one always-on process. The Solana
# firehose is a long-lived WebSocket, so run with min-instances >= 1 and CPU
# always allocated. Set DATABASE_URL (Cloud SQL / Neon / Timescale) for a
# durable archive; without it the embedded PGlite dir is ephemeral on Cloud Run.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
EXPOSE 8080
CMD ["node", "dist/pulse.js"]
