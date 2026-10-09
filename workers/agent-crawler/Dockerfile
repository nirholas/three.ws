# syntax=docker/dockerfile:1
# agent-crawler: three.ws agents reading the open web in real browsers (/crawl).
#
# The base image ships Chromium plus every system dependency it needs. Its tag
# MUST match the playwright version pinned (exactly) in package.json and the
# lockfile: the image bakes the browser build that playwright release expects,
# so a drifted pair dies on launch with "Executable doesn't exist at
# /ms-playwright/chromium-<rev>". Bump both together.
FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js crawler.js frontier.js extract.js net.js seeds.js ./

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_ENV=production \
    BASE_URL=https://three.ws \
    CRAWLERS=8 \
    JPEG_QUALITY=55

# CRAWL_WORKER_SECRET must be supplied at runtime.
USER pwuser

CMD ["node", "index.js"]
