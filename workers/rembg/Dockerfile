FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

# rembg downloads ONNX model weights on first use; pre-cache every model a
# caller asks for so cold starts never hit the network. Models live in
# /root/.u2net/. u2net and isnet-general-use are the warm defaults.
# birefnet-general-lite is what TripoSG mattes every image with
# (REMBG_MODEL in workers/model-triposg): left lazy, each fresh instance
# spent about two minutes downloading its 224 MB on the first TripoSG job,
# past TripoSG's 120 s matte budget, so that job failed (2026-11-20).
# tests/worker-rembg-baked-models.test.js keeps this list in step with the
# callers. u2net_human_seg and silueta stay lazy: no worker requests them.
RUN python -c "import rembg; rembg.new_session('u2net')" && \
    python -c "import rembg; rembg.new_session('isnet-general-use')"
RUN python -c "import rembg; rembg.new_session('birefnet-general-lite')"

WORKDIR /app
COPY worker_security.py rembg_policy.py main.py task_store.py forwarder.py /app/
COPY tracing.py test_tracing.py triton_backend.py /app/
COPY test_rembg_policy.py test_rembg_smoke.py test_task_store.py test_forwarder.py \
     test_task_routes.py /app/

# Build gate: the image does not ship unless the request policy holds, task
# records survive a cross-instance poll, the traffic split falls back safely,
# and a real cutout comes out of both baked-in models. API_KEY/GCS_BUCKET are import-time
# requirements of main.py; nothing here touches GCS or the network.
RUN python test_rembg_policy.py && python test_task_store.py && python test_forwarder.py && \
    API_KEY=build-gate GCS_BUCKET=build-gate python test_rembg_smoke.py && \
    API_KEY=build-gate GCS_BUCKET=build-gate python test_task_routes.py

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
