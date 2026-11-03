#!/bin/sh
# Opens the head-unit page full screen once the service answers. Run from the
# desktop session (three-ws-kiosk.desktop in ~/.config/autostart does that).
set -eu

PORT="${PORT:-7300}"
URL="http://127.0.0.1:${PORT}/"

# Wait for the service (it starts in a few hundred ms; give a slow SD card 60 s).
i=0
until curl -sf -o /dev/null "${URL}api/state"; do
	i=$((i + 1))
	if [ "$i" -ge 120 ]; then
		echo "head-unit service did not answer on ${URL}; opening anyway" >&2
		break
	fi
	sleep 0.5
done

BROWSER="$(command -v chromium-browser || command -v chromium || true)"
if [ -z "$BROWSER" ]; then
	echo "Chromium is not installed: sudo apt install chromium-browser" >&2
	exit 1
fi

# --autoplay-policy lets projected audio play without a first tap.
# --use-fake-ui-for-media-stream answers the agent's microphone prompt, which
# a touch-only kiosk could not otherwise do. Remove it to keep the prompt.
exec "$BROWSER" \
	--kiosk \
	--noerrdialogs \
	--disable-infobars \
	--disable-session-crashed-bubble \
	--check-for-update-interval=31536000 \
	--overscroll-history-navigation=0 \
	--autoplay-policy=no-user-gesture-required \
	--use-fake-ui-for-media-stream \
	"$URL"
