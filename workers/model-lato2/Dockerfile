# LATO.2 (Meshy, MIT code and weights): artist-mesh retopology on an L4 (24 GB).
#
# Same CUDA 12.4 / torch 2.6.0 matrix as workers/model-trellis2, because LATO.2's
# own setup.sh is copied from TRELLIS.2's and needs the same compiled extensions
# (nvdiffrast, CuMesh, FlexGEMM, o_voxel) at import time. Upstream is pinned to a
# commit; the checkpoints (about 3.6 GB) are staged to the weights bucket by
# stage_weights.sh and streamed at boot, never fetched from the Hub at serve time.
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

FROM nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04

ARG TORCH_CUDA_ARCH_LIST="8.9"
ARG LATO_COMMIT=fbb1f5a5755e6db8700cf6922fd506830b7cdccd

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    TORCH_CUDA_ARCH_LIST="${TORCH_CUDA_ARCH_LIST}" \
    CUDA_HOME=/usr/local/cuda \
    LATO_ROOT=/app/LATO.2 \
    PYTHONPATH=/app/LATO.2:/app/TRELLIS.2/o-voxel \
    PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
    MALLOC_ARENA_MAX=2

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.10 python3.10-dev python3-pip \
        git curl wget build-essential ninja-build \
        libgl1 libglib2.0-0 libgomp1 libjpeg-dev libusb-1.0-0 libegl1 libspatialindex-dev \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.10 /usr/bin/python \
    && pip install --upgrade pip setuptools wheel

COPY --from=gltfpack /usr/local/bin/gltfpack /usr/local/bin/gltfpack

RUN pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124

# setup.sh --basic
RUN pip install numpy trimesh tqdm pillow ninja psutil opencv-python-headless huggingface_hub \
        "open3d==0.19.0" plyfile zstandard easydict scipy rtree \
    && pip install spconv-cu124==2.3.8 \
    && pip install torch-scatter -f https://data.pyg.org/whl/torch-2.6.0+cu124.html

# setup.sh --flash-attn is skipped on purpose: it compiles for 30+ minutes and
# routinely OOMs the builder. xformers is the attention backend upstream
# documents as the alternative.
RUN pip install xformers==0.0.29.post2 --index-url https://download.pytorch.org/whl/cu124
ENV ATTN_BACKEND=xformers

# setup.sh --nvdiffrast --cumesh --flexgemm --o-voxel (all required at import time).
RUN git clone -b v0.4.0 --depth 1 https://github.com/NVlabs/nvdiffrast.git /tmp/ext/nvdiffrast \
    && pip install --no-build-isolation /tmp/ext/nvdiffrast
RUN git clone --recursive https://github.com/JeffreyXiang/CuMesh.git /tmp/ext/CuMesh \
    && pip install --no-build-isolation /tmp/ext/CuMesh
RUN git clone --recursive https://github.com/JeffreyXiang/FlexGEMM.git /tmp/ext/FlexGEMM \
    && pip install --no-build-isolation /tmp/ext/FlexGEMM
RUN git clone --recursive https://github.com/microsoft/TRELLIS.2.git /app/TRELLIS.2 \
    && git -C /app/TRELLIS.2 checkout 75fbf0183001ed9876c8dbb35de6b68552ee08bd \
    && git -C /app/TRELLIS.2 submodule update --init --recursive \
    && pip install --no-build-isolation /app/TRELLIS.2/o-voxel \
    && rm -rf /tmp/ext

RUN git clone https://github.com/LoHhhha/LATO.2.git /app/LATO.2 \
    && git -C /app/LATO.2 checkout ${LATO_COMMIT}

RUN pip install \
        "fastapi==0.115.0" "uvicorn[standard]==0.32.0" "pydantic>=2.0.0" \
        "httpx>=0.27.0" "google-cloud-storage==2.18.0" "pytest>=8.0.0"

WORKDIR /app
COPY worker_security.py gltf_meshopt.py lato_policy.py lato_run.py weights_sync.py main.py /app/
COPY test_lato_policy.py test_lato_run.py test_gltf_meshopt.py test_weights_sync.py test_app_contract.py /app/

# Build-time gate: the topology gate, retry and frame logic, the vendored meshopt
# decoder and the served contract, none of which need a GPU.
RUN python3 -m pytest /app/test_lato_policy.py /app/test_lato_run.py /app/test_weights_sync.py -q \
    && python3 /app/test_gltf_meshopt.py \
    && API_KEY=build-gate GCS_BUCKET=build-gate python3 /app/test_app_contract.py

EXPOSE 8080
CMD ["python3", "weights_sync.py", "--serve"]
