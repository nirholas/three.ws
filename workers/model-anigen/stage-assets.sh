#!/usr/bin/env bash
# Stage AniGen's checkpoints into the model-weights bucket. Run once (from any
# machine with gcloud + python3 + huggingface_hub) before the first deploy,
# and again only when bumping ANIGEN_COMMIT in the Dockerfile.
#
#   bash workers/model-anigen/stage-assets.sh
#
# Layout produced under gs://three-ws-model-weights/anigen/:
#   ckpts/anigen/ss_flow_solo/...    sparse-structure flow checkpoint
#   ckpts/anigen/slat_flow_auto/...  SLat flow checkpoint
#
# This is the exact same call AniGen's own anigen/utils/ckpt_utils.py
# (ensure_ckpts) makes at runtime when ckpts/ is missing; staging it here
# ahead of time means entrypoint.sh never needs Hugging Face egress in
# production.
set -euo pipefail

BUCKET="${BUCKET:-gs://three-ws-model-weights/anigen}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> AniGen checkpoints (HF: VAST-AI/AniGen)"
python3 -c "
from huggingface_hub import snapshot_download
path = snapshot_download(
    repo_id='VAST-AI/AniGen',
    allow_patterns=['ckpts/**'],
    local_dir='$WORK',
)
print('downloaded to', path)
"

echo "==> Upload to $BUCKET"
gcloud storage cp -r "$WORK/ckpts" "$BUCKET/ckpts"

echo "==> Staged. Verify:"
gcloud storage ls -r "$BUCKET" | sed 's/^/    /'
