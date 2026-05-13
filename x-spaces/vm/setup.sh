#!/usr/bin/env bash
# x-spaces VM bootstrap — fresh Ubuntu 22.04 LTS → ready to launch.
# Idempotent: safe to re-run.
#
# Usage (run as root on the VM):
#   curl -fsSL https://raw.githubusercontent.com/nirholas/three.ws/main/x-spaces/vm/setup.sh | sudo bash
#
# Or manually:
#   git clone https://github.com/nirholas/three.ws.git /opt/three.ws
#   sudo /opt/three.ws/x-spaces/vm/setup.sh

set -euo pipefail
exec > >(tee -a /var/log/x-spaces-setup.log) 2>&1

REPO_URL="https://github.com/nirholas/three.ws.git"
REPO_DIR="/opt/three.ws"
AGENT_HOME="/home/agent"
SERVER_DIR="$AGENT_HOME/ai-agents-x-space"

echo "=== x-spaces setup starting at $(date) ==="
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  curl wget git ca-certificates gnupg python3 \
  xvfb xdotool x11-utils \
  pulseaudio pulseaudio-utils alsa-utils \
  libnss3 libxss1 libgbm1 libasound2t64 \
  libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libatspi2.0-0t64 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxkbcommon0 \
  libpango-1.0-0 libpangocairo-1.0-0 libgtk-3-0t64 libdrm2 libdbus-1-3 \
  fonts-liberation ffmpeg sudo

# Google Chrome
if ! command -v google-chrome >/dev/null; then
  wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y /tmp/chrome.deb
  rm /tmp/chrome.deb
fi

# Node 20
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1)" != "v20" ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# Non-root agent user
if ! id -u agent >/dev/null 2>&1; then
  useradd -m -s /bin/bash agent
  usermod -aG sudo,audio agent
  echo "agent ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/agent
fi

# Clone or update repo
if [ ! -d "$REPO_DIR" ]; then
  git clone "$REPO_URL" "$REPO_DIR"
else
  git -C "$REPO_DIR" pull --ff-only || true
fi
chown -R agent:agent "$REPO_DIR"

# PulseAudio: two virtual cables (per-process routing via PULSE_SINK/PULSE_SOURCE)
sudo -u agent mkdir -p "$AGENT_HOME/.config/pulse"
sudo -u agent tee "$AGENT_HOME/.config/pulse/default.pa" >/dev/null <<'PA'
.include /etc/pulse/default.pa

# Cable A: agent_speakers -> x_mic (this is what the agent broadcasts)
load-module module-null-sink sink_name=agent_speakers sink_properties=device.description=AgentSpeakers
# Cable B: x_speakers -> agent_mic (this is what the agent hears from the Space)
load-module module-null-sink sink_name=x_speakers sink_properties=device.description=XSpeakers

# Expose each sink's monitor as a usable virtual mic
load-module module-remap-source source_name=x_mic master=agent_speakers.monitor source_properties=device.description=XMicInput
load-module module-remap-source source_name=agent_mic master=x_speakers.monitor source_properties=device.description=AgentMicInput
PA

# Server: copy bundled code into agent's home
sudo -u agent mkdir -p "$SERVER_DIR/public"
sudo -u agent cp -r "$REPO_DIR/x-spaces/server/." "$SERVER_DIR/"
sudo -u agent bash -c "cd '$SERVER_DIR' && npm install --no-audit --no-fund"

# Automation directory + puppeteer-core
sudo -u agent mkdir -p "$AGENT_HOME/automation"
sudo -u agent cp "$REPO_DIR"/x-spaces/automation/*.js "$AGENT_HOME/automation/"
sudo -u agent cp "$REPO_DIR"/x-spaces/automation/*.py "$AGENT_HOME/automation/" 2>/dev/null || true
sudo -u agent bash -c "cd '$AGENT_HOME/automation' && [ -f package.json ] || npm init -y >/dev/null; npm install --no-audit --no-fund puppeteer-core"

# Helpers
sudo -u agent cp "$REPO_DIR/x-spaces/scripts/say.sh" "$AGENT_HOME/say.sh"
sudo chmod +x "$AGENT_HOME/say.sh"
sudo -u agent cp "$REPO_DIR/x-spaces/vm/launch.sh" "$AGENT_HOME/launch.sh"
sudo chmod +x "$AGENT_HOME/launch.sh"

# systemd service for the Node server (auto-restart)
cp "$REPO_DIR/x-spaces/vm/swarm-server.service" /etc/systemd/system/swarm-server.service
systemctl daemon-reload

cat <<MSG

=== x-spaces VM setup complete at $(date) ===

Next steps:
  1. Drop your OpenAI key into the server's .env:
       sudo -u agent tee $SERVER_DIR/.env <<EOF
OPENAI_API_KEY=sk-...
PORT=3000
EOF
       sudo chmod 600 $SERVER_DIR/.env

  2. Drop your X cookies (for the agent's X account) into the automation .env:
       sudo -u agent tee $AGENT_HOME/automation/.env <<EOF
X_AUTH_TOKEN=...
X_CT0=...
EOF
       sudo chmod 600 $AGENT_HOME/automation/.env

  3. Start the systemd-managed server:
       sudo systemctl enable --now swarm-server.service

  4. Launch Xvfb + PulseAudio + Chrome + automation for a given Space:
       sudo -u agent $AGENT_HOME/launch.sh https://x.com/i/spaces/<SPACE_ID>

  5. Accept the speaker request on your phone as the host.

  6. Click unmute:
       sudo -u agent bash -c "cd $AGENT_HOME/automation && node unmute-only.js"

  7. Test audio:
       sudo -u agent $AGENT_HOME/say.sh "hello from x-spaces"

See x-spaces/README.md for the full walkthrough.
MSG
