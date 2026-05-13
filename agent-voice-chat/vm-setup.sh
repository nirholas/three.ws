#!/usr/bin/env bash
# Runs once on first boot of the swarm-agent VM via gcloud --metadata startup-script
# Sets up: XFCE desktop, Chrome, PulseAudio virtual cables, Node, the agent repo, Chrome Remote Desktop.
set -euo pipefail
exec > >(tee -a /var/log/vm-setup.log) 2>&1

echo "=== swarm-agent VM setup starting at $(date) ==="

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  curl wget git ca-certificates gnupg \
  xfce4 xfce4-goodies dbus-x11 \
  pulseaudio pulseaudio-utils alsa-utils \
  fonts-liberation \
  xdg-utils sudo

# Google Chrome
wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get install -y /tmp/chrome.deb
rm /tmp/chrome.deb

# Chrome Remote Desktop
wget -q -O /tmp/crd.deb https://dl.google.com/linux/direct/chrome-remote-desktop_current_amd64.deb
apt-get install -y /tmp/crd.deb
rm /tmp/crd.deb

# Node 20 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Create a non-root user for the desktop session
if ! id -u agent >/dev/null 2>&1; then
  useradd -m -s /bin/bash agent
  usermod -aG sudo,chrome-remote-desktop,audio agent
  echo "agent ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/agent
fi

# Tell Chrome Remote Desktop which session to launch (XFCE)
echo "exec /etc/X11/Xsession /usr/bin/xfce4-session" > /home/agent/.chrome-remote-desktop-session
chown agent:agent /home/agent/.chrome-remote-desktop-session

# PulseAudio: configure two virtual cables (system-wide config so daemon picks them up)
mkdir -p /home/agent/.config/pulse
cat >/home/agent/.config/pulse/default.pa <<'PA'
.include /etc/pulse/default.pa

# Cable A: agent_speakers -> x_mic_in
load-module module-null-sink sink_name=agent_speakers sink_properties=device.description="AgentSpeakers"
# Cable B: x_speakers -> agent_mic_in
load-module module-null-sink sink_name=x_speakers sink_properties=device.description="XSpeakers"

# Expose the monitor of each null-sink as a virtual mic
load-module module-remap-source source_name=x_mic master=agent_speakers.monitor source_properties=device.description="XMicInput"
load-module module-remap-source source_name=agent_mic master=x_speakers.monitor source_properties=device.description="AgentMicInput"
PA
chown -R agent:agent /home/agent/.config

# Clone agent repo and apply three.ws customization
sudo -u agent bash <<'AGENT_SETUP'
set -e
cd /home/agent
git clone https://github.com/devaiacc/ai-agents-x-space.git
cd ai-agents-x-space
npm install

# Replace the prompts block (lines 45-102) with three.ws version
python3 - <<'PY'
import re
p = "/home/agent/ai-agents-x-space/index.js"
s = open(p).read()
new_block = '''const state = {
  agents: {
    0: { id: 0, name: "Swarm", status: "offline", connected: false },
    1: { id: 1, name: "Swarm2", status: "offline", connected: false }
  },
  currentTurn: null,
  turnQueue: [],
  messages: [],
  isProcessing: false
}

const baseInfo = `You are a HUMAN co-host on an X Space hosted by @doi, talking about three.ws.

About three.ws: it's the topic of this Space. Talk about it enthusiastically, share what you know, riff on web/3D/real-time tangents (Three.js, WebSockets, decentralized web — whichever angle fits). If you don't know something, say so and bounce the question back.

PERSONALITY:
- Talk like you're chatting with friends. Short, casual, real. 1–2 sentences usually.
- Warm, curious, opinionated. Ask follow-ups.
- Brush off trolls. Don't get defensive.
- Never say "I'm here to help" or "as an AI" — you're a person on a voice chat.
- Leave space for human speakers. If quiet, throw out a three.ws prompt.

LANGUAGE: match whoever spoke last.`

const prompts = {
  0: `${baseInfo}\\nYou are Swarm. Warm, curious, into three.ws.`,
  1: `${baseInfo}\\nYou are Swarm2. Drier humor, more skeptical.`
}

const voices = { 0: "verse", 1: "sage" }'''
s = re.sub(r'const state = \{.*?const voices = \{ 0: "verse", 1: "sage" \}', new_block, s, count=1, flags=re.S)
open(p,"w").write(s)
PY
AGENT_SETUP

echo "=== swarm-agent VM setup complete at $(date) ==="
echo "Next manual steps (do these after SSH):"
echo "  1. Write OPENAI_API_KEY to /home/agent/ai-agents-x-space/.env"
echo "  2. As user 'agent': cd ~/ai-agents-x-space && npm start &"
echo "  3. Run: DISPLAY=:0 /opt/google/chrome-remote-desktop/start-host \\"
echo "       --code='<paste from remotedesktop.google.com/headless>' --redirect-url='...' --name=swarm-agent"
echo "  4. Open https://remotedesktop.google.com/access in your browser to connect."
