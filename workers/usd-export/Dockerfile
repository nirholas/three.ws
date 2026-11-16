# gltfpack (zeux/meshoptimizer, MIT) decodes EXT_meshopt_compression, which
# most Forge GLBs ship with. Pinned by release tag and checksum so the image
# never picks up a binary we did not audit.
FROM python:3.12-slim AS gltfpack
ARG GLTFPACK_VERSION=v1.2
ARG GLTFPACK_SHA256=ebc236f5f6c08c7e5c5750476a187d24805d44d8c680449c4b7369c333f817b1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && curl -fsSL -o /tmp/gltfpack.zip \
        https://github.com/zeux/meshoptimizer/releases/download/${GLTFPACK_VERSION}/gltfpack-ubuntu.zip \
    && echo "${GLTFPACK_SHA256}  /tmp/gltfpack.zip" | sha256sum -c - \
    && unzip -j /tmp/gltfpack.zip gltfpack -d /usr/local/bin \
    && chmod +x /usr/local/bin/gltfpack \
    && /usr/local/bin/gltfpack -v

FROM python:3.12-slim
COPY --from=gltfpack /usr/local/bin/gltfpack /usr/local/bin/gltfpack

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    GLTFPACK_BIN=/usr/local/bin/gltfpack

# libgomp1: CoACD's OpenMP runtime. Everything else ships as manylinux wheels
# (usd-core, omniverse-asset-validator, coacd, trimesh, rtree).
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

WORKDIR /app
COPY worker_security.py gltf_meshopt.py gltf_reader.py gltf_to_usd.py physics.py \
     semantics.py validate.py export.py main.py /app/

# Core-path gate: a textured prop, caller overrides, a two-skin animated rig
# (skinned points compared against glTF linear blend skinning), Draco refusal,
# the semantic classifier and the task key all run at build time, with both
# validators, so a regression fails the image instead of reaching Cloud Run.
COPY test_export.py /app/test_export.py
RUN API_KEY=build-gate GCS_BUCKET=build-gate python test_export.py

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
