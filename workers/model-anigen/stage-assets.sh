#!/usr/bin/env bash
# Stage AniGen's checkpoints into the model-weights bucket. Run once (from any
# machine with gcloud + python3 + huggingface_hub) before the first deploy,
# and again only when bumping ANIGEN_COMMIT in the Dockerfile.
#
#   bash workers/model-anigen/stage-assets.sh
#
# Layout produced under gs://three-ws-model-weights/anigen/:
#   ckpts/anigen/<flows and autoencoders>  AniGen's own checkpoints
#   ckpts/dinov2/...                       DINOv2 as a local torch.hub repo
#   ckpts/marigold-normals-lcm-v0-1/...    normal estimator (normal_estimator.py)
#
# The AniGen snapshot is the exact same call AniGen's own
# anigen/utils/ckpt_utils.py (ensure_ckpts) makes at runtime when ckpts/ is
# missing, minus DSINE: its licence is non-commercial only, so this worker
# never stages or loads it (patch_anigen.py). entrypoint.sh copies only the
# serving subset into the container, so production needs no Hugging Face or
# GitHub egress.
set -euo pipefail

BUCKET="${BUCKET:-gs://three-ws-model-weights/anigen}"
WORK="$(mktemp -d)"
# Pinned: the revision normal_estimator.py's frame conversion was checked
# against. fp16 weights only (the variant load_normal_estimator requests).
MARIGOLD_REPO=prs-eth/marigold-normals-lcm-v0-1
MARIGOLD_REVISION=28214f06633a6a73088b569d1d068c3e48ea7902
trap 'rm -rf "$WORK"' EXIT

echo "==> AniGen checkpoints (HF: VAST-AI/AniGen)"
python3 -c "
from huggingface_hub import snapshot_download
path = snapshot_download(
    repo_id='VAST-AI/AniGen',
    allow_patterns=['ckpts/**'],
    ignore_patterns=['ckpts/dsine/**'],
    local_dir='$WORK',
)
print('downloaded to', path)
"

echo "==> Marigold normals (HF: $MARIGOLD_REPO @ $MARIGOLD_REVISION, Apache-2.0)"
python3 -c "
from huggingface_hub import snapshot_download
path = snapshot_download(
    repo_id='$MARIGOLD_REPO',
    revision='$MARIGOLD_REVISION',
    allow_patterns=['model_index.json', 'README.md', 'scheduler/*', 'tokenizer/*',
                    '*/config.json', '*.fp16.safetensors'],
    local_dir='$WORK/ckpts/marigold-normals-lcm-v0-1',
)
print('downloaded to', path)
"

echo "==> Upload to $BUCKET"
gcloud storage cp -r "$WORK/ckpts" "$BUCKET/ckpts"

echo "==> Staged. Verify:"
gcloud storage ls -r "$BUCKET" | sed 's/^/    /'
