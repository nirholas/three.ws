#!/usr/bin/env bash
# Stage TripoSplat weights (MIT, HF VAST-AI/TripoSplat) into the shared weights bucket.
set -euo pipefail
DEST="${WEIGHTS_BUCKET:-gs://three-ws-model-weights}/triposplat"
TMP="$(mktemp -d)"
python3 -m pip install -q huggingface_hub
python3 -c "from huggingface_hub import snapshot_download; snapshot_download('VAST-AI/TripoSplat', local_dir='$TMP')"
gcloud storage cp -r "$TMP"/* "$DEST/"
rm -rf "$TMP"
echo "staged to $DEST"
