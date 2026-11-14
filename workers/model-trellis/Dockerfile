# TRELLIS (Microsoft, MIT): single image to textured 3D mesh on one NVIDIA GPU.
#
# This image translates the upstream conda `setup.sh` into a reproducible pip
# build. Reliability choices that matter for Cloud Build, Cloud Run L4 and the
# NGC Catalog build (docs/nvidia-ngc-listing.md):
#   * TWO STAGES. The CUDA *devel* base (nvcc) is needed only to compile
#     nvdiffrast / diff-gaussian-rasterization, so it is the
#     `builder` stage. The shipped image is the CUDA *runtime* base plus the
#     built virtualenv, TRELLIS source and baked dinov2 copied across: no
#     compiler, no CUDA headers, far fewer packages for a CVE scanner to flag
#     (NVIDIA's NGC step 3 scan reads the shipped image, not the build stage).
#   * CUDA 12.6 on Ubuntu 24.04 (Python 3.12), torch 2.6.0 + cu126. Moved from
#     CUDA 12.1 / Python 3.10 / torch 2.4 on 2026-11-10 because the old matrix
#     could not clear its CRITICAL CVEs: torch < 2.6 carries CVE-2025-32434 and
#     the pillow release that fixes its 2026 CRITICALs (13.0.0) needs Python
#     3.11+. Every TRELLIS dependency publishes cp312 wheels for this matrix
#     (xformers 0.0.29.post3, spconv-cu126 2.3.8, kaolin 0.18.0 torch-2.6.0_cu126).
#     torch's pip wheels carry their own cuDNN, so neither base needs a cudnn tag.
#   * Attention backend = xformers, NOT flash-attn. flash-attn compiles from
#     source for 30+ min and routinely OOMs the builder; xformers is an upstream-
#     supported backend. Set via ATTN_BACKEND.
#   * LICENSE BUNDLE. Every git checkout below saves its license file and commit
#     to /opt/licenses-src before the checkout is deleted, and the runtime stage
#     turns that plus the installed packages into /licenses and
#     /licenses/THIRD_PARTY_NOTICES.md (third_party_notices.py). nvdiffrast and
#     diff-gaussian-rasterization may only be redistributed with a complete
#     copy of their (research / evaluation only) licenses, and the NGC EULA
#     promises the listing; the build gate fails without it.
#   * TORCH_CUDA_ARCH_LIST defaults to 8.9 for the production L4 image. The NGC
#     build (cloudbuild.ngc.yaml) passes "8.0;8.6;8.9;9.0+PTX", pinned on
#     2026-11-10 after real inference passed on an A100 (8.0) and an L4 (8.9);
#     9.0 ships native sm_90 plus PTX but was not run (H100 quota denied).
#     Evidence: NGC-VALIDATION.md.
FROM nvidia/cuda:12.6.3-devel-ubuntu24.04 AS builder

ARG TORCH_CUDA_ARCH_LIST="8.9"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    # Production defaults to L4 (Ada, sm_89); NGC overrides this build arg.
    TORCH_CUDA_ARCH_LIST="${TORCH_CUDA_ARCH_LIST}" \
    # TRELLIS runtime backends (read at import time in main.py).
    ATTN_BACKEND=xformers \
    SPCONV_ALGO=native \
    # One virtualenv holds every Python package (Ubuntu 24.04 marks the system
    # interpreter externally managed, PEP 668); the runtime stage copies it whole.
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    # TRELLIS repo lives here and is imported off PYTHONPATH (not a pip package).
    PYTHONPATH=/app/TRELLIS \
    # Cap glibc at two malloc arenas. Every job runs on executor threads, and by
    # default each thread grows its own arena that keeps freed heap forever: the
    # instance ratcheted from 46% to 91% of its 32 GiB across a day of jobs and
    # was OOM-killed mid-job (see instance_health.py).
    MALLOC_ARENA_MAX=2

# libusb-1.0-0 and libegl1: open3d (imported by TRELLIS's pipelines package)
# dlopens both at import time. Without them the model load dies with
# "libusb-1.0.so.0: cannot open shared object file" and the revision never serves.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.12 python3.12-dev python3.12-venv \
        git curl build-essential ninja-build \
        libgl1 libglib2.0-0t64 libgomp1 \
        libusb-1.0-0 libegl1 \
    && rm -rf /var/lib/apt/lists/* \
    && python3.12 -m venv /opt/venv \
    && pip install --upgrade pip setuptools wheel

# -- 1. Torch first (own layer; every extension below links against it) --------
RUN pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu126

# -- 2. setup.sh --basic + utils3d ---------------------------------------------
# transformers stays pinned: unpinned, the 2026-07-16 rebuild resolved a release
# whose CLIP modeling needed a newer torch than the image had, so the pipeline
# failed to load at boot and every inference on the revision failed. open3d is
# pinned for the same reason: an unpinned resolve on 2026-09-18 pulled a wheel
# with new system-library needs (see the apt layer above) and the load failed at
# boot. The 2026-11-10 CVE pass moved transformers to 5.21.0 and rembg to
# 2.0.86 (both clear HIGHs in the old pins; rembg past 2.0.69 needs Python
# 3.11+) and floored pillow at 13.0.0, the release that fixes its 2026
# CRITICALs. The image pipeline never loads a transformers model: TRELLIS only
# imports CLIPTextModel for its text pipeline, which the build gate exercises.
RUN pip install \
        "pillow>=13.0.0" imageio imageio-ffmpeg tqdm easydict opencv-python-headless \
        scipy ninja "rembg==2.0.86" onnxruntime trimesh xatlas pyvista pymeshfix \
        igraph "transformers==5.21.0" "open3d==0.20.0" \
    && git clone https://github.com/EasternJournalist/utils3d.git /tmp/utils3d \
    && git -C /tmp/utils3d checkout 9a4eb15e4021b67b12c460c7057d642626897ec8 \
    && pip install /tmp/utils3d \
    && mkdir -p /opt/licenses-src/utils3d \
    && cp /tmp/utils3d/LICENSE /opt/licenses-src/utils3d/ \
    && git -C /tmp/utils3d rev-parse HEAD > /opt/licenses-src/utils3d/COMMIT \
    && rm -rf /tmp/utils3d

# -- 3. setup.sh --xformers / --spconv / --kaolin (prebuilt wheels) ------------
RUN pip install xformers==0.0.29.post3 --index-url https://download.pytorch.org/whl/cu126
RUN pip install spconv-cu126==2.3.8
RUN pip install kaolin==0.18.0 -f https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.6.0_cu126.html

# -- 4. setup.sh --nvdiffrast / --mipgaussian (compiled) ----------------------
# upstream setup.sh also builds diffoctreerast. It is deliberately left out: it
# only rasterises Octree (radiance-field) samples, TRELLIS imports it lazily
# inside OctreeRenderer's render(), and main.py decodes formats=["gaussian",
# "mesh"] only, so it never loads. Shipping it would add a third research-only
# license (Inria / MPII derivative) to the image for no runtime use.
# These build CUDA kernels with nvcc for every arch in TORCH_CUDA_ARCH_LIST.
# --no-build-isolation is REQUIRED: each extension's setup.py `import torch` at
# build time, but PEP517 isolation hides the torch installed in step 1, so nvdiffrast
# aborts with "Cannot compile nvdiffrast CUDA extension ... run pip install with
# --no-build-isolation". The flag makes the build reuse the image's torch. setuptools/
# wheel are already present (installed in the apt layer), so no build deps are missing.
RUN git clone https://github.com/NVlabs/nvdiffrast.git /tmp/ext/nvdiffrast \
    && pip install --no-build-isolation /tmp/ext/nvdiffrast \
    && mkdir -p /opt/licenses-src/nvdiffrast \
    && cp /tmp/ext/nvdiffrast/LICENSE.txt /opt/licenses-src/nvdiffrast/ \
    && git -C /tmp/ext/nvdiffrast rev-parse HEAD > /opt/licenses-src/nvdiffrast/COMMIT
# diff-gaussian-rasterization uses uint32_t/uintptr_t without <cstdint>, which
# GCC 13 (Ubuntu 24.04) no longer pulls in transitively, so the include is added.
RUN git clone https://github.com/autonomousvision/mip-splatting.git /tmp/ext/mip-splatting \
    && sed -i '1i #include <cstdint>' /tmp/ext/mip-splatting/submodules/diff-gaussian-rasterization/cuda_rasterizer/rasterizer_impl.h \
    && pip install --no-build-isolation /tmp/ext/mip-splatting/submodules/diff-gaussian-rasterization/ \
    && mkdir -p /opt/licenses-src/diff-gaussian-rasterization \
    && cp /tmp/ext/mip-splatting/submodules/diff-gaussian-rasterization/LICENSE.md /opt/licenses-src/diff-gaussian-rasterization/ \
    && git -C /tmp/ext/mip-splatting rev-parse HEAD > /opt/licenses-src/diff-gaussian-rasterization/COMMIT \
    && rm -rf /tmp/ext

# -- 5. Server deps ------------------------------------------------------------
# pytest is here for the build-time gate at the bottom of this file, the same
# pattern workers/garment-forge uses: the request policy is unit tested during
# `docker build`, so a broken tier table or clamp can never reach a revision.
# fastapi 0.115 capped starlette below the releases that fix its HIGHs, hence
# the 0.162 / 1.10 pair. filelock and setuptools are pinned to their patched
# releases here, after the CUDA extensions above have finished building.
RUN pip install \
        "fastapi==0.162.0" "starlette==1.10.0" "uvicorn[standard]==0.32.0" "pydantic>=2.0.0" \
        "httpx>=0.27.0" "google-cloud-storage==2.18.0" "safetensors>=0.4.0" \
        "pytest>=8.0.0" "filelock==4.2.4" "setuptools==84.2.1"

# -- 6. TRELLIS source (imported via PYTHONPATH, pinned for reproducibility) ---
# --recurse-submodules is REQUIRED: TRELLIS vendors FlexiCubes (its mesh
# extractor) as a git submodule at trellis/representations/mesh/flexicubes. A
# plain clone leaves that dir a bare gitlink, so `from .flexicubes.flexicubes
# import FlexiCubes` fails at model load with ModuleNotFoundError and the worker
# crashes on startup before binding the port.
# Pinned (2026-07-16): a moving `main` broke this worker's rebuild once already
# (the transformers pin below exists for the same reason). This sha is verified
# to carry run_multi_image, which main.py uses for multi-view fusion.
RUN git clone --recurse-submodules https://github.com/microsoft/TRELLIS.git /app/TRELLIS \
    && git -C /app/TRELLIS checkout 442aa1e1afb9014e80681d3bf604e8d728a86ee7 \
    && git -C /app/TRELLIS submodule update --init --recursive \
    && mkdir -p /opt/licenses-src/TRELLIS /opt/licenses-src/flexicubes \
    && cp /app/TRELLIS/LICENSE /opt/licenses-src/TRELLIS/ \
    && git -C /app/TRELLIS rev-parse HEAD > /opt/licenses-src/TRELLIS/COMMIT \
    && cp /app/TRELLIS/trellis/representations/mesh/flexicubes/LICENSE.txt /opt/licenses-src/flexicubes/ \
    && git -C /app/TRELLIS/trellis/representations/mesh/flexicubes rev-parse HEAD > /opt/licenses-src/flexicubes/COMMIT

# -- 7. dinov2 image conditioner, baked so the model load never calls out ------
# pipeline.json sets image_cond_model=dinov2_vitl14_reg, and TRELLIS resolves it
# with torch.hub.load("facebookresearch/dinov2", ...) with no branch pinned. That
# call hits github.com on every load just to discover the default branch, and
# torch re-raises any non-404 there before it ever looks at its own cache. Cloud
# Run egresses from shared Google IPs that GitHub rate-limits, so the load had a
# standing dependency on somebody else's quota: on 2026-09-02 a single "HTTP
# Error 403: rate limit exceeded" failed it, and the latched error held the
# default free image lane down for 12 hours. Baking the repo and its checkpoint
# removes that dependency; main.py routes torch.hub at this checkout.
# The checkpoint filename is the one torch.hub.load_state_dict_from_url derives
# from the upstream URL, so the pre-baked copy is a cache hit rather than a
# second download.
ENV TORCH_HOME=/opt/torch \
    DINOV2_LOCAL_DIR=/opt/dinov2
RUN git clone https://github.com/facebookresearch/dinov2.git /opt/dinov2 \
    && git -C /opt/dinov2 checkout 7764ea0f912e53c92e82eb78a2a1631e92725fc8 \
    && mkdir -p /opt/licenses-src/dinov2 \
    && cp /opt/dinov2/LICENSE /opt/licenses-src/dinov2/ \
    && git -C /opt/dinov2 rev-parse HEAD > /opt/licenses-src/dinov2/COMMIT \
    && mkdir -p /opt/torch/hub/checkpoints \
    && curl -fsSL -o /opt/torch/hub/checkpoints/dinov2_vitl14_reg4_pretrain.pth \
         https://dl.fbaipublicfiles.com/dinov2/dinov2_vitl14/dinov2_vitl14_reg4_pretrain.pth \
    && python3 -c "import os; p='/opt/torch/hub/checkpoints/dinov2_vitl14_reg4_pretrain.pth'; s=os.path.getsize(p); assert s > 1_000_000_000, f'dinov2 checkpoint truncated: {s} bytes'"


# == Runtime stage ===========================================================
# Same env contract as the builder (and as the single-stage image this replaces):
# the entrypoint, ports, ATTN_BACKEND, PYTHONPATH, TORCH_HOME and DINOV2_LOCAL_DIR
# are unchanged, so the production Cloud Run revision behaves identically.
FROM nvidia/cuda:12.6.3-runtime-ubuntu24.04

ARG TORCH_CUDA_ARCH_LIST="8.9"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    TORCH_CUDA_ARCH_LIST="${TORCH_CUDA_ARCH_LIST}" \
    ATTN_BACKEND=xformers \
    SPCONV_ALGO=native \
    PYTHONPATH=/app/TRELLIS \
    MALLOC_ARENA_MAX=2 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    TORCH_HOME=/opt/torch \
    DINOV2_LOCAL_DIR=/opt/dinov2

# Runtime libraries only (see the builder stage for why libusb and libegl are
# here). `apt-get upgrade` pulls the Ubuntu security patches published since the
# CUDA base image was cut.
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
        python3.12 \
        libgl1 libglib2.0-0t64 libgomp1 \
        libusb-1.0-0 libegl1 \
    && rm -rf /var/lib/apt/lists/*

# The virtualenv links to /usr/bin/python3.12 (installed above), so one COPY
# carries every package, the compiled CUDA extensions and the console scripts
# (uvicorn), and `python3` / `python` resolve to it through PATH.
COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /app/TRELLIS /app/TRELLIS
COPY --from=builder /opt/dinov2 /opt/dinov2
COPY --from=builder /opt/torch /opt/torch
COPY --from=builder /opt/licenses-src /opt/licenses-src

WORKDIR /app
COPY worker_security.py /app/worker_security.py
COPY request_policy.py /app/request_policy.py
COPY storage_backend.py /app/storage_backend.py
COPY instance_health.py /app/instance_health.py
COPY tracing.py /app/tracing.py
COPY main.py /app/main.py
COPY third_party_notices.py /app/third_party_notices.py
COPY test_request_policy.py test_storage_backend.py test_instance_health.py test_app_contract.py test_tracing.py test_third_party_notices.py /app/

# License bundle from the real image contents (see the header), generated before
# the gate so test_third_party_notices.py can prove every license text shipped.
RUN python3 /app/third_party_notices.py --sources /opt/licenses-src --out /licenses

# Build-time gate, no part of which needs a GPU:
#   1. The quality tiers, the clamps that keep a caller value from crashing the
#      nvdiffrast bake, the image-fetch retry policy, and the memory-recycle and
#      orphan-expiry decisions are pure logic, proven here rather than in
#      production.
#   2. The license bundle: every source component's license text ships verbatim
#      under /licenses and the notices list the use-restricted ones first.
#   3. The served contract, against the exact dependency set that will run: the
#      TRELLIS import chain (FlexiCubes submodule included), the auth boundary,
#      the probe surfaces, request validation, and the SSRF guard.
RUN python3 -m pytest /app/test_request_policy.py /app/test_storage_backend.py /app/test_instance_health.py /app/test_tracing.py /app/test_third_party_notices.py -q \
    && python3 /app/test_app_contract.py

EXPOSE 8080

CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8080", \
     "--workers", "1", \
     "--timeout-keep-alive", "300"]
