# SAM 3D Objects (facebookresearch/sam-3d-objects, SAM License): one photo in, a
# posed 3D scene of its objects out. Upstream needs a Linux x86-64 host and a
# 32 GB+ NVIDIA GPU, so this image targets the Cloud Run RTX Pro 6000 class, not
# the L4 the other workers use (see cloudbuild.yaml).
#
# Pinned stack, read from the upstream commit below on 2026-10-24: Python 3.11,
# CUDA 12.1, torch 2.5.1. The official PyTorch devel image carries exactly that
# plus nvcc, which pytorch3d, kaolin and gsplat compile against.
#
# The SAM License is NOT accepted by building this image: the checkpoints are not
# in it. They are staged separately by the account owner with
# `npm run stage:sam3d-objects -- --accept-sam-license`.
FROM pytorch/pytorch:2.5.1-cuda12.1-cudnn9-devel

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    HF_HUB_DISABLE_TELEMETRY=1 \
    DO_NOT_TRACK=1 \
    CUDA_HOME=/usr/local/cuda \
    CONDA_PREFIX=/usr/local/cuda \
    LIDRA_SKIP_INIT=true \
    TORCH_CUDA_ARCH_LIST="8.0;8.6;8.9;9.0;12.0" \
    SAM3D_SRC=/app/sam3d-objects \
    SAM3D_CHECKPOINT_DIR=/app/checkpoints/hf \
    PIP_EXTRA_INDEX_URL="https://pypi.ngc.nvidia.com https://download.pytorch.org/whl/cu121" \
    PIP_FIND_LINKS="https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.5.1_cu121.html"

RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl build-essential ninja-build \
        libgl1 libglib2.0-0 libgomp1 libegl1 \
    && rm -rf /var/lib/apt/lists/*

# 1. SAM 3D Objects, pinned to the commit read on 2026-10-24
# (https://github.com/facebookresearch/sam-3d-objects/commit/f91db411c50efee93d8db7aeb323885650f6f722).
ARG SAM3D_COMMIT=f91db411c50efee93d8db7aeb323885650f6f722
RUN git clone https://github.com/facebookresearch/sam-3d-objects.git ${SAM3D_SRC} \
    && git -C ${SAM3D_SRC} checkout ${SAM3D_COMMIT} \
    && rm -rf ${SAM3D_SRC}/.git

# 2. Upstream's own install sequence (its doc/setup.md), in the same order: the
# core stack, then pytorch3d (its pip metadata is broken without the 2-step),
# then the inference extras.
WORKDIR ${SAM3D_SRC}
RUN pip install -e '.[dev]' \
    && pip install -e '.[p3d]' \
    && pip install -e '.[inference]'

# 3. Upstream's hydra patch (patching/hydra), applied from the same pinned fork
# commit it downloads, with the file's checksum verified first.
ARG HYDRA_PATCH_SHA256=b5799ea99626593e7650cd6ab7e15639e32d495d1a16f71d627811f86a2a6fba
RUN curl -fsSL -o /tmp/hydra_utils.py \
        https://raw.githubusercontent.com/gleize/hydra/78f00766b5f37672aa7232ebbf01bdd74246bd60/hydra/core/utils.py \
    && echo "${HYDRA_PATCH_SHA256}  /tmp/hydra_utils.py" | sha256sum -c - \
    && python -c 'import hydra, os, shutil; assert hydra.__version__ == "1.3.2", hydra.__version__; shutil.copy("/tmp/hydra_utils.py", os.path.join(os.path.dirname(hydra.__file__), "core", "utils.py"))' \
    && rm /tmp/hydra_utils.py

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY worker_security.py storage_backend.py request_policy.py scene_layout.py pipeline.py main.py entrypoint.sh /app/
COPY test_request_policy.py test_scene_layout.py test_app_contract.py /app/
RUN chmod +x /app/entrypoint.sh

# Build-time guard: the pure-logic tests and the served-contract test need no
# GPU and no checkpoints, so they run here and the image does not ship if request
# validation, the scene geometry or the import chain broke.
RUN python -m pytest -q /app/test_request_policy.py /app/test_scene_layout.py \
    && python /app/test_app_contract.py

EXPOSE 8080

CMD ["/app/entrypoint.sh"]
