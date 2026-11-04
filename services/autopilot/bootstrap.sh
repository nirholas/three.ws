#!/usr/bin/env bash
# VM startup script for three-ws-autopilot. provision.sh installs it as the
# instance's `startup-script` metadata, so it runs as root on every boot. It is
# idempotent: the first boot installs everything, later boots only refresh
# Claude Code and the systemd units.

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

USER_NAME=autopilot
HOME_DIR=/home/$USER_NAME
REPO=$HOME_DIR/three.ws
PROJECT=aerial-vehicle-466722-p5

as_user() { sudo -u "$USER_NAME" -H bash -lc "$1"; }

apt-get update -q
apt-get install -y -q git git-lfs jq curl ca-certificates gettext-base build-essential python3 xz-utils

if ! command -v gcloud >/dev/null; then
	curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
	echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" >/etc/apt/sources.list.d/google-cloud-sdk.list
	apt-get update -q && apt-get install -y -q google-cloud-cli
fi

if ! node -v 2>/dev/null | grep -q '^v24\.'; then
	curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
	apt-get install -y -q nodejs
fi

# Refreshed on every boot; the CLI's own auto-updater is disabled for the
# unattended user (claude-settings.json).
npm install -g --no-audit --no-fund @anthropic-ai/claude-code@latest

# The avatar-studio and frontend builds peak above RAM on a cold build.
if ! swapon --show | grep -q /swapfile; then
	[ -f /swapfile ] || { fallocate -l 16G /swapfile && chmod 600 /swapfile && mkswap /swapfile; }
	swapon /swapfile
	grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

id "$USER_NAME" >/dev/null 2>&1 || useradd -m -s /bin/bash "$USER_NAME"
as_user "gcloud config set project $PROJECT --quiet && gcloud config set run/region us-central1 --quiet"

if [ ! -d "$REPO/.git" ]; then
	as_user "git clone --origin threews https://github.com/nirholas/three.ws.git $REPO"
fi
if [ ! -d "$REPO/node_modules" ]; then
	as_user "cd $REPO && npm ci --no-audit --no-fund"
fi
(cd "$REPO" && npx --yes playwright install-deps chromium)
as_user "cd $REPO && npx playwright install chromium"

# Unit files: provision.sh ships the current ones as instance metadata so a VM
# can come up before they reach threews/main; otherwise use the clone's copies.
META=http://metadata.google.internal/computeMetadata/v1/instance/attributes
meta_get() { curl -fsS -H 'Metadata-Flavor: Google' "$META/$1" 2>/dev/null || true; }
for unit in autopilot.service autopilot.timer; do
	key="autopilot-unit-${unit#autopilot.}"
	tmp=$(mktemp)
	meta_get "$key" >"$tmp"
	if [ -s "$tmp" ]; then
		install -m 0644 "$tmp" "/etc/systemd/system/$unit"
	elif [ -f "$REPO/services/autopilot/$unit" ]; then
		install -m 0644 "$REPO/services/autopilot/$unit" "/etc/systemd/system/$unit"
	else
		rm -f "$tmp"
		echo "[bootstrap] FATAL: $unit is in neither instance metadata ($key) nor the clone at $REPO/services/autopilot/. Re-run provision.sh, or push the unit files." >&2
		exit 1
	fi
	rm -f "$tmp"
done

# /etc/autopilot/env is read by autopilot.service. provision.sh --no-ship sets
# the autopilot-no-ship metadata attribute, which writes AUTOPILOT_NO_SHIP=1.
install -d -m 0755 /etc/autopilot
[ -f /etc/autopilot/env ] || : >/etc/autopilot/env
if [ "$(meta_get autopilot-no-ship)" = "1" ]; then
	grep -q '^AUTOPILOT_NO_SHIP=' /etc/autopilot/env || echo 'AUTOPILOT_NO_SHIP=1' >>/etc/autopilot/env
fi
chmod 0644 /etc/autopilot/env

systemctl daemon-reload
systemctl enable --now autopilot.timer
echo "[bootstrap] autopilot timer enabled: $(systemctl list-timers autopilot.timer --no-legend)"
