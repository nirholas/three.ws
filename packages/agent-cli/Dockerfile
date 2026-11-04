# three-ws-agent in a container: the Telegram gateway and local schedules on a
# server. Sessions, config and the saved credential live under /data, so mount
# a volume there to keep them across restarts.
#
#   docker build -t three-ws-agent packages/agent-cli
#   docker run --rm three-ws-agent --help
#   docker run -d -v three-ws-agent:/data -e TELEGRAM_BOT_TOKEN -e TELEGRAM_ALLOWED_CHATS \
#     -e THREE_WS_API_KEY three-ws-agent gateway

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    THREE_WS_AGENT_HOME=/data/agent \
    XDG_CONFIG_HOME=/data/config

WORKDIR /opt/three-ws-agent
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY bin ./bin
COPY src ./src
COPY README.md LICENSE ./
RUN ln -s /opt/three-ws-agent/bin/three-ws-agent.js /usr/local/bin/three-ws-agent \
 && mkdir -p /data /workspace && chown node:node /data /workspace

USER node
WORKDIR /workspace
VOLUME ["/data"]
ENTRYPOINT ["three-ws-agent"]
CMD ["doctor"]
