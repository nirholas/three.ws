#!/bin/sh
# Wire staged SAM 3D Objects checkpoints into the path pipeline.py loads from
# (SAM3D_CHECKPOINT_DIR), then serve.
#
# Checkpoints are COPIED from the FUSE-mounted bucket to local disk rather than
# symlinked: torch.load over gcsfuse does slow random reads, and a sequential
# cp is fast and deterministic.
set -eu

WEIGHTS_ROOT="${WEIGHTS_ROOT:-/weights/sam3d-objects}"
SAM3D_CHECKPOINT_DIR="${SAM3D_CHECKPOINT_DIR:-/app/checkpoints/hf}"

if [ ! -e "$WEIGHTS_ROOT/hf/pipeline.yaml" ]; then
  echo "fatal: expected staged checkpoints at $WEIGHTS_ROOT/hf (run: HF_TOKEN=... npm run stage:sam3d-objects -- --accept-sam-license)" >&2
  exit 1
fi

mkdir -p "$(dirname "$SAM3D_CHECKPOINT_DIR")"
rm -rf "$SAM3D_CHECKPOINT_DIR"
echo "staging $WEIGHTS_ROOT/hf -> $SAM3D_CHECKPOINT_DIR"
cp -r "$WEIGHTS_ROOT/hf" "$SAM3D_CHECKPOINT_DIR"
[ -f "$WEIGHTS_ROOT/LICENSE" ] && cp "$WEIGHTS_ROOT/LICENSE" "$SAM3D_CHECKPOINT_DIR/../SAM_LICENSE" || true

exec uvicorn main:app --host 0.0.0.0 --port 8080 --workers 1 --timeout-keep-alive 300
