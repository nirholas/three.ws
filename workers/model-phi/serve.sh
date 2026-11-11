#!/usr/bin/env bash
# Boot vLLM on the staged Phi-4-mini-instruct weights, after proving the tree.
#
# The weights arrive on a read-only GCS FUSE mount (/weights). Before vLLM reads
# a byte, check_weights confirms REVISION names the pinned revision and every
# file MANIFEST.json lists is present at its recorded size, so a half-synced or
# re-pointed bucket fails the start instead of serving a different model.
# (stage_weights.py proved each file's SHA-256 against the Hub when it staged
# them; re-hashing 7.7 GB over FUSE at every cold start would add a minute.)
set -euo pipefail

WEIGHTS_DIR="${WEIGHTS_DIR:-/weights/phi-4-mini-instruct}"
PHI_REVISION="${PHI_REVISION:?PHI_REVISION must name the pinned Hugging Face revision}"
SERVED_MODEL_NAME="${SERVED_MODEL_NAME:-microsoft/Phi-4-mini-instruct}"
PORT="${PORT:-8080}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-32768}"
GPU_MEMORY_UTILIZATION="${GPU_MEMORY_UTILIZATION:-0.92}"
MAX_NUM_SEQS="${MAX_NUM_SEQS:-64}"

python3 - "$WEIGHTS_DIR" "$PHI_REVISION" <<'PY'
import json, os, sys
root, want = sys.argv[1], sys.argv[2]
try:
    have = open(os.path.join(root, "REVISION")).read().strip()
except FileNotFoundError:
    sys.exit(f"{root}/REVISION missing: weights are not staged (run cloudbuild.weights.yaml)")
if have != want:
    sys.exit(f"{root} holds revision {have}, this image pins {want}")
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
# for the Cloud Run startup probe.
exec vllm serve "$WEIGHTS_DIR" \
  --served-model-name "$SERVED_MODEL_NAME" \
  --host 0.0.0.0 \
  --port "$PORT" \
  --dtype bfloat16 \
  --max-model-len "$MAX_MODEL_LEN" \
  --gpu-memory-utilization "$GPU_MEMORY_UTILIZATION" \
  --max-num-seqs "$MAX_NUM_SEQS" \
  --enable-prefix-caching \
  --enable-auto-tool-choice \
  --tool-parser-plugin /app/phi_tool_parser.py \
  --tool-call-parser phi4_mini_native \
  --chat-template /app/chat_template.jinja \
  "$@"
