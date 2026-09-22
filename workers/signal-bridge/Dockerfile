# signal-bridge: the Signal leg of the agent gateway (workers/agent-gateway).
#
# A thin layer over the maintained signal-cli REST bridge
# (github.com/bbernhard/signal-cli-rest-api). The upstream image already does the
# hard part (signal-cli, the REST surface, the live receive websocket); this layer
# only adds persistence, because Cloud Run disks are ephemeral and the registered
# number's identity keys must survive a restart. persist.sh restores the state
# tree from the mounted bucket on boot and snapshots it back on a timer.
#
#   docker build -t signal-bridge workers/signal-bridge
#   docker run -p 8080:8080 -v "$PWD/.signal-state:/state" signal-bridge

FROM bbernhard/signal-cli-rest-api:0.100

# json-rpc keeps one signal-cli process resident, so sends are milliseconds
# instead of a JVM start each, and it is the mode that serves the receive
# websocket the gateway subscribes to.
ENV MODE=json-rpc \
	PORT=8080 \
	JSON_RPC_TRUST_NEW_IDENTITIES=on-first-use \
	JSON_RPC_IGNORE_STORIES=true \
	JSON_RPC_IGNORE_STICKERS=true \
	SIGNAL_STATE_DIR=/state \
	SIGNAL_SNAPSHOT_SECONDS=120

COPY --chmod=755 persist.sh /usr/local/bin/signal-bridge-persist

ENTRYPOINT ["/usr/local/bin/signal-bridge-persist"]
