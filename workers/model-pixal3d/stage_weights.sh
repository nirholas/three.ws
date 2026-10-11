#!/usr/bin/env bash
# Stage every weight Pixal3D (and its optional MV-Adapter rung) needs into
# gs://three-ws-model-weights, streaming straight from the source to the
# bucket (no local disk). Idempotent: an object that already exists at the
# expected size is skipped. Mirrors workers/model-trellis2/stage_weights.sh.
#
#   workers/model-pixal3d/stage_weights.sh
#
# Layout written (the worker's WEIGHTS_GCS_URI points at the first prefix):
#   gs://<bucket>/pixal3d/                 TencentARC/Pixal3D (MIT): pipeline.json,
#                                           pipeline_mv.json, ckpts/*
#   gs://<bucket>/pixal3d/dinov3/          camenduru/dinov3-vitl16-pretrain-lvd1689m,
#                                           the same ungated DINOv3 ViT-L/16 mirror
#                                           workers/model-trellis2 already stages
#                                           (the facebook/ original is gated).
#   gs://<bucket>/pixal3d/birefnet/        ZhengPeng7/BiRefNet (MIT), the background
#                                           matte. Replaces upstream's default,
#                                           RMBG-2.0, whose CC BY-NC licence excludes
#                                           commercial use.
#   gs://<bucket>/pixal3d-mvadapter/       the optional "fill in the other sides"
#     sdxl-base/                           rung (mv_adapter_fill.py), only read when
#     sdxl-vae-fix/                        a caller sets fill_other_sides=true:
#     mv-adapter/                            stabilityai/stable-diffusion-xl-base-1.0
#                                              (CreativeML Open RAIL++-M, permits
#                                              commercial hosting), default-precision
#                                              safetensors only (the fp16-variant
#                                              files are skipped; MV-Adapter casts to
#                                              fp16 itself after loading)
#                                            madebyollin/sdxl-vae-fp16-fix (MIT)
#                                            huanngzh/mv-adapter (Apache-2.0)
set -euo pipefail

BUCKET="${WEIGHTS_BUCKET:-three-ws-model-weights}"
PREFIX="${WEIGHTS_PREFIX:-pixal3d}"
MVADAPTER_PREFIX="${MVADAPTER_WEIGHTS_PREFIX:-pixal3d-mvadapter}"
DEST="gs://${BUCKET}/${PREFIX}"
MV_DEST="gs://${BUCKET}/${MVADAPTER_PREFIX}"
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

mirror_repo() { # <repo> <dest prefix> [include regex] [exclude regex]
  local repo="$1" dest="$2" include="${3:-.}" exclude="${4:-$}"
  while read -r path size; do
    [[ "$path" =~ $include ]] || continue
    [[ "$path" == .gitattributes ]] && continue
    [[ "$exclude" != '$' && "$path" =~ $exclude ]] && continue
    copy_one "$repo" "$path" "$size" "${dest}/${path}"
  done < <(list_repo "$repo")
}

# TencentARC/Pixal3D's pipeline.json / pipeline_mv.json / ckpts/*.
mirror_repo TencentARC/Pixal3D "${DEST}"
mirror_repo camenduru/dinov3-vitl16-pretrain-lvd1689m "${DEST}/dinov3"
mirror_repo ZhengPeng7/BiRefNet "${DEST}/birefnet"
echo "pixal3d weights staged at ${DEST}"

# The optional MV-Adapter rung. Set SKIP_MVADAPTER=1 to stage only the core
# 1-4 image lanes above and leave fill_other_sides unavailable for now.
if [[ "${SKIP_MVADAPTER:-0}" != "1" ]]; then
  mirror_repo stabilityai/stable-diffusion-xl-base-1.0 "${MV_DEST}/sdxl-base" '.' 'fp16|\.(bin|ckpt|onnx|msgpack)$'
  mirror_repo madebyollin/sdxl-vae-fp16-fix "${MV_DEST}/sdxl-vae-fix" '.' '\.(bin|ckpt|onnx|msgpack)$'
  mirror_repo huanngzh/mv-adapter "${MV_DEST}/mv-adapter"
  echo "mv-adapter weights staged at ${MV_DEST}"
fi
