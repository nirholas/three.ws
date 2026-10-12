"""Text-to-motion service: prompt to retargetable three.js animation clip.

Wraps a text-to-motion model on GPU, selectable per request between two MIT-
licensed backends. Given a natural-language prompt ("waving confidently", "a
slow tai-chi sweep") it samples SMPL-skeleton motion, then converts it to a
canonical three.js AnimationClip JSON (Wolf3D bone names, see
smpl_to_clip.py) that the platform retargets onto any rigged avatar with the
same engine the curated animation library uses. Output is uploaded to GCS and
the URL returned, mirroring the model-* worker contract exactly.

Models
  - MDM (GuyTevet/motion-diffusion-model), MIT. The default: diffusion
    sampling, one network, no residual-token stage, so it is the cheaper
    backend to keep warm.
  - MoMask (EricGuo5513/momask-codes), MIT. The stronger baseline on
    HumanML3D (published FID 0.045 vs. T2M-GPT's 0.141): a residual-VQ token
    vocabulary plus a masked transformer and a residual transformer. Selected
    per request via `model: "momask"`; see momask_sampler.py.
  Both are trained on HumanML3D and decode to the same 22-joint position
  representation (`motion_decode.py`'s shared, pure-NumPy position→rotation
  IK is backend-agnostic), so swapping models touches only `_load_model()` /
  `_generate_motion()`; the contract and the clip conversion do not change.

API contract (identical shape to the other model-* workers):
  POST /infer   { prompt: str, duration_seconds?: float=4, fps?: int=30, model?: str="mdm", job_id?: str }
                → 202 { task_id, status: "queued" }
  GET  /tasks/:id → { task_id, status, result_url?, frames?, fps?, error? }
  GET  /health    → { ok }

Environment:
  API_KEY            bearer secret (required)
  GCS_BUCKET         output bucket (required)
  MAX_CONCURRENT     default 2
  MOTION_MODEL_DIR   directory of MDM checkpoints (mounted from GCS)
  MOMASK_MODEL_DIR   directory of MoMask checkpoints (mounted from GCS)
  MAX_DURATION_SEC   hard cap on requested clip length (default 10)
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
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from google.cloud import storage
from pydantic import BaseModel, Field

from smpl_to_clip import smpl_motion_to_clip
from worker_security import require_api_key, safe_error

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("text2motion")

API_KEY = os.environ["API_KEY"]
GCS_BUCKET = os.environ["GCS_BUCKET"]
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "2"))
MOTION_MODEL_DIR = os.environ.get("MOTION_MODEL_DIR", "/weights/mdm")
MOMASK_MODEL_DIR = os.environ.get("MOMASK_MODEL_DIR", "/weights/momask")
MAX_DURATION_SEC = float(os.environ.get("MAX_DURATION_SEC", "10"))
DEFAULT_FPS = 30

# Canonical backend names. The default is warmed at container start; the rest
# load lazily on first use (same pattern as workers/rembg's multi-model
# selector, see rembg_policy.canonical_model).
CANONICAL_MODELS = ("mdm", "momask")
DEFAULT_MODEL = "mdm"

_bucket: Optional[storage.Bucket] = None
_sem: Optional[asyncio.Semaphore] = None
_tasks: dict[str, dict] = {}
_models: dict[str, object] = {}  # lazily-loaded samplers, keyed by canonical name
_model_locks: dict[str, asyncio.Lock] = {name: asyncio.Lock() for name in CANONICAL_MODELS}
_load_errors: dict[str, str] = {}


def canonical_model(name: Optional[str]) -> str:
    """Resolve a caller-supplied model name, falling back to the default.

    An unknown name falls back rather than 400s, because a generation request
    with a stale model name still has an obviously right thing to do.
    """
    resolved = (name or "").strip().lower()
    return resolved if resolved in CANONICAL_MODELS else DEFAULT_MODEL


async def _load_model_bg(name: str) -> None:
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, _load_model, name)
        log.info("%s ready, max_concurrent=%d", name, MAX_CONCURRENT)
    except Exception as exc:  # noqa: BLE001
        _load_errors[name] = safe_error(exc, context=f"{name} checkpoint load")
        log.error("%s model load FAILED: %s", name, exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _bucket, _sem
    _bucket = storage.Client().bucket(GCS_BUCKET)
    _sem = asyncio.Semaphore(MAX_CONCURRENT)
    # Load the DEFAULT checkpoint in the BACKGROUND and yield immediately:
    # uvicorn runs the ASGI lifespan before binding the socket, and the full
    # load (transformer weights + CUDA transfer from the GCS FUSE-mounted
    # weights dir) can run past Cloud Run's startup TCP-probe window on a cold
    # instance. Backgrounding opens the port at once; requests that arrive
    # before the load completes wait on `_ensure_loaded` in `_run_inference`.
    # Same pattern as model-trellis / model-triposg. Non-default backends
    # (momask) load on first request instead of at startup, matching rembg.
    asyncio.create_task(_load_model_bg(DEFAULT_MODEL))
    log.info("text2motion starting, %s loading in background (max_concurrent=%d)", DEFAULT_MODEL, MAX_CONCURRENT)
    yield


app = FastAPI(title="model-text2motion", lifespan=lifespan)


def _require_api_key(authorization: str) -> None:
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def _load_model(name: str) -> None:
    """Load one backend's sampler once per container.

    Kept import-local so the FastAPI app + the pure conversion path import
    cleanly in environments without torch/the model repos installed (tests,
    CI). On the GPU runtime this loads the checkpoint from the backend's
    model dir.
    """
    if name == "momask":
        from momask_sampler import MomaskSampler  # provided in the GPU image (see Dockerfile)

        _models[name] = MomaskSampler(model_dir=MOMASK_MODEL_DIR, device="cuda")
        log.info("MoMask checkpoints loaded from %s", MOMASK_MODEL_DIR)
    else:
        from mdm_sampler import MdmSampler  # provided in the GPU image (see Dockerfile)

        _models[name] = MdmSampler(model_dir=MOTION_MODEL_DIR, device="cuda")
        log.info("MDM checkpoint loaded from %s", MOTION_MODEL_DIR)


async def _ensure_loaded(name: str) -> None:
    """Block until `name`'s sampler is loaded, loading it now if nobody has."""
    if name in _models:
        return
    async with _model_locks[name]:
        if name in _models:  # a concurrent caller may have finished while we waited
            return
        if name in _load_errors:
            raise RuntimeError(_load_errors[name])
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(None, _load_model, name)
        except Exception as exc:  # noqa: BLE001
            _load_errors[name] = safe_error(exc, context=f"{name} checkpoint load")
            raise


def _generate_motion(name: str, prompt: str, n_frames: int):
    """Sample SMPL motion for `prompt` on backend `name`. Returns (poses, trans)."""
    model = _models.get(name)
    if model is None:
        raise RuntimeError(f"{name} model not loaded")
    poses, trans = model.sample(prompt=prompt, n_frames=n_frames)
    return poses, trans


class InferRequest(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=1000)
    duration_seconds: float = Field(default=4.0, gt=0)
    fps: int = Field(default=DEFAULT_FPS, ge=8, le=60)
    model: Optional[str] = None
    job_id: Optional[str] = None


@app.post("/infer", status_code=202)
async def infer(body: InferRequest, background_tasks: BackgroundTasks, authorization: str = Header(...)) -> dict:
    _require_api_key(authorization)
    model_name = canonical_model(body.model)
    task_id = body.job_id or str(uuid.uuid4())
    _tasks[task_id] = {"task_id": task_id, "status": "queued", "model": model_name}
    duration = min(body.duration_seconds, MAX_DURATION_SEC)
    n_frames = max(2, int(round(duration * body.fps)))
    background_tasks.add_task(_run_inference, task_id, model_name, body.prompt, n_frames, body.fps)
    return {"task_id": task_id, "status": "queued"}


@app.get("/tasks/{task_id}")
async def get_task(task_id: str, authorization: str = Header(...)) -> dict:
    _require_api_key(authorization)
    task = _tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@app.get("/")
async def root() -> dict:
    """Service identity for a bare-root GET.

    The keep-warm probe (api/cron/gpu-keepwarm.js) pings the root every 10
    minutes and counts anything under 500 as warm, so a 404 worked but logged 90
    WARNING lines a day into the triage sweep and told an operator who landed
    here nothing. Answer with the endpoint map instead, matching the other
    model-* workers.
    """
    return {
        "service": "model-text2motion",
        "model": DEFAULT_MODEL,
        "models_available": list(CANONICAL_MODELS),
        "health": "/health",
        "endpoints": ["POST /infer", "GET /tasks/{id}", "GET /health"],
    }


@app.get("/health")
async def health() -> dict:
    loaded = sorted(_models)
    return {
        "ok": True,
        "model_loaded": DEFAULT_MODEL in _models,
        "models_loaded": loaded,
        "models_available": list(CANONICAL_MODELS),
        "default_model": DEFAULT_MODEL,
        "status": "ready" if DEFAULT_MODEL in _models else ("failed" if DEFAULT_MODEL in _load_errors else "loading"),
        "load_error": _load_errors.get(DEFAULT_MODEL),
        "load_errors": dict(_load_errors),
    }


async def _run_inference(task_id: str, model_name: str, prompt: str, n_frames: int, fps: int) -> None:
    assert _sem is not None and _bucket is not None
    async with _sem:
        _tasks[task_id]["status"] = "running"
        started = time.time()
        loop = asyncio.get_event_loop()
        try:
            try:
                await asyncio.wait_for(_ensure_loaded(model_name), timeout=600)
            except asyncio.TimeoutError:
                raise RuntimeError(_load_errors.get(model_name) or f"{model_name} load timed out")
            poses, trans = await loop.run_in_executor(None, _generate_motion, model_name, prompt, n_frames)
            clip = smpl_motion_to_clip(poses, trans, fps=fps, name=_safe_name(prompt))
            payload = json.dumps(clip).encode("utf-8")

            blob_name = f"motion-clips/{model_name}/{task_id}.json"
            blob = _bucket.blob(blob_name)
            await loop.run_in_executor(
                None,
                lambda: blob.upload_from_string(payload, content_type="application/json"),
            )
            url = f"https://storage.googleapis.com/{GCS_BUCKET}/{blob_name}"
            _tasks[task_id].update(
                {
                    "status": "done",
                    "result_url": url,
                    "frames": int(n_frames),
                    "fps": int(fps),
                    "elapsed_ms": int((time.time() - started) * 1000),
                }
            )
            log.info("task %s done, %d frames in %dms", task_id, n_frames, int((time.time() - started) * 1000))
        except Exception as exc:  # surface an opaque, correlated error to the caller
            msg = safe_error(exc, context=f"text2motion task {task_id}")
            _tasks[task_id].update({"status": "failed", "error": msg})
            log.exception("task %s failed", task_id)
        finally:
            # Reclaim before releasing the semaphore, so the next inference
            # starts against a drained device. See _release_gpu_memory.
            await loop.run_in_executor(None, _release_gpu_memory)


def _release_gpu_memory() -> None:
    """Return a finished job's GPU allocations to the driver.

    Blocking, so callers run it in the executor. torch is imported lazily and
    the failure is swallowed because this module is deliberately importable
    without torch or MDM installed (see _load_model); on such a host there is
    no device to reclaim and the call is a no-op.

    Torch's caching allocator keeps freed blocks reserved rather than returning
    them, so without this an instance's usable VRAM only ever shrinks and a
    long-lived one eventually fails every job it accepts with a cudaMalloc
    error while its health check still passes. That is exactly how the sibling
    TRELLIS lane went from 1,189 generations on 2026-09-06 to a 100% failure
    rate on 2026-09-09; this lane had the same gap.
    """
    gc.collect()
    try:
        import torch
    except ImportError:
        return
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()


def _safe_name(prompt: str) -> str:
    slug = "".join(c if c.isalnum() else "-" for c in prompt.lower()).strip("-")
    return (slug[:40] or "generated").rstrip("-")
