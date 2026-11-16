#!/usr/bin/env bash
# three.ws GPU quickstart: host setup.
#
# This one script is both the NVIDIA Brev Launchable setup script (VM Mode) and
# the installer for any clean Ubuntu 22.04/24.04 machine with an NVIDIA GPU.
# It is idempotent: run it again to upgrade or to restart a stopped stack.
#
#   curl -fsSL https://raw.githubusercontent.com/nirholas/three.ws/main/distributions/nvidia-brev/setup.sh | bash
#
# What it does:
#   1. checks the NVIDIA driver (it never installs or replaces a driver)
#   2. installs Docker and the NVIDIA Container Toolkit if either is missing
#   3. pulls the quickstart image (or builds it from source if the pull fails)
#   4. starts it with the GPU attached and waits until the model is on the GPU
#
# Settings (environment variables, all optional; on Brev they are launch parameters):
#   THREE_WS_IMAGE          image to run (default: the published quickstart image)
#   THREE_WS_BIND           host address for ports 8000/8888 (default 127.0.0.1; Brev
#                           secure links and SSH tunnels reach localhost. Use 0.0.0.0
#                           only together with JUPYTER_TOKEN)
#   JUPYTER_TOKEN           JupyterLab token (default: none, protected by the bind address)
#   THREE_WS_CONNECT_NODE   1 to register the three.ws inference node and serve jobs
#   NODE_LABEL              label for that node (default: the hostname)
#   THREE_WS_BUILD          1 to skip the pull and build the image from source
set -euo pipefail

IMAGE="${THREE_WS_IMAGE:-us-docker.pkg.dev/aerial-vehicle-466722-p5/three-ws-public/gpu-quickstart:0.1.0}"
BIND="${THREE_WS_BIND:-127.0.0.1}"
NAME="three-ws-gpu"
VOLUME="three-ws-workspace"
REPO_URL="https://github.com/nirholas/three.ws.git"
STATE_DIR="${HOME:-/root}/three-ws-quickstart"
LOG="${STATE_DIR}/setup.log"
HEALTH_TIMEOUT_S="${THREE_WS_HEALTH_TIMEOUT_S:-900}"

mkdir -p "$STATE_DIR"
exec > >(tee -a "$LOG") 2>&1

T0=$(date +%s)
step_start=$T0
log() { printf '[three-ws %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*"; exit 1; }
lap() {
  local now; now=$(date +%s)
  log "$1 took $((now - step_start))s"
  printf '%s\t%s\n' "$1" "$((now - step_start))" >> "$STATE_DIR/timings.tsv"
  step_start=$now
}

SUDO=""
if [[ $EUID -ne 0 ]]; then
  command -v sudo >/dev/null || die "run as root or install sudo"
  SUDO="sudo"
fi

: > "$STATE_DIR/timings.tsv"
log "three.ws GPU quickstart setup on $(hostname) ($(. /etc/os-release && echo "$PRETTY_NAME"))"

# 1. NVIDIA driver ------------------------------------------------------------
if ! command -v nvidia-smi >/dev/null || ! nvidia-smi -L >/dev/null 2>&1; then
  die "no working NVIDIA driver. On Ubuntu install one with
      sudo apt-get update && sudo apt-get install -y ubuntu-drivers-common && sudo ubuntu-drivers install --gpgpu
  then reboot and run this script again. (Brev and GPU cloud images ship the driver.)"
fi
DRIVER=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -n1)
GPU=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -n1)
log "GPU: $GPU, driver $DRIVER"
DRIVER_MAJOR=${DRIVER%%.*}
if (( DRIVER_MAJOR < 525 )); then
  die "driver $DRIVER is older than 525, the minimum for CUDA 12. Upgrade the driver and rerun."
fi
lap "driver check"

# 2. Docker and the NVIDIA Container Toolkit -----------------------------------
if ! command -v docker >/dev/null; then
  log "installing Docker"
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq docker.io
  $SUDO systemctl enable --now docker
fi
DOCKER="docker"
docker info >/dev/null 2>&1 || DOCKER="$SUDO docker"
$DOCKER info >/dev/null 2>&1 || die "Docker is installed but not running: sudo systemctl start docker"

if ! $DOCKER info --format '{{json .Runtimes}}' | grep -q nvidia; then
  log "installing the NVIDIA Container Toolkit"
  if ! command -v nvidia-ctk >/dev/null; then
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
      | $SUDO gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
      | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
      | $SUDO tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq nvidia-container-toolkit
  fi
  $SUDO nvidia-ctk runtime configure --runtime=docker
  $SUDO systemctl restart docker
fi
lap "docker and container toolkit"

# 3. Image ---------------------------------------------------------------------
build_from_source() {
  command -v git >/dev/null || { $SUDO apt-get update -qq && $SUDO apt-get install -y -qq git; }
  local src="$STATE_DIR/src"
  if [[ -d "$src/.git" ]]; then
    git -C "$src" pull --ff-only
  else
    git clone --depth 1 --filter=blob:none --sparse "$REPO_URL" "$src"
    git -C "$src" sparse-checkout set distributions/nvidia-brev packages/node-operator
  fi
  local ctx; ctx="$(mktemp -d)"
  "$src/distributions/nvidia-brev/build.sh" context "$ctx"
  IMAGE="three-ws/gpu-quickstart:source"
  log "building $IMAGE from source (20 to 40 minutes: it compiles a CUDA kernel)"
  DOCKER_BUILDKIT=1 $DOCKER build --progress=plain -t "$IMAGE" "$ctx"
  rm -rf "$ctx"
}

if [[ "${THREE_WS_BUILD:-0}" == "1" ]]; then
  build_from_source
  lap "image build"
else
  log "pulling $IMAGE"
  if $DOCKER pull "$IMAGE"; then
    lap "image pull"
  else
    log "pull failed; building from source instead"
    build_from_source
    lap "image build"
  fi
fi

log "checking GPU passthrough into containers"
$DOCKER run --rm --gpus all --entrypoint nvidia-smi "$IMAGE" -L \
  || die "the container cannot see the GPU. Check: sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker"
lap "gpu passthrough check"

# 4. Run -----------------------------------------------------------------------
if $DOCKER inspect "$NAME" >/dev/null 2>&1; then
  log "replacing the existing $NAME container (the $VOLUME volume and your files are kept)"
  $DOCKER rm -f "$NAME" >/dev/null
fi

$DOCKER volume create "$VOLUME" >/dev/null
$DOCKER run -d --name "$NAME" \
  --gpus all \
  --restart unless-stopped \
  --shm-size 2g \
  -p "$BIND:8000:8000" \
  -p "$BIND:8888:8888" \
  -v "$VOLUME:/workspace" \
  -e JUPYTER_TOKEN="${JUPYTER_TOKEN:-}" \
  -e THREE_WS_CONNECT_NODE="${THREE_WS_CONNECT_NODE:-0}" \
  -e NODE_LABEL="${NODE_LABEL:-$(hostname)}" \
  "$IMAGE" >/dev/null
log "container $NAME started; waiting for the model to load onto the GPU"

deadline=$(( $(date +%s) + HEALTH_TIMEOUT_S ))
while :; do
  status=$($DOCKER inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$NAME" 2>/dev/null || echo missing)
  running=$($DOCKER inspect --format '{{.State.Running}}' "$NAME" 2>/dev/null || echo false)
  [[ "$status" == "healthy" ]] && break
  if [[ "$running" != "true" ]]; then
    $DOCKER logs --tail 80 "$NAME" || true
    die "the container stopped during startup (logs above)"
  fi
  if (( $(date +%s) > deadline )); then
    $DOCKER logs --tail 80 "$NAME" || true
    die "not healthy after ${HEALTH_TIMEOUT_S}s (logs above)"
  fi
  sleep 5
done
lap "container start to healthy"

HEALTH=$(curl -fsS "http://127.0.0.1:8000/health")
log "health: $HEALTH"
log "total setup time $(( $(date +%s) - T0 ))s"

cat <<EOF

three.ws GPU quickstart is running on $GPU.

  Notebook   http://localhost:8888   (on Brev: the "jupyter" secure link)
  Studio     http://localhost:8000   (on Brev: the "studio" secure link)

From your laptop over SSH:  ssh -L 8888:localhost:8888 -L 8000:localhost:8000 <this-machine>

Files you make are in the Docker volume "$VOLUME" (/workspace inside the container).
Logs: docker logs -f $NAME      Stop: docker stop $NAME      Timings: $STATE_DIR/timings.tsv
EOF
