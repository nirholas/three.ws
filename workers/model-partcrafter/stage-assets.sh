#!/usr/bin/env bash
# Stage PartCrafter's weights into the model-weights bucket. Run
# once (from any machine with gcloud + python3 + huggingface_hub) before the
# first deploy, and again only when bumping PARTCRAFTER_COMMIT in the
# Dockerfile.
#
#   bash workers/model-partcrafter/stage-assets.sh
#
# Layout produced under gs://three-ws-model-weights/partcrafter/:
#   PartCrafter/...  diffusion transformer, VAE, DINOv2 image encoder and
#                    scheduler (wgsxm/PartCrafter, MIT)
#
# Background matting is NOT staged here: upstream's RMBG-1.4 is licensed for
# non-commercial use only, so this worker uses BiRefNet (MIT) instead, baked
# into the image by checksum in the Dockerfile.
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

echo "==> Upload to $BUCKET"
gcloud storage cp -r "$WORK/PartCrafter" "$BUCKET/PartCrafter"

echo "==> Staged. Verify:"
gcloud storage ls -r "$BUCKET" | sed 's/^/    /'
