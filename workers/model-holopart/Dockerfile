# HoloPart (VAST-AI-Research, MIT, LICENSE read 2026-10-11): generative 3D
# part amodal segmentation. Given an already part-segmented mesh (one named
# geometry per part, e.g. workers/segment's output), completes each part's
# occluded geometry while preserving its name. Its own requirements.txt pins
# diffusers/transformers/diso/torch-cluster; torch is pinned separately here
# to match the CUDA image base, same pattern as workers/model-anigen and
# workers/model-partcrafter.
#
# gltfpack (zeux/meshoptimizer, MIT) is pinned by release tag and checksum,
# the same pin workers/segment ships: gltf_meshopt.py shells out to it to
# decode EXT_meshopt_compression before trimesh reads a caller's mesh.
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

FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    PYTHONPATH=/app/holopart-src \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    DO_NOT_TRACK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.10 python3.10-dev python3-pip \
        git curl build-essential ninja-build \
        libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.10 /usr/bin/python \
    && pip install --upgrade pip setuptools wheel

COPY --from=gltfpack /usr/local/bin/gltfpack /usr/local/bin/gltfpack

# 1. torch, its own cached layer (every extension below links against it;
# torch-cluster below needs a matching prebuilt wheel index).
RUN pip install torch==2.4.1 torchvision==0.19.1 --index-url https://download.pytorch.org/whl/cu121

# 2. HoloPart, pinned to the commit read on 2026-10-11
# (https://github.com/VAST-AI-Research/HoloPart/commit/48dd632c9a7412e6688573bb4f153e0ade7e7325).
ARG HOLOPART_COMMIT=48dd632c9a7412e6688573bb4f153e0ade7e7325
RUN git clone https://github.com/VAST-AI-Research/HoloPart.git /app/holopart-src \
    && git -C /app/holopart-src checkout ${HOLOPART_COMMIT} \
    && rm -rf /app/holopart-src/.git

# 3. HoloPart's own requirements, minus the lines that cannot install as
# written:
#   * numpy==1.22.3 has no wheel that the rest of this stack accepts;
#   * diffusers/transformers are unpinned upstream, so they are pinned here to
#     the releases contemporary with the pinned commit (April 2025), keeping
#     every rebuild on the API HoloPart was written against;
#   * torch-cluster needs the cu121-matched PyG wheel index;
#   * diso ships only an sdist whose setup.py imports torch and compiles CUDA
#     kernels, so it builds with --no-build-isolation (against the torch
#     installed above) and an explicit arch list, since no GPU is visible at
#     image build time. 8.9 is the L4 this service deploys on; 8.0/8.6 keep
#     the image usable on A100/A10-class hardware.
RUN grep -viE '^(numpy|diffusers|transformers|torch-cluster|diso)([=<> ]|$)' /app/holopart-src/requirements.txt > /tmp/holopart-reqs.txt \
    && pip install -r /tmp/holopart-reqs.txt "numpy>=1.24,<2" diffusers==0.32.2 transformers==4.49.0 \
    && pip install torch-cluster -f https://data.pyg.org/whl/torch-2.4.1+cu121.html \
    && TORCH_CUDA_ARCH_LIST="8.0;8.6;8.9" FORCE_CUDA=1 MAX_JOBS=8 \
        pip install --no-build-isolation diso==0.1.4

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY worker_security.py storage_backend.py gltf_meshopt.py pipeline.py main.py entrypoint.sh /app/
COPY test_gltf_meshopt.py test_app_contract.py /app/
RUN chmod +x /app/entrypoint.sh

# Build-time guards, none of which need a GPU or the checkpoints: HoloPart's
# whole inference import chain (including the compiled diso extension and
# torch-cluster) resolves against the pinned dependency set, and the
# served-contract tests hold. The image does not ship if either broke.
RUN python3 -c "import diso, pymeshlab, torch_cluster; from holopart.pipelines.pipeline_holopart import HoloPartPipeline; from holopart.inference_utils import flash_extract_geometry; print('import chain ok')" \
    && python3 /app/test_gltf_meshopt.py && python3 /app/test_app_contract.py

# Weights are staged in GCS (stage-assets.sh) and mounted at /weights by
# Cloud Run; entrypoint.sh copies them into HOLOPART_WEIGHTS_ROOT, the
# literal path pipeline.py's from_pretrained call uses, so inference needs no
# Hugging Face egress at runtime.

EXPOSE 8080

CMD ["/app/entrypoint.sh"]
