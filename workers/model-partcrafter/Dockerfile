# PartCrafter (wgsxm/PartCrafter, MIT, LICENSE read 2026-10-11): one
# reference image to a part-separated 3D asset, N named part meshes decoded
# in a single diffusion-transformer pass. Built on a TripoSG-derived
# backbone. Upstream's README targets Python 3.11 and torch 2.5.1+cu124, and its
# settings/setup.sh installs torch-cluster from the matching PyG index, so
# this image uses exactly that stack. Nothing here compiles CUDA code, so the
# smaller runtime base is enough; torch's own wheels carry cuDNN and cuBLAS.
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    PYTHONPATH=/app/partcrafter-src \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    DO_NOT_TRACK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3.11-dev python3.11-venv python3-pip \
        git curl ca-certificates \
        libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.11 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.11 /usr/bin/python \
    && python3 -m pip install --upgrade pip setuptools wheel

# 1. torch, its own cached layer, then torch-cluster from the PyG wheel index
# built for exactly this torch/CUDA pair (PartCrafter's sampler imports it).
RUN python3 -m pip install torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu124 \
    && python3 -m pip install torch-cluster==1.6.3 -f https://data.pyg.org/whl/torch-2.5.1+cu124.html

# 2. PartCrafter, pinned to the commit read on 2026-10-11
# (https://github.com/wgsxm/PartCrafter/commit/3d773bf02fad51c7ab31a5615573fec93b287b30).
ARG PARTCRAFTER_COMMIT=3d773bf02fad51c7ab31a5615573fec93b287b30
RUN git clone https://github.com/wgsxm/PartCrafter.git /app/partcrafter-src \
    && git -C /app/partcrafter-src checkout ${PARTCRAFTER_COMMIT} \
    && rm -rf /app/partcrafter-src/.git

# 3. BiRefNet (ZhengPeng7/BiRefNet, MIT) foreground matting, as the ONNX
# export the rembg project (danielgatis/rembg, MIT) publishes, pinned by
# checksum. Upstream PartCrafter uses BRIA RMBG-1.4 here, which is licensed
# for non-commercial use only, so it is deliberately not part of this image.
ARG BIREFNET_SHA256=58f621f00f5d756097615970a88a791584600dcf7c45b18a0a6267535a1ebd3c
RUN mkdir -p /app/models \
    && curl -fsSL -o /app/models/birefnet-general.onnx \
        https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx \
    && echo "${BIREFNET_SHA256}  /app/models/birefnet-general.onnx" | sha256sum -c -

# 4. The inference dependencies (requirements.txt pins and explains them).
# Upstream's settings/requirements.txt is a training environment (deepspeed,
# wandb, pyrender, a Gemini client) with every ML library unpinned, so it is
# not installed wholesale.
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN python3 -m pip install -r /app/requirements.txt

# 5. Two surgical fixes to the pinned checkout (patch_upstream.py explains
# both): log the part-decode exceptions upstream silently discards, and stop
# hardcoding the CUDA device in the octree expansion. Fails the build if
# either target line moved.
COPY patch_upstream.py /app/patch_upstream.py
RUN python3 /app/patch_upstream.py /app/partcrafter-src

COPY worker_security.py storage_backend.py matting.py pipeline.py main.py entrypoint.sh /app/
COPY test_app_contract.py test_matting.py test_patch_upstream.py /app/
RUN chmod +x /app/entrypoint.sh

# Build-time guards, none of which need a GPU or the diffusion checkpoints:
#   * PartCrafter's whole inference import chain resolves against the pinned
#     dependency set (catches upstream or dependency drift at build time
#     instead of at the first cold start);
#   * the reference-image framing is correct;
#   * the served contract (auth, probes, request validation) holds.
#   * the patch_upstream.py fixes are applied and the patcher still guards
#     against moved target lines.
RUN python3 -c "import torch_cluster, onnxruntime; from src.pipelines.pipeline_partcrafter import PartCrafterPipeline; print('import chain ok', onnxruntime.get_available_providers())" \
    && python3 /app/test_matting.py \
    && python3 /app/test_app_contract.py \
    && python3 /app/test_patch_upstream.py

# PartCrafter's weights are staged in GCS (stage-assets.sh) and mounted at
# /weights by Cloud Run; entrypoint.sh copies them into
# PARTCRAFTER_WEIGHTS_ROOT, the literal path pipeline.py's from_pretrained
# call uses, so inference needs no Hugging Face egress at runtime.

EXPOSE 8080

CMD ["/app/entrypoint.sh"]
