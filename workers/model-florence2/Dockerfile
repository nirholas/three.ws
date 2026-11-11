# Florence-2 (Microsoft, MIT) describe worker: captions, tags and detected
# objects for creation posters. One image serves the L4 Cloud Run service
# (main.py) and the verification / backfill Cloud Run job (batch.py).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/opt/hf \
    HF_HUB_DISABLE_TELEMETRY=1

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

# Bake the pinned weights into the image so a cold start never touches the
# network (about 1.6 GB). The revision matches describe.py's default.
ARG FLORENCE2_MODEL=florence-community/Florence-2-large-ft
ARG FLORENCE2_REVISION=26b734a54fdfbf9c398351eedfabb7f27fc470b7
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('${FLORENCE2_MODEL}', revision='${FLORENCE2_REVISION}', allow_patterns=['*.json','*.txt','*.safetensors'])"
ENV HF_HUB_OFFLINE=1

WORKDIR /app
COPY worker_security.py tags.py describe.py main.py batch.py test_tags.py smoke_test.py /app/

# Build gate: the tag rules hold, and the baked model describes a real image
# offline on the build machine's CPU.
RUN python test_tags.py && python smoke_test.py

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
