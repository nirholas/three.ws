# DEV-ONLY image. See README.md "License": do not deploy to production.
FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive LHM_REPO=/opt/LHM \
    TORCH_CUDA_ARCH_LIST=8.9

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.10 python3-pip python3.10-dev git curl build-essential ninja-build \
        libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.10 /usr/bin/python \
    && pip install --upgrade pip setuptools wheel

RUN pip install torch==2.3.0 torchvision==0.18.0 --index-url https://download.pytorch.org/whl/cu121

# Pin the upstream commit at build time with --build-arg LHM_REF=<sha>.
ARG LHM_REF=main
RUN git clone https://github.com/aigc3d/LHM.git /opt/LHM && git -C /opt/LHM checkout ${LHM_REF} \
    && pip install -r /opt/LHM/requirements.txt

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

WORKDIR /app
COPY worker_security.py lhm_prep.py main.py test_lhm_prep.py /app/
RUN python /app/test_lhm_prep.py

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--timeout-keep-alive", "300"]
