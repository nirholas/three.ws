#!/usr/bin/env bash
# Stage the LATO.2 checkpoints (MIT, 0x4c48/LATO.2) into gs://three-ws-model-weights,
# streaming straight from the Hub to the bucket. Idempotent: an object already at
# the expected size is skipped.
#
#   workers/model-lato2/stage_weights.sh
#
# Writes gs://<bucket>/lato2/*.pt, the prefix the worker's WEIGHTS_GCS_URI names.
# vdf_encoder.pt is not staged: the end-to-end pipeline does not load it.
set -euo pipefail

BUCKET="${WEIGHTS_BUCKET:-three-ws-model-weights}"
PREFIX="${WEIGHTS_PREFIX:-lato2}"
REPO="0x4c48/LATO.2"
FILES=(vflow.pt vvae.pt offset_head.pt tflow.pt tvae.pt voxel_encoder.pt)

remote_size() { gcloud storage objects describe "$1" --format='value(size)' 2>/dev/null || true; }

for f in "${FILES[@]}"; do
  dest="gs://${BUCKET}/${PREFIX}/${f}"
  size="$(curl -fsSI -L "https://huggingface.co/${REPO}/resolve/main/${f}" \
    | tr -d '\r' | awk 'tolower($1)=="content-length:" {s=$2} END {print s}')"
  if [[ "$(remote_size "$dest")" == "$size" && -n "$size" ]]; then
    echo "skip  $dest"
    continue
  fi
  echo "copy  ${REPO}/${f} -> ${dest} (${size} bytes)"
  curl -fsSL "https://huggingface.co/${REPO}/resolve/main/${f}" | gcloud storage cp - "$dest" --quiet
  got="$(remote_size "$dest")"
  if [[ "$got" != "$size" ]]; then
    echo "FAIL  ${dest}: expected ${size} bytes, bucket has ${got:-none}" >&2
    exit 1
  fi
done
echo "lato2 weights staged at gs://${BUCKET}/${PREFIX}"
