#!/usr/bin/env bash
# Stage LHM weights into the weights bucket under lhm/ (dev use only, see README License).
#   lhm/exps/releases/LHM-500M-HF  model snapshot (Apache-2.0)
#   lhm/<prior contents>  extracted of LHM_prior_model.tar (SMPL-X + Sapiens + SAM2:
#                        NON-COMMERCIAL components). Download the tar yourself from the
#                        link in the upstream README after accepting the SMPL-X licence,
#                        and pass its path as $1.
set -euo pipefail
DEST="${WEIGHTS_BUCKET:-gs://three-ws-model-weights}/lhm"
PRIOR_TAR="${1:?usage: stage-assets.sh /path/to/LHM_prior_model.tar}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
python3 -m pip install -q --target "$TMP/deps" huggingface_hub
PYTHONPATH="$TMP/deps" python3 -I -c "import sys; sys.path.insert(0, '$TMP/deps'); from huggingface_hub import snapshot_download; snapshot_download('3DAIGC/LHM-500M-HF', local_dir='$TMP/weights/exps/releases/LHM-500M-HF')"
mkdir -p "$TMP/prior"
tar -xf "$PRIOR_TAR" -C "$TMP/prior"
gcloud storage cp -r "$TMP/weights"/* "$DEST/"
gcloud storage cp -r "$TMP/prior"/* "$DEST/"
echo "staged to $DEST"
