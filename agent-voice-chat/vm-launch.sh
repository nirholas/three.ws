#!/usr/bin/env bash
# Run on the swarm-agent VM as user 'agent'.
# Boots: Xvfb -> PulseAudio -> Node server -> two Chrome instances -> automation script.
set -euo pipefail

SPACE_URL="${1:-}"
if [ -z "$SPACE_URL" ]; then
  echo "usage: $0 <https://x.com/i/spaces/...>"
  exit 1
fi

LOG=/home/agent/launch.log
echo "=== launch at $(date) for $SPACE_URL ===" | tee -a "$LOG"

# 1. Xvfb on :99
if ! pgrep -f "Xvfb :99" >/dev/null; then
  Xvfb :99 -screen 0 1280x800x24 -ac +extension RANDR >>"$LOG" 2>&1 &
  sleep 1
fi
export DISPLAY=:99
echo "[launch] Xvfb up on :99" | tee -a "$LOG"

# 2. PulseAudio (loads ~/.config/pulse/default.pa with the two null sinks)
pulseaudio --kill 2>/dev/null || true
sleep 1
pulseaudio --start --exit-idle-time=-1 --log-target=file:/home/agent/pulse.log
sleep 2
pactl list short sinks | tee -a "$LOG"
pactl list short sources | tee -a "$LOG"

# 3. Node server (ai-agents-x-space) on port 3000
if ! curl -s http://localhost:3000/ >/dev/null 2>&1; then
  cd /home/agent/ai-agents-x-space
  nohup node index.js >>/home/agent/server.log 2>&1 &
  sleep 4
fi
echo "[launch] node server up: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/)" | tee -a "$LOG"

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

# Agent Chrome: outputs to agent_speakers (cable A), records from agent_mic (= x_speakers.monitor, cable B)
PULSE_SINK=agent_speakers PULSE_SOURCE=agent_mic DISPLAY=:99 \
  $CHROME "${CHROME_FLAGS[@]}" --user-data-dir=/tmp/chrome-agent \
  --remote-debugging-port=9222 \
  about:blank >>/home/agent/chrome-agent.log 2>&1 &

# X Chrome: outputs to x_speakers (cable B), records from x_mic (= agent_speakers.monitor, cable A)
PULSE_SINK=x_speakers PULSE_SOURCE=x_mic DISPLAY=:99 \
  $CHROME "${CHROME_FLAGS[@]}" --user-data-dir=/tmp/chrome-x \
  --remote-debugging-port=9223 \
  about:blank >>/home/agent/chrome-x.log 2>&1 &

# Wait for both CDP endpoints
for port in 9222 9223; do
  for i in $(seq 1 30); do
    curl -s "http://127.0.0.1:$port/json/version" >/dev/null 2>&1 && break
    sleep 1
  done
  echo "[launch] chrome :$port -> $(curl -s http://127.0.0.1:$port/json/version | head -c 80)" | tee -a "$LOG"
done

# 5. Run the automation
set -a
. /home/agent/automation/.env
set +a
cd /home/agent/automation
node vm-automation.js "$SPACE_URL" 2>&1 | tee -a "$LOG"

echo "=== launch script DONE; chrome + server stay running ===" | tee -a "$LOG"
