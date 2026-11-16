#!/usr/bin/env bash
# Container entrypoint: the studio server (port 8000) owns the GPU and the
# TripoSR model; JupyterLab (port 8888) serves the guided notebook. When
# THREE_WS_CONNECT_NODE=1 the three.ws inference node also registers and drains
# jobs. If any process exits, the container exits, and Docker's restart policy
# brings the whole set back together.
set -euo pipefail

mkdir -p /workspace/outputs /workspace/notebooks /workspace/identity

# Copy the notebook into the persistent volume once, so a user's edits survive
# restarts and image upgrades never overwrite their work.
if [[ ! -f /workspace/notebooks/three-ws-gpu-quickstart.ipynb ]]; then
  cp /opt/three-ws/notebooks/three-ws-gpu-quickstart.ipynb /workspace/notebooks/
fi

if ! nvidia-smi -L >/dev/null 2>&1; then
  echo "[three-ws] no NVIDIA GPU is visible in the container. Run it with --gpus all on a host" >&2
  echo "[three-ws] with the NVIDIA driver and the NVIDIA Container Toolkit installed." >&2
  exit 78
fi
nvidia-smi -L

pids=()
uvicorn studio.server:app --app-dir /opt/three-ws --host 0.0.0.0 --port 8000 --log-level info &
pids+=($!)

jupyter lab \
  --ip=0.0.0.0 --port=8888 --no-browser \
  --ServerApp.root_dir=/workspace \
  --ServerApp.allow_remote_access=True \
  --ServerApp.trust_xheaders=True \
  --IdentityProvider.token="${JUPYTER_TOKEN:-}" \
  --LabApp.default_url=/lab/tree/notebooks/three-ws-gpu-quickstart.ipynb &
pids+=($!)

if [[ "${THREE_WS_CONNECT_NODE:-0}" == "1" ]]; then
  (cd /opt/node-operator && DEVICE=cuda IDENTITY_PATH=/workspace/identity/node-identity.json exec node src/index.js) &
  pids+=($!)
fi

trap 'kill -TERM "${pids[@]}" 2>/dev/null; wait' TERM INT
wait -n "${pids[@]}"
status=$?
kill -TERM "${pids[@]}" 2>/dev/null || true
wait || true
exit "$status"
