#!/usr/bin/env bash
# Boot the full x-spaces stack on a single VM (run as user 'agent').
#   Xvfb :99 -> PulseAudio -> Node server (systemd) -> two Chrome instances -> X-tab automation
set -euo pipefail

SPACE_URL="${1:-}"
if [ -z "$SPACE_URL" ]; then
  echo "usage: $0 <https://x.com/i/spaces/...>"
  exit 1
fi

LOG="${HOME}/launch.log"
SERVER_DIR="${HOME}/ai-agents-x-space"
AUTOMATION_DIR="${HOME}/automation"

echo "=== launch at $(date) for $SPACE_URL ===" | tee -a "$LOG"

# 1. Xvfb on :99
if ! pgrep -f "Xvfb :99" >/dev/null; then
  Xvfb :99 -screen 0 1280x800x24 -ac +extension RANDR >>"$LOG" 2>&1 &
  sleep 1
fi
export DISPLAY=:99
echo "[launch] Xvfb up on :99" | tee -a "$LOG"

# 2. PulseAudio
pulseaudio --kill 2>/dev/null || true
sleep 1
pulseaudio --start --exit-idle-time=-1 --log-target=file:"${HOME}/pulse.log"
sleep 2
pactl list short sinks | tee -a "$LOG"

# 3. Node server (systemd will keep it running)
sudo systemctl start swarm-server.service || true
sleep 2
echo "[launch] node server: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/)" | tee -a "$LOG"

# 4. Two Chrome instances with per-process Pulse routing
pkill -f "chrome.*user-data-dir=/tmp/chrome-agent" 2>/dev/null || true
pkill -f "chrome.*user-data-dir=/tmp/chrome-x" 2>/dev/null || true
sleep 1
rm -rf /tmp/chrome-agent /tmp/chrome-x

CHROME=/usr/bin/google-chrome
CHROME_FLAGS=(
  --no-default-browser-check --no-first-run
  --no-sandbox
  --use-fake-ui-for-media-stream
  --autoplay-policy=no-user-gesture-required
  --disable-features=MediaRouter
)

# Agent Chrome: speaks INTO agent_speakers (cable A), listens to agent_mic (= x_speakers.monitor)
PULSE_SINK=agent_speakers PULSE_SOURCE=agent_mic DISPLAY=:99 \
  $CHROME "${CHROME_FLAGS[@]}" --user-data-dir=/tmp/chrome-agent \
  --remote-debugging-port=9222 about:blank >>"${HOME}/chrome-agent.log" 2>&1 &

# X Chrome: speaks INTO x_speakers (cable B), listens to x_mic (= agent_speakers.monitor)
PULSE_SINK=x_speakers PULSE_SOURCE=x_mic DISPLAY=:99 \
  $CHROME "${CHROME_FLAGS[@]}" --user-data-dir=/tmp/chrome-x \
  --remote-debugging-port=9223 about:blank >>"${HOME}/chrome-x.log" 2>&1 &

for port in 9222 9223; do
  for i in $(seq 1 30); do
    curl -s "http://127.0.0.1:$port/json/version" >/dev/null 2>&1 && break
    sleep 1
  done
  echo "[launch] chrome :$port ready" | tee -a "$LOG"
done

# 5. Run the automation
set -a
. "$AUTOMATION_DIR/.env"
set +a
cd "$AUTOMATION_DIR"
node vm-automation.js "$SPACE_URL" 2>&1 | tee -a "$LOG"

echo "=== launch DONE; server + chromes stay running ===" | tee -a "$LOG"
echo
echo "Now accept the speaker request on your phone (as the Space host)."
echo "Then run:  cd $AUTOMATION_DIR && node unmute-only.js"
echo "Then:      $HOME/say.sh \"test message\""
