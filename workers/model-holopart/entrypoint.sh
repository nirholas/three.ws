#!/bin/sh
# Wire staged HoloPart weights into the local path pipeline.py loads from
# (HOLOPART_WEIGHTS_ROOT), then serve.
#
# Checkpoints are COPIED from the FUSE-mounted bucket to local disk rather
# than symlinked, same reasoning as workers/model-anigen and
# workers/model-partcrafter: torch.load over gcsfuse does slow random reads,
# and a sequential cp of a few GB is fast and deterministic.
set -eu

WEIGHTS_ROOT="${WEIGHTS_ROOT:-/weights/holopart}"
HOLOPART_WEIGHTS_ROOT="${HOLOPART_WEIGHTS_ROOT:-/app/pretrained_weights/HoloPart}"

if [ ! -e "$WEIGHTS_ROOT/HoloPart" ]; then
  echo "fatal: expected staged weights at $WEIGHTS_ROOT/HoloPart (run workers/model-holopart/stage-assets.sh)" >&2
  exit 1
fi

mkdir -p "$(dirname "$HOLOPART_WEIGHTS_ROOT")"
rm -rf "$HOLOPART_WEIGHTS_ROOT"
echo "staging $WEIGHTS_ROOT/HoloPart -> $HOLOPART_WEIGHTS_ROOT"
cp -r "$WEIGHTS_ROOT/HoloPart" "$HOLOPART_WEIGHTS_ROOT"

exec uvicorn main:app --host 0.0.0.0 --port 8080 --workers 1 --timeout-keep-alive 300
