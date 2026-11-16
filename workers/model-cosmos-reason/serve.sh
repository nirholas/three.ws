#!/usr/bin/env bash
# Boot vLLM on the staged NVIDIA Cosmos Reason 2 8B weights, after proving the tree.
#
# The weights arrive on a read-only GCS FUSE mount (/weights). Before vLLM reads
# a byte, the check below confirms REVISION names the pinned NGC version and every
# file MANIFEST.json lists is present at its recorded size, so a half-synced or
# re-pointed bucket fails the start instead of serving a different model.
# (stage_weights.py proved each file's SHA-256 against NGC when it staged them.)
set -euo pipefail

WEIGHTS_DIR="${WEIGHTS_DIR:-/weights/cosmos-reason2-8b}"
COSMOS_REVISION="${COSMOS_REVISION:?COSMOS_REVISION must name the pinned NGC version}"
SERVED_MODEL_NAME="${SERVED_MODEL_NAME:-nvidia/cosmos-reason2-8b}"
PORT="${PORT:-8080}"
# Four 512 px views plus the rubric and a reasoning trace fit well inside 16k.
MAX_MODEL_LEN="${MAX_MODEL_LEN:-16384}"
GPU_MEMORY_UTILIZATION="${GPU_MEMORY_UTILIZATION:-0.92}"
MAX_NUM_SEQS="${MAX_NUM_SEQS:-16}"

python3 - "$WEIGHTS_DIR" "$COSMOS_REVISION" <<'PY'
import json, os, sys
root, want = sys.argv[1], sys.argv[2]
try:
    have = open(os.path.join(root, "REVISION")).read().strip()
except FileNotFoundError:
    sys.exit(f"{root}/REVISION missing: weights are not staged (run cloudbuild.weights.yaml)")
if have != want:
    sys.exit(f"{root} holds version {have}, this image pins {want}")
manifest = json.load(open(os.path.join(root, "MANIFEST.json")))
if manifest.get("revision") != want:
    sys.exit(f"MANIFEST.json is for {manifest.get('revision')}, expected {want}")
for name, meta in manifest["files"].items():
    path = os.path.join(root, name)
    if not os.path.isfile(path):
        sys.exit(f"{name} listed in MANIFEST.json is missing")
    if os.path.getsize(path) != meta["size"]:
        sys.exit(f"{name}: {os.path.getsize(path)} bytes, manifest says {meta['size']}")
print(f"weights ok: {len(manifest['files'])} files on {want}", flush=True)
PY

# VLLM_API_KEY (from Secret Manager) gates every /v1 route; /health stays open
# for the Cloud Run startup probe. Images only: the judge never sends video.
# Prefetch: vLLM does not recognise GCS FUSE as a network filesystem, so by
# default it mmaps the shards and faults them in page by page, which measured
# 196 s per 4.1 GB shard on the first revision. A sequential read up front is
# what FUSE is fast at.
exec vllm serve "$WEIGHTS_DIR" \
  --served-model-name "$SERVED_MODEL_NAME" \
  --host 0.0.0.0 \
  --port "$PORT" \
  --dtype bfloat16 \
  --max-model-len "$MAX_MODEL_LEN" \
  --gpu-memory-utilization "$GPU_MEMORY_UTILIZATION" \
  --max-num-seqs "$MAX_NUM_SEQS" \
  --limit-mm-per-prompt '{"image":6,"video":0}' \
  --enable-prefix-caching \
  --safetensors-load-strategy prefetch \
  "$@"
