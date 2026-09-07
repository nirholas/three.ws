FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

# rembg downloads ONNX model weights on first use; pre-cache the two the service
# can warm at startup so cold starts never hit the network. Models live in
# /root/.u2net/. u2net_human_seg, silueta and birefnet-general-lite stay lazy:
# they are rarely asked for, and baking all five would add ~570 MB to every
# pull. The first birefnet request therefore pays a one-time 214 MB download.
RUN python -c "import rembg; rembg.new_session('u2net')" && \
    python -c "import rembg; rembg.new_session('isnet-general-use')"

WORKDIR /app
COPY worker_security.py rembg_policy.py main.py /app/
COPY test_rembg_policy.py test_rembg_smoke.py /app/

# Build gate: the image does not ship unless the request policy holds and a real
# cutout comes out of both baked-in models. API_KEY/GCS_BUCKET are import-time
# requirements of main.py; nothing here touches GCS or the network.
RUN python test_rembg_policy.py && \
    API_KEY=build-gate GCS_BUCKET=build-gate python test_rembg_smoke.py

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
