FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04

# devel (not runtime) base: TripoSG pulls diso (differentiable iso-surface
# extraction), which compiles a CUDA extension at install time and needs nvcc.
# TORCH_CUDA_ARCH_LIST targets the Cloud Run L4 (compute capability 8.9).
# PYTHONPATH carries both the package root (triposg.pipelines.*) and scripts/
# (the image_process preprocessing helper used by main.py). No background
# remover weights are loaded: image mode mattes through rembg-service (matte.py).
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    TORCH_CUDA_ARCH_LIST="8.9+PTX" \
    PYTHONPATH=/opt/triposg:/opt/triposg/scripts \
    FORCE_CUDA=1

# Pinned so a rebuild cannot pick up a moving upstream `main`. Both are the
# commits workers/modly already builds TripoSG from.
ARG TRIPOSG_COMMIT=fc5c40990181e2a756c4e0b1c2f4d6b5202faf8c
ARG DISO_COMMIT=9792ad928ccb09bdec938779651ee03e395758a6

# Python 3.11, not jammy's default 3.10: Pillow 13 (which fixes the decoder
# advisories still open in 12.x, and this service decodes caller images) ships
# no 3.10 build. workers/texture and workers/modly run the same 3.11-on-jammy
# layout.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3.11-dev python3-pip \
        git curl wget build-essential ninja-build \
        libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.11 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.11 /usr/bin/python \
    && pip install --upgrade pip setuptools wheel

# torch first (cached layer), matching the CUDA 12.1 base. 2.5.1 is the newest
# cu121 torch, and transformers 5 needs torch>=2.4.
RUN pip install torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu121

# TripoSG's package set, pinned (see requirements.txt for why upstream's own
# requirements.txt is not installed).
COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

# diso compiles a CUDA extension against the installed torch, so build isolation
# must stay off: pip's isolated build env hides torch and the build fails with
# "ModuleNotFoundError: No module named 'torch'". FORCE_CUDA=1 (set above) makes
# it build the CUDA kernels on a GPU-less builder.
RUN pip install --no-build-isolation "git+https://github.com/SarahWeiii/diso.git@${DISO_COMMIT}"

# TripoSG is not a pip package (no setup.py/pyproject); it runs from
# /opt/triposg via PYTHONPATH.
RUN git init -q /opt/triposg \
    && git -C /opt/triposg remote add origin https://github.com/VAST-AI-Research/TripoSG.git \
    && git -C /opt/triposg fetch -q --depth 1 origin ${TRIPOSG_COMMIT} \
    && git -C /opt/triposg checkout -q FETCH_HEAD \
    && rm -rf /opt/triposg/.git

WORKDIR /app
COPY worker_security.py /app/worker_security.py
COPY request_policy.py /app/request_policy.py
COPY matte.py /app/matte.py
COPY main.py /app/main.py
# The tests ship in the image so the served contract can be smoke-tested against
# the exact dependency set that will run in production:
#   docker run --rm model-triposg python3 test_app_contract.py
COPY test_request_policy.py test_matte.py test_app_contract.py /app/

EXPOSE 8080

COPY tracing.py test_tracing.py /app/
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8080", \
     "--workers", "1", \
     "--timeout-keep-alive", "300"]
