"""
Non-humanoid auto-rigging service: skeletons and skin weights for quadrupeds,
creatures, and props that `workers/rig`'s Make-It-Animatable engine (built
for bipedal humanoids) is not trained for.

Engines (both MIT, LICENSE files read 2026-10-09):
  - UniRig (VAST-AI-Research/UniRig, SIGGRAPH '25) predicts the joint
    hierarchy: launch/inference/generate_skeleton.sh, then grafts it onto the
    original mesh with launch/inference/merge.sh.
  - SkinTokens (VAST-AI-Research/SkinTokens), UniRig's successor, predicts
    ONLY the skinning weights for that skeleton-merged mesh
    (demo.py --use_skeleton --use_transfer), preserving the original
    texture and scale.
See pipeline.py for the exact command contract and chaining.

This service is reached two ways: directly, or forwarded by workers/rig when
its mesh_classify.py geometric heuristic calls a mesh non-humanoid. Either
way the API contract matches workers/rig exactly, so a caller (or a
forwarding worker) polls one shape regardless of which engine rigged the
mesh:
  POST /rig   { mesh_gcs_url: str, job_id?: str }
           -> 202 { task_id, status: "queued" }
  GET  /tasks/:id -> { task_id, status, rigged_gcs_url?, error?, elapsed_ms? }
  GET  /health    -> { ok, model, gpu_available, gpu_name, queued }

Design notes (mirrors workers/rig/main.py on purpose):
  - Every task runs under a hard timeout (TASK_TIMEOUT_S): three chained
    model forward passes can finish or fail, but never hang in "running"
    forever.
  - Task state is in-memory: run with min-instances = max-instances so
    pollers always reach the instance that owns the task.
  - Un-riggable input is rejected before the GPU is touched, same validation
    as the humanoid worker (rig_glb.validate_input_mesh, vendored call site
    duplicated here since this worker's Docker build context cannot reach
    workers/rig/rig_glb.py).

Environment variables:
  API_KEY            shared bearer secret (Secret Manager)
  GCS_BUCKET         output bucket for rigged GLBs
  UNIRIG_DIR         UniRig checkout (default /app/unirig)
  SKINTOKENS_DIR     SkinTokens checkout (default /app/skintokens)
  MAX_CONCURRENT     parallel rigging jobs (default 1)
  TASK_TIMEOUT_S     per-task hard timeout in seconds (default 1200)
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import httpx
import numpy as np
import torch
import trimesh
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from google.cloud import storage
from google.cloud.storage.retry import DEFAULT_RETRY
from pydantic import BaseModel

from gltf_meshopt import decode_if_meshopt
from pipeline import PipelineStepError, run_pipeline
from worker_security import (
    UnsafeUrlError,
    fetch_remote_bytes_async,
    require_api_key,
    safe_error,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("rig-nonhuman")

API_KEY = os.environ["API_KEY"]
GCS_BUCKET = os.environ["GCS_BUCKET"]
UNIRIG_DIR = Path(os.environ.get("UNIRIG_DIR", "/app/unirig"))
SKINTOKENS_DIR = Path(os.environ.get("SKINTOKENS_DIR", "/app/skintokens"))
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "1"))
TASK_TIMEOUT_S = float(os.environ.get("TASK_TIMEOUT_S", "1200"))
TASK_TTL_S = 3600.0

_GLB_MAGIC = b"glTF"
_GLB_HEADER_BYTES = 12

_bucket: Optional[storage.Bucket] = None
_sem: Optional[asyncio.Semaphore] = None
_tasks: dict[str, dict] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _bucket, _sem
    _bucket = storage.Client().bucket(GCS_BUCKET)
    _sem = asyncio.Semaphore(MAX_CONCURRENT)
    log.info(
        "Service ready: max_concurrent=%d task_timeout=%.0fs unirig_dir=%s skintokens_dir=%s",
        MAX_CONCURRENT, TASK_TIMEOUT_S, UNIRIG_DIR, SKINTOKENS_DIR,
    )
    yield


app = FastAPI(title="rig-nonhuman", lifespan=lifespan)


def _require_api_key(authorization: str) -> None:
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def _prune_tasks() -> None:
    cutoff = time.time() - TASK_TTL_S
    for tid in [t for t, v in _tasks.items() if v.get("created_at", 0) < cutoff]:
        _tasks.pop(tid, None)


class InvalidMeshError(ValueError):
    """The caller's mesh cannot be rigged: wrong container, or no surface.
    Mirrors workers/rig/rig_glb.validate_input_mesh (duplicated here: this
    worker's Docker build context cannot reach that module's source file)."""


def _validate_input_mesh(mesh_bytes: bytes) -> None:
    if len(mesh_bytes) < _GLB_HEADER_BYTES or mesh_bytes[:4] != _GLB_MAGIC:
        raise InvalidMeshError(
            "input is not a binary glTF: expected a .glb starting with the "
            "'glTF' magic header"
        )
    try:
        mesh = trimesh.load(io.BytesIO(mesh_bytes), file_type="glb", force="mesh")
    except Exception as exc:
        log.warning("input GLB failed to parse: %s", exc, exc_info=True)
        raise InvalidMeshError("input GLB could not be parsed as a mesh") from exc
    faces = getattr(mesh, "faces", None)
    if faces is None or len(faces) == 0:
        raise InvalidMeshError(
            "input GLB contains no triangles; rigging needs a surface mesh, "
            "not a point cloud or a curves-only export"
        )
    if float(np.sum(mesh.area_faces)) <= 0.0:
        raise InvalidMeshError(
            "input GLB has zero surface area; every triangle is degenerate"
        )


def _rig_sync(mesh_bytes: bytes) -> bytes:
    """The blocking rig pipeline; runs in a worker thread."""
    _validate_input_mesh(mesh_bytes)
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        mesh_glb = workdir / "input.glb"
        mesh_glb.write_bytes(mesh_bytes)
        rigged_path = run_pipeline(mesh_glb, workdir, UNIRIG_DIR, SKINTOKENS_DIR)
        return rigged_path.read_bytes()


async def _run_task(task_id: str, mesh_gcs_url: str) -> None:
    async with _sem:
        _tasks[task_id]["status"] = "running"
        loop = asyncio.get_event_loop()
        t0 = time.time()
        try:
            async def _work() -> str:
                async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client:
                    try:
                        mesh_bytes = await fetch_remote_bytes_async(client, mesh_gcs_url)
                    except UnsafeUrlError as exc:
                        raise RuntimeError(f"refused to fetch mesh url: {exc}") from exc

                mesh_bytes, _ = decode_if_meshopt(mesh_bytes, ".glb")
                rigged = await loop.run_in_executor(None, _rig_sync, mesh_bytes)

                blob_name = f"rigged-meshes/{task_id}.glb"
                blob = _bucket.blob(blob_name)
                await loop.run_in_executor(
                    None,
                    lambda: blob.upload_from_string(
                        rigged, content_type="model/gltf-binary", retry=DEFAULT_RETRY
                    ),
                )
                return f"https://storage.googleapis.com/{GCS_BUCKET}/{blob_name}"

            gcs_url = await asyncio.wait_for(_work(), timeout=TASK_TIMEOUT_S)
            elapsed = time.time() - t0
            _tasks[task_id].update({
                "status": "done",
                "rigged_gcs_url": gcs_url,
                "elapsed_ms": int(elapsed * 1000),
            })
            log.info("[%s] non-humanoid rigging done in %.1fs -> %s", task_id, elapsed, gcs_url)
        except asyncio.TimeoutError:
            _tasks[task_id].update({
                "status": "failed",
                "error": f"rigging timed out after {TASK_TIMEOUT_S:.0f}s",
                "elapsed_ms": int((time.time() - t0) * 1000),
            })
            log.error("[%s] rigging timed out", task_id)
        except InvalidMeshError as exc:
            _tasks[task_id].update({
                "status": "failed",
                "error": str(exc),
                "elapsed_ms": int((time.time() - t0) * 1000),
            })
            log.warning("[%s] rejected input mesh: %s", task_id, exc)
        except PipelineStepError as exc:
            # One upstream CLI step failed. Not the caller's fault (their
            # mesh already passed validation), but still a specific,
            # actionable reason rather than an opaque correlation id: it
            # names which of the three stages broke.
            _tasks[task_id].update({
                "status": "failed",
                "error": str(exc),
                "elapsed_ms": int((time.time() - t0) * 1000),
            })
            log.error("[%s] pipeline step failed: %s", task_id, exc)
        except Exception as exc:
            _tasks[task_id].update({
                "status": "failed",
                "error": safe_error(exc, context=f"[{task_id}] non-humanoid rigging"),
                "elapsed_ms": int((time.time() - t0) * 1000),
            })


class RigRequest(BaseModel):
    mesh_gcs_url: str
    job_id: str | None = None


@app.post("/rig", status_code=202)
async def rig(
    body: RigRequest,
    background_tasks: BackgroundTasks,
    authorization: str = Header(...),
) -> dict:
    _require_api_key(authorization)
    _prune_tasks()
    task_id = str(uuid.uuid4())
    _tasks[task_id] = {
        "task_id": task_id,
        "status": "queued",
        "created_at": time.time(),
    }
    background_tasks.add_task(_run_task, task_id, body.mesh_gcs_url)
    return {"task_id": task_id, "status": "queued"}


@app.get("/tasks/{task_id}")
async def get_task(task_id: str, authorization: str = Header(...)) -> dict:
    _require_api_key(authorization)
    task = _tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return {k: v for k, v in task.items() if k != "created_at"}


@app.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "model": "unirig+skintokens",
        "gpu_available": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "queued": sum(1 for t in _tasks.values() if t.get("status") in ("queued", "running")),
    }
