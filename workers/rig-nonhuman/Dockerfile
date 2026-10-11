# Non-humanoid rigging: UniRig (skeleton) + SkinTokens (skinning), both
# VAST-AI-Research, both MIT, LICENSE files read 2026-10-09. Neither ships a
# pip-installable package; both are subprocess CLIs (see pipeline.py), so
# this image vendors both checkouts at a pinned commit.
FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    HF_HUB_DISABLE_TELEMETRY=1 \
    DO_NOT_TRACK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3.11-dev python3.11-venv python3-pip \
        git curl build-essential \
        libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.11 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.11 /usr/bin/python \
    && python3 -m pip install --upgrade pip setuptools wheel

# torch first, as its own cached layer, matching SkinTokens' documented
# install (the newer and more exacting of the two dependency sets; UniRig
# only requires torch>=2.3.1, so this satisfies both).
RUN pip install torch==2.7.0 torchvision==0.22.0 torchaudio==2.7.0 \
    --index-url https://download.pytorch.org/whl/cu128

# UniRig (SIGGRAPH '25), pinned to the main HEAD read on 2026-10-11
# (https://github.com/VAST-AI-Research/UniRig/commit/6793c6640ff01c8fb389f3993434124bb43d2933).
ARG UNIRIG_COMMIT=6793c6640ff01c8fb389f3993434124bb43d2933
RUN git clone https://github.com/VAST-AI-Research/UniRig.git /app/unirig \
    && git -C /app/unirig checkout ${UNIRIG_COMMIT} \
    && rm -rf /app/unirig/.git
RUN pip install -r /app/unirig/requirements.txt \
    && pip install spconv-cu120 \
    && pip install torch_scatter torch_cluster \
        -f https://data.pyg.org/whl/torch-2.7.0+cu128.html --no-cache-dir \
    && pip install numpy==1.26.4

# SkinTokens, pinned to the main HEAD read on 2026-10-11
# (https://github.com/VAST-AI-Research/SkinTokens/commit/273b691d35989d71cd17ff2895fdc735097b92d1).
# Successor to UniRig; predicts skin weights only.
ARG SKINTOKENS_COMMIT=273b691d35989d71cd17ff2895fdc735097b92d1
RUN git clone https://github.com/VAST-AI-Research/SkinTokens.git /app/skintokens \
    && git -C /app/skintokens checkout ${SKINTOKENS_COMMIT} \
    && rm -rf /app/skintokens/.git
RUN pip install -r /app/skintokens/requirements.txt \
    && pip install flash-attn --no-build-isolation

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY worker_security.py gltf_meshopt.py pipeline.py main.py entrypoint.sh /app/
COPY test_gltf_meshopt.py test_pipeline.py /app/
RUN chmod +x /app/entrypoint.sh

# Build-time guard: the chaining/error-handling logic needs no GPU and no
# checkout, so it runs here and the image does not ship if it broke.
RUN python3 /app/test_pipeline.py && python3 /app/test_gltf_meshopt.py

# Checkpoints are staged in GCS (stage-assets.sh) and mounted at /weights by
# Cloud Run; entrypoint.sh copies them into the literal relative paths UniRig
# and SkinTokens fall back to when their own Hugging Face auto-fetch has no
# egress (see stage-assets.sh for the exact layout).

EXPOSE 8080

CMD ["/app/entrypoint.sh"]
