# Modly (Lightning Pixel, MIT) run headless on an L4 (24 GB): image to 3D through
# Modly's own backend and its official open-weight extensions, behind the
# three.ws task contract. See README.md.
#
#   * Modly and both extensions are pinned to commits and fetched by SHA, so a
#     moving `main` can never change what a rebuild serves.
#   * Each extension gets the venv Modly's own installer would build (its
#     setup.py), translated into pinned pip installs. Both venvs share the one
#     torch 2.6.0 + cu124 install in the system interpreter (--system-site-packages)
#     instead of carrying two 5 GB copies.
#   * CUDA 12.4 *devel* base: nvcc compiles diso (TripoSG's DiffDMC decoder) from
#     a pinned commit. TORCH_CUDA_ARCH_LIST defaults to 8.9 (L4).
#   * Modly's decimate op runs on Node + meshoptimizer; Node is pinned by checksum
#     and its packages come from meshopt/package-lock.json.
#   * rembg's u2net.onnx (background removal, used by both extensions) is baked in
#     by checksum: the service runs with the Hub offline.
#   * Modly's uv_unwrapper and texture_baker (derived from Stability AI's
#     stable-fast-3d, under the Stability AI Community License) are NOT built.
#     postprocess.py replaces them with xatlas (MIT) and a numpy/scipy bake.
#   * gltfpack (zeux/meshoptimizer, MIT) is pinned by release tag and checksum,
#     the same pin workers/model-trellis2 ships, and compresses the output GLB.
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
ARG MODLY_COMMIT=f11a4d2bd9fe994b9d30f76a36cb6c18ac8733ea
ARG TRIPOSG_EXT_COMMIT=cc30cb8bedddf8141e78dc6cf88a4cb1a305d128
ARG HUNYUAN_TURBO_EXT_COMMIT=9457b71b6e3ee5436240cac0d6c1bbcd02e9f53d
ARG TRIPOSG_COMMIT=fc5c40990181e2a756c4e0b1c2f4d6b5202faf8c
ARG HUNYUAN3D2_COMMIT=f8db63096c8282cb27354314d896feba5ba6ff8a
ARG DISO_COMMIT=9792ad928ccb09bdec938779651ee03e395758a6
ARG NODE_VERSION=v20.18.1
ARG NODE_SHA256=c6fa75c841cbffac851678a472f2a5bd612fff8308ef39236190e1f8dbb0e567
ARG U2NET_SHA256=8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    TORCH_CUDA_ARCH_LIST="${TORCH_CUDA_ARCH_LIST}" \
    CUDA_HOME=/usr/local/cuda \
    PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
    MODLY_API_DIR=/opt/modly/api \
    EXTENSIONS_DIR=/opt/modly-extensions \
    U2NET_HOME=/opt/u2net \
    # The weights are staged to the bucket, never fetched from the Hub at serve time.
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    # Cap glibc at two malloc arenas (see instance_health.py).
    MALLOC_ARENA_MAX=2

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.10 python3.10-dev python3.10-venv python3-pip \
        git curl wget xz-utils build-essential ninja-build \
        libgl1 libglib2.0-0 libgomp1 libsm6 libxext6 libxrender1 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.10 /usr/bin/python \
    && pip install --upgrade pip==24.3.1 setuptools==75.8.0 wheel==0.45.1

COPY --from=gltfpack /usr/local/bin/gltfpack /usr/local/bin/gltfpack

# 1. Torch, once, in the system interpreter. Both extension venvs see it through
# --system-site-packages; the host (Modly + the front) never imports it.
RUN pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124

# 2. Host: Modly's FastAPI backend and the three.ws front, every line pinned.
COPY requirements-host.txt /tmp/requirements-host.txt
RUN pip install -r /tmp/requirements-host.txt

# 3. Modly itself, fetched by commit. Its LICENSE travels with the image.
RUN git init -q /opt/modly \
    && git -C /opt/modly remote add origin https://github.com/lightningpixel/modly.git \
    && git -C /opt/modly fetch -q --depth 1 origin ${MODLY_COMMIT} \
    && git -C /opt/modly checkout -q FETCH_HEAD \
    && rm -rf /opt/modly/.git \
    && mkdir -p /app/licenses \
    && cp /opt/modly/LICENSE /app/licenses/MODLY-LICENSE

# 4. Node + the mesh-optimizer packages Modly's decimate op loads from
# <modly>/src/areas/workflows/nodes/mesh-optimizer/node_modules.
RUN curl -fsSL -o /tmp/node.tar.xz \
        https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz \
    && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
        --exclude=CHANGELOG.md --exclude=README.md --exclude=LICENSE \
    && rm /tmp/node.tar.xz \
    && node --version
COPY meshopt/package.json meshopt/package-lock.json /opt/meshopt/
RUN cd /opt/meshopt \
    && npm ci --omit=dev --no-audit --no-fund \
    && mv /opt/meshopt/node_modules /opt/modly/src/areas/workflows/nodes/mesh-optimizer/node_modules \
    && rm -rf /opt/meshopt /root/.npm

# 5. Background removal weights (rembg u2net), by checksum.
RUN mkdir -p /opt/u2net \
    && curl -fsSL -o /opt/u2net/u2net.onnx \
        https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx \
    && echo "${U2NET_SHA256}  /opt/u2net/u2net.onnx" | sha256sum -c -

# 6. TripoSG extension (MIT). Folder name must equal the manifest id. An empty
# vendor/ tells Modly's registry the pure-Python vendor step is not needed: the
# triposg package lives in the venv's site-packages instead, which is exactly
# what the extension's own setup.py installs.
COPY requirements-triposg.txt /tmp/requirements-triposg.txt
RUN git init -q ${EXTENSIONS_DIR}/triposg \
    && git -C ${EXTENSIONS_DIR}/triposg remote add origin https://github.com/lightningpixel/modly-triposg-extension.git \
    && git -C ${EXTENSIONS_DIR}/triposg fetch -q --depth 1 origin ${TRIPOSG_EXT_COMMIT} \
    && git -C ${EXTENSIONS_DIR}/triposg checkout -q FETCH_HEAD \
    && rm -rf ${EXTENSIONS_DIR}/triposg/.git \
    && mkdir ${EXTENSIONS_DIR}/triposg/vendor \
    && python3 -m venv --system-site-packages ${EXTENSIONS_DIR}/triposg/venv \
    && ${EXTENSIONS_DIR}/triposg/venv/bin/pip install -r /tmp/requirements-triposg.txt
# diso compiles against the shared torch, so build isolation must stay off.
RUN ${EXTENSIONS_DIR}/triposg/venv/bin/pip install --no-build-isolation \
        "git+https://github.com/SarahWeiii/diso.git@${DISO_COMMIT}"
RUN git init -q /tmp/TripoSG \
    && git -C /tmp/TripoSG remote add origin https://github.com/VAST-AI-Research/TripoSG.git \
    && git -C /tmp/TripoSG fetch -q --depth 1 origin ${TRIPOSG_COMMIT} \
    && git -C /tmp/TripoSG checkout -q FETCH_HEAD \
    && SITE="$(${EXTENSIONS_DIR}/triposg/venv/bin/python -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')" \
    && cp -r /tmp/TripoSG/triposg "${SITE}/triposg" \
    && cp /tmp/TripoSG/LICENSE /app/licenses/TRIPOSG-LICENSE \
    && rm -rf /tmp/TripoSG

# 7. Hunyuan3D 2 Mini Turbo extension (Tencent Hunyuan 3D 2.0 Community License).
# hy3dgen installs from a pinned Hunyuan3D-2 commit with --no-deps: only the
# shape pipeline runs, its dependencies are in requirements-hunyuan.txt, and the
# paint pipeline's compiled rasterizers are never built.
COPY requirements-hunyuan.txt /tmp/requirements-hunyuan.txt
RUN git init -q ${EXTENSIONS_DIR}/hunyuan3d-mini-turbo \
    && git -C ${EXTENSIONS_DIR}/hunyuan3d-mini-turbo remote add origin https://github.com/lightningpixel/modly-hunyuan3d-mini-turbo-extension.git \
    && git -C ${EXTENSIONS_DIR}/hunyuan3d-mini-turbo fetch -q --depth 1 origin ${HUNYUAN_TURBO_EXT_COMMIT} \
    && git -C ${EXTENSIONS_DIR}/hunyuan3d-mini-turbo checkout -q FETCH_HEAD \
    && rm -rf ${EXTENSIONS_DIR}/hunyuan3d-mini-turbo/.git \
    && python3 -m venv --system-site-packages ${EXTENSIONS_DIR}/hunyuan3d-mini-turbo/venv \
    && ${EXTENSIONS_DIR}/hunyuan3d-mini-turbo/venv/bin/pip install -r /tmp/requirements-hunyuan.txt \
    && git init -q /tmp/Hunyuan3D-2 \
    && git -C /tmp/Hunyuan3D-2 remote add origin https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git \
    && git -C /tmp/Hunyuan3D-2 fetch -q --depth 1 origin ${HUNYUAN3D2_COMMIT} \
    && git -C /tmp/Hunyuan3D-2 checkout -q FETCH_HEAD \
    && ${EXTENSIONS_DIR}/hunyuan3d-mini-turbo/venv/bin/pip install --no-build-isolation --no-deps /tmp/Hunyuan3D-2 \
    && cp /tmp/Hunyuan3D-2/LICENSE /app/licenses/HUNYUAN3D-2-LICENSE \
    && cp /tmp/Hunyuan3D-2/NOTICE /app/licenses/HUNYUAN3D-2-NOTICE \
    && rm -rf /tmp/Hunyuan3D-2

WORKDIR /app
COPY worker_security.py request_policy.py storage_backend.py instance_health.py \
     gltf_meshopt.py postprocess.py main.py /app/
COPY test_request_policy.py test_postprocess.py test_gltf_meshopt.py \
     test_instance_health.py test_storage_backend.py test_app_contract.py /app/

# Build-time gate, none of which needs a GPU: the pure-logic tests, then the
# served contract, including a real start of the pinned Modly with both pinned
# extensions, its repair/decimate/smooth ops, and an import of each extension's
# model package inside its venv. A broken pin fails here, not on a revision.
RUN python3 -m pytest /app/test_request_policy.py /app/test_postprocess.py \
        /app/test_gltf_meshopt.py /app/test_instance_health.py \
        /app/test_storage_backend.py -q -p no:cacheprovider \
    && MODLY_CONTRACT_REQUIRE_BACKEND=1 python3 /app/test_app_contract.py

EXPOSE 8080

CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8080", \
     "--workers", "1", \
     "--timeout-keep-alive", "300"]
