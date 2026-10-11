#!/usr/bin/env bash
# Stage every weight TRELLIS.2 needs into gs://three-ws-model-weights, streaming
# straight from the source to the bucket (no local disk). Idempotent: an object
# that already exists at the expected size is skipped.
#
#   workers/model-trellis2/stage_weights.sh
#
# Layout written (the worker's WEIGHTS_GCS_URI points at the first prefix):
#   gs://<bucket>/trellis2-4b/                 microsoft/TRELLIS.2-4B (MIT)
#   gs://<bucket>/trellis2-4b/ss_dec/          ss_dec_conv3d_16l8_fp16 from
#                                              microsoft/TRELLIS-image-large (MIT);
#                                              pipeline.json names it by repo path
#   gs://<bucket>/trellis2-4b/dinov3/          camenduru/dinov3-vitl16-pretrain-lvd1689m,
#                                              an ungated mirror of the DINOv3 ViT-L/16
#                                              weights that ships the DINOv3 LICENSE.md.
#                                              The official facebook repo is gated; to
#                                              use it instead, mirror it here with an
#                                              HF_TOKEN whose account accepted the terms.
#   gs://<bucket>/trellis2-4b/birefnet/        ZhengPeng7/BiRefNet (MIT), the background
#                                              matte. Replaces the upstream default,
#                                              RMBG-2.0, whose CC BY-NC licence excludes
#                                              commercial use.
set -euo pipefail

BUCKET="${WEIGHTS_BUCKET:-three-ws-model-weights}"
PREFIX="${WEIGHTS_PREFIX:-trellis2-4b}"
DEST="gs://${BUCKET}/${PREFIX}"
AUTH=()
if [[ -n "${HF_TOKEN:-}" ]]; then AUTH=(-H "Authorization: Bearer ${HF_TOKEN}"); fi

list_repo() { # <repo> -> "path size" lines
  curl -fsS "${AUTH[@]}" "https://huggingface.co/api/models/$1?blobs=true" \
    | python3 -I -c 'import json,sys
for s in json.load(sys.stdin)["siblings"]:
    print(s["rfilename"], s.get("size") or 0)'
}

remote_size() { gcloud storage objects describe "$1" --format='value(size)' 2>/dev/null || true; }

copy_one() { # <repo> <src path> <size> <dest uri>
  local repo="$1" path="$2" size="$3" dest="$4"
  if [[ "$(remote_size "$dest")" == "$size" && "$size" != "0" ]]; then
    echo "skip  $dest"
    return
  fi
  echo "copy  $repo/$path -> $dest ($size bytes)"
  curl -fsSL "${AUTH[@]}" "https://huggingface.co/${repo}/resolve/main/${path}" \
    | gcloud storage cp - "$dest" --quiet
  local got
  got="$(remote_size "$dest")"
  if [[ "$size" != "0" && "$got" != "$size" ]]; then
    echo "FAIL  $dest: expected $size bytes, bucket has ${got:-none}" >&2
    exit 1
  fi
}

mirror_repo() { # <repo> <dest prefix> [path regex]
  local repo="$1" dest="$2" only="${3:-.}"
  while read -r path size; do
    [[ "$path" =~ $only ]] || continue
    [[ "$path" == .gitattributes ]] && continue
    copy_one "$repo" "$path" "$size" "${dest}/${path}"
  done < <(list_repo "$repo")
}

mirror_repo microsoft/TRELLIS.2-4B "${DEST}"
mirror_repo microsoft/TRELLIS-image-large "${DEST}/ss_dec" '^ckpts/ss_dec_conv3d_16l8_fp16\.'
mirror_repo camenduru/dinov3-vitl16-pretrain-lvd1689m "${DEST}/dinov3"
mirror_repo ZhengPeng7/BiRefNet "${DEST}/birefnet"
echo "trellis2 weights staged at ${DEST}"
