# ============================================================
# Stage 1: Install dependencies
# ============================================================
FROM node:20-slim AS deps

WORKDIR /app

# Install pnpm (must match lockfile version — lockfileVersion: '9.0')
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate && pnpm --version

# Skip Puppeteer's bundled Chromium download (we use system Chromium in runtime)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Copy package files for dependency installation (layer caching)
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/
COPY packages/widget/package.json packages/widget/
COPY packages/create-xspace-agent/package.json packages/create-xspace-agent/

# Install all dependencies (need devDeps for build step)
RUN pnpm install --frozen-lockfile

# ============================================================
# Stage 2: Build TypeScript
# ============================================================
FROM deps AS builder

WORKDIR /app

# Copy source code and config
COPY tsconfig.json tsconfig.base.json ./
COPY packages/ packages/

# Build all packages
RUN pnpm --filter xspace-agent run build && \
    pnpm --filter @xspace/server run build

# Prune dev dependencies after build
RUN pnpm prune --prod

# ============================================================
# Stage 3: Production runtime
# ============================================================
FROM node:20-slim AS runtime

# Install Chromium dependencies for Puppeteer + dumb-init for signal handling
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use system Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Create non-root user
RUN groupadd -r xspace && useradd -r -g xspace -m -d /home/xspace xspace

WORKDIR /app

# Copy production node_modules and built packages
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/packages/core/dist packages/core/dist/
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/core/node_modules packages/core/node_modules/
COPY --from=builder /app/packages/server/dist packages/server/dist/
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/packages/server/public packages/server/public/
COPY --from=builder /app/packages/server/node_modules packages/server/node_modules/
COPY --from=builder /app/package.json .
COPY --from=builder /app/pnpm-workspace.yaml .

# Create directories for persistent data
RUN mkdir -p /app/data /app/cookies && \
    chown -R xspace:xspace /app

USER xspace

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV HEADLESS=true
ENV BROWSER_MODE=managed
ENV COOKIE_PATH=/app/cookies/.cookies.json
ENV STATE_PATH=/app/data/state.json

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

EXPOSE 3000

# Use dumb-init as PID 1 for proper signal forwarding
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "packages/server/dist/index.js"]


