#!/usr/bin/env bash
# Stage PartCrafter's and RMBG's weights into the model-weights bucket. Run
# once (from any machine with gcloud + python3 + huggingface_hub) before the
# first deploy, and again only when bumping PARTCRAFTER_COMMIT in the
# Dockerfile.
#
#   bash workers/model-partcrafter/stage-assets.sh
#
# Layout produced under gs://three-ws-model-weights/partcrafter/:
#   PartCrafter/...  diffusion-transformer weights (wgsxm/PartCrafter)
#   RMBG-1.4/...     background-removal net (briaai/RMBG-1.4), PartCrafter's
#                    own preprocessing dependency (scripts/inference_partcrafter.py)
set -euo pipefail

BUCKET="${BUCKET:-gs://three-ws-model-weights/partcrafter}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> PartCrafter weights (HF: wgsxm/PartCrafter)"
python3 -c "
from huggingface_hub import snapshot_download
path = snapshot_download(repo_id='wgsxm/PartCrafter', local_dir='$WORK/PartCrafter')
print('downloaded to', path)
"

echo "==> RMBG-1.4 weights (HF: briaai/RMBG-1.4)"
python3 -c "
from huggingface_hub import snapshot_download
path = snapshot_download(repo_id='briaai/RMBG-1.4', local_dir='$WORK/RMBG-1.4')
print('downloaded to', path)
"

echo "==> Upload to $BUCKET"
gcloud storage cp -r "$WORK/PartCrafter" "$BUCKET/PartCrafter"
gcloud storage cp -r "$WORK/RMBG-1.4" "$BUCKET/RMBG-1.4"

echo "==> Staged. Verify:"
gcloud storage ls -r "$BUCKET" | sed 's/^/    /'
