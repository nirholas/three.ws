"""
SAM 3D Objects inference service: one photo in, a 3D scene of its objects out
(facebookresearch/sam-3d-objects, SAM License; generative single-image 3D
object reconstruction with scene layout).

This is the Forge / AR Studio "From a photo" lane: the caller names the objects
in the photo (one mask PNG or one normalized box per object) and gets back one
GLB laid out like the photo, with a named node per object and a manifest of
each object's position and size.

API contract (same task shape as the other GPU workers):
  POST /infer   { image_url: https URL to the photo,
                  mask_urls?: [https URL of a PNG mask per object, white = object],
                  boxes?: [[x0, y0, x1, y1] per object, fractions of the frame],
                  max_objects?: int (default 8, max 12), seed?: int, job_id?: str }
             ->  202 { task_id, status: "queued" }

  GET  /tasks/:id -> { task_id, status, result_gcs_url?, result_url?, objects?,
                       object_count?, skipped?, error? }
  GET  /results/:id.glb -> the scene GLB when OUTPUT_DIR local storage is active
  GET  /health    -> { ok, model, gpu_available, load_error, load_attempts };
                     503 once the model load has spent its retry budget.
  GET  /          -> unauthenticated descriptor for the platform warmth probe.

Weights: gs://three-ws-model-weights/sam3d-objects (npm run stage:sam3d-objects).

Environment variables (README.md carries the full table):
  API_KEY, GCS_BUCKET, OUTPUT_DIR, MAX_CONCURRENT (default 1),
  SAM3D_CHECKPOINT_DIR (default /app/checkpoints/hf), SAM3D_SRC (default /app/sam3d-objects),
  IMAGE_FETCH_TIMEOUT_S, MODEL_LOAD_ATTEMPTS, MODEL_LOAD_RETRY_BASE_S / _CAP_S
"""

from __future__ import annotations

import asyncio
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
import numpy as np
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Response
from fastapi.responses import FileResponse
from google.api_core.exceptions import NotFound
from google.cloud import storage
from pydantic import BaseModel, Field

import scene_layout as layout
from request_policy import RequestRejected, validate_request
from storage_backend import LocalStorage
from worker_security import UnsafeUrlError, fetch_remote_bytes, require_api_key, safe_error

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("model-sam3d-objects")

API_KEY = os.environ["API_KEY"]
GCS_BUCKET = os.environ.get("GCS_BUCKET", "").strip()
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/output")
CHECKPOINT_DIR = os.environ.get("SAM3D_CHECKPOINT_DIR", "/app/checkpoints/hf")
SAM3D_SRC = os.environ.get("SAM3D_SRC", "/app/sam3d-objects")
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "1"))
MODEL_LOAD_ATTEMPTS = int(os.environ.get("MODEL_LOAD_ATTEMPTS", "4"))
MODEL_LOAD_RETRY_BASE_S = float(os.environ.get("MODEL_LOAD_RETRY_BASE_S", "15"))
MODEL_LOAD_RETRY_CAP_S = float(os.environ.get("MODEL_LOAD_RETRY_CAP_S", "120"))
IMAGE_FETCH_TIMEOUT_S = float(os.environ.get("IMAGE_FETCH_TIMEOUT_S", "60"))
FETCH_ATTEMPTS = 3
MAX_IMAGE_BYTES = 32 * 1024 * 1024
MAX_MASK_BYTES = 16 * 1024 * 1024
# The model works at a fixed internal resolution; a larger photo only costs memory.
MAX_PHOTO_SIDE = 2048
MAX_PHOTO_PIXELS = 40_000_000

_bucket: Optional[storage.Bucket] = None
_local_storage: Optional[LocalStorage] = None
_sem: Optional[asyncio.Semaphore] = None
_ready: Optional[asyncio.Event] = None
_load_error: Optional[str] = None
_load_attempts = 0
_pipeline_loaded = False
_tasks: dict[str, dict] = {}
_task_locks: dict[str, asyncio.Lock] = {}


def _torch():
    try:
        import torch

        return torch
    except ImportError:
        return None


def _cuda_available() -> bool:
    torch = _torch()
    return bool(torch and torch.cuda.is_available())


def _load_pipeline_sync() -> None:
    global _pipeline_loaded
    from pipeline import load_pipeline

    log.info("Loading SAM 3D Objects: checkpoints=%s", CHECKPOINT_DIR)
    load_pipeline(CHECKPOINT_DIR, SAM3D_SRC)
    _pipeline_loaded = True
    log.info("SAM 3D Objects loaded")


async def _load_pipeline_bg() -> None:
    """Load off the request path; retry with backoff before latching a failure."""
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
        except Exception as exc:  # noqa: BLE001 - surfaced via /health and task status
            if attempt >= attempts:
                _load_error = safe_error(exc, context="model load")
                log.error("SAM 3D Objects load FAILED after %d attempt(s): %s", attempt, exc)
                return
            delay = min(MODEL_LOAD_RETRY_BASE_S * (2 ** (attempt - 1)), MODEL_LOAD_RETRY_CAP_S)
            log.warning("SAM 3D Objects load attempt %d/%d failed (%s); retrying in %.0fs", attempt, attempts, exc, delay)
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


app = FastAPI(title="model-sam3d-objects", lifespan=lifespan)


def _require_api_key(authorization: str) -> None:
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


class ImageSourceError(ValueError):
    """A caller-supplied photo or mask could not be read."""


def _source_label(src: str) -> str:
    return urlsplit(src).hostname or src[:60]


def _fetch_bytes(url: str, what: str, max_bytes: int) -> bytes:
    label = _source_label(url)
    last_exc: Optional[BaseException] = None
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        try:
            return fetch_remote_bytes(url, timeout=IMAGE_FETCH_TIMEOUT_S, max_bytes=max_bytes)
        except UnsafeUrlError as exc:
            raise ImageSourceError(f"refused to fetch {what} ({label}): {exc}") from exc
        except httpx.HTTPStatusError as exc:
            raise ImageSourceError(f"{what} source {label} returned HTTP {exc.response.status_code}") from exc
        except httpx.HTTPError as exc:
            last_exc = exc
            if attempt < FETCH_ATTEMPTS:
                time.sleep(min(2 ** attempt, 5))
        except ValueError as exc:
            raise ImageSourceError(f"{what} source {label} rejected: {exc}") from exc
    raise ImageSourceError(
        f"{what} source {label} unreachable after {FETCH_ATTEMPTS} attempts "
        f"({type(last_exc).__name__}); check the URL is publicly readable"
    )


def _load_photo(url: str) -> np.ndarray:
    from PIL import Image, ImageOps

    data = _fetch_bytes(url, "photo", MAX_IMAGE_BYTES)
    try:
        Image.MAX_IMAGE_PIXELS = MAX_PHOTO_PIXELS
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as exc:  # noqa: BLE001 - PIL raises many types, including decompression bombs
        raise ImageSourceError("photo is not a readable image (use PNG, JPEG or WebP)") from exc
    img = ImageOps.exif_transpose(img).convert("RGB")
    if max(img.size) > MAX_PHOTO_SIDE:
        scale = MAX_PHOTO_SIDE / max(img.size)
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    return np.asarray(img)


def _build_masks(request: dict, photo: np.ndarray) -> tuple[list[np.ndarray], list[str]]:
    height, width = photo.shape[:2]
    masks: list[np.ndarray] = []
    if request["mask_urls"]:
        for i, url in enumerate(request["mask_urls"]):
            data = _fetch_bytes(url, f"mask {i + 1}", MAX_MASK_BYTES)
            try:
                masks.append(layout.mask_from_png_bytes(data, width, height))
            except ValueError as exc:
                raise ImageSourceError(f"mask {i + 1}: {exc}") from exc
        return masks, ["mask"] * len(masks)
    for box in request["boxes"]:
        masks.append(layout.grabcut_mask(photo, layout.box_to_pixels(box, width, height)))
    return masks, ["box"] * len(masks)


def _task_blob(task_id: str, name: str | None = None):
    if _bucket is None:
        raise RuntimeError("GCS task storage is not active")
    return _bucket.blob(name or f"tasks/{task_id}.json")


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
                None, lambda: _task_blob(task_id).upload_from_string(payload, content_type="application/json")
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


def _generate_sync(request: dict) -> dict:
    from pipeline import run_objects

    photo = _load_photo(request["image_url"])
    masks, sources = _build_masks(request, photo)
    return run_objects(photo, masks, sources, request["seed"] if request["seed"] is not None else 42)


def _release_gpu_memory() -> None:
    gc.collect()
    torch = _torch()
    if torch and torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()


async def _run_job(task_id: str, request: dict) -> None:
    from pipeline import ObjectReconstructionError

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
        try:
            result = await loop.run_in_executor(None, _generate_sync, request)
            glb_bytes = result["scene_glb"]
            if _using_gcs():
                blob_name = f"raw-meshes/sam3d-objects/{task_id}.glb"
                blob = _bucket.blob(blob_name)
                await loop.run_in_executor(
                    None, lambda: blob.upload_from_string(glb_bytes, content_type="model/gltf-binary")
                )
                result_fields = {"result_gcs_url": f"https://storage.googleapis.com/{GCS_BUCKET}/{blob_name}"}
            else:
                result_path = await loop.run_in_executor(None, _get_local_storage().write_result, task_id, glb_bytes)
                result_fields = {"result_url": f"/results/{task_id}.glb", "result_path": str(result_path)}
            elapsed = time.time() - t0
            await _update_task(
                task_id,
                status="done",
                **result_fields,
                objects=result["objects"],
                object_count=len(result["objects"]),
                skipped=result["skipped"],
                bytes=len(glb_bytes),
                elapsed_ms=int(elapsed * 1000),
            )
            log.info("[%s] done in %.1fs (objects=%d) %d bytes", task_id, elapsed, len(result["objects"]), len(glb_bytes))
        except (ImageSourceError, ObjectReconstructionError) as exc:
            log.warning("[%s] rejected: %s", task_id, exc)
            await _update_task(task_id, status="failed", error=str(exc), elapsed_ms=int((time.time() - t0) * 1000))
        except Exception as exc:
            await _update_task(
                task_id, status="failed", error=safe_error(exc, context=f"[{task_id}] inference"),
                elapsed_ms=int((time.time() - t0) * 1000),
            )
        finally:
            await loop.run_in_executor(None, _release_gpu_memory)


class InferRequest(BaseModel):
    image_url: str = Field(..., min_length=1, max_length=4096)
    mask_urls: list[str] | None = None
    boxes: list[list[float]] | None = None
    max_objects: int | None = None
    seed: int | None = None
    job_id: str | None = None


@app.post("/infer", status_code=202)
async def infer(body: InferRequest, background_tasks: BackgroundTasks, authorization: str = Header(...)) -> dict:
    _require_api_key(authorization)
    if _load_error:
        raise HTTPException(status_code=503, detail=f"pipeline unavailable: {_load_error}")
    payload = body.model_dump(exclude_none=True)
    try:
        request = validate_request(payload)
    except RequestRejected as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    task_id = str(uuid.uuid4())
    await _update_task(task_id, status="queued", model="sam3d-objects")
    background_tasks.add_task(_run_job, task_id, request)
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
        "service": "model-sam3d-objects",
        "model": "sam3d-objects",
        "ready": bool(_ready and _ready.is_set()),
        "endpoints": ["POST /infer", "GET /tasks/{task_id}", "GET /results/{task_id}.glb", "GET /health"],
    }


@app.get("/health")
async def health(response: Response) -> dict:
    dead = _load_error is not None
    if dead:
        response.status_code = 503
    torch = _torch()
    cuda = _cuda_available()
    return {
        "ok": not dead,
        "model": "sam3d-objects",
        "gpu_available": cuda,
        "gpu_name": torch.cuda.get_device_name(0) if cuda else None,
        "gpu_memory_gb": round(torch.cuda.get_device_properties(0).total_memory / 2**30, 1) if cuda else None,
        "pipeline_loaded": _pipeline_loaded,
        "ready": bool(_ready and _ready.is_set()),
        "load_error": _load_error,
        "load_attempts": _load_attempts,
        "output_backend": "gcs" if _using_gcs() else "local",
    }
