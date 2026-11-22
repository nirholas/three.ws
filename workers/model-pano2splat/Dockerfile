# model-pano2splat: one GPU image for pano_stitch, pano_sfm, splat_train and the service shell.
#
#   colmap-build  compiles COLMAP 4.2.1 with CUDA (GUI off), in a devel image
#   py-build      builds the Python venv (torch cu129, service deps, every requirements.d/*.txt)
#                 in a devel image so CUDA extensions such as gsplat compile ahead of time
#   runtime       CUDA 12.9 runtime image with the COLMAP binaries, ffmpeg (NVENC/NVDEC) and the venv
#
# COLMAP is built from the tagged release rather than taken from the colmap/colmap
# image: that image's tags are dated nightlies, not versions, so 4.2.1 cannot be pinned there.
ARG CUDA_VERSION=12.9.1
ARG UBUNTU_VERSION=24.04
ARG COLMAP_TAG=4.2.1
# 8.0 A100, 8.6 A10/RTX 30, 8.9 L4/RTX 40, 9.0 H100.
ARG CUDA_ARCHS="80;86;89;90"

FROM nvidia/cuda:${CUDA_VERSION}-devel-ubuntu${UBUNTU_VERSION} AS colmap-build
ARG COLMAP_TAG
ARG CUDA_ARCHS
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        git cmake ninja-build build-essential ca-certificates \
        libboost-program-options-dev libboost-graph-dev libboost-system-dev \
        libeigen3-dev libopenimageio-dev openimageio-tools libmetis-dev \
        libgoogle-glog-dev libgtest-dev libgmock-dev libsqlite3-dev libglew-dev \
        libcgal-dev libceres-dev libcurl4-openssl-dev libssl-dev libopenblas-dev \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/include/opencv4
RUN git clone --depth 1 --branch ${COLMAP_TAG} https://github.com/colmap/colmap.git /colmap
RUN cd /colmap && mkdir build && cd build \
    && cmake .. -GNinja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCUDA_ENABLED=ON \
        -DGUI_ENABLED=OFF \
        -DONNX_ENABLED=OFF \
        -DTESTS_ENABLED=OFF \
        -DCMAKE_CUDA_ARCHITECTURES="${CUDA_ARCHS}" \
        -DCMAKE_INSTALL_PREFIX=/colmap-install \
    && ninja install

FROM nvidia/cuda:${CUDA_VERSION}-devel-ubuntu${UBUNTU_VERSION} AS py-build
ARG CUDA_ARCHS
ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    TORCH_CUDA_ARCH_LIST="8.0;8.6;8.9;9.0+PTX" \
    MAX_JOBS=8
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-dev python3-venv python3-pip git build-essential ninja-build cmake \
        libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
RUN pip install --upgrade pip setuptools wheel \
    && pip install torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu129
COPY requirements.txt /build/requirements.txt
RUN pip install -r /build/requirements.txt
# Stage packages pin conflicting dependencies (numpy 1 vs 2, opencv 4 vs 5), so each requirements.d
# file gets its own venv under /opt/stages/<stage>. torch/torchvision come from /opt/venv through a
# trailing .pth, so there is one copy of the CUDA wheels. stages.stage_python() selects the venv.
COPY requirements.d/ /build/requirements.d/
RUN set -e; \
    BASE="$(python -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"; \
    for f in /build/requirements.d/*.txt; do \
        n="$(basename "$f" .txt)"; \
        python3 -m venv "/opt/stages/$n"; \
        SP="$(/opt/stages/$n/bin/python -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"; \
        echo "$BASE" > "$SP/zz_base_torch.pth"; \
        /opt/stages/$n/bin/pip install --upgrade pip setuptools wheel scikit-build-core nanobind ninja cmake; \
        echo "== stage $n"; \
        PYTHONPATH="$BASE" /opt/stages/$n/bin/pip install --no-build-isolation -r "$f"; \
    done
# PyPI serves gsplat as a pure-Python wheel, which would leave the CUDA extension to a JIT build
# at first use, and the runtime image has no nvcc. --no-binary forces the sdist so setup.py
# compiles gsplat.csrc here, where nvcc is; importing gsplat.csrc fails the build if it did not.
RUN set -e; BASE="$(python -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"; \
    if [ -d /opt/stages/splat_train ]; then \
        PYTHONPATH="$BASE" /opt/stages/splat_train/bin/pip install --no-build-isolation --no-binary gsplat gsplat==1.5.3; \
        /opt/stages/splat_train/bin/python -c "from gsplat import csrc; import gsplat, torch, numpy; print('gsplat', gsplat.__version__, csrc.__file__, 'torch', torch.__version__, 'numpy', numpy.__version__)"; \
    fi

FROM nvidia/cuda:${CUDA_VERSION}-runtime-ubuntu${UBUNTU_VERSION} AS runtime
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility,video \
    PATH=/opt/venv/bin:$PATH \
    HOME=/home/app \
    TORCH_EXTENSIONS_DIR=/home/app/.cache/torch_extensions
RUN apt-get update && apt-get install -y --no-install-recommends --no-install-suggests \
        python3 ffmpeg ca-certificates \
        libgl1 libglib2.0-0 libgomp1 libopengl0 \
        libboost-program-options1.83.0 libmetis5 libceres4t64 libopenimageio2.4t64 \
        libgoogle-glog0v6t64 libglew2.2 libcurl4 libssl3t64 libopenblas0 libomp5 \
        libgmp10 libmpfr6 libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 app
COPY --from=colmap-build /colmap-install/ /usr/local/
COPY --from=py-build /opt/venv /opt/venv
COPY --from=py-build /opt/stages /opt/stages
RUN ldconfig \
    && missing="$(ldd /usr/local/bin/colmap | grep 'not found' || true)" \
    && if [ -n "$missing" ]; then echo "colmap is missing libraries:\n$missing"; exit 1; fi \
    && colmap help | head -3 \
    && ffmpeg -hide_banner -encoders 2>/dev/null | grep -E 'h264_nvenc|hevc_nvenc'

WORKDIR /app
COPY --chown=app:app . /app
USER app
RUN python -c "import main, verify; print('service imports clean')" \
    && for s in /opt/stages/*; do echo "stage venv $s"; $s/bin/python -c "import numpy, torch; print(numpy.__version__, torch.__version__)"; done \
    && /opt/stages/splat_train/bin/python -c "from gsplat import csrc; print('gsplat extension', csrc.__file__)" \
    && /opt/stages/pano_sfm/bin/python -c "from torchvision.models.segmentation import DeepLabV3_MobileNet_V3_Large_Weights as W; W.DEFAULT.get_state_dict(progress=False); print('operator mask weights cached')"

EXPOSE 8080
# Cloud Run sets $PORT. One uvicorn worker: the task manager is in-process and one
# task runs at a time per instance.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --timeout-keep-alive 600"]
