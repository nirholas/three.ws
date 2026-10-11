#!/usr/bin/env bash
# Stage the weights of every Modly model this worker serves into
# gs://three-ws-model-weights, streaming straight from the Hugging Face Hub to the
# bucket (no local disk). Each repo is pinned to a commit so a rebuild of the
# bucket reproduces the exact bytes the worker was verified against. Idempotent:
# an object that already exists at the expected size is skipped.
#
#   workers/modly/stage_weights.sh
#
# Layout written (the worker's WEIGHTS_GCS_URI points at the prefix; each model
# lands at <prefix>/<extension id>/<node id>/, the MODELS_DIR layout Modly reads):
#   gs://<bucket>/modly/triposg/generate/
#       VAST-AI/TripoSG (MIT) at 2c1c516d22d58db486a058d98d31bb6177344e06,
#       about 7.9 GB: DINOv2 image encoder, flow transformer, VAE, scheduler.
#   gs://<bucket>/modly/hunyuan3d-mini-turbo/generate/
#       tencent/Hunyuan3D-2mini (Tencent Hunyuan 3D 2.0 Community License) at
#       f90a0f7df7d5e6f71109cf333f6a95a0ae3194a6, about 4.2 GB: only the turbo
#       DiT and turbo VAE the extension loads, plus the LICENSE and NOTICE the
#       licence requires to travel with the weights. The fast and base variants
#       and the .ckpt duplicates are skipped.
#
# The background-removal model (rembg's u2net.onnx) is baked into the image by
# checksum, so nothing for it is staged here.
set -euo pipefail

BUCKET="${WEIGHTS_BUCKET:-three-ws-model-weights}"
PREFIX="${WEIGHTS_PREFIX:-modly}"
DEST="gs://${BUCKET}/${PREFIX}"
AUTH=()
if [[ -n "${HF_TOKEN:-}" ]]; then AUTH=(-H "Authorization: Bearer ${HF_TOKEN}"); fi

TRIPOSG_REPO="VAST-AI/TripoSG"
TRIPOSG_REV="2c1c516d22d58db486a058d98d31bb6177344e06"
HUNYUAN_REPO="tencent/Hunyuan3D-2mini"
HUNYUAN_REV="f90a0f7df7d5e6f71109cf333f6a95a0ae3194a6"

list_repo() { # <repo> <revision> -> "path size" lines
  curl -fsS "${AUTH[@]}" "https://huggingface.co/api/models/$1/revision/$2?blobs=true" \
    | python3 -I -c 'import json,sys
for s in json.load(sys.stdin)["siblings"]:
    print(s["rfilename"], s.get("size") or 0)'
}

remote_size() { gcloud storage objects describe "$1" --format='value(size)' 2>/dev/null || true; }

copy_one() { # <repo> <revision> <src path> <size> <dest uri>
  local repo="$1" rev="$2" path="$3" size="$4" dest="$5"
  if [[ "$(remote_size "$dest")" == "$size" && "$size" != "0" ]]; then
    echo "skip  $dest"
    return
  fi
  echo "copy  $repo@${rev:0:12}/$path -> $dest ($size bytes)"
  curl -fsSL "${AUTH[@]}" "https://huggingface.co/${repo}/resolve/${rev}/${path}" \
    | gcloud storage cp - "$dest" --quiet
  local got
  got="$(remote_size "$dest")"
  if [[ "$size" != "0" && "$got" != "$size" ]]; then
    echo "FAIL  $dest: expected $size bytes, bucket has ${got:-none}" >&2
    exit 1
  fi
}

mirror_repo() { # <repo> <revision> <dest prefix> <path regex>
  local repo="$1" rev="$2" dest="$3" only="$4" count=0
  while read -r path size; do
    [[ "$path" =~ $only ]] || continue
    copy_one "$repo" "$rev" "$path" "$size" "${dest}/${path}"
    count=$((count + 1))
  done < <(list_repo "$repo" "$rev")
  if [[ "$count" == 0 ]]; then
    echo "FAIL  no files of $repo@$rev matched $only" >&2
    exit 1
  fi
}

mirror_repo "$TRIPOSG_REPO" "$TRIPOSG_REV" "${DEST}/triposg/generate" \
  '^(model_index\.json|(feature_extractor_dinov2|image_encoder_dinov2|scheduler|transformer|vae)/.+\.(json|safetensors))$'
mirror_repo "$HUNYUAN_REPO" "$HUNYUAN_REV" "${DEST}/hunyuan3d-mini-turbo/generate" \
  '^(config\.json|LICENSE|NOTICE|hunyuan3d-(dit|vae)-v2-mini-turbo/(config\.yaml|model\.fp16\.safetensors))$'
echo "modly weights staged at ${DEST}"
