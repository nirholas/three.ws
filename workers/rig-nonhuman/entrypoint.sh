#!/bin/sh
# Wire staged assets into the UniRig and SkinTokens checkouts, then serve.
#
# Both engines resolve their checkpoints by trying Hugging Face Hub first and
# falling back to the literal relative path on failure (UniRig's
# src/inference/download.py, run.py:240); placing the files at that literal
# path means inference needs no Hugging Face egress at runtime. Checkpoints
# are COPIED from the FUSE-mounted bucket to local disk rather than
# symlinked, same reasoning as workers/rig: torch.load over gcsfuse does slow
# random reads, and a sequential cp of a few GB is fast and deterministic.
set -eu

WEIGHTS_ROOT="${WEIGHTS_ROOT:-/weights/rig-nonhuman}"
UNIRIG_DIR="${UNIRIG_DIR:-/app/unirig}"
SKINTOKENS_DIR="${SKINTOKENS_DIR:-/app/skintokens}"

for pair in "unirig/experiments:$UNIRIG_DIR/experiments" \
            "skintokens/experiments:$SKINTOKENS_DIR/experiments" \
            "skintokens/models:$SKINTOKENS_DIR/models"; do
  rel="${pair%%:*}"
  dst="${pair#*:}"
  src="$WEIGHTS_ROOT/$rel"
  if [ ! -e "$src" ]; then
    echo "fatal: expected staged assets at $src (run workers/rig-nonhuman/stage-assets.sh)" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$dst")"
  rm -rf "$dst"
  echo "staging $src -> $dst"
  cp -r "$src" "$dst"
done

exec uvicorn main:app --host 0.0.0.0 --port 8080 --workers 1 --timeout-keep-alive 300
