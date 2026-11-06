# DEV-ONLY image. See README.md "License": do not deploy to production.
FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive LHM_REPO=/opt/LHM \
    TORCH_CUDA_ARCH_LIST=8.9

# Python 3.11 from deadsnakes: Pillow 13 (the first release with the 2026 decoder
# and PDF fixes) requires Python >= 3.11, and Ubuntu 22.04 only ships 3.10.
# A venv on PATH makes `python` and `pip` resolve to 3.11 for every later step.
RUN apt-get update && apt-get install -y --no-install-recommends software-properties-common gpg-agent \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3.11-dev python3.11-venv git curl build-essential ninja-build \
        libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && python3.11 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
RUN pip install --upgrade pip setuptools wheel

RUN pip install torch==2.3.0 torchvision==0.18.0 --index-url https://download.pytorch.org/whl/cu121

# Pin the upstream commit at build time with --build-arg LHM_REF=<sha>.
ARG LHM_REF=main
# Upstream pins numpy 1.23.0 and matplotlib 3.5.3, which publish no cp311 wheels.
# Move each to the nearest release that does (same numpy minor, so the np.bool-era
# API upstream relies on is unchanged).
# chumpy and basicsr ship only legacy sdists whose setup.py imports pip, numpy and
# torch, which pip's isolated build env hides; build them against this venv instead.
RUN git clone https://github.com/aigc3d/LHM.git /opt/LHM && git -C /opt/LHM checkout ${LHM_REF} \
    && sed -i -e 's/^numpy==.*/numpy==1.23.5/' -e 's/^matplotlib==.*/matplotlib==3.6.3/' /opt/LHM/requirements.txt \
    && pip install numpy==1.23.5 \
    && pip install --no-build-isolation -r /opt/LHM/requirements.txt

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

WORKDIR /app
COPY worker_security.py lhm_prep.py main.py test_lhm_prep.py /app/
RUN python /app/test_lhm_prep.py

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--timeout-keep-alive", "300"]
