# AniGen (VAST-AI-Research, MIT, LICENSE read 2026-10-11): one reference
# image to a rigged 3D asset (skeleton + skin weights predicted in the same
# pass). Translates upstream's conda setup.sh into a reproducible pip build,
# deliberately EXCLUDING one of its three CUDA extensions and its normal
# estimator:
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
#   * DSINE (the normal estimator upstream fetches from GitHub at load time)
#     is NEVER loaded. Its licence (Imperial College, clause 2(b)) is
#     non-commercial only. patch_anigen.py swaps the call for
#     normal_estimator.py, Marigold normals (Apache-2.0) through diffusers,
#     loaded offline from the weights bucket.
FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    PYTHONPATH=/app/anigen-src:/app \
    U2NET_HOME=/opt/rembg \
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
# 1b. xformers (BSD), the sparse-attention kernel. Upstream calls it optional,
# but only the DENSE attention module has an SDPA fallback: the sparse
# modules (anigen/modules/sparse/attention/*) dispatch to xformers or
# flash_attn only, and sparse/__init__.py probes find_spec('xformers.ops'),
# which raises ModuleNotFoundError at import when neither is installed.
# 0.0.27.post2 is the wheel built against torch 2.4.0 + cu121; --no-deps keeps
# pip from replacing the torch pinned above.
RUN pip install --no-deps xformers==0.0.27.post2 --index-url https://download.pytorch.org/whl/cu121 \
    && python3 -c "import importlib.metadata as m; v = m.version('xformers'); assert v == '0.0.27.post2', v; print('xformers', v)"
# Pin both attention dispatchers to it instead of trusting import-time probing.
ENV ATTN_BACKEND=xformers \
    SPARSE_ATTN_BACKEND=xformers

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
# pytorch3d 0.7.8 is the release AniGen's own setup.sh builds. Its git tag is
# spelled `V0.7.8` (capital V; there is no `v0.7.8`, which the first build
# tried and died on), so it is pinned by that tag's commit instead of a name.
# Cloud Build has no GPU, so pytorch3d's setup.py would detect none and
# silently compile CPU-only kernels, failing the first request on the L4 with
# "Not compiled with GPU support". FORCE_CUDA builds the CUDA kernels anyway,
# for sm_89 (L4) only, which also keeps the compile inside the build timeout.
# MAX_JOBS caps ninja's parallelism: left alone it starts one cc1plus/nvcc per
# vCPU (32 on E2_HIGHCPU_32, which has 32 GB), each torch-extension unit needs
# 1.5 to 3 GB, and the kernel OOM-killed cc1plus mid-build. 8 jobs fit.
ARG PYTORCH3D_COMMIT=75ebeeaea0908c5527e7b1e305fbc7681382db47
ENV FORCE_CUDA=1 \
    TORCH_CUDA_ARCH_LIST=8.9 \
    MAX_JOBS=8
RUN pip install -r /app/anigen-src/requirements.txt \
    && pip install spconv-cu120 \
    && pip install "fvcore>=0.1.5" iopath \
    && pip install --no-build-isolation \
        "git+https://github.com/facebookresearch/pytorch3d.git@${PYTORCH3D_COMMIT}" \
    && python3 -c "import pytorch3d; assert pytorch3d.__version__ == '0.7.8', pytorch3d.__version__; print('pytorch3d', pytorch3d.__version__)"

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

# Bake rembg's BiRefNet background-removal model (MIT) into the image.
# preprocess_image opens rembg.new_session('birefnet-general') per request,
# which otherwise downloads the ONNX from GitHub releases on first use: a
# runtime egress dependency and a cold-start stall. U2NET_HOME (above) pins
# where rembg looks, so the baked copy is the one it finds.
RUN python3 -c "import rembg; rembg.new_session('birefnet-general'); print('rembg birefnet-general cached')" \
    && ls -la /opt/rembg

COPY worker_security.py storage_backend.py pipeline.py main.py entrypoint.sh normal_estimator.py /app/
COPY test_app_contract.py test_entrypoint.py test_normal_estimator.py /app/
RUN chmod +x /app/entrypoint.sh

# Build-time guards: none needs a GPU or checkpoints, so they run here and
# the image does not ship if the patch, the import chain, request handling,
# the checkpoint staging, or the normal-map frame conversion broke.
RUN python3 /app/test_app_contract.py \
    && python3 /app/test_entrypoint.py \
    && cd /app && python3 /app/test_normal_estimator.py

# Checkpoints are staged in GCS (stage-assets.sh) and mounted at /weights by
# Cloud Run; entrypoint.sh copies only the serving set (two flows, two
# decoders, DINOv2, Marigold) into ANIGEN_CKPT_ROOT/ckpts/ and serves from
# there, because AniGen resolves every checkpoint relative to the cwd. No
# Hugging Face or GitHub egress at runtime.

EXPOSE 8080

CMD ["/app/entrypoint.sh"]
