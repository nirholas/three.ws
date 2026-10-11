#!/usr/bin/env bash
# Stage everything the non-humanoid rig worker needs into the model-weights
# bucket. Run once (from any machine with gcloud + python3 + huggingface_hub)
# before the first deploy, and again only when bumping UNIRIG_COMMIT or
# SKINTOKENS_COMMIT in the Dockerfile.
#
#   bash workers/rig-nonhuman/stage-assets.sh
#
# Layout produced under gs://three-ws-model-weights/rig-nonhuman/:
#   unirig/experiments/skeleton/articulation-xl_quantization_256/model.ckpt
#     UniRig's skeleton-prediction checkpoint (HF: VAST-AI/UniRig). This is
#     the only UniRig checkpoint staged: skinning runs through SkinTokens
#     instead of UniRig's own generate_skin.sh.
#   skintokens/experiments/skin_vae_2_10_32768/last.ckpt
#     SkinTokens' FSQ-CVAE skin-weight tokenizer (HF: VAST-AI/SkinTokens).
#   skintokens/experiments/articulation_xl_quantization_256_token_4/grpo_1400.ckpt
#     SkinTokens' TokenRig autoregressive rigging checkpoint, GRPO-refined
#     (the README's "recommended" model).
#   skintokens/models/Qwen3-0.6B/
#     Config + tokenizer only (no .bin/.safetensors) for the Qwen3-0.6B
#     backbone architecture SkinTokens was fine-tuned from; the actual
#     weights live inside the two checkpoints above, same as upstream's own
#     download.py --model.
#
# Both UniRig and SkinTokens resolve their checkpoint paths by first trying
# huggingface_hub, then falling back to the literal relative path if that
# fails (see UniRig's src/inference/download.py and run.py:240); entrypoint.sh
# pre-places these files at those literal paths so inference needs no
# Hugging Face egress at runtime.
set -euo pipefail

BUCKET="${BUCKET:-gs://three-ws-model-weights/rig-nonhuman}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> UniRig skeleton checkpoint (HF: VAST-AI/UniRig)"
python3 -c "
from huggingface_hub import hf_hub_download
path = hf_hub_download(
    repo_id='VAST-AI/UniRig',
    filename='skeleton/articulation-xl_quantization_256/model.ckpt',
    local_dir='$WORK/unirig/experiments',
)
print('downloaded to', path)
"

echo "==> SkinTokens checkpoints + Qwen3-0.6B config (HF: VAST-AI/SkinTokens, Qwen/Qwen3-0.6B)"
python3 -c "
from huggingface_hub import hf_hub_download, snapshot_download

for name in (
    'experiments/skin_vae_2_10_32768/last.ckpt',
    'experiments/articulation_xl_quantization_256_token_4/grpo_1400.ckpt',
):
    path = hf_hub_download(repo_id='VAST-AI/SkinTokens', filename=name, local_dir='$WORK/skintokens')
    print('downloaded to', path)

path = snapshot_download(
    repo_id='Qwen/Qwen3-0.6B',
    local_dir='$WORK/skintokens/models/Qwen3-0.6B',
    ignore_patterns=['*.bin', '*.safetensors'],
)
print('downloaded to', path)
"

echo "==> Upload to $BUCKET"
gcloud storage cp -r "$WORK/unirig/experiments" "$BUCKET/unirig/experiments"
gcloud storage cp -r "$WORK/skintokens/experiments" "$BUCKET/skintokens/experiments"
gcloud storage cp -r "$WORK/skintokens/models" "$BUCKET/skintokens/models"

echo "==> Staged. Verify:"
gcloud storage ls -r "$BUCKET" | sed 's/^/    /'
