# Throwaway CUDA image for measuring splat_train on a Cloud Run L4. Not the production image:
# order 337 owns workers/model-pano2splat/Dockerfile. measure.sh assembles the build context
# (this file, run.sh, the splat_train package and its requirements) and deletes the image after.
FROM nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TORCH_CUDA_ARCH_LIST="8.9+PTX"

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.10 python3.10-dev python3-pip git cmake ninja-build build-essential \
        ffmpeg libgl1 libglib2.0-0 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/local/bin/python

RUN python -m pip install --upgrade pip setuptools wheel \
    && python -m pip install torch==2.4.1 --index-url https://download.pytorch.org/whl/cu124 \
    && python -m pip install gsplat==1.5.3 --extra-index-url https://docs.gsplat.studio/whl/pt24cu124 \
    && python -m pip install scikit-build-core nanobind

WORKDIR /app
COPY requirements.d/splat_train.txt /app/requirements.d/splat_train.txt
RUN python -m pip install --no-build-isolation -r /app/requirements.d/splat_train.txt

COPY splat_train /app/splat_train
COPY run.sh /app/run.sh
RUN chmod +x /app/run.sh \
    && python -c "import torch, gsplat, spz, cv2, scipy, torchmetrics; print('torch', torch.__version__, 'gsplat', gsplat.__version__)" \
    && python -m splat_train --help > /dev/null

ENTRYPOINT ["/app/run.sh"]
