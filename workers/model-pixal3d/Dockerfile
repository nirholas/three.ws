# Pixal3D (TencentARC, MIT): 1 to 4 photos to a PBR-textured 3D asset on an L4 (24 GB).
#
# Built on TRELLIS.2's own backbone, so this image follows workers/model-trellis2's
# Dockerfile closely (same CUDA/torch matrix, same attention backend, same gltfpack
# pin) and adds only what Pixal3D's own setup needs on top:
#   * MoGe-2 (microsoft/moge, MIT), the monocular camera estimator Pixal3D's single-
#     view path uses to recover a camera from one photo (inference.py's
#     get_camera_params_wild_moge). Installed from git, not pip, as upstream does.
#   * natten (SHI-Labs, MIT), compiled from source like the v1 CuMesh/FlexGEMM
#     extensions: it has no prebuilt wheel for this torch/CUDA combination.
#   * diffusers/accelerate pinned to the versions Pixal3D's own requirements.txt
#     names, one step ahead of trellis2's because Pixal3D also drives the optional
#     MV-Adapter (huanngzh/MV-Adapter, Apache-2.0) SDXL rung for "fill in the other
#     sides" (mv_adapter_fill.py).
#   * utils3d is the same EasternJournalist pin trellis2 already carries.
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
    PIXAL3D_SRC=/opt/pixal3d-src \
    MVADAPTER_SRC=/opt/mvadapter-src \
    PYTHONPATH=/opt/pixal3d-src:/opt/pixal3d-src/o-voxel:/opt/mvadapter-src \
    PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
    # The weights are staged to the bucket, never fetched from the Hub at serve time.
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    # Cap glibc at two malloc arenas; see workers/model-trellis2's identical comment.
    MALLOC_ARENA_MAX=2

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

# 2. Shared TRELLIS.2-backbone dependencies, same pins as workers/model-trellis2.
RUN pip install \
        imageio imageio-ffmpeg tqdm easydict opencv-python-headless ninja trimesh \
        "transformers==4.57.1" pandas lpips zstandard kornia timm einops \
        pillow plyfile scipy "open3d==0.19.0" \
    && pip install git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8

# 3. xformers matched to torch 2.6.0.
RUN pip install xformers==0.0.29.post2 --index-url https://download.pytorch.org/whl/cu124

# 4. Compiled CUDA extensions. --no-build-isolation is REQUIRED on every one of
# these: each setup.py imports torch at build time and PEP517 isolation hides the
# torch from step 1. TRELLIS.2 is pinned to the same commit workers/model-trellis2
# carries, for the o-voxel postprocess module Pixal3D's own to_glb call reuses.
RUN git clone --recursive https://github.com/microsoft/TRELLIS.2.git /tmp/ext/TRELLIS.2 \
    && git -C /tmp/ext/TRELLIS.2 checkout 75fbf0183001ed9876c8dbb35de6b68552ee08bd \
    && git -C /tmp/ext/TRELLIS.2 submodule update --init --recursive
RUN git clone -b v0.4.0 --depth 1 https://github.com/NVlabs/nvdiffrast.git /tmp/ext/nvdiffrast \
    && pip install --no-build-isolation /tmp/ext/nvdiffrast
RUN git clone --recursive https://github.com/JeffreyXiang/CuMesh.git /tmp/ext/CuMesh \
    && pip install --no-build-isolation /tmp/ext/CuMesh
RUN git clone --recursive https://github.com/JeffreyXiang/FlexGEMM.git /tmp/ext/FlexGEMM \
    && pip install --no-build-isolation /tmp/ext/FlexGEMM
RUN pip install --no-build-isolation /tmp/ext/TRELLIS.2/o-voxel
# natten has no prebuilt wheel for CUDA 12.4 + torch 2.6; Pixal3D's attention
# blocks need it for neighborhood attention.
RUN pip install natten==0.21.0 --no-build-isolation
RUN rm -rf /tmp/ext

# 5. MoGe-2 (microsoft/moge, MIT): the single-view camera estimator.
RUN pip install git+https://github.com/microsoft/MoGe.git@74fbce054ebed49800de42d0ad0e83495065719a

# 6. Pixal3D itself, pinned to a commit for the same reproducibility reason
# TRELLIS.2 is pinned above: its own reference scripts (inference.py,
# inference_mv.py) and pipelines package are imported directly by main.py.
RUN git clone https://github.com/TencentARC/Pixal3D.git /opt/pixal3d-src \
    && git -C /opt/pixal3d-src checkout f7cf38429b0bd264f1995f0f8743a88b1c728b94

# 7. MV-Adapter (huanngzh/MV-Adapter, Apache-2.0): the optional "fill in the
# other sides" rung. diffusers/accelerate match its own requirements.txt.
RUN pip install "diffusers==0.37.1" "accelerate==1.13.0"
RUN git clone https://github.com/huanngzh/MV-Adapter.git /opt/mvadapter-src \
    && git -C /opt/mvadapter-src checkout 4277e0018232bac82bb2c103caf0893cedb711be \
    && pip install --no-deps -r /opt/mvadapter-src/requirements.txt || true

# 8. Server deps. pytest is here for the build-time gate at the bottom of this
# file: the pure-logic modules are unit tested during `docker build`, so a broken
# one can never reach a revision.
RUN pip install \
        "fastapi==0.115.0" "uvicorn[standard]==0.32.0" "pydantic>=2.0.0" \
        "httpx>=0.27.0" "google-cloud-storage==2.18.0" "safetensors>=0.4.0" \
        "pytest>=8.0.0"

WORKDIR /app
COPY worker_security.py request_policy.py storage_backend.py instance_health.py \
     pipeline_config.py glb_pack.py camera_rig.py mv_adapter_fill.py main.py /app/
COPY test_request_policy.py test_storage_backend.py test_instance_health.py \
     test_pipeline_config.py test_glb_pack.py test_camera_rig.py test_app_contract.py /app/

# Build-time gate, neither half of which needs a GPU: the pure-logic tests, then
# the served contract against the exact dependency set that will run.
RUN python3 -m pytest /app/test_request_policy.py /app/test_storage_backend.py \
        /app/test_instance_health.py /app/test_pipeline_config.py /app/test_glb_pack.py \
        /app/test_camera_rig.py -q \
    && python3 /app/test_app_contract.py

EXPOSE 8080

CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8080", \
     "--workers", "1", \
     "--timeout-keep-alive", "300"]
