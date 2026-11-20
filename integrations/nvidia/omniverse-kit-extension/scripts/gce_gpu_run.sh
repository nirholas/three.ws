#!/usr/bin/env bash
# Run the full threews.forge omni.kit.test suite (panel and live tests included)
# on a short-lived Google Cloud L4 VM, bring the evidence back, delete the VM.
#
#   scripts/gce_gpu_run.sh [--key-file <json>] [--out <dir>] [--zones "<z1> <z2>"] [--keep]
#
#   --key-file  three.ws API key, either a JSON file from POST /api/keys (the
#               secret at .key.secret) or a file holding only the key. Without it,
#               THREEWS_API_KEY from the environment is used; with neither, the
#               generation, account and live panel tests skip. The key is copied to the VM
#               with mode 600, read into the test process environment there, and
#               never printed.
#   --out       where the evidence lands (default: .test-output/gpu-<timestamp>)
#   --zones     zones to try in order (L4 stockouts are per zone and hourly)
#   --keep      leave the VM running for inspection (you delete it)
#
# THREEWS_LIVE_TEXT=0 in the environment skips the live text to 3D test.
#
# Evidence: run.log, kit.log, report.jsonl (omni.kit.test), live-report.json
# (timings), live-stage-*.usda, captures/*.png, generate-from-panel.mp4 and .gif.
# The VM is a spot g2-standard-8 (one L4) on a Deep Learning image; the script
# adds the matching NVIDIA graphics userspace, Xorg on the GPU, uv and Python
# 3.12, and the omniverse-kit wheel. GCE spend is covered by the standing GCP
# credit approval (CLAUDE.md).
set -euo pipefail

PROJECT=aerial-vehicle-466722-p5
SA="three-ws@${PROJECT}.iam.gserviceaccount.com"
KIT_VERSION=110.4.1.392751
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_FILE=""; OUT=""; KEEP=0
ZONES="us-central1-a us-central1-b us-central1-c us-east1-c us-east1-d us-east4-a us-east4-c us-west1-a us-west1-b us-west4-a europe-west4-a"

while [ $# -gt 0 ]; do
	case "$1" in
		--key-file) KEY_FILE="${2:-}"; shift 2 ;;
		--out) OUT="${2:-}"; shift 2 ;;
		--zones) ZONES="${2:-}"; shift 2 ;;
		--keep) KEEP=1; shift ;;
		*) echo "unknown argument: $1" >&2; exit 64 ;;
	esac
done

RUN="$(date +%Y%m%d-%H%M%S)"
VM="kit-forge-${RUN}"
OUT="${OUT:-$HERE/.test-output/gpu-${RUN}}"
mkdir -p "$OUT"
WORK="$(mktemp -d)"
ZONE=""

cleanup() {
	rm -rf "$WORK"
	if [ -n "$ZONE" ] && [ "$KEEP" = 0 ]; then
		gcloud compute instances delete "$VM" --zone "$ZONE" --project "$PROJECT" --quiet >/dev/null 2>&1 || true
		echo "VM $VM deleted."
	elif [ -n "$ZONE" ]; then
		echo "VM $VM kept in $ZONE. Delete it with: gcloud compute instances delete $VM --zone $ZONE --project $PROJECT"
	fi
}
trap cleanup EXIT

# The key travels as a file, never on a command line or in instance metadata.
umask 077
if [ -n "$KEY_FILE" ]; then
	python3 -c 'import json,sys
raw=open(sys.argv[1]).read().strip()
try:
    raw=json.loads(raw)["key"]["secret"]
except (ValueError, KeyError, TypeError):
    pass
open(sys.argv[2],"w").write(raw)' "$KEY_FILE" "$WORK/key"
elif [ -n "${THREEWS_API_KEY:-}" ]; then
	printf '%s' "$THREEWS_API_KEY" > "$WORK/key"
else
	: > "$WORK/key"
fi
umask 022

tar -C "$HERE/.." -czf "$WORK/ext.tgz" --exclude=.test-output --exclude=__pycache__ "$(basename "$HERE")"

cat > "$WORK/setup.sh" <<EOF
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
# The Deep Learning image ships the compute-only driver; Kit needs the matching
# GL, Vulkan and X userspace of the same version.
ver="\$(dpkg-query -W -f='\${Version}' nvidia-utils-580-server)"
sudo apt-get update -q
sudo apt-get install -yq "libnvidia-gl-580-server=\$ver" "xserver-xorg-video-nvidia-580-server=\$ver" \
  "libnvidia-extra-580-server=\$ver" xserver-xorg-core x11-xserver-utils ffmpeg \
  libglu1-mesa libxt6 libxrandr2 libxinerama1 libxcursor1 libxi6 libsm6
bus="\$(nvidia-smi --query-gpu=pci.bus_id --format=csv,noheader | head -1 | awk -F'[:.]' '{printf "PCI:%d:%d:%d", strtonum("0x"\$2), strtonum("0x"\$3), \$4}')"
sudo nvidia-xconfig -a --allow-empty-initial-configuration --virtual=1920x1080 --busid="\$bus" -o /etc/X11/xorg.conf
sudo nohup Xorg :0 -noreset +extension GLX vt7 > /tmp/xorg.out 2>&1 &
for _ in \$(seq 1 30); do DISPLAY=:0 xrandr >/dev/null 2>&1 && break; sleep 1; done
DISPLAY=:0 xrandr --fb 1920x1080 || true
curl -LsSf https://astral.sh/uv/install.sh | sh
~/.local/bin/uv venv -p 3.12 ~/kitvenv
~/.local/bin/uv pip install -p ~/kitvenv/bin/python "omniverse-kit==${KIT_VERSION}" --extra-index-url https://pypi.nvidia.com
EOF

cat > "$WORK/run.sh" <<'EOF'
set -uo pipefail
out="$HOME/out"
rm -rf "$out" && mkdir -p "$out/captures"
cd "$HOME/ext/omniverse-kit-extension"
export DISPLAY=:0 KIT_WINDOW=1 KIT_PYTHON="$HOME/kitvenv/bin/python" TEST_OUTPUT="$out"
export THREEWS_CAPTURE_DIR="$out/captures" THREEWS_LIVE=1 THREEWS_LIVE_TEXT="${THREEWS_LIVE_TEXT:-1}"
export THREEWS_LIVE_REPORT="$out/live-report.json" THREEWS_LIVE_STAGE="$out/live-stage.usda"
if [ -s "$HOME/threews-key" ]; then THREEWS_API_KEY="$(cat "$HOME/threews-key")"; export THREEWS_API_KEY; fi
nvidia-smi --query-gpu=name,driver_version --format=csv,noheader > "$out/gpu.txt"
scripts/run_tests.sh > "$out/run.log" 2>&1
echo $? > "$out/exit-code"
rm -f "$HOME/threews-key"
frames="$out/captures/frames"
if ls "$frames"/frame_*.png >/dev/null 2>&1; then
  ffmpeg -loglevel error -y -framerate 4 -i "$frames/frame_%04d.png" \
    -vf "scale=1280:-2:flags=lanczos,format=yuv420p" -c:v libx264 -crf 22 -movflags +faststart "$out/generate-from-panel.mp4"
  ffmpeg -loglevel error -y -framerate 4 -i "$frames/frame_%04d.png" \
    -vf "scale=960:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer" "$out/generate-from-panel.gif"
fi
EOF

create_in() {
	gcloud compute instances create "$VM" --project "$PROJECT" --zone "$1" \
		--machine-type g2-standard-8 --provisioning-model SPOT --instance-termination-action DELETE \
		--maintenance-policy TERMINATE --boot-disk-size 200GB --boot-disk-type pd-ssd \
		--image-family common-cu129-ubuntu-2204-nvidia-580 --image-project deeplearning-platform-release \
		--service-account "$SA" --scopes cloud-platform --metadata install-nvidia-driver=True >/dev/null
}
for candidate in $ZONES; do
	if create_in "$candidate" 2>/dev/null; then ZONE="$candidate"; break; fi
	echo "no L4 capacity in $candidate, trying the next zone" >&2
done
[ -n "$ZONE" ] || { echo "no zone in [$ZONES] had an L4" >&2; exit 1; }
echo "VM $VM created in $ZONE."

ssh_vm() { gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --quiet --command "$1"; }
for _ in $(seq 1 30); do ssh_vm true >/dev/null 2>&1 && break; sleep 10; done

gcloud compute scp "$WORK/ext.tgz" "$WORK/setup.sh" "$WORK/run.sh" "$VM:/tmp/" --zone "$ZONE" --project "$PROJECT" --quiet
gcloud compute scp "$WORK/key" "$VM:threews-key" --zone "$ZONE" --project "$PROJECT" --quiet
ssh_vm "chmod 600 ~/threews-key; rm -rf ~/ext && mkdir ~/ext && tar -C ~/ext -xzf /tmp/ext.tgz"
echo "Installing the graphics driver userspace, Xorg and Kit ${KIT_VERSION}..."
ssh_vm "bash /tmp/setup.sh > /tmp/setup.log 2>&1 || { tail -40 /tmp/setup.log; exit 1; }"
echo "Running the suite (the first RTX start compiles shaders for several minutes)..."
ssh_vm "THREEWS_LIVE_TEXT='${THREEWS_LIVE_TEXT:-1}' bash /tmp/run.sh"
ssh_vm "tar -C ~ -czf /tmp/out.tgz out"
gcloud compute scp "$VM:/tmp/out.tgz" "$WORK/out.tgz" --zone "$ZONE" --project "$PROJECT" --quiet
tar -C "$WORK" -xzf "$WORK/out.tgz" && cp -r "$WORK/out/." "$OUT/"

code="$(cat "$OUT/exit-code" 2>/dev/null || echo 1)"
grep -E '^Ran |^OK|^FAILED' "$OUT/run.log" || true
echo "Kit log errors: $(grep -c '\[Error\]' "$OUT/kit.log" || true)"
echo "Evidence in $OUT"
exit "$code"
