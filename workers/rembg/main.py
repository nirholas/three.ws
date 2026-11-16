"""
Background removal service: strips the background from an image and returns a
transparent PNG, using rembg (MIT) and its ONNX salient-object-detection models.

API contract:
  POST /remove   { image: data-uri|url, model?: name }
              →  202 { task_id, status: "queued", model }
       model is one of u2net | isnet-general-use | u2net_human_seg | silueta |
       birefnet-general-lite. The legacy aliases "rmbg2" and "isnet" resolve to
       isnet-general-use; "birefnet" resolves to birefnet-general-lite.

  GET  /tasks/:id → { task_id, status, result_url?, error? }

  GET  /health    → { ok, models_loaded, models_available, default_model,
                      gpu_available, execution_providers }

Two inference backends share this one codebase and contract:

  onnxruntime (default)  the models run in-process on ONNX Runtime's CPU
                         provider, ~1-2 s per inference except
                         birefnet-general-lite (~6 s for a cleaner edge). Only
                         the default model loads at startup.
  triton                 the forward pass runs on NVIDIA Triton Inference
                         Server beside this process (Dockerfile.triton), on the
                         GPU, with dynamic batching across concurrent jobs.
                         rembg's own pre/post-processing is unchanged.

Task records are written to GCS (task_store.py), so a poll can land on any
instance, revision or lane. The CPU service can hand a share of submits to the
GPU lane (forwarder.py) while remaining the single URL callers use.

Environment variables:
  API_KEY                 shared bearer secret (required)
  GCS_BUCKET              Cloud Storage bucket for output PNGs (required)
  MODEL                   default model name (default: isnet-general-use)
  MAX_CONCURRENT          in-flight removals allowed at once (default: 4)
  INFERENCE_BACKEND       onnxruntime | triton (default: onnxruntime)
  TRITON_FORWARD_URL      GPU lane base URL to split traffic to (optional)
  TRITON_FORWARD_PERCENT  share of submits forwarded there, 0-100 (default: 0)
  METRICS_PROJECT         with METRICS_LOCATION, enables the Triton metrics
                          export to Cloud Monitoring (triton backend only)
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import io
import logging
import os
import random
import threading
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Header, BackgroundTasks
from google.api_core import exceptions as gcs_errors
from google.cloud import storage
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from rembg_policy import (
    CANONICAL_MODELS,
    MAX_TASKS,
    SourceImageError,
    TASK_RETENTION_S,
    canonical_model,
    gpu_providers,
    prune_tasks,
)
from forwarder import ForwardError, forward_percent, forward_submit, should_forward
from task_store import TaskNotFound, load_task, persist_task, public_view
from tracing import install_tracing
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
log = logging.getLogger("rembg")

API_KEY = os.environ["API_KEY"]
GCS_BUCKET = os.environ["GCS_BUCKET"]
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "4"))

# The startup default, pre-baked into the image (see Dockerfile), so warming it
# never touches the network. Env override is resolved through the alias table.
DEFAULT_MODEL = canonical_model(os.environ.get("MODEL", ""))

# Some image hosts (Wikimedia most visibly) answer 403 to a bare library
# user-agent. Identify the service and where to complain about it, per their
# published policy, so a public image URL a user pastes actually resolves.
USER_AGENT = "three.ws-rembg/1.0 (background removal worker; +https://three.ws)"
FETCH_TIMEOUT_S = 30.0
MAX_SOURCE_BYTES = 16 * 1024 * 1024

INFERENCE_BACKEND = os.environ.get("INFERENCE_BACKEND", "onnxruntime").strip().lower()
if INFERENCE_BACKEND not in ("onnxruntime", "triton"):
    raise RuntimeError(f"INFERENCE_BACKEND must be onnxruntime or triton, got {INFERENCE_BACKEND!r}")
TRITON_FORWARD_URL = os.environ.get("TRITON_FORWARD_URL", "").strip()
TRITON_FORWARD_PERCENT = forward_percent(os.environ.get("TRITON_FORWARD_PERCENT"))
METRICS_PROJECT = os.environ.get("METRICS_PROJECT", "").strip()
METRICS_LOCATION = os.environ.get("METRICS_LOCATION", "").strip()

_sessions: dict[str, object] = {}
_sessions_lock = threading.Lock()
_bucket: Optional[storage.Bucket] = None
_sem: Optional[asyncio.Semaphore] = None
_tasks: dict[str, dict] = {}
_triton_client = None
_metrics_exporter = None
_forward_client: Optional[httpx.AsyncClient] = None
_forward_stats = {"forwarded": 0, "fallbacks": 0}


def _get_session(model_name: str):
    """Lazily build (and cache) a rembg session, double-checked under a lock so
    the worker thread-pool never loads the same model twice. Only the default
    model is warmed at startup; the rest load on first use, so cold start stays
    fast and the /remove submit returns its 202 immediately."""
    canon = canonical_model(model_name, fallback=DEFAULT_MODEL)
    session = _sessions.get(canon)
    if session is not None:
        return session
    with _sessions_lock:
        session = _sessions.get(canon)
        if session is None:
            if INFERENCE_BACKEND == "triton":
                import triton_backend
                session = triton_backend.build_session(_triton_client, canon)
            else:
                import rembg
                session = rembg.new_session(canon)
            _sessions[canon] = session
            log.info("Loaded rembg session: %s (%s)", canon, INFERENCE_BACKEND)
        return session


def _execution_providers() -> list:
    """ONNX Runtime execution providers this build can use."""
    import onnxruntime
    return list(onnxruntime.get_available_providers())


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _bucket, _sem, _triton_client, _metrics_exporter, _forward_client
    _bucket = storage.Client().bucket(GCS_BUCKET)
    _sem = asyncio.Semaphore(MAX_CONCURRENT)
    loop = asyncio.get_event_loop()
    if INFERENCE_BACKEND == "triton":
        import triton_backend
        _triton_client = triton_backend.make_client()
        # Triton loads and warms every model in the repository at boot; the
        # startup probe holds traffic until all of them answer ready.
        await loop.run_in_executor(
            None, triton_backend.wait_until_ready, _triton_client, list(CANONICAL_MODELS)
        )
        if METRICS_PROJECT and METRICS_LOCATION:
            _metrics_exporter = triton_backend.MetricsExporter(
                METRICS_PROJECT, METRICS_LOCATION, os.environ.get("K_SERVICE", "rembg-triton")
            )
            _metrics_exporter.start()
    # Warm the default model so the first job pays no load cost; on the
    # onnxruntime backend the other models load lazily on first request.
    await loop.run_in_executor(None, _get_session, DEFAULT_MODEL)
    if TRITON_FORWARD_URL and TRITON_FORWARD_PERCENT > 0:
        _forward_client = httpx.AsyncClient()
        log.info("forwarding %.1f%% of submits to %s", TRITON_FORWARD_PERCENT, TRITON_FORWARD_URL)
    log.info("rembg service ready (%s), default model: %s", INFERENCE_BACKEND, DEFAULT_MODEL)
    yield
    if _forward_client is not None:
        await _forward_client.aclose()


app = FastAPI(title="rembg-service", lifespan=lifespan)
install_tracing(app, "rembg")


def _require_api_key(authorization: Optional[str]) -> None:
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def _open_image(data: bytes) -> Image.Image:
    """Decode fetched bytes into RGBA, or say what arrived instead.

    RGBA is what rembg composites against: it pastes the cutout onto a
    transparent RGBA canvas of the same mode, so handing it RGB raises deep
    inside the library with a message no caller could act on.
    """
    try:
        return Image.open(io.BytesIO(data)).convert("RGBA")
    except UnidentifiedImageError as exc:
        raise SourceImageError(
            "the source is not a decodable image (expected PNG, JPEG, WebP or similar)"
        ) from exc
    except OSError as exc:
        raise SourceImageError(f"the source image is truncated or corrupt: {exc}") from exc


def _decode_image(src: str) -> Image.Image:
    if src.startswith("data:image"):
        _, _, payload = src.partition(",")
        try:
            raw = base64.b64decode(payload, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise SourceImageError("the data URI payload is not valid base64") from exc
        return _open_image(raw)
    if src.startswith("https://"):
        try:
            data = fetch_remote_bytes(
                src,
                timeout=FETCH_TIMEOUT_S,
                max_bytes=MAX_SOURCE_BYTES,
                headers={"User-Agent": USER_AGENT},
            )
        except UnsafeUrlError as exc:
            raise SourceImageError(f"refused to fetch the image: {exc}") from exc
        except httpx.HTTPStatusError as exc:
            raise SourceImageError(
                f"the image URL returned HTTP {exc.response.status_code}"
            ) from exc
        except httpx.HTTPError as exc:
            raise SourceImageError(f"could not fetch the image URL: {type(exc).__name__}") from exc
        except ValueError as exc:
            # fetch_remote_bytes raises ValueError once the body passes max_bytes.
            raise SourceImageError(str(exc)) from exc
        return _open_image(data)
    raise SourceImageError("image must be an https:// URL or a data:image/... URI")


def _run_removal(img: Image.Image, model_name: str) -> Image.Image:
    """Cut the subject out, returning an RGBA image.

    The image goes to rembg as a PIL image rather than as re-encoded PNG bytes:
    the round trip cost more than the inference itself (2.9 s of the 8.1 s total
    on a 12 MP photo, measured on 2 cores) and threw away the EXIF orientation,
    so upright phone photos came back on their side.
    """
    import rembg
    session = _get_session(model_name)
    return rembg.remove(img, session=session)


async def _persist(task: dict) -> None:
    """Publish the task record for other instances and lanes. A storage hiccup
    is logged, not raised: this instance still answers from memory, and the
    next state change writes the record again."""
    loop = asyncio.get_event_loop()
    snapshot = dict(task)
    try:
        await loop.run_in_executor(None, persist_task, _bucket, snapshot)
    except Exception as exc:
        log.warning("[%s] could not persist task record: %s", task.get("task_id"), exc)


async def _process(task_id: str, image_src: str, model_name: str) -> None:
    try:
        await _process_inner(task_id, image_src, model_name)
    finally:
        await _persist(_tasks[task_id])


async def _process_inner(task_id: str, image_src: str, model_name: str) -> None:
    async with _sem:
        _tasks[task_id]["status"] = "running"
        loop = asyncio.get_event_loop()
        t0 = time.time()
        try:
            img = await loop.run_in_executor(None, _decode_image, image_src)
            result = await loop.run_in_executor(None, _run_removal, img, model_name)

            buf = io.BytesIO()
            result.save(buf, format="PNG")
            png_bytes = buf.getvalue()

            blob_name = f"rembg/{task_id}.png"
            blob = _bucket.blob(blob_name)
            await loop.run_in_executor(
                None,
                lambda: blob.upload_from_string(png_bytes, content_type="image/png"),
            )
            result_url = f"https://storage.googleapis.com/{GCS_BUCKET}/{blob_name}"

            elapsed = time.time() - t0
            _tasks[task_id].update({
                "status": "done",
                "result_url": result_url,
                "width": result.width,
                "height": result.height,
                "elapsed_ms": int(elapsed * 1000),
                "finished_at": time.time(),
            })
            log.info("[%s] done in %.2fs, %d bytes", task_id, elapsed, len(png_bytes))

        except SourceImageError as exc:
            # The caller's input is at fault, so answer with what is wrong. The
            # opaque safe_error path exists for OUR failures, and using it here
            # sent people hunting a service outage over a dead image link.
            log.warning("[%s] rejected source image: %s", task_id, exc)
            _tasks[task_id].update({
                "status": "failed",
                "error": str(exc),
                "elapsed_ms": int((time.time() - t0) * 1000),
                "finished_at": time.time(),
            })
        except Exception as exc:
            _tasks[task_id].update({
                "status": "failed",
                "error": safe_error(exc, context=f"[{task_id}] rembg"),
                "elapsed_ms": int((time.time() - t0) * 1000),
                "finished_at": time.time(),
            })


class RemoveRequest(BaseModel):
    image: str = Field(..., description="data-uri or https URL of the source image")
    model: str = Field(default="rmbg2", description="rembg model name")


@app.post("/remove", status_code=202)
async def remove_background(
    body: RemoveRequest,
    background_tasks: BackgroundTasks,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    _require_api_key(authorization)
    if _forward_client is not None and should_forward(
        TRITON_FORWARD_URL, TRITON_FORWARD_PERCENT, random.random()
    ):
        try:
            forwarded = await forward_submit(
                _forward_client, TRITON_FORWARD_URL, API_KEY, body.model_dump()
            )
            _forward_stats["forwarded"] += 1
            log.info("[%s] forwarded to triton lane", forwarded["task_id"])
            return forwarded
        except ForwardError as exc:
            _forward_stats["fallbacks"] += 1
            log.warning("triton lane refused a job, processing locally: %s", exc)
    model_name = canonical_model(body.model, fallback=DEFAULT_MODEL)
    task_id = str(uuid.uuid4())
    now = time.time()
    evicted = prune_tasks(_tasks, now)
    if evicted:
        log.info("pruned %d finished task(s), %d retained", len(evicted), len(_tasks))
    _tasks[task_id] = {
        "task_id": task_id,
        "status": "queued",
        "model": model_name,
        "created_at": now,
    }
    # Written before the 202 so a poll that lands on another instance (or the
    # front door, when this is the GPU lane) finds the job straight away.
    await _persist(_tasks[task_id])
    background_tasks.add_task(_process, task_id, body.image, model_name)
    return {"task_id": task_id, "status": "queued", "model": model_name}


@app.get("/tasks/{task_id}")
async def get_task(task_id: str, authorization: Optional[str] = Header(default=None)) -> dict:
    _require_api_key(authorization)
    task = _tasks.get(task_id)
    if task is not None:
        # Retention bookkeeping stays server-side: the documented response
        # shape is what callers get, whatever the eviction policy tracks.
        return public_view(task)
    # Accepted by another instance, an earlier revision, or the GPU lane.
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(
            None, lambda: load_task(_bucket, task_id, not_found=(gcs_errors.NotFound,))
        )
    except TaskNotFound:
        raise HTTPException(status_code=404, detail="task not found")
    except gcs_errors.GoogleAPIError as exc:
        log.warning("[%s] task store read failed: %s", task_id, exc)
        raise HTTPException(status_code=503, detail="task store temporarily unavailable; retry")


def _triton_health() -> dict:
    import triton_backend
    states = triton_backend.model_ready_states(_triton_client, CANONICAL_MODELS)
    try:
        gpu = triton_backend.scrape_gpu_gauges()
    except Exception as exc:
        log.warning("triton metrics scrape failed: %s", exc)
        gpu = {}
    return {
        "triton_models_ready": states,
        "triton_gpu": gpu,
        "metrics_export": None if _metrics_exporter is None else {
            "project": METRICS_PROJECT,
            "last_error": _metrics_exporter.last_error,
            "last_summary": _metrics_exporter.last_summary,
        },
    }


@app.get("/health")
async def health() -> dict:
    if INFERENCE_BACKEND == "triton":
        providers = ["TritonInferenceServer"]
        backend = await asyncio.get_event_loop().run_in_executor(None, _triton_health)
        # Triton only exports nv_gpu_* gauges when it owns a GPU.
        gpu = "gpu_utilization" in backend["triton_gpu"]
    else:
        providers = _execution_providers()
        backend = {}
        gpu = bool(gpu_providers(providers))
    return {
        "ok": True,
        "service": "rembg",
        "inference_backend": INFERENCE_BACKEND,
        **backend,
        "triton_forward": {
            "url": TRITON_FORWARD_URL or None,
            "percent": TRITON_FORWARD_PERCENT,
            **_forward_stats,
        },
        "gpu_available": gpu,
        "execution_providers": providers,
        "models_loaded": list(_sessions),
        "models_available": list(CANONICAL_MODELS),
        "default_model": DEFAULT_MODEL,
        "tasks_tracked": len(_tasks),
        "task_retention_s": TASK_RETENTION_S,
        "max_tasks": MAX_TASKS,
    }
