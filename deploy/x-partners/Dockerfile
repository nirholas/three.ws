# syntax=docker/dockerfile:1.7-labs
# The daily partner spotlight runner (docs/x-partner-series.md), as a Cloud Run Job.
#
# The production image sheds Playwright and has no ffmpeg on purpose, so the
# authoring side of the X pipeline (filming a reel, cutting a GIF, building a
# head) needs its own image. This one is the repo at a commit, with devDependencies
# kept, Chromium and its system libraries installed for the exact Playwright
# version in package-lock.json, and the colour emoji font the reel check demands.
# Build from the repo root:
#   gcloud builds submit --config deploy/x-partners/cloudbuild.yaml .
FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates curl fontconfig fonts-liberation git \
    && rm -rf /var/lib/apt/lists/*

# Same pin as the production Dockerfile: the npm that produced package-lock.json.
ARG NPM_VERSION=11.9.0
RUN npm install -g npm@${NPM_VERSION}

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PUPPETEER_SKIP_DOWNLOAD=1

COPY --parents package.json package-lock.json .npmrc* **/package.json /app/
RUN npm ci --ignore-scripts --no-audit --no-fund

# Chromium for the Playwright version the lockfile resolved, with its system libraries.
RUN npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*

# verify.js refuses to film when emoji draw as boxes; this is the font it asks for.
RUN curl -sSL -o /usr/share/fonts/truetype/Noto-COLRv1.ttf --create-dirs \
      https://raw.githubusercontent.com/googlefonts/noto-emoji/main/2D/fonts/Noto-COLRv1.ttf \
    && fc-cache -f

COPY . .
# npm rebuild runs the install hooks skipped above, among them ffmpeg-static's
# binary download, which reel.js and the head builder use.
RUN npm rebuild && npm run postinstall

ENV NODE_ENV=production \
    NODE_OPTIONS=--no-deprecation \
    GOOGLE_CLOUD_PROJECT=aerial-vehicle-466722-p5

# The run writes stories, proofs and media into the tree before bundling them.
RUN chown -R node:node /app
USER node

ENTRYPOINT ["bash", "deploy/x-partners/run.sh"]
