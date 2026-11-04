#!/bin/sh
# Stage exactly the checkpoints AniGen's serving path opens, then serve from
# the directory its cwd-relative loads resolve against.
#
# AniGen loads everything relative to the process cwd:
#   torch.hub.load('./ckpts/dinov2', 'dinov2_vitl14_reg', source='local')
#     (the vendored hub's _DINOV2_BASE_URL is "./ckpts/dinov2", so the reg4
#     weights come from ckpts/dinov2/dinov2_vitl14/)
#   ckpts/anigen/{ss_dae,slat_dae}   (decoders named in the flow configs,
#                                     checkpoint "final")
#   ckpts/anigen/<flow>/ckpts/denoiser.pt for the two flows main.py names
#   ckpts/marigold-normals-lcm-v0-1  (normal_estimator.py, replaces DSINE)
# So the process cds into ANIGEN_CKPT_ROOT and imports main.py via --app-dir.
#
# Only the serving set is copied. Cloud Run's writable filesystem is in
# memory and counts against the container limit: the whole bucket tree is
# 18 GiB (three unused flows, both autoencoder encoders, DSINE, VGG), which
# is why the first europe-west4 revision never passed its startup probe.
#
# Checkpoints are COPIED from the FUSE-mounted bucket rather than symlinked,
# same reasoning as workers/rig and workers/rig-nonhuman: torch.load over
# gcsfuse does slow random reads, a sequential cp is fast and deterministic.
set -eu

WEIGHTS_ROOT="${WEIGHTS_ROOT:-/weights/anigen}"
ANIGEN_CKPT_ROOT="${ANIGEN_CKPT_ROOT:-/app}"
APP_DIR="${APP_DIR:-/app}"
SRC="$WEIGHTS_ROOT/ckpts"
DST="$ANIGEN_CKPT_ROOT/ckpts"

SERVING_SET="
anigen/ss_flow_solo/config.json
anigen/ss_flow_solo/ckpts/denoiser.pt
anigen/slat_flow_auto/config.json
anigen/slat_flow_auto/ckpts/denoiser.pt
anigen/ss_dae/config.json
anigen/ss_dae/ckpts/decoder_final.pt
anigen/slat_dae/config.json
anigen/slat_dae/ckpts/decoder_final.pt
dinov2/hubconf.py
dinov2/dinov2
dinov2/dinov2_vitl14/dinov2_vitl14_reg4_pretrain.pth
marigold-normals-lcm-v0-1
"

missing=""
for rel in $SERVING_SET; do
  [ -e "$SRC/$rel" ] || missing="$missing $rel"
done
if [ -n "$missing" ]; then
  echo "fatal: checkpoints missing under $SRC:$missing (run workers/model-anigen/stage-assets.sh)" >&2
  exit 1
fi

rm -rf "$DST"
for rel in $SERVING_SET; do
  mkdir -p "$(dirname "$DST/$rel")"
  echo "staging $SRC/$rel -> $DST/$rel"
  cp -r "$SRC/$rel" "$DST/$rel"
done

cd "$ANIGEN_CKPT_ROOT"
exec uvicorn main:app --app-dir "$APP_DIR" --host 0.0.0.0 --port 8080 --workers 1 --timeout-keep-alive 300
