# Cloud Run image for HQ: static Vite build served by scripts/cloudrun-server.mjs,
# with the sidecar API server handling /api/* in-process.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:full

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY api ./api
COPY data ./data
COPY src-tauri/sidecar ./src-tauri/sidecar
COPY scripts/cloudrun-server.mjs ./scripts/cloudrun-server.mjs
EXPOSE 8080
CMD ["node", "scripts/cloudrun-server.mjs"]
