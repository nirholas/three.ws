FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

# runtime (not devel) base: unlike model-triposr's torchmcubes, TripoSplat
# compiles no CUDA extension at install time, so nvcc is not needed here.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    PYTHONPATH=/opt/triposplat

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.10 python3.10-dev python3-pip \
        git curl \
        libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.10 /usr/bin/python \
    && pip install --upgrade pip setuptools wheel

# torch first (cached layer), matching the CUDA 12.1 base.
RUN pip install torch==2.3.1 torchvision==0.18.1 --index-url https://download.pytorch.org/whl/cu121

# TripoSplat is not a pip package (two files, no setup.py/pyproject): clone it
# and put it on PYTHONPATH so `from triposplat import TripoSplatPipeline`
# resolves, same pattern as model-triposr's `tsr` package.
RUN git clone --depth 1 https://github.com/VAST-AI-Research/TripoSplat.git /opt/triposplat

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

WORKDIR /app
COPY worker_security.py /app/worker_security.py
COPY image_prep.py /app/image_prep.py
COPY main.py /app/main.py
COPY test_image_prep.py /app/test_image_prep.py

# Build-time guard: the pre-inference path (decode, output naming) and the
# auth + SSRF guards must pass their unit suite or the image does not ship.
RUN python /app/test_image_prep.py

EXPOSE 8080

CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8080", \
     "--workers", "1", \
     "--timeout-keep-alive", "300"]
