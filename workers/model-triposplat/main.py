"""
TripoSplat inference service: one image to a 3D Gaussian splat
(VAST-AI-Research/TripoSplat, MIT code and weights).

The Forge "Image to splat" lane behind /api/forge-splat. Unlike the mesh
workers it returns a splat (.ply plus a compact .splat), which the Splat Viewer
(src/splat-viewer.js, Spark) renders directly.

API contract (same task shape as the other GPU workers):
  POST /infer  { images: [data-uri|https url], num_gaussians?: int, job_id?: str }
            -> 202 { task_id, status: "queued" }
  GET  /tasks/:id -> { task_id, status, result_gcs_url?, ply_url?, splat_url?,
                       num_gaussians?, elapsed_ms?, error? }
  GET  /health    -> { ok, model, gpu_available, load_error, load_attempts }
  GET  /          -> unauthenticated descriptor for the platform warmth probe.

Weights: gs://three-ws-model-weights/triposplat (stage-assets.sh), mounted at
/weights. Environment: API_KEY, GCS_BUCKET, WEIGHTS_DIR, MAX_CONCURRENT.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

import torch
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Response
from google.api_core.exceptions import NotFound
from google.cloud import storage
from pydantic import BaseModel, Field

from splat_prep import clamp_gaussians, decode_image, splat_blob_name, splat_public_url
from worker_security import UnsafeUrlError, fetch_remote_bytes, require_api_key, safe_error

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("model-triposplat")

API_KEY = os.environ["API_KEY"]
GCS_BUCKET = os.environ["GCS_BUCKET"]
WEIGHTS_DIR = os.environ.get("WEIGHTS_DIR", "/weights/triposplat")
REPO_DIR = os.environ.get("TRIPOSPLAT_REPO", "/opt/triposplat")
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "1"))
MODEL_LOAD_ATTEMPTS = int(os.environ.get("MODEL_LOAD_ATTEMPTS", "4"))
MODEL_LOAD_RETRY_BASE_S = float(os.environ.get("MODEL_LOAD_RETRY_BASE_S", "15"))

_pipe = None
_bucket: Optional[storage.Bucket] = None
_sem: Optional[asyncio.Semaphore] = None
_ready: Optional[asyncio.Event] = None
_load_error: Optional[str] = None
_load_attempts = 0
_tasks: dict[str, dict] = {}
_task_locks: dict[str, asyncio.Lock] = {}
_TERMINAL = frozenset({"done", "failed"})


def _load_pipeline_sync() -> None:
    global _pipe
    if REPO_DIR not in sys.path:
        sys.path.insert(0, REPO_DIR)
    from triposplat import TripoSplatPipeline

    w = WEIGHTS_DIR
    log.info("Loading TripoSplat from %s", w)
    _pipe = TripoSplatPipeline(
        ckpt_path=f"{w}/diffusion_models/triposplat_fp16.safetensors",
        decoder_path=f"{w}/vae/triposplat_vae_decoder_fp16.safetensors",
        dinov3_path=f"{w}/clip_vision/dino_v3_vit_h.safetensors",
        flux2_vae_encoder_path=f"{w}/vae/flux2-vae.safetensors",
        rmbg_path=f"{w}/background_removal/birefnet.safetensors",
        device="cuda",
    )


async def _load_pipeline_bg() -> None:
    """Load off the request path, retrying with backoff before latching a failure."""
    global _load_error, _load_attempts
    loop = asyncio.get_event_loop()
    for attempt in range(1, max(1, MODEL_LOAD_ATTEMPTS) + 1):
        _load_attempts = attempt
        try:
            await loop.run_in_executor(None, _load_pipeline_sync)
            _load_error = None
            _ready.set()
            return
        except Exception as exc:  # noqa: BLE001 - surfaced via /health + task status
            if attempt >= MODEL_LOAD_ATTEMPTS:
                _load_error = safe_error(exc, context="model load")
                log.error("TripoSplat load FAILED after %d attempt(s): %s", attempt, exc)
                return
            delay = MODEL_LOAD_RETRY_BASE_S * (2 ** (attempt - 1))
            log.warning("TripoSplat load attempt %d failed (%s); retrying in %.0fs", attempt, exc, delay)
            await asyncio.sleep(delay)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _bucket, _sem, _ready
    _bucket = storage.Client().bucket(GCS_BUCKET)
    _sem = asyncio.Semaphore(MAX_CONCURRENT)
    _ready = asyncio.Event()
    asyncio.create_task(_load_pipeline_bg())
    yield


app = FastAPI(title="model-triposplat", lifespan=lifespan)


def _require_api_key(authorization: str) -> None:
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def _fetch_image_bytes(url: str) -> bytes:
    try:
        return fetch_remote_bytes(url, timeout=30)
    except UnsafeUrlError as exc:
        raise ValueError(f"refused to fetch image source: {exc}") from exc


def _task_blob(task_id: str):
    return _bucket.blob(f"tasks/triposplat/{task_id}.json")


async def _update_task(task_id: str, **fields) -> dict:
    """Persist every transition to GCS: polls land on any instance."""
    lock = _task_locks.setdefault(task_id, asyncio.Lock())
    async with lock:
        task = _tasks.setdefault(task_id, {"task_id": task_id})
        task.update(fields)
        task["updated_at"] = time.time()
        payload = json.dumps(task)
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: _task_blob(task_id).upload_from_string(payload, content_type="application/json")
        )
    return task


async def _resolve_task(task_id: str) -> dict:
    task = _tasks.get(task_id)
    if task is not None and task.get("status") in _TERMINAL:
        return task
    try:
        data = await asyncio.get_event_loop().run_in_executor(None, _task_blob(task_id).download_as_bytes)
    except NotFound:
        if task is not None:
            return task
        raise HTTPException(status_code=404, detail="task not found")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=safe_error(exc, context="task lookup")) from exc
    task = json.loads(data)
    if task.get("status") in _TERMINAL:
        _tasks[task_id] = task
    return task


def _generate_sync(image, num_gaussians: int) -> tuple[bytes, bytes]:
    with torch.no_grad():
        gaussian, _prepared = _pipe.run(image, num_gaussians=num_gaussians, show_progress=False)
    with tempfile.TemporaryDirectory() as tmp:
        ply, splat = os.path.join(tmp, "o.ply"), os.path.join(tmp, "o.splat")
        gaussian.save_ply(ply)
        gaussian.save_splat(splat)
        with open(ply, "rb") as a, open(splat, "rb") as b:
            return a.read(), b.read()


async def _run_job(task_id: str, image_src: str, num_gaussians: int) -> None:
    await _ready.wait()
    async with _sem:
        await _update_task(task_id, status="running")
        loop = asyncio.get_event_loop()
        t0 = time.time()
        try:
            image = await loop.run_in_executor(None, lambda: decode_image(image_src, fetch=_fetch_image_bytes))
            ply_bytes, splat_bytes = await loop.run_in_executor(None, _generate_sync, image, num_gaussians)

            urls = {}
            for ext, data in (("ply", ply_bytes), ("splat", splat_bytes)):
                name = splat_blob_name(task_id, ext)
                await loop.run_in_executor(
                    None,
                    lambda n=name, d=data: _bucket.blob(n).upload_from_string(d, content_type="application/octet-stream"),
                )
                urls[ext] = splat_public_url(GCS_BUCKET, name)

            await _update_task(
                task_id,
                status="done",
                result_gcs_url=urls["splat"],
                splat_url=urls["splat"],
                ply_url=urls["ply"],
                num_gaussians=num_gaussians,
                elapsed_ms=int((time.time() - t0) * 1000),
            )
            log.info("[%s] done in %.1fs, %d gaussians", task_id, time.time() - t0, num_gaussians)
        except Exception as exc:  # noqa: BLE001
            is_input = isinstance(exc, ValueError)
            await _update_task(
                task_id,
                status="failed",
                error=str(exc) if is_input else safe_error(exc, context=f"[{task_id}] inference"),
                error_kind="input" if is_input else "internal",
                elapsed_ms=int((time.time() - t0) * 1000),
            )
        finally:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()


class InferRequest(BaseModel):
    images: list[str] = Field(..., min_length=1, max_length=6)
    num_gaussians: int | None = None
    job_id: str | None = None


@app.post("/infer", status_code=202)
async def infer(body: InferRequest, background_tasks: BackgroundTasks, authorization: str = Header(...)) -> dict:
    _require_api_key(authorization)
    if _load_error:
        raise HTTPException(status_code=503, detail=f"pipeline unavailable: {_load_error}")
    try:
        count = clamp_gaussians(body.num_gaussians)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    task_id = str(uuid.uuid4())
    await _update_task(task_id, status="queued", model="triposplat")
    # TripoSplat conditions on a single image; extra frames are accepted and ignored.
    background_tasks.add_task(_run_job, task_id, body.images[0], count)
    return {"task_id": task_id, "status": "queued"}


@app.get("/tasks/{task_id}")
async def get_task(task_id: str, authorization: str = Header(...)) -> dict:
    _require_api_key(authorization)
    try:
        uuid.UUID(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="task not found") from exc
    return await _resolve_task(task_id)


@app.get("/")
async def root() -> dict:
    return {
        "service": "model-triposplat",
        "model": "triposplat",
        "ready": bool(_ready and _ready.is_set()),
        "endpoints": ["POST /infer", "GET /tasks/{task_id}", "GET /health"],
    }


@app.get("/health")
async def health(response: Response) -> dict:
    dead = _load_error is not None
    if dead:
        response.status_code = 503
    return {
        "ok": not dead,
        "model": "triposplat",
        "gpu_available": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "pipeline_loaded": _pipe is not None,
        "ready": bool(_ready and _ready.is_set()),
        "load_error": _load_error,
        "load_attempts": _load_attempts,
    }
