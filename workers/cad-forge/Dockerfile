FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# OpenCascade links against the GL/X stubs even headless; libseccomp2 backs
# pyseccomp, which is what keeps a model-written program off the network.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libgomp1 libseccomp2 libxrender1 libxext6 libsm6 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

WORKDIR /app
COPY worker_security.py cad_policy.py sandbox_child.py main.py /app/
# The sandbox child runs as nobody and must be able to read its own code.
RUN chmod 0755 /app && chmod 0644 /app/*.py

# Build gate: the policy unit tests plus real builds and real escape attempts
# through the sandbox, run as root exactly like Cloud Run. A regression in the
# sandbox fails the image instead of reaching production.
COPY test_cad_policy.py test_sandbox.py /app/
RUN python test_cad_policy.py && REQUIRE_SECCOMP=1 python test_sandbox.py

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
