#!/usr/bin/env bash
# Stage HoloPart's weights into the model-weights bucket. Run once (from any
# machine with gcloud + python3 + huggingface_hub) before the first deploy,
# and again only when bumping HOLOPART_COMMIT in the Dockerfile.
#
#   bash workers/model-holopart/stage-assets.sh
#
# Layout produced under gs://three-ws-model-weights/holopart/:
#   HoloPart/...  diffusion weights (VAST-AI/HoloPart)
#
# This is the exact same call upstream's own inference_holopart.py makes at
# runtime when its local weights dir is missing; staging it here ahead of
# time means entrypoint.sh never needs Hugging Face egress in production.
set -euo pipefail

BUCKET="${BUCKET:-gs://three-ws-model-weights/holopart}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> HoloPart weights (HF: VAST-AI/HoloPart)"
python3 -c "
from huggingface_hub import snapshot_download
path = snapshot_download(repo_id='VAST-AI/HoloPart', local_dir='$WORK/HoloPart')
print('downloaded to', path)
"

echo "==> Upload to $BUCKET"
gcloud storage cp -r "$WORK/HoloPart" "$BUCKET/HoloPart"

echo "==> Staged. Verify:"
gcloud storage ls -r "$BUCKET" | sed 's/^/    /'
