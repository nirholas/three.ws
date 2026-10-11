"""
AniGen inference service: one reference image to a rigged 3D asset
(VAST-AI-Research/AniGen, MIT license; image-to-3D with the skeleton and skin
weights predicted in the same pass, not a separate rigging step).

Unlike every other Forge image lane (TRELLIS.2, Pixal3D, Hunyuan3D, ...),
this worker's output is already animatable: the GLB it writes carries joints,
bone hierarchy, and per-vertex skin weights alongside the mesh. See
pipeline.py for the in-process AniGen call and patch_anigen.py for why
nvdiffrast is never installed (its license forbids commercial use; AniGen's
own optional raster-texture-bake step that needs it is always disabled here).

API contract (consumed by the Forge router, same task shape as the other
image-to-3D workers):
  POST /infer   { images: [data-uri|url, ...], seed?: int, job_id?: str }
             ->  202 { task_id, status: "queued" }

  AniGen conditions on ONE image; when several are sent the first is used and
  the task record reports views_used: 1.

  GET  /tasks/:id -> { task_id, status, result_gcs_url?, result_url?,
                       rigged: true, joint_count?, error? }

  GET  /results/:id.glb -> generated GLB when OUTPUT_DIR local storage is active

  GET  /health    -> { ok, model, gpu_available, load_error, load_attempts }.
                     503 with ok:false once the model load has spent its
                     retry budget, so a dead instance is drained.

  GET  /          -> { service, model, ready, endpoints }. Unauthenticated
                     descriptor for the platform's warmth probe.

Weights: gs://three-ws-model-weights/anigen (workers/model-anigen/stage-assets.sh).

Environment variables (README.md carries the full table):
  API_KEY               shared bearer secret
  GCS_BUCKET            optional Cloud Storage bucket for output meshes
  OUTPUT_DIR            local task and result volume when GCS_BUCKET is unset
  ANIGEN_CKPT_ROOT      local checkpoint root entrypoint.sh stages into (default: /app)
  MAX_CONCURRENT        max parallel inferences (default: 1)
  IMAGE_FETCH_TIMEOUT_S per-attempt image fetch timeout (default: 30)
  MODEL_LOAD_ATTEMPTS   model-load attempts before the error latches (default: 4)
  MODEL_LOAD_RETRY_BASE_S / MODEL_LOAD_RETRY_CAP_S  load-retry backoff bounds
"""

from __future__ import annotations

import asyncio
import base64
import gc
import io
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
from PIL import Image
from pydantic import BaseModel, Field

from pipeline import RigAtGenerationError, run_anigen
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
log = logging.getLogger("model-anigen")

API_KEY = os.environ["API_KEY"]
GCS_BUCKET = os.environ.get("GCS_BUCKET", "").strip()
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/output")
ANIGEN_CKPT_ROOT = os.environ.get("ANIGEN_CKPT_ROOT", "/app")
SS_FLOW_PATH = os.path.join(ANIGEN_CKPT_ROOT, "ckpts", "anigen", "ss_flow_solo")
SLAT_FLOW_PATH = os.path.join(ANIGEN_CKPT_ROOT, "ckpts", "anigen", "slat_flow_auto")
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "1"))
MODEL_LOAD_ATTEMPTS = int(os.environ.get("MODEL_LOAD_ATTEMPTS", "4"))
MODEL_LOAD_RETRY_BASE_S = float(os.environ.get("MODEL_LOAD_RETRY_BASE_S", "15"))
MODEL_LOAD_RETRY_CAP_S = float(os.environ.get("MODEL_LOAD_RETRY_CAP_S", "120"))
IMAGE_FETCH_TIMEOUT_S = float(os.environ.get("IMAGE_FETCH_TIMEOUT_S", "30"))
FETCH_ATTEMPTS = 3

_bucket: Optional[storage.Bucket] = None
_local_storage: Optional[LocalStorage] = None
_sem: Optional[asyncio.Semaphore] = None
_ready: Optional[asyncio.Event] = None
_load_error: Optional[str] = None
_load_attempts = 0
_pipeline_loaded = False
# In-memory cache only, same invariant as workers/model-trellis2: the durable
# source of truth is the tasks/{task_id}.json blob in GCS.
_tasks: dict[str, dict] = {}
_task_locks: dict[str, asyncio.Lock] = {}


def _load_pipeline_sync() -> None:
    global _pipeline_loaded
    from pipeline import load_pipeline

    log.info("Loading AniGen pipeline: ss=%s slat=%s", SS_FLOW_PATH, SLAT_FLOW_PATH)
    load_pipeline(SS_FLOW_PATH, SLAT_FLOW_PATH)
    _pipeline_loaded = True
    log.info("AniGen pipeline loaded")


async def _load_pipeline_bg() -> None:
    """Load the pipeline off the request path; retry with backoff before
    latching a failure. See workers/model-trellis2's identical function for
    why the first failure is never latched: a transient blip must not turn a
    warm, minScale-held instance into a permanently dead one."""
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
                log.error("AniGen pipeline load FAILED after %d attempt(s): %s", attempt, exc)
                return
            delay = min(MODEL_LOAD_RETRY_BASE_S * (2 ** (attempt - 1)), MODEL_LOAD_RETRY_CAP_S)
            log.warning(
                "AniGen pipeline load attempt %d/%d failed (%s); retrying in %.0fs",
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


app = FastAPI(title="model-anigen", lifespan=lifespan)


def _require_api_key(authorization: str) -> None:
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


class ImageSourceError(ValueError):
    """A caller-supplied image could not be read: see workers/model-trellis2."""


def _source_label(src: str) -> str:
    if src.startswith("data:image"):
        return "inline data uri"
    host = urlsplit(src).hostname
    return host or src[:60]


def _fetch_image_bytes(src: str) -> bytes:
    label = _source_label(src)
    last_exc: Optional[BaseException] = None
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        try:
            return fetch_remote_bytes(src, timeout=IMAGE_FETCH_TIMEOUT_S)
        except UnsafeUrlError as exc:
            raise ImageSourceError(f"refused to fetch image source ({label}): {exc}") from exc
        except httpx.HTTPStatusError as exc:
            raise ImageSourceError(
                f"image source {label} returned HTTP {exc.response.status_code}"
            ) from exc
        except httpx.HTTPError as exc:
            last_exc = exc
            if attempt < FETCH_ATTEMPTS:
                log.warning(
                    "image fetch attempt %d/%d for %s failed (%s); retrying",
                    attempt, FETCH_ATTEMPTS, label, type(exc).__name__,
                )
                time.sleep(min(2 ** attempt, 5))
        except ValueError as exc:
            raise ImageSourceError(f"image source {label} rejected: {exc}") from exc
    raise ImageSourceError(
        f"image source {label} unreachable after {FETCH_ATTEMPTS} attempts "
        f"({type(last_exc).__name__}); check the URL is publicly readable"
    )


def _decode_image_bytes(src: str) -> bytes:
    if src.startswith("data:image"):
        b64 = src.split(",", 1)[1]
        try:
            return base64.b64decode(b64)
        except Exception as exc:  # noqa: BLE001 - caller's own payload
            raise ImageSourceError(f"inline data uri is not valid base64: {exc}") from exc
    if src.startswith("https://"):
        return _fetch_image_bytes(src)
    raise ImageSourceError(f"unsupported image source: {src[:60]}")


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


def _rig_sync(image_bytes: bytes, output_glb: Path, seed: int) -> dict:
    run_anigen(
        image_bytes,
        output_glb,
        ss_flow_path=SS_FLOW_PATH,
        slat_flow_path=SLAT_FLOW_PATH,
        seed=seed,
    )
    import trimesh

    mesh = trimesh.load(output_glb, file_type="glb", force="scene")
    joint_count = 0
    for geom in mesh.geometry.values() if hasattr(mesh, "geometry") else []:
        skeleton = getattr(geom, "skeleton", None)
        if skeleton is not None:
            joint_count = max(joint_count, len(getattr(skeleton, "joints", []) or []))
    return {"glb_bytes": output_glb.read_bytes(), "joint_count": joint_count}


def _release_gpu_memory() -> None:
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()


async def _run_job(task_id: str, images: list[str], seed: int | None) -> None:
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
            image_bytes = await loop.run_in_executor(None, _decode_image_bytes, images[0])
            with tempfile.TemporaryDirectory() as tmp:
                output_glb = Path(tmp) / "rigged.glb"
                result = await loop.run_in_executor(
                    None, _rig_sync, image_bytes, output_glb, seed if seed is not None else 42
                )
            glb_bytes = result["glb_bytes"]

            if _using_gcs():
                blob_name = f"raw-meshes/anigen/{task_id}.glb"
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
                rigged=True,
                joint_count=result["joint_count"],
                views_used=1,
                bytes=len(glb_bytes),
                elapsed_ms=int(elapsed * 1000),
            )
            log.info(
                "[%s] done in %.1fs (joints=%d) %d bytes -> %s",
                task_id, elapsed, result["joint_count"], len(glb_bytes), result_label,
            )
        except ImageSourceError as exc:
            log.warning("[%s] image source rejected: %s", task_id, exc)
            await _update_task(task_id, status="failed", error=str(exc), elapsed_ms=int((time.time() - t0) * 1000))
        except RigAtGenerationError as exc:
            log.error("[%s] AniGen produced no usable rig: %s", task_id, exc)
            await _update_task(task_id, status="failed", error=str(exc), elapsed_ms=int((time.time() - t0) * 1000))
        except Exception as exc:
            await _update_task(
                task_id, status="failed", error=safe_error(exc, context=f"[{task_id}] inference"),
                elapsed_ms=int((time.time() - t0) * 1000),
            )
        finally:
            await loop.run_in_executor(None, _release_gpu_memory)


class InferRequest(BaseModel):
    images: list[str] = Field(..., min_length=1, max_length=6)
    job_id: str | None = None
    seed: int | None = None


@app.post("/infer", status_code=202)
async def infer(body: InferRequest, background_tasks: BackgroundTasks, authorization: str = Header(...)) -> dict:
    _require_api_key(authorization)
    if _load_error:
        raise HTTPException(status_code=503, detail=f"pipeline unavailable: {_load_error}")
    task_id = str(uuid.uuid4())
    await _update_task(task_id, status="queued", model="anigen")
    background_tasks.add_task(_run_job, task_id, body.images, body.seed)
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
        "service": "model-anigen",
        "model": "anigen",
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
        "model": "anigen",
        "gpu_available": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "pipeline_loaded": _pipeline_loaded,
        "ready": bool(_ready and _ready.is_set()),
        "load_error": _load_error,
        "load_attempts": _load_attempts,
        "output_backend": "gcs" if _using_gcs() else "local",
        "output_dir": None if _using_gcs() else str(_get_local_storage().output_dir),
    }
