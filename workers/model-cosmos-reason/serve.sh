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

# Warm the page cache before vLLM opens a shard. vLLM mmaps the checkpoint and
# faults it in page by page, which GCS FUSE serves as small random reads: 196 s
# per 5.3 GB shard on the first revision (2026-11-16). vLLM's own prefetch
# (--safetensors-load-strategy prefetch) reads each file from 8 threads at
# once, which gcsfuse also treats as random access, and one shard stalled
# outright. One sequential reader per shard is the pattern gcsfuse streams
# fast, and the 16 GB that lands in the page cache fits the 32 GiB instance.
python3 - "$WEIGHTS_DIR" <<'PY'
import glob, os, sys, threading, time
shards = sorted(glob.glob(os.path.join(sys.argv[1], "*.safetensors")))
total = sum(os.path.getsize(p) for p in shards)
errors = []
def warm(path):
    try:
        with open(path, "rb", buffering=0) as f:
            while f.read(64 << 20):
                pass
    except OSError as exc:
        errors.append(f"{os.path.basename(path)}: {exc}")
t0 = time.monotonic()
threads = [threading.Thread(target=warm, args=(p,)) for p in shards]
for t in threads:
    t.start()
for t in threads:
    t.join()
took = max(time.monotonic() - t0, 1e-3)
if errors:
    sys.exit("page-cache warm failed: " + "; ".join(errors))
print(f"weights warm: {len(shards)} shards, {total / 1e9:.1f} GB in {took:.0f} s ({total / 1e6 / took:.0f} MB/s)", flush=True)
PY

# VLLM_API_KEY (from Secret Manager) gates every /v1 route; /health stays open
# for the Cloud Run startup probe. Images only: the judge never sends video.
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
  "$@"
