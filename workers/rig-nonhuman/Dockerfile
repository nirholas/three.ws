# Non-humanoid rigging: UniRig (skeleton) + SkinTokens (skinning), both
# VAST-AI-Research, both MIT, LICENSE files read 2026-10-09. Neither ships a
# pip-installable package; both are subprocess CLIs (see pipeline.py), so
# this image vendors both checkouts at a pinned commit.
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

FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    HF_HUB_DISABLE_TELEMETRY=1 \
    DO_NOT_TRACK=1

# The X11 client libraries are what the bpy 4.2 wheel links against even when
# Blender runs headless (UniRig's merge step imports bpy to write the skinned
# GLB); without libXrender the import fails at runtime, not at pip install.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3.11-dev python3.11-venv python3-pip \
        git curl build-essential \
        libgl1 libglib2.0-0 \
        libx11-6 libxext6 libxrender1 libxfixes3 libxi6 libxxf86vm1 \
        libxkbcommon0 libsm6 libice6 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.11 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.11 /usr/bin/python \
    && python3 -m pip install --upgrade pip setuptools wheel

COPY --from=gltfpack /usr/local/bin/gltfpack /usr/local/bin/gltfpack

# One constraints file for every requirements install below. bpy 4.2 needs
# numpy 1.x, and the unpinned upstream requirement sets otherwise drift to
# numpy 2 and pandas 3 (which refuses numpy 1). SkinTokens' demo.py imports
# gradio, which imports pandas, so that mismatch crashed skinning at import
# time; the import gate at the end of this file now fails the build instead.
RUN printf 'numpy==1.26.4\npandas==2.2.3\n' > /app-constraints.txt

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
# flash-attn (Dao-AILab, BSD-3-Clause) comes from its official prebuilt wheel,
# never a source build: this is a CUDA runtime image with no nvcc, and pip's
# build isolation hides the installed torch from flash-attn's setup.py (the
# first deploy attempt died there). UniRig lists it unpinned, so it is
# stripped from that file and installed once here. The wheel's C++ ABI must
# match torch's; the assert fails the build, not the running service.
ARG FLASH_ATTN_WHEEL=https://github.com/Dao-AILab/flash-attention/releases/download/v2.8.3/flash_attn-2.8.3+cu12torch2.7cxx11abiTRUE-cp311-cp311-linux_x86_64.whl
RUN python3 -c "import torch, sys; sys.exit(0 if torch._C._GLIBCXX_USE_CXX11_ABI else 'torch is not built with the CXX11 ABI; switch FLASH_ATTN_WHEEL to the cxx11abiFALSE wheel')" \
    && pip install "${FLASH_ATTN_WHEEL}"
RUN grep -viE '^flash[-_]attn' /app/unirig/requirements.txt > /tmp/unirig-requirements.txt \
    && pip install -c /app-constraints.txt -r /tmp/unirig-requirements.txt \
    && pip install -c /app-constraints.txt spconv-cu120 \
    && pip install -c /app-constraints.txt torch_scatter torch_cluster \
        -f https://data.pyg.org/whl/torch-2.7.0+cu128.html --no-cache-dir

# SkinTokens, pinned to the main HEAD read on 2026-10-11
# (https://github.com/VAST-AI-Research/SkinTokens/commit/273b691d35989d71cd17ff2895fdc735097b92d1).
# Successor to UniRig; predicts skin weights only.
ARG SKINTOKENS_COMMIT=273b691d35989d71cd17ff2895fdc735097b92d1
RUN git clone https://github.com/VAST-AI-Research/SkinTokens.git /app/skintokens \
    && git -C /app/skintokens checkout ${SKINTOKENS_COMMIT} \
    && rm -rf /app/skintokens/.git
RUN grep -viE '^flash[-_]attn' /app/skintokens/requirements.txt > /tmp/skintokens-requirements.txt \
    && pip install -c /app-constraints.txt -r /tmp/skintokens-requirements.txt \
    && python3 -c "import importlib.metadata as m; v = m.version('flash_attn'); assert v == '2.8.3', v; print('flash_attn', v)"

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install -c /app-constraints.txt -r /app/requirements.txt

COPY worker_security.py gltf_meshopt.py pipeline.py main.py entrypoint.sh /app/
COPY test_gltf_meshopt.py test_pipeline.py /app/
RUN chmod +x /app/entrypoint.sh

# Build-time guard: the chaining/error-handling logic needs no GPU and no
# checkout, so it runs here and the image does not ship if it broke.
RUN python3 /app/test_pipeline.py && python3 /app/test_gltf_meshopt.py

# Import gate: load the exact entry modules pipeline.py runs (UniRig's run.py,
# SkinTokens' demo.py; both guard their CLI behind __main__) so a dependency
# that cannot import fails the build, not the first rig request. pip check
# catches resolver conflicts the installs above only warn about. Its one
# tolerated line is "bpy 4.2.0 is not supported on this platform": a false
# positive from pip's wheel-tag check (the installed wheel is
# manylinux_2_28_x86_64 and this Ubuntu 22.04 base has glibc 2.35), and the
# `import bpy` below proves bpy loads here. Any other line fails the build.
RUN { pip check > /tmp/pip-check.txt 2>&1 || true; } \
    && cat /tmp/pip-check.txt \
    && ! grep -vxE 'No broken requirements found\.|bpy 4\.2\.0 is not supported on this platform' /tmp/pip-check.txt \
    && python3 -c "import bpy; print('bpy', bpy.app.version_string)" \
    && cd /app/unirig && python3 -c "import run" \
    && cd /app/skintokens && python3 -c "import demo" \
    && python3 -c "import numpy, pandas; print('numpy', numpy.__version__, 'pandas', pandas.__version__)"

# Checkpoints are staged in GCS (stage-assets.sh) and mounted at /weights by
# Cloud Run; entrypoint.sh copies them into the literal relative paths UniRig
# and SkinTokens fall back to when their own Hugging Face auto-fetch has no
# egress (see stage-assets.sh for the exact layout).

EXPOSE 8080

CMD ["/app/entrypoint.sh"]
