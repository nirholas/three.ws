#!/usr/bin/env bash
# Stage TripoSplat weights (MIT, HF VAST-AI/TripoSplat) into the shared weights bucket.
#
# huggingface_hub is installed into a throwaway --target directory instead of the
# interpreter's site-packages: Debian/Ubuntu Pythons are PEP 668 "externally
# managed" and refuse a bare `pip install`, which used to kill this script on
# its first line of work.
set -euo pipefail
DEST="${WEIGHTS_BUCKET:-gs://three-ws-model-weights}/triposplat"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
python3 -m pip install -q --target "$TMP/deps" huggingface_hub
PYTHONPATH="$TMP/deps" python3 -I -c "import sys; sys.path.insert(0, '$TMP/deps'); from huggingface_hub import snapshot_download; snapshot_download('VAST-AI/TripoSplat', local_dir='$TMP/weights')"
gcloud storage cp -r "$TMP/weights"/* "$DEST/"
echo "staged to $DEST"
