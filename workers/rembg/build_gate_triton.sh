#!/usr/bin/env bash
# Dockerfile.triton build gate. One RUN step, so the upstream weights (needed
# only as the parity reference) never land in a shipped layer.
#   1. download the five rembg models and export them into /models (the
#      exporter fails the build if a rewritten graph drifts from upstream);
#   2. run the stdlib/unit suites;
#   3. start tritonserver on CPU over a KIND_CPU copy of the repository (Cloud
#      Build has no GPU; the serving graphs and the batcher are the same);
#   4. cut real photos out through Triton and through ONNX Runtime and require
#      matching masks, plus a dynamic-batching check under concurrency.
set -euo pipefail

MODELS="isnet-general-use u2net u2net_human_seg silueta birefnet-general-lite"
PHOTOS="eval-refs/black-african-adult-man-long-hair.png
eval-refs/black-african-young-adult-woman-headscarf.png
eval-adversarial/extreme-hard-backlight.png"

cleanup() {
  pkill -f "tritonserver --model-repository=/tmp/models-cpu" 2>/dev/null || true
  rm -rf /tmp/models-cpu /tmp/parity "$U2NET_HOME"
}
trap cleanup EXIT

for model in $MODELS; do
  python -c "import rembg, sys; rembg.new_session(sys.argv[1], providers=['CPUExecutionProvider'])" "$model"
done
python export_triton_models.py --weights "$U2NET_HOME" --repo /models

python test_rembg_policy.py
python test_task_store.py
python test_forwarder.py
python test_triton_metrics.py

mkdir -p /tmp/parity /tmp/models-cpu
for photo in $PHOTOS; do
  curl -fsS -o "/tmp/parity/$(basename "$photo")" \
    "https://storage.googleapis.com/three-ws-avatar-reconstructions/$photo"
done
cp -r /models/. /tmp/models-cpu/
sed -i 's/KIND_GPU/KIND_CPU/' /tmp/models-cpu/*/config.pbtxt

tritonserver --model-repository=/tmp/models-cpu --log-verbose=0 > /tmp/triton-gate.log 2>&1 &
if ! python test_triton_parity.py /tmp/parity/*.png; then
  tail -60 /tmp/triton-gate.log
  exit 1
fi
