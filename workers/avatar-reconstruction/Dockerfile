# ── Stage: base ───────────────────────────────────────────────────────────────
# CUDA runtime, kept for the onnxruntime-gpu build that rembg[gpu] pulls in. Note
# the service DEPLOYS WITHOUT A GPU (see cloudbuild.yaml): measured 2026-07-25,
# the CUDA provider never actually engaged for background removal, so the L4 was
# returned to the shared regional pool and every stage now runs on the 8 vCPU
# allocation. onnxruntime-gpu falls back to its CPU provider cleanly, which is
# what production has been serving on since. The image is ~2 GB heavier than a
# plain CPU base for that fallback; swapping the base image is a live change to
# the inference path, so it needs its own measured run rather than a drive-by.
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1

# ── System dependencies ───────────────────────────────────────────────────────
# Python 3.11, not jammy's default 3.10: Pillow 13 (which fixes the decoder
# advisories still open in 12.x, and this service decodes caller images) ships
# no 3.10 build. workers/texture and workers/modly run the same 3.11-on-jammy layout.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3.11-dev python3-pip \
        git curl wget \
        # OpenCV headless runtime deps
        libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 \
        # MediaPipe runtime deps
        libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.11 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.11 /usr/bin/python \
    && pip install --upgrade pip setuptools wheel

# ── Python dependencies ───────────────────────────────────────────────────────
COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

# ── App code ──────────────────────────────────────────────────────────────────
# Files are copied individually, so ADDING A NEW MODULE MEANS ADDING A LINE HERE.
# Forget it and the image builds and pushes clean, then the container dies on
# import with ModuleNotFoundError and the Cloud Run revision never passes its
# health check. That is a full build cycle to discover. (Live traffic is safe:
# the previous revision keeps serving when a new one fails to start.)
WORKDIR /app
COPY worker_security.py /app/worker_security.py
COPY main.py          /app/main.py
COPY face_pipeline.py /app/face_pipeline.py
COPY dense_fit.py /app/dense_fit.py
COPY face_geometry.py /app/face_geometry.py
COPY face_projection.py /app/face_projection.py
COPY view_synthesis.py /app/view_synthesis.py
COPY view_texture.py  /app/view_texture.py
COPY glb_ops.py       /app/glb_ops.py
COPY recon_templates.py /app/recon_templates.py
COPY precompute_uv.py /app/precompute_uv.py
COPY test_face_geometry.py /app/test_face_geometry.py
COPY test_parametric_template.py /app/test_parametric_template.py
COPY test_face_projection.py /app/test_face_projection.py
COPY test_face_pipeline.py /app/test_face_pipeline.py
COPY smoke_test.py    /app/smoke_test.py

# ── Template GLBs ─────────────────────────────────────────────────────────────
# Baked into the image so cold starts are instant. Both templates ship and
# RECON_TEMPLATE picks one at runtime (recon_templates.py): default.glb is the
# Wolf3D avatar, parametric.glb the owned CC0 parametric body whose body_type is
# baked from sliders. Rebuild parametric.glb with
# scripts/build-reconstruction-template.mjs, never by hand.
RUN mkdir -p /app/templates
COPY templates/ /app/templates/

# ── UV pre-computation ────────────────────────────────────────────────────────
# Run once per template at image build time: each UV map is precomputed against
# that template's exact head topology, so a template without its map cannot
# serve. Requires network access during build (downloads the ~200 KB canonical
# MediaPipe face OBJ from GitHub).
RUN python /app/precompute_uv.py --template wolf3d \
 && python /app/precompute_uv.py --template parametric

# ── Build-time guards ─────────────────────────────────────────────────────────
# The geometry morph must preserve the rig + 52 ARKit blendshapes and never blow
# up the mesh. Fail the image build if the morph math regresses, rather than
# shipping a broken avatar pipeline.
RUN python /app/test_face_geometry.py
RUN python /app/test_parametric_template.py
RUN python /app/test_face_projection.py
RUN python /app/test_face_pipeline.py

# Then the whole core path on a real photograph: every stage-level test above
# passes on a pipeline that cannot actually serve a request (a module missing
# from the COPY list, a stage that only crashes on real photo data, an output GLB
# whose rig has come loose). Failing here costs a build; failing after a deploy
# costs a build plus a broken revision. Needs network, which this build already
# requires for the UV pre-computation above. It also warms rembg's u2net weights
# into the image, so the first request on a cold instance no longer waits on that
# download.
RUN python /app/smoke_test.py \
 && RECON_TEMPLATE=parametric python /app/smoke_test.py

EXPOSE 8080

# Two workers: CPU pipeline parallelism; GPU is shared via process-level mutex
# inside rembg (onnxruntime handles it).
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8080", \
     "--workers", "1", \
     "--timeout-keep-alive", "300"]
