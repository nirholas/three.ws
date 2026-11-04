FROM node:22-slim
WORKDIR /app
RUN npm install --omit=dev @three-ws/x402-server @solana/web3.js @solana/spl-token bs58 @noble/curves
COPY server.mjs .
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
