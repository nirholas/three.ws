#!/bin/sh
# Wire the staged PartCrafter weights into the local path pipeline.py loads
# from (PARTCRAFTER_WEIGHTS_ROOT/PartCrafter), then serve. The BiRefNet
# matting model is baked into the image by checksum (see the Dockerfile), so
# only the diffusion weights come from the bucket.
#
# Checkpoints are COPIED from the FUSE-mounted bucket to local disk rather
# than symlinked, same reasoning as workers/model-anigen: torch.load over
# gcsfuse does slow random reads, and a sequential cp of a few GB is fast and
# deterministic.
set -eu

WEIGHTS_ROOT="${WEIGHTS_ROOT:-/weights/partcrafter}"
PARTCRAFTER_WEIGHTS_ROOT="${PARTCRAFTER_WEIGHTS_ROOT:-/app/pretrained_weights}"

if [ ! -e "$WEIGHTS_ROOT/PartCrafter/model_index.json" ]; then
  echo "fatal: expected staged weights at $WEIGHTS_ROOT/PartCrafter (run workers/model-partcrafter/stage-assets.sh)" >&2
  exit 1
fi

mkdir -p "$PARTCRAFTER_WEIGHTS_ROOT"
rm -rf "$PARTCRAFTER_WEIGHTS_ROOT/PartCrafter"
echo "staging $WEIGHTS_ROOT/PartCrafter -> $PARTCRAFTER_WEIGHTS_ROOT/PartCrafter"
cp -r "$WEIGHTS_ROOT/PartCrafter" "$PARTCRAFTER_WEIGHTS_ROOT/PartCrafter"

exec uvicorn main:app --host 0.0.0.0 --port 8080 --workers 1 --timeout-keep-alive 300
