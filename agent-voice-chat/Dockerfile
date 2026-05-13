# ============================================================
# Stage 1: Production dependencies only
# ============================================================
FROM node:20-slim AS deps
WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/react/package.json packages/react/
COPY packages/vue/package.json packages/vue/
COPY packages/widget/package.json packages/widget/

RUN npm ci --omit=dev

# ============================================================
# Stage 2: Build TypeScript workspace packages
# ============================================================
FROM node:20-slim AS builder
WORKDIR /app

COPY . .
RUN npm ci && npm run build:packages

# ============================================================
# Stage 3: Production image
# ============================================================
FROM node:20-slim AS production
WORKDIR /app

# Install dumb-init for proper PID 1 signal handling
RUN apt-get update \
    && apt-get install -y --no-install-recommends dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Security: run as non-root user
RUN addgroup --system app && adduser --system --group app

# Production node_modules (no dev deps, smaller image)
COPY --from=deps --chown=app:app /app/node_modules ./node_modules

# Compiled workspace packages (TypeScript dist/ dirs)
COPY --from=builder --chown=app:app /app/packages ./packages

# Application source (JS — no compile step needed for main server)
COPY --chown=app:app server.js agent-registry.js room-manager.js agents.config.json ./
COPY --chown=app:app src/ ./src/
COPY --chown=app:app providers/ ./providers/
COPY --chown=app:app lib/ ./lib/
COPY --chown=app:app public/ ./public/
COPY --chown=app:app prompts/ ./prompts/
COPY --chown=app:app openapi.json openapi.yaml package.json ./

# Create runtime data directories with correct ownership
RUN mkdir -p memory knowledge && chown -R app:app memory knowledge

USER app

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Health check hits /api/health which validates provider connectivity
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]
