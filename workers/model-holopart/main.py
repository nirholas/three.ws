"""
HoloPart inference service: complete the occluded geometry of an
already part-segmented mesh (VAST-AI-Research/HoloPart, MIT; generative 3D
part amodal segmentation).

This is the Forge "Complete hidden parts" lane behind the segment lane (work
order 070): where workers/segment only cuts a mesh at its visible seams,
leaving each part's hidden/occluded side an open shell, this worker fills
each named part back in to a geometrically complete, closed mesh, with no
extra reconstruction call needed. Node names are preserved verbatim from the
input (`part_mesh.name = part_id_list[i]` in upstream's own script), which is
exactly what work order 070's Task 3 (stable node names) requires.

API contract (consumed by the Forge router, same task shape as the other
mesh-in GPU workers, e.g. workers/segment):
  POST /infer   { mesh_url: https URL to an ALREADY part-segmented GLB
                  (one named geometry per part, as workers/segment emits),
                  seed?: int, job_id?: str }
             ->  202 { task_id, status: "queued" }

  GET  /tasks/:id -> { task_id, status, result_gcs_url?, result_url?,
                       parts?, part_count?, error? }

  GET  /results/:id.glb -> completed GLB when OUTPUT_DIR local storage is active

  GET  /health    -> { ok, model, gpu_available, load_error, load_attempts }.
                     503 with ok:false once the model load has spent its
                     retry budget, so a dead instance is drained.

  GET  /          -> { service, model, ready, endpoints }. Unauthenticated
                     descriptor for the platform's warmth probe.

Weights: gs://three-ws-model-weights/holopart (workers/model-holopart/stage-assets.sh).

Environment variables (README.md carries the full table):
  API_KEY                shared bearer secret
  GCS_BUCKET              optional Cloud Storage bucket for output meshes
  OUTPUT_DIR              local task and result volume when GCS_BUCKET is unset
  HOLOPART_WEIGHTS_ROOT   local checkpoint root entrypoint.sh stages into (default: /app/pretrained_weights/HoloPart)
  MAX_CONCURRENT          max parallel inferences (default: 1)
  MESH_FETCH_TIMEOUT_S    per-attempt mesh fetch timeout (default: 60)
  MODEL_LOAD_ATTEMPTS     model-load attempts before the error latches (default: 4)
  MODEL_LOAD_RETRY_BASE_S / MODEL_LOAD_RETRY_CAP_S  load-retry backoff bounds
"""

from __future__ import annotations

import asyncio
import gc
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

import httpx
import torch
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Response
from fastapi.responses import FileResponse
from google.api_core.exceptions import NotFound
from google.cloud import storage
from pydantic import BaseModel, Field

from gltf_meshopt import decode_if_meshopt
from pipeline import PartCompletionError, run_holopart
from storage_backend import LocalStorage
from worker_security import (
    UnsafeUrlError,
    fetch_remote_bytes,
    require_api_key,
    safe_error,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("model-holopart")

API_KEY = os.environ["API_KEY"]
GCS_BUCKET = os.environ.get("GCS_BUCKET", "").strip()
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/output")
HOLOPART_WEIGHTS_ROOT = os.environ.get("HOLOPART_WEIGHTS_ROOT", "/app/pretrained_weights/HoloPart")
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "1"))
MODEL_LOAD_ATTEMPTS = int(os.environ.get("MODEL_LOAD_ATTEMPTS", "4"))
MODEL_LOAD_RETRY_BASE_S = float(os.environ.get("MODEL_LOAD_RETRY_BASE_S", "15"))
MODEL_LOAD_RETRY_CAP_S = float(os.environ.get("MODEL_LOAD_RETRY_CAP_S", "120"))
MESH_FETCH_TIMEOUT_S = float(os.environ.get("MESH_FETCH_TIMEOUT_S", "60"))
FETCH_ATTEMPTS = 3
MAX_MESH_BYTES = 128 * 1024 * 1024

# FBX has no part-name convention HoloPart can read and trimesh has no FBX
# reader, same reasoning as workers/segment.
SUPPORTED_INPUT_FORMATS = {".glb", ".gltf"}
SUPPORTED_INPUT_LABEL = "GLB or GLTF"
UNSUPPORTED_FORMAT_MESSAGE = (
    f"HoloPart needs an already part-segmented {SUPPORTED_INPUT_LABEL} (e.g. the output of "
    "the segment worker): one named geometry per part. Segment the mesh first."
)
FBX_BINARY_MAGIC = b"Kaydara FBX Binary  \x00"
FBX_ASCII_HEADER = b"; FBX"

_bucket: Optional[storage.Bucket] = None
_local_storage: Optional[LocalStorage] = None
_sem: Optional[asyncio.Semaphore] = None
_ready: Optional[asyncio.Event] = None
_load_error: Optional[str] = None
_load_attempts = 0
_pipeline_loaded = False
_tasks: dict[str, dict] = {}
_task_locks: dict[str, asyncio.Lock] = {}


def _load_pipeline_sync() -> None:
    global _pipeline_loaded
    from pipeline import load_pipeline

    log.info("Loading HoloPart pipeline: weights=%s", HOLOPART_WEIGHTS_ROOT)
    load_pipeline(HOLOPART_WEIGHTS_ROOT)
    _pipeline_loaded = True
    log.info("HoloPart pipeline loaded")


async def _load_pipeline_bg() -> None:
    """Load the pipeline off the request path; retry with backoff before
    latching a failure. See workers/model-anigen's identical function for why
    the first failure is never latched."""
    global _load_error, _load_attempts
    loop = asyncio.get_event_loop()
    attempts = max(1, MODEL_LOAD_ATTEMPTS)
    for attempt in range(1, attempts + 1):
        _load_attempts = attempt
        try:
            await loop.run_in_executor(None, _load_pipeline_sync)
            _load_error = None
            _ready.set()
            return
        except Exception as exc:  # noqa: BLE001 - surfaced via /health + task status
            if attempt >= attempts:
                _load_error = safe_error(exc, context="model load")
                log.error("HoloPart pipeline load FAILED after %d attempt(s): %s", attempt, exc)
                return
            delay = min(MODEL_LOAD_RETRY_BASE_S * (2 ** (attempt - 1)), MODEL_LOAD_RETRY_CAP_S)
            log.warning(
                "HoloPart pipeline load attempt %d/%d failed (%s); retrying in %.0fs",
                attempt, attempts, exc, delay,
            )
            await asyncio.sleep(delay)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _bucket, _local_storage, _sem, _ready
    if GCS_BUCKET:
        _bucket = storage.Client().bucket(GCS_BUCKET)
        _local_storage = None
    else:
        _bucket = None
        _local_storage = LocalStorage(OUTPUT_DIR)
    _sem = asyncio.Semaphore(MAX_CONCURRENT)
    _ready = asyncio.Event()
    asyncio.create_task(_load_pipeline_bg())
    log.info("Service starting, pipeline loading in background (max_concurrent=%d)", MAX_CONCURRENT)
    yield


app = FastAPI(title="model-holopart", lifespan=lifespan)


def _require_api_key(authorization: str) -> None:
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


class MeshSourceError(ValueError):
    """A caller-supplied mesh could not be read: see workers/segment's
    identical rejection shape for FBX / unsafe URLs."""


def _source_label(src: str) -> str:
    host = urlsplit(src).hostname
    return host or src[:60]


def _url_suffix(url: str) -> str:
    return Path(url.split("?")[0].split("#")[0]).suffix.lower()


def _is_fbx(data: bytes) -> bool:
    if data.startswith(FBX_BINARY_MAGIC):
        return True
    return data[:64].lstrip(b"\xef\xbb\xbf").lstrip().startswith(FBX_ASCII_HEADER)


def _fetch_mesh_bytes(url: str) -> bytes:
    label = _source_label(url)
    last_exc: Optional[BaseException] = None
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        try:
            return fetch_remote_bytes(url, timeout=MESH_FETCH_TIMEOUT_S, max_bytes=MAX_MESH_BYTES)
        except UnsafeUrlError as exc:
            raise MeshSourceError(f"refused to fetch mesh ({label}): {exc}") from exc
        except httpx.HTTPStatusError as exc:
            raise MeshSourceError(f"mesh source {label} returned HTTP {exc.response.status_code}") from exc
        except httpx.HTTPError as exc:
            last_exc = exc
            if attempt < FETCH_ATTEMPTS:
                log.warning(
                    "mesh fetch attempt %d/%d for %s failed (%s); retrying",
                    attempt, FETCH_ATTEMPTS, label, type(exc).__name__,
                )
                time.sleep(min(2 ** attempt, 5))
        except ValueError as exc:
            raise MeshSourceError(f"mesh source {label} rejected: {exc}") from exc
    raise MeshSourceError(
        f"mesh source {label} unreachable after {FETCH_ATTEMPTS} attempts "
        f"({type(last_exc).__name__}); check the URL is publicly readable"
    )


def _load_part_scene(mesh_url: str):
    import trimesh

    data = _fetch_mesh_bytes(mesh_url)
    if _url_suffix(mesh_url) == ".fbx" or _is_fbx(data):
        raise MeshSourceError(UNSUPPORTED_FORMAT_MESSAGE)
    suffix = _url_suffix(mesh_url)
    if suffix not in SUPPORTED_INPUT_FORMATS:
        suffix = ".glb"
    try:
        data, suffix = decode_if_meshopt(data, suffix)
    except ValueError as exc:
        raise MeshSourceError(str(exc)) from exc
    import io

    scene = trimesh.load(io.BytesIO(data), file_type=suffix.lstrip("."))
    if not isinstance(scene, trimesh.Scene) or len(scene.geometry) < 2:
        raise MeshSourceError(UNSUPPORTED_FORMAT_MESSAGE)
    return scene


def _task_blob(task_id: str):
    if _bucket is None:
        raise RuntimeError("GCS task storage is not active")
    return _bucket.blob(f"tasks/{task_id}.json")


def _using_gcs() -> bool:
    return bool(GCS_BUCKET)


def _get_local_storage() -> LocalStorage:
    global _local_storage
    if _local_storage is None:
        _local_storage = LocalStorage(OUTPUT_DIR)
    return _local_storage


async def _update_task(task_id: str, **fields) -> dict:
    lock = _task_locks.setdefault(task_id, asyncio.Lock())
    async with lock:
        task = _tasks.setdefault(task_id, {"task_id": task_id})
        task.update(fields)
        task["updated_at"] = time.time()
        snapshot = task.copy()
        loop = asyncio.get_event_loop()
        if _using_gcs():
            payload = json.dumps(snapshot)
            await loop.run_in_executor(
                None,
                lambda: _task_blob(task_id).upload_from_string(
                    payload, content_type="application/json"
                ),
            )
        else:
            await loop.run_in_executor(None, _get_local_storage().write_task, snapshot)
    return task


_TERMINAL_STATUSES = frozenset({"done", "failed"})


async def _resolve_task(task_id: str) -> dict:
    task = _tasks.get(task_id)
    if task is not None and task.get("status") in _TERMINAL_STATUSES:
        return task
    loop = asyncio.get_event_loop()
    try:
        if _using_gcs():
            data = await loop.run_in_executor(None, _task_blob(task_id).download_as_bytes)
            task = json.loads(data)
        else:
            task = await loop.run_in_executor(None, _get_local_storage().read_task, task_id)
    except (NotFound, FileNotFoundError, ValueError):
        if task is not None:
            return task
        raise HTTPException(status_code=404, detail="task not found")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=safe_error(exc, context="task lookup")) from exc
    if task.get("status") in _TERMINAL_STATUSES:
        _tasks[task_id] = task
    return task


def _generate_sync(scene, output_glb: Path, seed: int) -> dict:
    return run_holopart(scene, output_glb, holopart_weights_dir=HOLOPART_WEIGHTS_ROOT, seed=seed)


def _release_gpu_memory() -> None:
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()


async def _run_job(task_id: str, mesh_url: str, seed: int | None) -> None:
    if _load_error:
        await _update_task(task_id, status="failed", error=f"pipeline unavailable: {_load_error}")
        return
    try:
        await asyncio.wait_for(_ready.wait(), timeout=900)
    except asyncio.TimeoutError:
        await _update_task(task_id, status="failed", error="pipeline not ready (model load timed out)")
        return
    if _load_error:
        await _update_task(task_id, status="failed", error=f"pipeline unavailable: {_load_error}")
        return

    async with _sem:
        await _update_task(task_id, status="running")
        loop = asyncio.get_event_loop()
        t0 = time.time()
        import tempfile

        try:
            scene = await loop.run_in_executor(None, _load_part_scene, mesh_url)
            with tempfile.TemporaryDirectory() as tmp:
                output_glb = Path(tmp) / "completed.glb"
                result = await loop.run_in_executor(
                    None, _generate_sync, scene, output_glb, seed if seed is not None else 42
                )
            glb_bytes = result["glb_bytes"]

            if _using_gcs():
                blob_name = f"raw-meshes/holopart/{task_id}.glb"
                blob = _bucket.blob(blob_name)
                await loop.run_in_executor(
                    None, lambda: blob.upload_from_string(glb_bytes, content_type="model/gltf-binary")
                )
                result_fields = {"result_gcs_url": f"https://storage.googleapis.com/{GCS_BUCKET}/{blob_name}"}
                result_label = result_fields["result_gcs_url"]
            else:
                result_path = await loop.run_in_executor(
                    None, _get_local_storage().write_result, task_id, glb_bytes
                )
                result_fields = {"result_url": f"/results/{task_id}.glb", "result_path": str(result_path)}
                result_label = str(result_path)

            elapsed = time.time() - t0
            await _update_task(
                task_id,
                status="done",
                **result_fields,
                parts=result["parts"],
                part_count=result["part_count"],
                bytes=len(glb_bytes),
                elapsed_ms=int(elapsed * 1000),
            )
            log.info(
                "[%s] done in %.1fs (parts=%d) %d bytes -> %s",
                task_id, elapsed, result["part_count"], len(glb_bytes), result_label,
            )
        except MeshSourceError as exc:
            log.warning("[%s] mesh source rejected: %s", task_id, exc)
            await _update_task(task_id, status="failed", error=str(exc), elapsed_ms=int((time.time() - t0) * 1000))
        except PartCompletionError as exc:
            log.error("[%s] HoloPart produced no usable parts: %s", task_id, exc)
            await _update_task(task_id, status="failed", error=str(exc), elapsed_ms=int((time.time() - t0) * 1000))
        except Exception as exc:
            await _update_task(
                task_id, status="failed", error=safe_error(exc, context=f"[{task_id}] inference"),
                elapsed_ms=int((time.time() - t0) * 1000),
            )
        finally:
            await loop.run_in_executor(None, _release_gpu_memory)


class InferRequest(BaseModel):
    mesh_url: str = Field(..., min_length=1, max_length=4096)
    job_id: str | None = None
    seed: int | None = None


@app.post("/infer", status_code=202)
async def infer(body: InferRequest, background_tasks: BackgroundTasks, authorization: str = Header(...)) -> dict:
    _require_api_key(authorization)
    if _load_error:
        raise HTTPException(status_code=503, detail=f"pipeline unavailable: {_load_error}")
    task_id = str(uuid.uuid4())
    await _update_task(task_id, status="queued", model="holopart")
    background_tasks.add_task(_run_job, task_id, body.mesh_url, body.seed)
    return {"task_id": task_id, "status": "queued"}


@app.get("/tasks/{task_id}")
async def get_task(task_id: str, authorization: str = Header(...)) -> dict:
    _require_api_key(authorization)
    return await _resolve_task(task_id)


@app.get("/results/{task_id}.glb")
async def get_result(task_id: str, authorization: str = Header(...)):
    _require_api_key(authorization)
    if _using_gcs():
        raise HTTPException(status_code=404, detail="local result storage is not active")
    try:
        path = _get_local_storage().result_path(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="result not found") from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="result not found")
    return FileResponse(path, media_type="model/gltf-binary", filename=path.name)


@app.get("/")
async def root() -> dict:
    return {
        "service": "model-holopart",
        "model": "holopart",
        "ready": bool(_ready and _ready.is_set()),
        "endpoints": ["POST /infer", "GET /tasks/{task_id}", "GET /results/{task_id}.glb", "GET /health"],
    }


@app.get("/health")
async def health(response: Response) -> dict:
    dead = _load_error is not None
    if dead:
        response.status_code = 503
    return {
        "ok": not dead,
        "model": "holopart",
        "gpu_available": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "pipeline_loaded": _pipeline_loaded,
        "ready": bool(_ready and _ready.is_set()),
        "load_error": _load_error,
        "load_attempts": _load_attempts,
        "output_backend": "gcs" if _using_gcs() else "local",
        "output_dir": None if _using_gcs() else str(_get_local_storage().output_dir),
    }
