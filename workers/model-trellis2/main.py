"""
TRELLIS.2 inference service: single image to a PBR-textured 3D asset (Microsoft,
MIT license; 4B flow transformer over O-Voxel structured latents).

API contract (consumed by the Forge router, same shape as workers/model-trellis):
  POST /infer   { images: [data-uri|url, ...], resolution?: 512|1024|1536,
                  tier?: str, seed?: int, texture_size?: int,
                  decimation_target?: int, body_type?: str, job_id?: str }
             ->  202 { task_id, status: "queued" }

  TRELLIS.2 conditions on ONE image. When several are sent the first is used and
  the task record reports views_used: 1.

  resolution picks the O-Voxel grid (512 | 1024 | 1536). tier (draft | standard |
  high | max) is accepted for lane parity and maps to a resolution when none is
  sent. The default is 1024. A request the GPU cannot hold is retried one size
  down, and the task record reports resolution_served so the step-down is visible.

  GET  /tasks/:id -> { task_id, status, result_gcs_url?, result_url?, resolution?,
                       resolution_served?, alpha_mode?, packed?, error? }

  GET  /results/:id.glb -> generated GLB when OUTPUT_DIR local storage is active

  GET  /health    -> { ok, model, gpu_available, resolutions, load_error,
                       load_attempts }. 503 with ok:false once the model load has
                       spent its retry budget, so a dead instance is drained.

  GET  /          -> { service, model, ready, endpoints }. Unauthenticated
                     descriptor for the platform's warmth probe.

Weights: gs://three-ws-model-weights/trellis2-4b (workers/model-trellis2/stage_weights.sh).

Environment variables (README.md carries the full table):
  API_KEY               shared bearer secret
  GCS_BUCKET            optional Cloud Storage bucket for output meshes
  OUTPUT_DIR            local task and result volume when GCS_BUCKET is unset
  WEIGHTS_DIR           local weight tree (default: /weights/trellis2-4b)
  WEIGHTS_GCS_URI       optional gs:// tree; each sub-model streams to local disk,
                        loads, and is deleted, so peak disk is one checkpoint
  WEIGHTS_LOCAL_DIR     scratch for that streaming (default: /tmp/trellis2-weights)
  MAX_RESOLUTION        ceiling on the served resolution (default: 1536)
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
import shutil
import signal
import time
import uuid

import httpx

# TRELLIS.2 reads its attention and sparse-conv backends from the environment at
# import time. The Dockerfile sets these as ENV; default them here too so a bare
# env still loads. xformers avoids the flash-attn source compile, and the
# expandable-segments allocator lowers fragmentation across the cascade stages.
os.environ.setdefault("ATTN_BACKEND", "xformers")
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

import torch
from fastapi import FastAPI, HTTPException, Header, BackgroundTasks, Response
from fastapi.responses import FileResponse
from google.api_core.exceptions import NotFound
from google.cloud import storage
from PIL import Image
from pydantic import BaseModel, Field

import glb_pack
import pipeline_config
from request_policy import (
    DEFAULT_RESOLUTION,
    FETCH_ATTEMPTS,
    PIPELINE_TYPES,
    RESOLUTIONS,
    bake_params,
    call_with_retry,
    clamp_to_ceiling,
    resolve_resolution,
    step_down,
)
from worker_security import (
    UnsafeUrlError,
    fetch_remote_bytes,
    require_api_key,
    safe_error,
)
from storage_backend import LocalStorage
from instance_health import (
    HEARTBEAT_SECS,
    MemorySample,
    read_memory,
    should_recycle,
    task_is_orphaned,
    trim_heap,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("trellis2")

API_KEY = os.environ["API_KEY"]
GCS_BUCKET = os.environ.get("GCS_BUCKET", "").strip()
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/output")
WEIGHTS_DIR = os.environ.get("WEIGHTS_DIR", "/weights/trellis2-4b")
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "1"))
MAX_RESOLUTION = int(os.environ.get("MAX_RESOLUTION", str(max(RESOLUTIONS))))
# The 15 GiB checkpoint tree does not fit Cloud Run's in-memory filesystem next
# to a 32 GiB job budget, and the Cloud Storage FUSE mount stalls on the random
# reads safetensors makes ("stalled read-req cancelled"). So with WEIGHTS_GCS_URI
# set, each sub-model streams to local disk with plain sequential GETs, loads,
# and is deleted before the next one starts. Unset (an NGC container with the
# tree on a mounted volume), the pipeline loads straight from WEIGHTS_DIR.
WEIGHTS_GCS_URI = os.environ.get("WEIGHTS_GCS_URI", "").rstrip("/")
WEIGHTS_LOCAL_DIR = os.environ.get("WEIGHTS_LOCAL_DIR", "/tmp/trellis2-weights")
CONFIG_DIR = os.path.join(WEIGHTS_LOCAL_DIR, "config")
AUX_DIR = os.path.join(WEIGHTS_LOCAL_DIR, "aux")
MODEL_LOAD_ATTEMPTS = int(os.environ.get("MODEL_LOAD_ATTEMPTS", "4"))
MODEL_LOAD_RETRY_BASE_S = float(os.environ.get("MODEL_LOAD_RETRY_BASE_S", "15"))
MODEL_LOAD_RETRY_CAP_S = float(os.environ.get("MODEL_LOAD_RETRY_CAP_S", "120"))

_pipeline = None
_bucket: Optional[storage.Bucket] = None
_local_storage: Optional[LocalStorage] = None
_sem: Optional[asyncio.Semaphore] = None
_ready: Optional[asyncio.Event] = None
_load_error: Optional[str] = None
_load_attempts = 0
# In-memory cache only: Cloud Run runs this service across several containers
# with no session affinity, so the durable source of truth is the
# `tasks/{task_id}.json` blob in GCS (see _update_task / _resolve_task).
_tasks: dict[str, dict] = {}
# One lock per task serializes its durable writes (heartbeat vs status writes).
_task_locks: dict[str, asyncio.Lock] = {}
# Tasks this instance has accepted and not yet finished.
_live_tasks: set[str] = set()
_memory_baseline: Optional[MemorySample] = None
_draining = False
_restart_signalled = False


def _gcs_split(uri: str) -> tuple[str, str]:
    bucket_name, _, prefix = uri[len("gs://"):].partition("/")
    return bucket_name, prefix.strip("/")


def _download_blob(blob, dest: str) -> None:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and blob.size is not None and os.path.getsize(dest) == blob.size:
        return
    blob.download_to_filename(dest)


def _stage_aux_weights(client: storage.Client, bucket_name: str, prefix: str) -> None:
    """Copy the DINOv3 conditioner and BiRefNet matte (about 1.7 GB) to local disk.

    They stay resident for the instance's life (the pipeline reloads them to the
    GPU per job under low_vram), unlike the 4B checkpoints, which stream through.
    """
    from concurrent.futures import ThreadPoolExecutor

    wanted = [
        b
        for sub in (pipeline_config.DINOV3_DIR, pipeline_config.BIREFNET_DIR)
        for b in client.list_blobs(bucket_name, prefix=f"{prefix}/{sub}/")
        if not b.name.endswith("/")
    ]
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda b: _download_blob(b, os.path.join(AUX_DIR, b.name[len(prefix) + 1:])), wanted))
    log.info("aux weights staged to %s in %.1fs (%d objects)", AUX_DIR, time.time() - t0, len(wanted))


def _install_streaming_loader(client: storage.Client, bucket_name: str, prefix: str) -> None:
    """Make TRELLIS.2's per-model loader stream each checkpoint from GCS.

    Pipeline.from_pretrained resolves every model as `<CONFIG_DIR>/<name>` and
    hands that to trellis2.models.from_pretrained. The wrapper fetches
    `<name>.json` and `<name>.safetensors` from the weights prefix, loads them,
    and removes them, so disk and RAM never hold more than one checkpoint.
    """
    import trellis2.models as t2_models

    original = t2_models.from_pretrained
    bucket = client.bucket(bucket_name)

    def streaming(path: str, **kwargs):
        if not path.startswith(CONFIG_DIR + "/"):
            return original(path, **kwargs)
        name = path[len(CONFIG_DIR) + 1:]
        scratch = os.path.join(WEIGHTS_LOCAL_DIR, "stream")
        local = os.path.join(scratch, name)
        os.makedirs(os.path.dirname(local), exist_ok=True)
        try:
            for ext in (".json", ".safetensors"):
                blob = bucket.get_blob(f"{prefix}/{name}{ext}")
                if blob is None:
                    raise FileNotFoundError(f"gs://{bucket_name}/{prefix}/{name}{ext} is not staged")
                blob.download_to_filename(local + ext)
            return original(local, **kwargs)
        finally:
            shutil.rmtree(scratch, ignore_errors=True)

    t2_models.from_pretrained = streaming


def _prepare_pipeline_path() -> str:
    """Return the config directory TRELLIS.2 loads from, staging what it needs."""
    if WEIGHTS_GCS_URI.startswith("gs://"):
        client = storage.Client()
        bucket_name, prefix = _gcs_split(WEIGHTS_GCS_URI)
        names = [
            b.name[len(prefix) + 1:]
            for b in client.list_blobs(bucket_name, prefix=prefix + "/")
            if not b.name.endswith("/")
        ]
        missing = pipeline_config.missing_weights(names)
        if missing:
            raise FileNotFoundError(
                f"TRELLIS.2 weights incomplete at {WEIGHTS_GCS_URI}: {', '.join(missing)}"
            )
        _stage_aux_weights(client, bucket_name, prefix)
        pipeline_json = client.bucket(bucket_name).blob(f"{prefix}/pipeline.json").download_as_text()
        pipeline_config.write_local_config(pipeline_json, AUX_DIR, CONFIG_DIR)
        _install_streaming_loader(client, bucket_name, prefix)
        return CONFIG_DIR

    root = Path(WEIGHTS_DIR)
    present = [str(p.relative_to(root)) for p in root.rglob("*") if p.is_file() or p.is_symlink()]
    missing = pipeline_config.missing_weights(present)
    if missing:
        raise FileNotFoundError(f"TRELLIS.2 weights incomplete at {root}: {', '.join(missing)}")
    pipeline_config.write_local_config((root / "pipeline.json").read_text(), root, CONFIG_DIR)
    pipeline_config.link_weight_tree(root, CONFIG_DIR)
    return CONFIG_DIR


def _load_pipeline():
    global _pipeline, _memory_baseline
    from trellis2.pipelines import Trellis2ImageTo3DPipeline

    path = _prepare_pipeline_path()
    log.info("Loading TRELLIS.2 pipeline from %s", path)
    _pipeline = Trellis2ImageTo3DPipeline.from_pretrained(path)
    _pipeline.cuda()
    log.info("TRELLIS.2 pipeline loaded")
    shutil.rmtree(os.path.join(WEIGHTS_LOCAL_DIR, "stream"), ignore_errors=True)
    trim_heap()
    _memory_baseline = read_memory()
    if _memory_baseline is not None:
        log.info("memory after load: %s", _memory_baseline.describe())


async def _load_pipeline_bg():
    """Load the pipeline off the request path and signal readiness when done.

    Runs the blocking, GPU-bound load in a worker thread so the event loop (and
    the HTTP port) stay live.

    The load is RETRIED with exponential backoff, and _load_error stays unset
    while attempts remain, so a job that arrives mid-retry waits on _ready
    instead of failing against a half-written verdict. Latching the very first
    exception is what turned a single transient 403 into a 12-hour outage on
    2026-09-02: the error was cached in memory, every later task failed against
    it instantly, and minScale=1 kept that dead instance resident and in
    rotation. Only once the whole budget is spent does the error latch, and from
    there /health answers 503 and /infer refuses new work, so the instance is
    reported down and the caller fails over instead of queueing behind a corpse.
    """
    global _load_error, _load_attempts
    loop = asyncio.get_event_loop()
    attempts = max(1, MODEL_LOAD_ATTEMPTS)
    for attempt in range(1, attempts + 1):
        _load_attempts = attempt
        try:
            await loop.run_in_executor(None, _load_pipeline)
            _load_error = None
            _ready.set()
            log.info("TRELLIS.2 pipeline ready (attempt %d)", attempt)
            return
        except Exception as exc:  # noqa: BLE001 - surfaced via /health + task status
            if attempt >= attempts:
                _load_error = safe_error(exc, context="model load")
                log.error("TRELLIS.2 pipeline load FAILED after %d attempt(s): %s", attempt, exc)
                return
            delay = min(MODEL_LOAD_RETRY_BASE_S * (2 ** (attempt - 1)), MODEL_LOAD_RETRY_CAP_S)
            log.warning(
                "TRELLIS.2 pipeline load attempt %d/%d failed (%s); retrying in %.0fs",
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
    # Load the pipeline in the BACKGROUND and yield immediately. uvicorn runs the
    # ASGI lifespan BEFORE it binds the socket, so a blocking load here would
    # outlast Cloud Run's startup TCP-probe window on a cold instance and the
    # revision would be marked failed. Requests that arrive before the load
    # completes wait on _ready (see _run_job).
    asyncio.create_task(_load_pipeline_bg())
    log.info("Service starting, pipeline loading in background (max_concurrent=%d)", MAX_CONCURRENT)
    yield


app = FastAPI(title="model-trellis2", lifespan=lifespan)


def _require_api_key(authorization: str) -> None:
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


class ImageSourceError(ValueError):
    """A caller-supplied image could not be read.

    Distinct from an internal failure: the cause is the request's own `images`
    entry (unreachable host, rejected target, undecodable bytes), so the message
    is safe and useful to hand back verbatim instead of an opaque error ref.
    """


IMAGE_FETCH_TIMEOUT_S = float(os.environ.get("IMAGE_FETCH_TIMEOUT_S", "30"))


def _source_label(src: str) -> str:
    """Short, non-leaking identifier for an image source, for error messages."""
    if src.startswith("data:image"):
        return "inline data uri"
    host = urlsplit(src).hostname
    return host or src[:60]


def _fetch_image_bytes(src: str) -> bytes:
    """Fetch one https image source, retrying transient network failures.

    A single read timeout against a public image host used to fail the entire
    generation (observed live 2026-08-10). The fetch itself stays SSRF-hardened:
    https-only, private/loopback/link-local/metadata IPs rejected after DNS
    resolution, redirects re-validated per hop, response size bounded.
    """
    label = _source_label(src)

    def attempt() -> bytes:
        return fetch_remote_bytes(src, timeout=IMAGE_FETCH_TIMEOUT_S)

    def note_retry(number: int, delay: float, exc: BaseException) -> None:
        log.warning(
            "image fetch attempt %d/%d for %s failed (%s); retrying in %.1fs",
            number, FETCH_ATTEMPTS, label, type(exc).__name__, delay,
        )

    try:
        return call_with_retry(attempt, sleep=time.sleep, on_retry=note_retry)
    except UnsafeUrlError as exc:
        raise ImageSourceError(f"refused to fetch image source ({label}): {exc}") from exc
    except httpx.HTTPStatusError as exc:
        raise ImageSourceError(
            f"image source {label} returned HTTP {exc.response.status_code}"
        ) from exc
    except httpx.HTTPError as exc:
        raise ImageSourceError(
            f"image source {label} unreachable after {FETCH_ATTEMPTS} attempts "
            f"({type(exc).__name__}); check the URL is publicly readable"
        ) from exc
    except ValueError as exc:
        # The guard's own size ceiling. Caught after UnsafeUrlError (a ValueError
        # subclass) so the more specific message wins.
        raise ImageSourceError(f"image source {label} rejected: {exc}") from exc


def _decode_image(src: str) -> Image.Image:
    # RGBA is preserved: TRELLIS.2 uses a supplied alpha channel as the subject
    # mask and only runs its own background removal for opaque input.
    mode = "RGBA"
    if src.startswith("data:image"):
        b64 = src.split(",", 1)[1]
        try:
            raw = base64.b64decode(b64)
        except Exception as exc:  # noqa: BLE001 - caller's own payload, report it as such
            raise ImageSourceError(f"inline data uri is not valid base64: {exc}") from exc
        return _open_image(raw, mode, "inline data uri")
    if src.startswith("https://"):
        return _open_image(_fetch_image_bytes(src), mode, _source_label(src))
    raise ImageSourceError(f"unsupported image source: {src[:60]}")


def _open_image(data: bytes, mode: str, label: str) -> Image.Image:
    try:
        return Image.open(io.BytesIO(data)).convert(mode)
    except Exception as exc:  # noqa: BLE001 - undecodable caller input, not an internal fault
        raise ImageSourceError(
            f"image source {label} is not a decodable image ({type(exc).__name__})"
        ) from exc


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
    """Merge `fields` into the task, then persist to GCS as the source of truth
    (see the comment on `_tasks`). Called with no fields it is a heartbeat: it
    only refreshes updated_at, which is what proves the runner is alive."""
    lock = _task_locks.setdefault(task_id, asyncio.Lock())
    async with lock:
        task = _tasks.setdefault(task_id, {"task_id": task_id})
        task.update(fields)
        task["updated_at"] = time.time()
        # Snapshot inside the lock: the upload runs later on an executor thread,
        # and serializing the live dict there could capture a newer state than
        # the one this write is ordered as.
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


async def _heartbeat(task_id: str) -> None:
    """Refresh a live task's durable record until cancelled.

    The poll side (_resolve_task) declares a queued/running record orphaned once
    it stops moving, so this beat is the runner's proof of life. A failed beat
    is logged and retried on the next tick; it never touches the job itself.
    """
    while True:
        await asyncio.sleep(HEARTBEAT_SECS)
        try:
            await _update_task(task_id)
        except Exception as exc:  # noqa: BLE001 - a missed beat must not kill the job
            log.warning("[%s] heartbeat write failed: %s", task_id, exc)


# A live runner refreshes its record every HEARTBEAT_SECS (see _heartbeat), so a
# queued/running record that stops moving belongs to an instance that died
# mid-job (an OOM kill, a crash, a scale-in) and nothing resumes persisted tasks.
# instance_health.ORPHAN_AFTER_SECS bounds that silence; expiring the record
# turns an endless client poll into a designed failure the router's poll-time
# failover can redispatch while the client is still polling.
_TERMINAL_STATUSES = frozenset({"done", "failed"})


async def _resolve_task(task_id: str) -> dict:
    """Shared poll reader. The instance-local cache is only trusted for
    terminal records: caching a queued/running record would freeze that
    status on this instance forever while the runner instance advances the
    durable GCS record (polls have no session affinity). Non-terminal records
    are always re-read from GCS and expired once orphaned."""
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
            # Local-only record (the initial persist raced or failed), serve
            # the in-memory view rather than 404ing a task we know exists.
            return task
        raise HTTPException(status_code=404, detail="task not found")
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=safe_error(exc, context="task lookup")
        ) from exc
    status = task.get("status")
    if status in _TERMINAL_STATUSES:
        _tasks[task_id] = task
        return task
    if task_is_orphaned(status, task.get("updated_at"), time.time()):
        # Adopt the durable copy so the failure write keeps its fields rather
        # than whatever partial view this instance had cached.
        _tasks[task_id] = task
        failed = await _update_task(
            task_id,
            status="failed",
            error="task orphaned: its runner instance stopped mid-job "
            "(restart or out of memory); retry the request",
        )
        _task_locks.pop(task_id, None)
        return failed
    return task


async def _run_inference(task_id: str, *args, **kwargs) -> None:
    """Run one accepted job with a heartbeat on its record, then decide whether
    this instance should restart before it takes the next one."""
    _live_tasks.add(task_id)
    beat = asyncio.create_task(_heartbeat(task_id))
    try:
        await _run_job(task_id, *args, **kwargs)
    finally:
        beat.cancel()
        _live_tasks.discard(task_id)
        _task_locks.pop(task_id, None)
        _recycle_if_bloated(task_id)


def _recycle_if_bloated(task_id: str) -> None:
    """Restart an idle instance whose memory has ratcheted toward its ceiling.

    Even with the heap trimmed after every job, the native libraries in the
    postprocess (xatlas, nvdiffrast, open3d) keep some of what they allocate,
    and this instance can only ever have 32 GiB. Letting it run until a job
    tips it over is what used to happen: the OOM kill took that job and the one
    queued behind it. Restarting while idle costs one model load instead.

    Once it decides, the instance drains: /infer refuses new work with a 503 so
    the caller fails over, jobs already queued here still run, and the restart
    happens when the last of them finishes. Runs on the event loop with no
    await, so nothing can be accepted between the idle check and the signal.
    uvicorn shuts down cleanly on SIGTERM, and Cloud Run starts a fresh instance
    in its place to hold the warm minimum.
    """
    global _draining, _restart_signalled
    sample = read_memory()
    if sample is not None:
        log.info("[%s] memory after job: %s", task_id, sample.describe())
    if not _draining:
        if not should_recycle(sample, _memory_baseline):
            return
        _draining = True
        log.warning(
            "recycling instance: memory %s, up from %s after load; draining %d queued job(s) first",
            sample.describe(),
            _memory_baseline.describe() if _memory_baseline else "unknown",
            len(_live_tasks),
        )
    if _live_tasks or _restart_signalled:
        return
    _restart_signalled = True
    log.warning("recycling instance: idle, restarting now")
    signal.raise_signal(signal.SIGTERM)



async def _run_job(
    task_id: str,
    images: list[str],
    resolution: int | None = None,
    tier: str | None = None,
    seed: int | None = None,
    texture_size: int | None = None,
    decimation_target: int | None = None,
) -> None:
    # Wait for the background pipeline load before touching the GPU. Warm
    # instances pass instantly; a cold one waits out the load rather than
    # NoneType-crashing. A failed load surfaces as a designed task error.
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

    requested = clamp_to_ceiling(resolve_resolution(resolution, tier), MAX_RESOLUTION)

    async with _sem:
        await _update_task(task_id, status="running", resolution=requested)
        loop = asyncio.get_event_loop()
        t0 = time.time()
        try:
            # TRELLIS.2 conditions on one image; the first is the subject.
            image = await loop.run_in_executor(None, _decode_image, images[0])

            served = requested
            while True:
                try:
                    result = await loop.run_in_executor(
                        None, _generate, image, served, seed, texture_size, decimation_target
                    )
                    break
                except torch.cuda.OutOfMemoryError:
                    # The GPU class cannot hold this grid. Hand the memory back
                    # and retry one size down rather than failing the job: a
                    # 1024 asset beats an error.
                    await loop.run_in_executor(None, _release_gpu_memory)
                    smaller = step_down(served)
                    if smaller is None:
                        raise
                    log.warning("[%s] out of GPU memory at %d; retrying at %d", task_id, served, smaller)
                    served = smaller
            glb_bytes, alpha_mode, packed = result

            if _using_gcs():
                blob_name = f"raw-meshes/trellis2/{task_id}.glb"
                blob = _bucket.blob(blob_name)
                await loop.run_in_executor(
                    None,
                    lambda: blob.upload_from_string(glb_bytes, content_type="model/gltf-binary"),
                )
                result_fields = {
                    "result_gcs_url": f"https://storage.googleapis.com/{GCS_BUCKET}/{blob_name}"
                }
                result_label = result_fields["result_gcs_url"]
            else:
                result_path = await loop.run_in_executor(
                    None, _get_local_storage().write_result, task_id, glb_bytes
                )
                result_fields = {
                    "result_url": f"/results/{task_id}.glb",
                    "result_path": str(result_path),
                }
                result_label = str(result_path)

            elapsed = time.time() - t0
            await _update_task(
                task_id,
                status="done",
                **result_fields,
                views_used=1,
                resolution=requested,
                resolution_served=served,
                alpha_mode=alpha_mode,
                packed=packed,
                bytes=len(glb_bytes),
                elapsed_ms=int(elapsed * 1000),
            )
            log.info(
                "[%s] done in %.1fs (resolution=%d served=%d alpha=%s packed=%s) %d bytes -> %s",
                task_id, elapsed, requested, served, alpha_mode, packed, len(glb_bytes), result_label,
            )

        except ImageSourceError as exc:
            # The request's own `images` entry is at fault, so hand the reason
            # back verbatim: an opaque error ref would tell the caller nothing
            # and leaves the router retrying a URL that can never work.
            log.warning("[%s] image source rejected: %s", task_id, exc)
            await _update_task(
                task_id,
                status="failed",
                error=str(exc),
                elapsed_ms=int((time.time() - t0) * 1000),
            )
        except Exception as exc:
            await _update_task(
                task_id,
                status="failed",
                error=safe_error(exc, context=f"[{task_id}] inference"),
                elapsed_ms=int((time.time() - t0) * 1000),
            )
        finally:
            # Hand this job's GPU memory back before releasing the semaphore so
            # the next inference starts against a drained device. Torch's caching
            # allocator and the native bake libraries hold freed blocks in
            # reserve, so without this an instance's usable VRAM only shrinks
            # until every later job fails out of memory while health still passes
            # (the failure that took the v1 TRELLIS lane down on 2026-09-09).
            await loop.run_in_executor(None, _release_gpu_memory)


def _generate(
    image: Image.Image,
    resolution: int,
    seed: int | None,
    texture_size: int | None,
    decimation_target: int | None,
) -> tuple[bytes, str, bool]:
    """One synchronous generation: sample, bake to a PBR GLB, keep alpha, pack."""
    import o_voxel

    outputs = _pipeline.run(
        image,
        seed=seed if seed is not None else 42,
        pipeline_type=PIPELINE_TYPES[resolution],
        preprocess_image=True,
    )
    mesh = outputs[0]
    mesh.simplify(16777216)  # nvdiffrast's face limit
    bake = bake_params(resolution, texture_size, decimation_target)
    glb = o_voxel.postprocess.to_glb(
        vertices=mesh.vertices,
        faces=mesh.faces,
        attr_volume=mesh.attrs,
        coords=mesh.coords,
        attr_layout=mesh.layout,
        voxel_size=mesh.voxel_size,
        aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
        decimation_target=bake["decimation_target"],
        texture_size=bake["texture_size"],
        remesh=True,
        remesh_band=1,
        remesh_project=0,
        verbose=False,
    )
    alpha_mode = glb_pack.blend_if_translucent(glb)
    raw = glb.export(file_type="glb", extension_webp=True)
    packed_bytes, packed = glb_pack.compress(raw)
    return packed_bytes, alpha_mode, packed


def _release_gpu_memory() -> None:
    """Return a finished job's GPU allocations to the driver.

    Blocking, so callers run it in the executor. Safe on CPU-only hosts (the unit
    tests import this module without a GPU) because every CUDA call is gated on
    availability.
    """
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()
    # The host side leaks the same way: each executor thread's glibc arena keeps
    # the job's freed heap. Hand it back to the kernel (see instance_health).
    trim_heap()


class InferRequest(BaseModel):
    images: list[str] = Field(..., min_length=1, max_length=6)
    body_type: str = "neutral"
    job_id: str | None = None
    # O-Voxel grid: 512 | 1024 | 1536. Omitted, the tier (or the 1024 default) decides.
    resolution: int | None = None
    # draft | standard | high | max, accepted for lane parity with the other
    # image-to-3D workers. Maps to a resolution when none is sent.
    tier: str | None = None
    seed: int | None = None
    # Optional bake overrides, clamped (power-of-two texture, bounded face budget).
    texture_size: int | None = None
    decimation_target: int | None = None


@app.post("/infer", status_code=202)
async def infer(
    body: InferRequest,
    background_tasks: BackgroundTasks,
    authorization: str = Header(...),
) -> dict:
    _require_api_key(authorization)
    # A latched load failure means this instance can never serve this job, so
    # refuse it at submit time. 503 is what the caller's lane failover reads
    # (api/forge.js isUpstreamUnavailable -> markLaneUnhealthy), which routes the
    # request to another backend instead of accepting a job that can only fail.
    if _load_error:
        raise HTTPException(status_code=503, detail=f"pipeline unavailable: {_load_error}")
    if _draining:
        raise HTTPException(
            status_code=503,
            detail="instance restarting to reclaim memory; retry shortly",
        )
    task_id = str(uuid.uuid4())
    # Persist the "queued" record before responding: a poll can reach a different
    # instance than this one the moment the 202 lands.
    await _update_task(task_id, status="queued", model="trellis2-4b")
    background_tasks.add_task(
        _run_inference,
        task_id,
        body.images,
        body.resolution,
        body.tier,
        body.seed,
        body.texture_size,
        body.decimation_target,
    )
    return {"task_id": task_id, "status": "queued"}


@app.get("/tasks/{task_id}")
async def get_task(task_id: str, authorization: str = Header(...)) -> dict:
    _require_api_key(authorization)
    return await _resolve_task(task_id)


@app.get("/results/{task_id}.glb")
async def get_result(task_id: str, authorization: str = Header(...)):
    """Download a generated GLB from the mounted local output volume."""
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
    """Service descriptor, and the answer to the platform's warmth ping.

    api/cron/gpu-keepwarm.js holds a scale-to-zero lane resident with an
    authenticated GET against the worker root and treats any status below 500 as
    "the container is up". Answering 200 keeps the log honest; routing itself
    reads /health, which carries the load state this cannot.
    """
    return {
        "service": "model-trellis2",
        "model": "trellis2-4b",
        "ready": bool(_ready and _ready.is_set()),
        "endpoints": [
            "POST /infer",
            "GET /tasks/{task_id}",
            "GET /results/{task_id}.glb",
            "GET /health",
        ],
    }


@app.get("/health")
async def health(response: Response) -> dict:
    """Readiness, answered honestly.

    A spent load budget answers 503: the platform health probe reads that as down
    (api/_lib/forge-health.js), and a Cloud Run liveness probe pointed here
    recycles the container. A load still in progress stays 200 so an ordinary
    cold start is never killed mid-load.
    """
    dead = _load_error is not None
    if dead:
        response.status_code = 503
    return {
        "ok": not dead,
        "model": "trellis2-4b",
        "gpu_available": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "pipeline_loaded": _pipeline is not None,
        "ready": bool(_ready and _ready.is_set()),
        "load_error": _load_error,
        "load_attempts": _load_attempts,
        "draining": _draining,
        "resolutions": [r for r in RESOLUTIONS if r <= MAX_RESOLUTION],
        "default_resolution": DEFAULT_RESOLUTION,
        "output_backend": "gcs" if _using_gcs() else "local",
        "output_dir": None if _using_gcs() else str(_get_local_storage().output_dir),
    }
