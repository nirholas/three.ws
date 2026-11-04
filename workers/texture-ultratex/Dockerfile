# UltraTex runtime image. Python 3.12, PyTorch 2.5.1 and Triton 3.1.0 are the
# versions the upstream kernels are built against (CUDA 12.4). The UltraTex
# checkout and its FLUX base weights are NOT baked in: the base-model licenses
# are non-commercial, so the operator stages them (see README.md) and points
# ULTRATEX_INFER_CMD at the upstream inference entry point.
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        software-properties-common ca-certificates git \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update && apt-get install -y --no-install-recommends \
        python3.12 python3.12-venv python3.12-dev libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN python3.12 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

RUN pip install --upgrade pip \
    && pip install torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu124 \
    && pip install triton==3.1.0

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY contract.py main.py tracing.py ultratex_runner.py worker_security.py ./

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
