# PartCrafter (wgsxm/PartCrafter, MIT, LICENSE read 2026-10-11): one
# reference image to a part-separated 3D asset, N named part meshes decoded
# in a single diffusion-transformer pass. Built on a TripoSG-derived
# backbone; its own requirements.txt pins torch 2.4.1+cu121.
FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04

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
        python3.10 python3.10-dev python3-pip \
        git curl build-essential ninja-build \
        libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.10 /usr/bin/python \
    && pip install --upgrade pip setuptools wheel

# 1. torch, its own cached layer (every extension below links against it).
RUN pip install torch==2.4.1 torchvision==0.19.1 --index-url https://download.pytorch.org/whl/cu121

# 2. PartCrafter, pinned to the commit read on 2026-10-11
# (https://github.com/wgsxm/PartCrafter/commit/3d773bf02fad51c7ab31a5615573fec93b287b30).
ARG PARTCRAFTER_COMMIT=3d773bf02fad51c7ab31a5615573fec93b287b30
RUN git clone https://github.com/wgsxm/PartCrafter.git /app/partcrafter-src \
    && git -C /app/partcrafter-src checkout ${PARTCRAFTER_COMMIT} \
    && rm -rf /app/partcrafter-src/.git

# 3. PartCrafter's own requirements (minus torch/torchvision, installed above).
RUN grep -viE '^(torch|torchvision)([=<> ]|$)' /app/partcrafter-src/requirements.txt > /tmp/partcrafter-reqs.txt \
    && pip install -r /tmp/partcrafter-reqs.txt

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY worker_security.py storage_backend.py pipeline.py main.py entrypoint.sh /app/
COPY test_app_contract.py /app/
RUN chmod +x /app/entrypoint.sh

# Build-time guard: served-contract tests need no GPU and no checkpoints, so
# they run here and the image does not ship if the import chain or request
# handling broke.
RUN python3 /app/test_app_contract.py

# Weights are staged in GCS (stage-assets.sh) and mounted at /weights by
# Cloud Run; entrypoint.sh copies PartCrafter + RMBG-1.4 into
# PARTCRAFTER_WEIGHTS_ROOT, the literal relative layout pipeline.py's
# from_pretrained calls use, so inference needs no Hugging Face egress at
# runtime.

EXPOSE 8080

CMD ["/app/entrypoint.sh"]
