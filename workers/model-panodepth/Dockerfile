# Ubuntu 24.04 for Python 3.12: Pillow 13.0.0, the only release with no open
# advisory, requires Python >= 3.11, which 22.04 does not ship.
FROM nvidia/cuda:12.8.0-cudnn-runtime-ubuntu24.04

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    OPENCV_IO_ENABLE_OPENEXR=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH

# 24.04's system Python is externally managed (PEP 668), so everything installs
# into a venv that sits first on PATH for both root and the app user.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.12 python3.12-venv git ca-certificates libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && python3.12 -m venv /opt/venv \
    && pip install --upgrade pip setuptools wheel

RUN pip install torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu128

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

# MoGe (MIT) and its geometry helper, pinned to the commits the worker was proven on.
# --no-deps: MoGe's pyproject also pulls a gradio viewer and training stack we never import.
RUN pip install --no-deps \
        "git+https://github.com/microsoft/MoGe.git@74fbce054ebed49800de42d0ad0e83495065719a" \
        "git+https://github.com/EasternJournalist/utils3d-moge.git@62f09d58509485564e24d5d9f6aac9ee9ebc0c37"

# Weights are staged into ./weights by cloudbuild.yaml from
# gs://three-ws-model-weights/panodepth/ (SHA-256 in weights/SHA256SUMS, checked here).
COPY weights/ /weights/panodepth/
RUN cd /weights/panodepth/moge-2-vitl-normal && sha256sum -c SHA256SUMS

RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY *.py /app/
COPY tests /app/tests
RUN chown -R app:app /app
USER app

# Fail the build, not a production request, if the service or the geometry is broken.
RUN API_KEY=build python -m pytest -q tests \
    && API_KEY=build python -c "import main; print('main imports clean')"

ENV WEIGHTS_PATH=/weights/panodepth/moge-2-vitl-normal/model.pt \
    PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers 1 --timeout-keep-alive 600"]
