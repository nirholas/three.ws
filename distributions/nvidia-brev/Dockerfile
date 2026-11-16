# syntax=docker/dockerfile:1.7
#
# three.ws GPU quickstart image: TripoSR image-to-3D, the three.ws inference
# node, a studio web page and a guided JupyterLab notebook, on one NVIDIA GPU.
#
# Build through build.sh, which assembles the context (this directory plus
# packages/node-operator) so the build never uploads the whole monorepo:
#
#   distributions/nvidia-brev/build.sh local     # docker build on this machine
#   distributions/nvidia-brev/build.sh cloud     # Cloud Build -> Artifact Registry
#
# Every weight is baked in and pinned (see LICENSES.md). Nothing with a
# non-commercial or research-only licence is installed.

ARG CUDA_VERSION=12.8.1
ARG TRIPOSR_COMMIT=107cefdc244c39106fa830359024f6a2f1c78871
ARG TORCHMCUBES_COMMIT=a9ac95aa329957ba646e7bb057f825f5dfa77f38

# ---------------------------------------------------------------------------
# Builder: compile torchmcubes' CUDA kernel and fetch the pinned weights.
# ---------------------------------------------------------------------------
FROM nvidia/cuda:${CUDA_VERSION}-cudnn-devel-ubuntu22.04 AS builder
ARG TRIPOSR_COMMIT
ARG TORCHMCUBES_COMMIT

# Kernels for every GPU Brev offers that torch 2.7 cu128 supports: T4 (7.5),
# A100 (8.0), A10G / RTX A6000 (8.6), L4 / L40S (8.9), H100 / H200 (9.0),
# B200 (10.0) and RTX PRO 6000 Blackwell (12.0), plus PTX for anything newer.
ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TORCH_CUDA_ARCH_LIST="7.5;8.0;8.6;8.9;9.0;10.0;12.0+PTX" \
    PATH=/opt/venv/bin:$PATH \
    HF_HOME=/opt/hf \
    U2NET_HOME=/opt/u2net

RUN apt-get update && apt-get install -y --no-install-recommends \
        software-properties-common git build-essential ninja-build ca-certificates curl \
    && add-apt-repository -y universe \
    && apt-get install -y --no-install-recommends python3.11 python3.11-venv python3.11-dev \
    && rm -rf /var/lib/apt/lists/* \
    && python3.11 -m venv /opt/venv \
    && pip install --upgrade pip setuptools wheel

RUN pip install torch==2.7.1 --index-url https://download.pytorch.org/whl/cu128

# torchmcubes reads the installed torch at build time, so it is built without
# pip's isolated environment (same reason as workers/model-triposr).
RUN pip install scikit-build-core pybind11 cmake ninja numpy \
    && pip install --no-build-isolation "git+https://github.com/tatsy/torchmcubes.git@${TORCHMCUBES_COMMIT}"

RUN git clone https://github.com/VAST-AI-Research/TripoSR.git /opt/triposr \
    && git -C /opt/triposr checkout --quiet "${TRIPOSR_COMMIT}" \
    && rm -rf /opt/triposr/.git /opt/triposr/figures

COPY image/requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

COPY image/download_weights.py /tmp/download_weights.py
RUN python /tmp/download_weights.py /opt/weights/triposr

# Samples come from TripoSR's own examples directory (MIT, same licence as the code).
RUN mkdir -p /opt/samples \
    && for f in chair robot hamburger teapot flamingo horse poly_fox unicorn; do \
         cp "/opt/triposr/examples/${f}.png" /opt/samples/; \
       done

# ---------------------------------------------------------------------------
# Runtime: CUDA 12.8 runtime + cuDNN 9 (ONNX Runtime's CUDA provider needs both),
# Python 3.11 venv from the builder, Node 22 for the inference node.
# ---------------------------------------------------------------------------
FROM nvidia/cuda:${CUDA_VERSION}-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH \
    PYTHONPATH=/opt/three-ws:/opt/triposr \
    HF_HOME=/opt/hf \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    U2NET_HOME=/opt/u2net \
    TRIPOSR_WEIGHTS=/opt/weights/triposr \
    THREE_WS_SAMPLES=/opt/samples \
    THREE_WS_OUTPUTS=/workspace/outputs \
    THREE_WS_NODE_DIR=/opt/node-operator \
    PLATFORM_URL=https://three.ws \
    CAPABILITY=text-embedding \
    MODEL=Xenova/all-MiniLM-L6-v2 \
    IDENTITY_PATH=/workspace/identity/node-identity.json \
    JUPYTER_TOKEN=""

RUN apt-get update && apt-get install -y --no-install-recommends \
        software-properties-common ca-certificates curl gnupg tini libgl1 libglib2.0-0 \
    && add-apt-repository -y universe \
    && apt-get install -y --no-install-recommends python3.11 \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get purge -y --auto-remove software-properties-common gnupg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /opt/triposr /opt/triposr
COPY --from=builder /opt/weights /opt/weights
COPY --from=builder /opt/hf /opt/hf
COPY --from=builder /opt/u2net /opt/u2net
COPY --from=builder /opt/samples /opt/samples

# The inference node client, with its fp32 MiniLM graph cached so the GPU
# self-test needs no network. The throwaway identity from the caching run is
# deleted: every container generates its own on first use.
WORKDIR /opt/node-operator
COPY node-operator/package.json node-operator/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY node-operator/src ./src
RUN DEVICE=cpu DTYPE=fp32 IDENTITY_PATH=/tmp/cache-identity.json node src/index.js --self-test \
    && rm -f /tmp/cache-identity.json

# model-viewer is served from the studio itself, so the page needs no CDN.
RUN mkdir -p /tmp/mv && cd /tmp/mv \
    && npm pack --silent @google/model-viewer@4.3.1 \
    && tar -xzf google-model-viewer-4.3.1.tgz \
    && mkdir -p /opt/model-viewer \
    && cp package/dist/model-viewer.min.js package/LICENSE /opt/model-viewer/ \
    && rm -rf /tmp/mv

COPY image/ /opt/three-ws/
COPY LICENSES.md /licenses/THREE_WS_QUICKSTART_LICENSES.md
RUN mkdir -p /opt/three-ws/studio/static/vendor \
    && cp /opt/model-viewer/model-viewer.min.js /opt/three-ws/studio/static/vendor/ \
    && cp /opt/model-viewer/LICENSE /licenses/model-viewer-LICENSE \
    && cp /opt/triposr/LICENSE /licenses/TripoSR-LICENSE \
    && chmod +x /opt/three-ws/start.sh \
    && python /opt/three-ws/tests/test_core.py

# Runs as uid 1000, the default user on Brev and most cloud Ubuntu images, so
# files in the mounted /workspace volume belong to the person on the host.
RUN groupadd --gid 1000 three \
    && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash three \
    && mkdir -p /workspace \
    && chown -R three:three /workspace /opt/node-operator/models
USER three
WORKDIR /workspace
VOLUME ["/workspace"]

EXPOSE 8000 8888
HEALTHCHECK --interval=15s --timeout=6s --start-period=300s --retries=4 \
    CMD ["python", "/opt/three-ws/healthcheck.py"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/opt/three-ws/start.sh"]
