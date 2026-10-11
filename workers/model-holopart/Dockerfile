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

# 3. HoloPart's own requirements (minus numpy's hard == pin, which conflicts
# with this worker's trimesh/pymeshlab stack; torch-cluster needs the
# cu121-matched wheel index).
RUN grep -viE '^numpy([=<> ]|$)' /app/holopart-src/requirements.txt > /tmp/holopart-reqs.txt \
    && grep -viE '^torch-cluster([=<> ]|$)' /tmp/holopart-reqs.txt > /tmp/holopart-reqs2.txt \
    && pip install -r /tmp/holopart-reqs2.txt "numpy>=1.24,<2" \
    && pip install torch-cluster -f https://data.pyg.org/whl/torch-2.4.1+cu121.html

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY worker_security.py storage_backend.py gltf_meshopt.py pipeline.py main.py entrypoint.sh /app/
COPY test_gltf_meshopt.py test_app_contract.py /app/
RUN chmod +x /app/entrypoint.sh

# Build-time guard: served-contract tests need no GPU and no checkpoints, so
# they run here and the image does not ship if the import chain or request
# handling broke.
RUN python3 /app/test_gltf_meshopt.py && python3 /app/test_app_contract.py

# Weights are staged in GCS (stage-assets.sh) and mounted at /weights by
# Cloud Run; entrypoint.sh copies them into HOLOPART_WEIGHTS_ROOT, the
# literal path pipeline.py's from_pretrained call uses, so inference needs no
# Hugging Face egress at runtime.

EXPOSE 8080

CMD ["/app/entrypoint.sh"]
