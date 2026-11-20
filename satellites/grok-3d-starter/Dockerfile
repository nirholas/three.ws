# Small production image: Node 22, runtime dependencies only, non-root.
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server.mjs ./
COPY lib ./lib
COPY shared ./shared
COPY public ./public
USER node
ENV PORT=8080 TRUST_PROXY=1
EXPOSE 8080
CMD ["node", "server.mjs"]
