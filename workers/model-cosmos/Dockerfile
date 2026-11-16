# model-cosmos: NVIDIA Cosmos3-Nano world generation for Cloud Run RTX PRO 6000
# (Blackwell, sm_120). torch cu128 wheels carry the CUDA runtime, so the base
# image only needs the driver-facing CUDA 12.8 layer that Cloud Run maps in.
FROM nvidia/cuda:12.8.1-base-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PYTHON_INSTALL_DIR=/opt/python \
    UV_COMPILE_BYTECODE=1 \
    HF_HUB_OFFLINE=1 \
    PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git libgl1 libglib2.0-0 libxcb1 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /usr/local/bin/uv

WORKDIR /app
COPY requirements.txt .
RUN uv venv /opt/venv --python 3.12 --managed-python \
 && VIRTUAL_ENV=/opt/venv uv pip install --no-cache -r requirements.txt --torch-backend cu128
ENV PATH=/opt/venv/bin:$PATH

COPY worker_security.py generation_config.py upsampler.py control.py main.py ./
COPY prompting/ ./prompting/

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--timeout-keep-alive", "75"]
