# The sandbox runner image. Build context is the REPOSITORY ROOT, because the
# runner imports the same exec-core.js the API's local and docker backends use
# (one isolation implementation, not a copy):
#
#   docker build -t three-ws-sandbox -f workers/sandbox-runner/Dockerfile .
#
# The same image is the `docker` backend's program image: it carries python3,
# node, bash and the three_ws bridge clients at /opt/three_ws/clients.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PIP_BREAK_SYSTEM_PACKAGES=1

# util-linux provides unshare, setpriv and prlimit: the namespace isolation and
# the kernel resource limits exec-core.js applies to every program.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip util-linux procps ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install \
        numpy==2.1.3 pandas==2.2.3 scipy==1.14.1 matplotlib==3.9.2 \
        pillow==11.0.0 openpyxl==3.1.5 sympy==1.13.3 scikit-learn==1.5.2

WORKDIR /app
COPY workers/sandbox-runner/server.mjs workers/sandbox-runner/server.mjs
COPY api/_lib/sandbox/exec-core.js api/_lib/sandbox/exec-core.js
COPY api/_lib/sandbox/paths.js api/_lib/sandbox/paths.js
COPY api/_lib/sandbox/clients api/_lib/sandbox/clients
COPY api/_lib/sandbox/clients /opt/three_ws/clients

# Programs run as uid 65534 and may read these; none may write them.
RUN chmod -R a+rX /app /opt/three_ws \
    && mkdir -p /tmp/sandbox-jobs && chmod 1777 /tmp/sandbox-jobs

ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
# Root is deliberate: exec-core's `root` isolation mode unshares the network,
# PID and IPC namespaces and then drops the program to uid 65534 with no
# capabilities and no-new-privs. The server process itself never runs user code.
CMD ["node", "workers/sandbox-runner/server.mjs"]
