FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

# TripoSplat is not a pip package: clone the MIT repo to /opt/triposplat and put
# it on the path. Its only deps are numpy, safetensors, pillow, tqdm and torch.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    TRIPOSPLAT_REPO=/opt/triposplat

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.10 python3-pip git curl libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.10 /usr/bin/python \
    && pip install --upgrade pip setuptools wheel

RUN pip install torch==2.3.1 torchvision==0.18.1 --index-url https://download.pytorch.org/whl/cu121

RUN git clone --depth 1 https://github.com/VAST-AI-Research/TripoSplat.git /opt/triposplat

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

WORKDIR /app
COPY worker_security.py splat_prep.py main.py test_splat_prep.py /app/

# Build-time guard: input decoding, density bounds and output naming must pass.
RUN python /app/test_splat_prep.py

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--timeout-keep-alive", "300"]
