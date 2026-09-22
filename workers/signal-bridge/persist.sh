#!/bin/sh
# Restore the signal-cli state tree from the mounted state volume, keep it
# snapshotted there, then hand PID 1 to the upstream s6 init.
#
# The snapshot is written to a temp name and renamed, so a restart mid-write
# restores the previous complete tarball rather than a torn one. The loop only
# writes when the tree changed since the last snapshot, which keeps an idle
# bridge from rewriting the same object every interval.
set -eu

CONFIG_DIR="${SIGNAL_CLI_CONFIG_DIR:-/home/.local/share/signal-cli}"
STATE_DIR="${SIGNAL_STATE_DIR:-/state}"
INTERVAL="${SIGNAL_SNAPSHOT_SECONDS:-120}"
SNAPSHOT="$STATE_DIR/signal-cli.tgz"

mkdir -p "$CONFIG_DIR"

if [ -d "$STATE_DIR" ] && [ -s "$SNAPSHOT" ]; then
	echo "signal-bridge: restoring state from $SNAPSHOT"
	tar -xzf "$SNAPSHOT" -C "$CONFIG_DIR"
else
	echo "signal-bridge: no snapshot at $SNAPSHOT, starting unregistered"
fi

snapshot() {
	[ -d "$STATE_DIR" ] || return 0
	tar -czf "$STATE_DIR/.signal-cli.tgz.tmp" -C "$CONFIG_DIR" . \
		&& mv -f "$STATE_DIR/.signal-cli.tgz.tmp" "$SNAPSHOT"
}

(
	last=""
	while sleep "$INTERVAL"; do
		stamp="$(find "$CONFIG_DIR" -type f -newer "$SNAPSHOT" 2>/dev/null | head -1)"
		if [ ! -s "$SNAPSHOT" ] || [ -n "$stamp" ]; then
			if snapshot; then
				last="$(date -u +%FT%TZ)"
				echo "signal-bridge: snapshot written $last"
			else
				echo "signal-bridge: snapshot failed" >&2
			fi
		fi
	done
) &

exec /init
