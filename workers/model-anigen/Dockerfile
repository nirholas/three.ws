# AniGen (VAST-AI-Research, MIT, LICENSE read 2026-10-11): one reference
# image to a rigged 3D asset (skeleton + skin weights predicted in the same
# pass). Translates upstream's conda setup.sh into a reproducible pip build,
# deliberately EXCLUDING one of its three CUDA extensions:
#
#   * torch 2.4.0 + cu121, upstream setup.sh's own default matrix for
#     Python <=3.12.
#   * spconv-cu121 and pytorch3d (Meta, BSD, license read 2026-10-11):
#     installed, no restriction.
#   * nvdiffrast is NEVER installed. Its license (NVLabs/nvdiffrast,
#     "Nvidia Source Code License (1-Way Commercial)") bars commercial use,
#     which this worker's paid Forge lane cannot satisfy. patch_anigen.py
#     removes the two module-level imports that would otherwise pull it in
#     (see that file's docstring for the full nvdiffrast-usage trace); this
#     worker always runs the pipeline with fill_holes=False, texture_size=0
#     (pipeline.py), so nothing in its call path ever touches the renderer
#     that would need it.
FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    PYTHONPATH=/app/anigen-src \
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
RUN pip install torch==2.4.0 torchvision==0.19.0 --index-url https://download.pytorch.org/whl/cu121

# 2. AniGen, pinned to the commit read on 2026-10-11
# (https://github.com/VAST-AI-Research/AniGen/commit/c49db3d6b466537a02ccf2286688903d77af7e4f).
ARG ANIGEN_COMMIT=c49db3d6b466537a02ccf2286688903d77af7e4f
RUN git clone https://github.com/VAST-AI-Research/AniGen.git /app/anigen-src \
    && git -C /app/anigen-src checkout ${ANIGEN_COMMIT} \
    && rm -rf /app/anigen-src/.git

# 3. The build-time nvdiffrast-removal patch, BEFORE anything imports the tree.
COPY patch_anigen.py test_patch_anigen.py /app/
RUN python3 /app/test_patch_anigen.py && python3 /app/patch_anigen.py /app/anigen-src

# 4. requirements.txt, minus torch/torchvision (installed above) and minus
# nvdiffrast/pytorch3d (installed separately below; spconv needs its own
# CUDA-major-keyed wheel, same as workers/rig-nonhuman).
RUN pip install -r /app/anigen-src/requirements.txt \
    && pip install spconv-cu120 \
    && pip install "fvcore>=0.1.5" iopath \
    && pip install --no-build-isolation \
        "git+https://github.com/facebookresearch/pytorch3d.git@v0.7.8"

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY worker_security.py storage_backend.py pipeline.py main.py entrypoint.sh /app/
COPY test_app_contract.py /app/
RUN chmod +x /app/entrypoint.sh

# Build-time guard: served-contract tests need no GPU and no checkpoints, so
# they run here and the image does not ship if the patch, the import chain,
# or request handling broke.
RUN python3 /app/test_app_contract.py

# Checkpoints are staged in GCS (stage-assets.sh) and mounted at /weights by
# Cloud Run; entrypoint.sh copies them into ANIGEN_CKPT_ROOT/ckpts/anigen/...,
# the exact literal relative path AniGen's own from_pretrained call uses
# (example.py), so inference needs no Hugging Face egress at runtime.

EXPOSE 8080

CMD ["/app/entrypoint.sh"]
