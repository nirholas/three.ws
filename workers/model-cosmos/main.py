"""model-cosmos: NVIDIA Cosmos 3 world generation on a Cloud Run RTX PRO 6000.

One checkpoint (nvidia/Cosmos3-Nano, OpenMDW-1.1) loaded once through diffusers'
Cosmos3OmniModularPipeline serves four modes: text, image (a still of the
caller's scene as frame 0), depth and edge (layout transfer from a three.js
render). See generation_config.py for the per-mode numbers.

Job lifecycle (every state is persisted, so a poll survives a page reload, an
API redeploy, or a poll that lands on a fresh instance):

  queued -> upsampling -> generating -> decoding -> encoding -> done
                                                            \\-> failed (error_code + error)

Endpoints (all but / and /health need `Authorization: Bearer <API_KEY>`):
  POST /infer               202 {task_id, status, queue_position}
  GET  /tasks/{id}          the task record (status, progress, step, total_steps, eta_seconds, timings)
  GET  /tasks/{id}/video    the finished MP4
  GET  /health              load state, modes, revision
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import StreamingResponse

import generation_config as gc_cfg
from generation_config import GenerationRequest, RequestError, eta_seconds, parse_request
from upsampler import Upsampler, load_negative_prompt
from worker_security import require_api_key, safe_error

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("cosmos")

API_KEY = os.environ["API_KEY"]
MODEL_ID = "cosmos3-nano"
MODEL_DIR = os.environ.get("MODEL_DIR", "/weights/cosmos3-nano")
TASK_BUCKET = os.environ.get("TASK_BUCKET", "").strip()
TASK_PREFIX = os.environ.get("TASK_PREFIX", "cosmos-worker").strip("/")
LOCAL_TASK_DIR = Path(os.environ.get("LOCAL_TASK_DIR", "/tmp/cosmos-tasks"))
DEFAULT_RESOLUTION = os.environ.get("DEFAULT_RESOLUTION", gc_cfg.DEFAULT_RESOLUTION)
MAX_QUEUE = int(os.environ.get("MAX_QUEUE", "4"))
HEARTBEAT_SECS = float(os.environ.get("HEARTBEAT_SECS", "20"))
ORPHAN_AFTER_SECS = float(os.environ.get("ORPHAN_AFTER_SECS", "240"))
JOB_TIMEOUT_SECS = float(os.environ.get("JOB_TIMEOUT_SECS", "1500"))
MODEL_LOAD_ATTEMPTS = int(os.environ.get("MODEL_LOAD_ATTEMPTS", "3"))
MODEL_LOAD_RETRY_BASE_S = float(os.environ.get("MODEL_LOAD_RETRY_BASE_S", "20"))

TERMINAL = frozenset({"done", "failed"})

_pipe = None
_ready: Optional[asyncio.Event] = None
_load_error: Optional[str] = None
_load_attempts = 0
_load_seconds: Optional[float] = None
_gpu_name: Optional[str] = None
_revision: Optional[str] = None
_bucket = None
_gpu_lock: Optional[asyncio.Lock] = None
_queue: list[str] = []
_tasks: dict[str, dict] = {}
_task_locks: dict[str, asyncio.Lock] = {}
_upsampler = Upsampler()
_negatives = {name: load_negative_prompt(name) for name in {p.negative_file for p in gc_cfg.PRESETS.values()}}

# Set by the scheduler.step wrapper while a job denoises; read by the progress pump.
_step_state = {"step": 0, "total": 0, "started": 0.0}


# ---------------------------------------------------------------------------
# Task records: GCS when TASK_BUCKET is set (production), local disk otherwise.
# ---------------------------------------------------------------------------


def _record_key(task_id: str) -> str:
    return f"{TASK_PREFIX}/tasks/{task_id}.json"


def _video_key(task_id: str) -> str:
    return f"{TASK_PREFIX}/videos/{task_id}.mp4"


def _write_record(snapshot: dict) -> None:
    payload = json.dumps(snapshot)
    if _bucket is not None:
        blob = _bucket.blob(_record_key(snapshot["task_id"]))
        blob.cache_control = "no-store"
        blob.upload_from_string(payload, content_type="application/json")
        return
    path = LOCAL_TASK_DIR / "tasks" / f"{snapshot['task_id']}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(payload)
    tmp.replace(path)


def _read_record(task_id: str) -> Optional[dict]:
    if _bucket is not None:
        from google.api_core.exceptions import NotFound

        try:
            return json.loads(_bucket.blob(_record_key(task_id)).download_as_bytes())
        except NotFound:
            return None
    path = LOCAL_TASK_DIR / "tasks" / f"{task_id}.json"
    return json.loads(path.read_text()) if path.is_file() else None


def _write_video(task_id: str, path: Path) -> int:
    size = path.stat().st_size
    if _bucket is not None:
        blob = _bucket.blob(_video_key(task_id))
        blob.cache_control = "private, max-age=3600"
        blob.upload_from_filename(str(path), content_type="video/mp4")
        return size
    dest = LOCAL_TASK_DIR / "videos" / f"{task_id}.mp4"
    dest.parent.mkdir(parents=True, exist_ok=True)
    path.replace(dest)
    return size


def _read_video(task_id: str) -> Optional[bytes]:
    if _bucket is not None:
        from google.api_core.exceptions import NotFound

        try:
            return _bucket.blob(_video_key(task_id)).download_as_bytes()
        except NotFound:
            return None
    path = LOCAL_TASK_DIR / "videos" / f"{task_id}.mp4"
    return path.read_bytes() if path.is_file() else None


async def _update(task_id: str, **fields) -> dict:
    lock = _task_locks.setdefault(task_id, asyncio.Lock())
    async with lock:
        task = _tasks.setdefault(task_id, {"task_id": task_id})
        task.update(fields)
        task["updated_at"] = time.time()
        snapshot = dict(task)
        await asyncio.get_running_loop().run_in_executor(None, _write_record, snapshot)
    return task


def is_orphaned(task: dict, now: float, orphan_after: float = ORPHAN_AFTER_SECS) -> bool:
    if task.get("status") in TERMINAL:
        return False
    updated = task.get("updated_at")
    if not isinstance(updated, (int, float)):
        return True
    return now - updated > orphan_after


async def _resolve(task_id: str) -> dict:
    task = _tasks.get(task_id)
    if task is not None and (task.get("status") in TERMINAL or task_id in _queue or task.get("live")):
        return task
    loop = asyncio.get_running_loop()
    try:
        stored = await loop.run_in_executor(None, _read_record, task_id)
    except Exception as exc:  # noqa: BLE001 - storage outage surfaces as 502
        raise HTTPException(status_code=502, detail=safe_error(exc, context="task lookup")) from exc
    if stored is None:
        if task is not None:
            return task
        raise HTTPException(status_code=404, detail="task not found")
    if is_orphaned(stored, time.time()):
        _tasks[task_id] = stored
        return await _update(
            task_id,
            status="failed",
            error_code="worker_restarted",
            error="the GPU worker restarted mid-job; submit the world again",
        )
    if stored.get("status") in TERMINAL:
        _tasks[task_id] = stored
    return stored


# ---------------------------------------------------------------------------
# Model load
# ---------------------------------------------------------------------------


def _install_step_counter(pipe) -> None:
    """Count denoising steps for honest progress. Transfer chunks reset the
    scheduler per chunk, so the counter is cumulative across chunks."""
    scheduler = pipe.scheduler
    original = scheduler.step

    def counted_step(*args, **kwargs):
        out = original(*args, **kwargs)
        _step_state["step"] += 1
        return out

    scheduler.step = counted_step


def _load_pipeline() -> None:
    global _pipe, _gpu_name, _revision, _load_seconds
    import torch
    from diffusers import Cosmos3OmniModularPipeline
    from diffusers.schedulers.scheduling_unipc_multistep import UniPCMultistepScheduler

    started = time.monotonic()
    if not Path(MODEL_DIR, "model_index.json").is_file():
        raise RuntimeError(f"no diffusers checkpoint at {MODEL_DIR} (is the weights volume mounted?)")
    rev_file = Path(MODEL_DIR, "REVISION")
    _revision = rev_file.read_text().strip() if rev_file.is_file() else None
    pipe = Cosmos3OmniModularPipeline.from_pretrained(MODEL_DIR, torch_dtype=torch.bfloat16)
    pipe.load_components(torch_dtype=torch.bfloat16)
    pipe.to("cuda")
    scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config, flow_shift=gc_cfg.FLOW_SHIFT)
    pipe.update_components(scheduler=scheduler)
    # No three.ws surface screens what a user may ask (owner directive, see
    # api/_lib/publish-safety.js), and the Cosmos guardrail is a prompt and
    # output classifier, so the worker runs with it off and says so in /health.
    pipe.disable_safety_checker()
    _install_step_counter(pipe)
    _gpu_name = torch.cuda.get_device_name(0)
    _pipe = pipe
    _load_seconds = round(time.monotonic() - started, 1)
    log.info("Cosmos3-Nano ready on %s in %.1fs (revision %s)", _gpu_name, _load_seconds, _revision)


async def _load_bg() -> None:
    global _load_error, _load_attempts
    loop = asyncio.get_running_loop()
    for attempt in range(1, MODEL_LOAD_ATTEMPTS + 1):
        _load_attempts = attempt
        try:
            await loop.run_in_executor(None, _load_pipeline)
            _ready.set()
            return
        except Exception as exc:  # noqa: BLE001 - surfaced through /health
            if attempt >= MODEL_LOAD_ATTEMPTS:
                _load_error = safe_error(exc, context="model load")
                return
            delay = MODEL_LOAD_RETRY_BASE_S * (2 ** (attempt - 1))
            log.warning("model load attempt %d failed (%s); retrying in %.0fs", attempt, exc, delay)
            await asyncio.sleep(delay)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _bucket, _ready, _gpu_lock
    if TASK_BUCKET:
        from google.cloud import storage

        _bucket = storage.Client().bucket(TASK_BUCKET)
    _ready = asyncio.Event()
    _gpu_lock = asyncio.Lock()
    asyncio.create_task(_load_bg())
    yield


app = FastAPI(title="model-cosmos", lifespan=lifespan)


def _auth(authorization: Optional[str]) -> None:
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------


def _generate(req: GenerationRequest, prompt: str, control_videos: Optional[dict], out_path: Path) -> dict:
    import torch
    from diffusers.utils import export_to_video
    from PIL import Image

    preset = req.preset
    kwargs = dict(
        prompt=prompt,
        negative_prompt=_negatives[preset.negative_file],
        height=req.height,
        width=req.width,
        num_frames=req.num_frames,
        fps=preset.fps,
        num_inference_steps=preset.steps,
        guidance_scale=preset.guidance,
        generator=torch.Generator(device="cuda").manual_seed(req.seed),
        enable_sound=False,
    )
    if req.mode == "image":
        kwargs["image"] = Image.open(io.BytesIO(req.image_bytes)).convert("RGB")
    if control_videos is not None:
        kwargs["control_videos"] = control_videos
        kwargs["control_guidance"] = preset.control_guidance
        kwargs["num_video_frames_per_chunk"] = req.num_frames
        kwargs["num_conditional_frames"] = 1

    t0 = time.monotonic()
    with torch.inference_mode():
        videos = _pipe(**kwargs, output="videos")
    t_sample = time.monotonic() - t0
    _step_state["phase"] = "encoding"
    t1 = time.monotonic()
    export_to_video(videos, str(out_path), fps=preset.fps, macro_block_size=1)
    t_encode = time.monotonic() - t1
    torch.cuda.empty_cache()
    return {"sample_s": round(t_sample, 2), "encode_s": round(t_encode, 2)}


async def _progress_pump(task_id: str, total: int) -> None:
    """Publish step progress and keep the record's heartbeat fresh."""
    last_step = -1
    last_write = 0.0
    while True:
        await asyncio.sleep(2.0)
        step = min(_step_state["step"], total)
        now = time.monotonic()
        if step == last_step and now - last_write < HEARTBEAT_SECS:
            continue
        progress = step / total if total else 0.0
        elapsed = now - _step_state["started"]
        phase = _step_state.get("phase")
        status = phase or ("decoding" if step >= total else "generating")
        try:
            await _update(
                task_id,
                status=status,
                step=step,
                total_steps=total,
                progress=round(progress, 4),
                eta_seconds=eta_seconds(progress, elapsed),
            )
        except Exception as exc:  # noqa: BLE001 - a missed beat must not kill the job
            log.warning("[%s] progress write failed: %s", task_id, exc)
        last_step, last_write = step, now


async def _heartbeat(task_id: str) -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_SECS)
        try:
            await _update(task_id)
        except Exception as exc:  # noqa: BLE001
            log.warning("[%s] heartbeat failed: %s", task_id, exc)


async def _run(task_id: str, req: GenerationRequest) -> None:
    beat = asyncio.create_task(_heartbeat(task_id))
    timings: dict = {}
    try:
        if not _ready.is_set():
            await _update(task_id, status="queued", detail="model loading")
            await asyncio.wait_for(_ready.wait(), timeout=900)
        async with _gpu_lock:
            _queue.remove(task_id)
            started = time.monotonic()
            await _update(task_id, status="upsampling", started_at=time.time(), queue_position=0)
            ups = await _upsampler.upsample(
                req.prompt,
                resolution=req.resolution,
                aspect_ratio=gc_cfg.ASPECT_RATIO,
                height=req.height,
                width=req.width,
                duration=req.duration_label,
                fps=req.fps,
                image_bytes=req.image_bytes,
            )
            timings["upsample_s"] = ups.seconds
            control_videos = None
            loop = asyncio.get_running_loop()
            if req.control_bytes is not None:
                import control

                t_ctrl = time.monotonic()
                control_videos = await loop.run_in_executor(
                    None,
                    lambda: control.control_videos_for(
                        req.control_bytes, req.mode, num_frames=req.num_frames, width=req.width, height=req.height
                    ),
                )
                timings["control_s"] = round(time.monotonic() - t_ctrl, 2)

            total = req.preset.steps
            _step_state.update(step=0, total=total, started=time.monotonic(), phase=None)
            await _update(
                task_id,
                status="generating",
                upsampler=ups.upsampler,
                upsampler_error=ups.error,
                step=0,
                total_steps=total,
                progress=0.0,
            )
            pump = asyncio.create_task(_progress_pump(task_id, total))
            with tempfile.TemporaryDirectory() as tmp:
                out_path = Path(tmp) / f"{task_id}.mp4"
                try:
                    gen = await asyncio.wait_for(
                        loop.run_in_executor(None, _generate, req, ups.prompt, control_videos, out_path),
                        timeout=JOB_TIMEOUT_SECS,
                    )
                finally:
                    pump.cancel()
                timings.update(gen)
                size = await loop.run_in_executor(None, _write_video, task_id, out_path)
            timings["total_s"] = round(time.monotonic() - started, 2)
            await _update(
                task_id,
                status="done",
                progress=1.0,
                step=total,
                eta_seconds=0,
                bytes=size,
                timings=timings,
                finished_at=time.time(),
                live=False,
            )
            log.info("[%s] done mode=%s %s", task_id, req.mode, timings)
    except asyncio.TimeoutError:
        await _update(
            task_id,
            status="failed",
            error_code="timeout",
            error="generation ran past its time limit; try again with a shorter prompt or at 480p",
            timings=timings,
            live=False,
        )
    except Exception as exc:  # noqa: BLE001 - every failure lands on the record
        code, message = classify_failure(exc)
        await _update(task_id, status="failed", error_code=code, error=message, timings=timings, live=False)
    finally:
        beat.cancel()
        if task_id in _queue:
            _queue.remove(task_id)
        _task_locks.pop(task_id, None)


def classify_failure(exc: BaseException) -> tuple[str, str]:
    """Map an exception to (error_code, caller-safe message)."""
    try:
        import control

        if isinstance(exc, control.ControlError):
            return "bad_control_video", str(exc)
    except ImportError:
        pass
    text = f"{type(exc).__name__}: {exc}"
    if "out of memory" in text.lower():
        return "gpu_oom", "the GPU ran out of memory on this request; try 480p or fewer frames"
    if isinstance(exc, (OSError, ValueError)) and "image" in text.lower():
        return "bad_image", "the scene still could not be read; capture it again"
    return "generation_failed", safe_error(exc, context="generation")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.post("/infer", status_code=202)
async def infer(request: Request, authorization: Optional[str] = Header(None)) -> dict:
    _auth(authorization)
    if _load_error:
        raise HTTPException(status_code=503, detail=f"model unavailable: {_load_error}")
    if len(_queue) >= MAX_QUEUE:
        raise HTTPException(status_code=429, detail=f"{len(_queue)} worlds are already queued; try again shortly")
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="body must be JSON") from exc
    try:
        req = parse_request(body, default_resolution=DEFAULT_RESOLUTION)
    except RequestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    task_id = uuid.uuid4().hex
    position = len(_queue) + (1 if _gpu_lock.locked() else 0)
    _queue.append(task_id)
    await _update(
        task_id,
        status="queued",
        model=MODEL_ID,
        mode=req.mode,
        resolution=req.resolution,
        num_frames=req.num_frames,
        fps=req.fps,
        seed=req.seed,
        queue_position=position,
        created_at=time.time(),
        live=True,
    )
    asyncio.create_task(_run(task_id, req))
    return {"task_id": task_id, "status": "queued", "queue_position": position, "model": MODEL_ID}


@app.get("/tasks/{task_id}")
async def get_task(task_id: str, authorization: Optional[str] = Header(None)) -> dict:
    _auth(authorization)
    if not task_id.isalnum() or len(task_id) > 64:
        raise HTTPException(status_code=404, detail="task not found")
    task = dict(await _resolve(task_id))
    if task.get("status") == "queued" and task_id in _queue:
        task["queue_position"] = _queue.index(task_id) + (1 if _gpu_lock.locked() else 0)
    task.pop("live", None)
    return task


@app.get("/tasks/{task_id}/video")
async def get_video(task_id: str, authorization: Optional[str] = Header(None)):
    _auth(authorization)
    if not task_id.isalnum() or len(task_id) > 64:
        raise HTTPException(status_code=404, detail="video not found")
    data = await asyncio.get_running_loop().run_in_executor(None, _read_video, task_id)
    if data is None:
        raise HTTPException(status_code=404, detail="video not found")
    return StreamingResponse(
        iter([data]),
        media_type="video/mp4",
        headers={"Content-Length": str(len(data)), "Cache-Control": "private, max-age=3600"},
    )


@app.get("/")
async def root() -> dict:
    return {
        "service": "model-cosmos",
        "model": MODEL_ID,
        "ready": bool(_ready and _ready.is_set()),
        "endpoints": ["POST /infer", "GET /tasks/{id}", "GET /tasks/{id}/video", "GET /health"],
    }


@app.get("/health")
async def health(response: Response) -> dict:
    if _load_error:
        response.status_code = 503
    return {
        "ok": _load_error is None,
        "model": MODEL_ID,
        "revision": _revision,
        "ready": bool(_ready and _ready.is_set()),
        "load_error": _load_error,
        "load_attempts": _load_attempts,
        "load_seconds": _load_seconds,
        "gpu_name": _gpu_name,
        "modes": list(gc_cfg.MODES),
        "resolutions": list(gc_cfg.RESOLUTIONS),
        "default_resolution": DEFAULT_RESOLUTION,
        "frames": {"min": gc_cfg.MIN_FRAMES, "max": gc_cfg.MAX_FRAMES, "default": gc_cfg.DEFAULT_FRAMES},
        "upsampler": {"configured": _upsampler.configured, "models": list(_upsampler.models)},
        "guardrail": False,
        "queue_depth": len(_queue),
        "busy": bool(_gpu_lock and _gpu_lock.locked()),
        "storage": "gcs" if _bucket is not None else "local",
    }
