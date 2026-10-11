#!/bin/sh
# Wire staged AniGen checkpoints into the literal relative path its own
# from_pretrained call uses (example.py: ss_flow_path='ckpts/anigen/ss_flow_solo',
# slat_flow_path='ckpts/anigen/slat_flow_auto'), then serve.
#
# Checkpoints are COPIED from the FUSE-mounted bucket to local disk rather than
# symlinked, same reasoning as workers/rig and workers/rig-nonhuman:
# torch.load over gcsfuse does slow random reads, and a sequential cp of a few
# GB is fast and deterministic.
set -eu

WEIGHTS_ROOT="${WEIGHTS_ROOT:-/weights/anigen}"
ANIGEN_CKPT_ROOT="${ANIGEN_CKPT_ROOT:-/app}"
DST="$ANIGEN_CKPT_ROOT/ckpts/anigen"

if [ ! -e "$WEIGHTS_ROOT/ckpts/anigen" ]; then
  echo "fatal: expected staged checkpoints at $WEIGHTS_ROOT/ckpts/anigen (run workers/model-anigen/stage-assets.sh)" >&2
  exit 1
fi

mkdir -p "$ANIGEN_CKPT_ROOT/ckpts"
rm -rf "$DST"
echo "staging $WEIGHTS_ROOT/ckpts/anigen -> $DST"
cp -r "$WEIGHTS_ROOT/ckpts/anigen" "$DST"

exec uvicorn main:app --host 0.0.0.0 --port 8080 --workers 1 --timeout-keep-alive 300
