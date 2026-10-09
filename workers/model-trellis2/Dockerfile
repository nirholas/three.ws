# TRELLIS.2 (Microsoft, MIT): single image to a PBR-textured 3D asset on an L4 (24 GB).
#
# Translates the upstream conda `setup.sh` into a reproducible pip build.
#   * CUDA 12.4 *devel* base: nvcc compiles CuMesh, FlexGEMM, O-Voxel and
#     nvdiffrast from source, and 12.4 is the toolkit upstream recommends.
#   * torch 2.6.0 + cu124, the matrix upstream's setup.sh installs.
#   * Attention backend = xformers, NOT flash-attn. flash-attn compiles from source
#     for 30+ minutes and routinely OOMs the builder; xformers is an upstream
#     supported backend and runs on the L4 (sm_89). Set via ATTN_BACKEND.
#   * TORCH_CUDA_ARCH_LIST defaults to 8.9 (L4). Pass a wider list for other GPUs.
#   * nvdiffrec is NOT installed: it only backs the preview renderer, never the GLB
#     bake, and carries NVIDIA terms we have no need to take on.
#   * gltfpack (zeux/meshoptimizer, MIT) is pinned by release tag and checksum,
#     the same pin workers/stylize ships, and compresses the output GLB.
FROM python:3.11-slim AS gltfpack
ARG GLTFPACK_VERSION=v1.2
ARG GLTFPACK_SHA256=ebc236f5f6c08c7e5c5750476a187d24805d44d8c680449c4b7369c333f817b1
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates \
    && curl -fsSL -o /tmp/gltfpack.zip \
        https://github.com/zeux/meshoptimizer/releases/download/${GLTFPACK_VERSION}/gltfpack-ubuntu.zip \
    && echo "${GLTFPACK_SHA256}  /tmp/gltfpack.zip" | sha256sum -c - \
    && unzip -j /tmp/gltfpack.zip gltfpack -d /usr/local/bin \
    && chmod +x /usr/local/bin/gltfpack \
    && /usr/local/bin/gltfpack -v

FROM nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04

ARG TORCH_CUDA_ARCH_LIST="8.9"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    TORCH_CUDA_ARCH_LIST="${TORCH_CUDA_ARCH_LIST}" \
    CUDA_HOME=/usr/local/cuda \
    ATTN_BACKEND=xformers \
    PYTHONPATH=/app/TRELLIS.2:/app/TRELLIS.2/o-voxel \
    PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
    # The weights are staged to the bucket, never fetched from the Hub at serve time.
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    # Cap glibc at two malloc arenas. Every job runs on executor threads, and by
    # default each thread grows its own arena that keeps freed heap forever (see
    # instance_health.py).
    MALLOC_ARENA_MAX=2

# libusb-1.0-0 and libegl1: open3d dlopens both at import time. libjpeg-dev is the
# header set setup.sh installs for pillow.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.10 python3.10-dev python3-pip \
        git curl wget build-essential ninja-build \
        libgl1 libglib2.0-0 libgomp1 libjpeg-dev \
        libusb-1.0-0 libegl1 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.10 /usr/bin/python \
    && pip install --upgrade pip setuptools wheel

COPY --from=gltfpack /usr/local/bin/gltfpack /usr/local/bin/gltfpack

# 1. Torch first (own layer; every extension below links against it).
RUN pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124

# 2. setup.sh --basic, minus gradio/tensorboard (the demo UI) and with the serving
# dependencies pinned. transformers must carry DINOv3 (4.56+) and stay compatible
# with torch 2.6. open3d is pinned for the same reason as the v1 worker: an
# unpinned resolve once pulled a wheel with new system-library needs.
RUN pip install \
        imageio imageio-ffmpeg tqdm easydict opencv-python-headless ninja trimesh \
        "transformers==4.57.1" pandas lpips zstandard kornia timm einops \
        pillow plyfile scipy "open3d==0.19.0" \
    && pip install git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8

# 3. xformers matched to torch 2.6.0.
RUN pip install xformers==0.0.29.post2 --index-url https://download.pytorch.org/whl/cu124

# 4. Compiled CUDA extensions (setup.sh --nvdiffrast --cumesh --flexgemm --o-voxel).
# --no-build-isolation is REQUIRED: each setup.py imports torch at build time and
# PEP517 isolation hides the torch from step 1.
# TRELLIS.2 is pinned to a commit: a moving `main` has broken a worker rebuild
# before. The clone is recursive for o-voxel's eigen submodule.
RUN git clone --recursive https://github.com/microsoft/TRELLIS.2.git /app/TRELLIS.2 \
    && git -C /app/TRELLIS.2 checkout 75fbf0183001ed9876c8dbb35de6b68552ee08bd \
    && git -C /app/TRELLIS.2 submodule update --init --recursive
RUN git clone -b v0.4.0 --depth 1 https://github.com/NVlabs/nvdiffrast.git /tmp/ext/nvdiffrast \
    && pip install --no-build-isolation /tmp/ext/nvdiffrast
RUN git clone --recursive https://github.com/JeffreyXiang/CuMesh.git /tmp/ext/CuMesh \
    && pip install --no-build-isolation /tmp/ext/CuMesh
RUN git clone --recursive https://github.com/JeffreyXiang/FlexGEMM.git /tmp/ext/FlexGEMM \
    && pip install --no-build-isolation /tmp/ext/FlexGEMM
RUN pip install --no-build-isolation /app/TRELLIS.2/o-voxel \
    && rm -rf /tmp/ext

# 5. Server deps. pytest is here for the build-time gate at the bottom of this
# file: the request policy, config rewrite and GLB packing are unit tested during
# `docker build`, so a broken one can never reach a revision.
RUN pip install \
        "fastapi==0.115.0" "uvicorn[standard]==0.32.0" "pydantic>=2.0.0" \
        "httpx>=0.27.0" "google-cloud-storage==2.18.0" "safetensors>=0.4.0" \
        "pytest>=8.0.0"

WORKDIR /app
COPY worker_security.py request_policy.py storage_backend.py instance_health.py \
     pipeline_config.py glb_pack.py main.py /app/
COPY test_request_policy.py test_storage_backend.py test_instance_health.py \
     test_pipeline_config.py test_glb_pack.py test_app_contract.py /app/

# Build-time gate, neither half of which needs a GPU: the pure-logic tests, then
# the served contract against the exact dependency set that will run.
RUN python3 -m pytest /app/test_request_policy.py /app/test_storage_backend.py \
        /app/test_instance_health.py /app/test_pipeline_config.py /app/test_glb_pack.py -q \
    && python3 /app/test_app_contract.py

EXPOSE 8080

CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8080", \
     "--workers", "1", \
     "--timeout-keep-alive", "300"]
