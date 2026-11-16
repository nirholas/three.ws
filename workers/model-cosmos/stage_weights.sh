#!/usr/bin/env bash
# Stage the Cosmos3-Nano diffusers checkpoint into the europe-west4 weights
# bucket, streaming each file from Hugging Face straight into GCS (no local
# disk). Idempotent: an object already present at the expected size is skipped.
#
#   workers/model-cosmos/stage_weights.sh
#
# Layout written (the worker's MODEL_DIR points at the mounted prefix):
#   gs://<bucket>/cosmos3-nano/   nvidia/Cosmos3-Nano at a pinned revision
#                                 (OpenMDW-1.1, ungated). The repo's sample
#                                 assets/ and images/ folders are skipped.
set -euo pipefail

BUCKET="${WEIGHTS_BUCKET:-three-ws-model-weights-euw4}"
PREFIX="${WEIGHTS_PREFIX:-cosmos3-nano}"
REPO="${COSMOS_REPO:-nvidia/Cosmos3-Nano}"
REVISION="${COSMOS_REVISION:-45666784803b3a7ad577e0def405f9afcc3bddb2}"
DEST="gs://${BUCKET}/${PREFIX}"
AUTH=()
if [[ -n "${HF_TOKEN:-}" ]]; then AUTH=(-H "Authorization: Bearer ${HF_TOKEN}"); fi

remote_size() { gcloud storage objects describe "$1" --format='value(size)' 2>/dev/null || true; }

listing="$(curl -fsS "${AUTH[@]}" "https://huggingface.co/api/models/${REPO}/tree/${REVISION}?recursive=1" \
  | python3 -I -c 'import json,sys
for f in json.load(sys.stdin):
    if f.get("type") == "file":
        print(f["path"], f.get("size") or 0)')"
if [[ -z "$listing" ]]; then
  echo "FAIL  ${REPO}@${REVISION}: empty file listing" >&2
  exit 1
fi

while read -r path size; do
  case "$path" in
    assets/*|images/*|.gitattributes) continue ;;
  esac
  dest="${DEST}/${path}"
  if [[ "$(remote_size "$dest")" == "$size" && "$size" != "0" ]]; then
    echo "skip  $dest"
    continue
  fi
  echo "copy  ${REPO}/${path} -> $dest ($size bytes)"
  curl -fsSL "${AUTH[@]}" "https://huggingface.co/${REPO}/resolve/${REVISION}/${path}" \
    | gcloud storage cp - "$dest" --quiet
  got="$(remote_size "$dest")"
  if [[ "$size" != "0" && "$got" != "$size" ]]; then
    echo "FAIL  $dest: expected $size bytes, bucket has ${got:-none}" >&2
    exit 1
  fi
done <<< "$listing"

printf '%s\n' "$REVISION" | gcloud storage cp - "${DEST}/REVISION" --quiet
echo "cosmos3-nano weights staged at ${DEST} (revision ${REVISION})"
