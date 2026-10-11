"""
Modly worker: Modly's local image-to-3D backend, run headless on a Cloud Run GPU
behind the same authenticated task contract as every other three.ws model worker.

Based on Modly (https://github.com/lightningpixel/modly) by Lightning Pixel
(https://github.com/lightningpixel), MIT license. The pinned Modly checkout lives
at /opt/modly and its LICENSE ships in the image at /app/licenses/MODLY-LICENSE.

Shape of the service:

  * Modly's own FastAPI app runs as a child process on 127.0.0.1:MODLY_PORT. It is
    never reachable from outside the container: it has no auth, accepts absolute
    filesystem paths on its optimize routes, and is built for a single desktop
    user. Everything a caller can reach is this front.
  * The front owns auth (worker_security), request policy (request_policy), task
    records in GCS (storage_backend), instance health (instance_health), weight
    staging, Modly supervision, the post-process chain and the upload.
  * Generation runs through Modly's official extensions, pinned by commit in the
    Dockerfile: TripoSG (MIT, VAST AI) and Hunyuan3D 2 Mini Turbo (Tencent
    Hunyuan Community License). Each runs in its own venv as a Modly subprocess.

API contract (consumed by the Forge router, same shape as workers/model-trellis2):
  POST /infer   { images?: [data-uri|url, ...], mesh_url?: data-uri|url,
                  model?: "triposg" | "hunyuan3d-mini-turbo" | <full Modly id>,
                  tier?: draft|standard|high|max, seed?: int, params?: {...},
                  postprocess?: { repair?, decimate?, smooth?, uv_unwrap?, bake? },
                  body_type?: str, job_id?: str }
             ->  202 { task_id, status: "queued", model }

  Exactly one of `images` (image to 3D, first image is the subject) or `mesh_url`
  (post-process an existing mesh; needs at least one postprocess step).

  GET  /tasks/:id -> { task_id, status, model, progress?, step?, result_gcs_url?,
                       result_url?, seed?, params?, postprocess_applied?, packed?,
                       bytes?, elapsed_ms?, error? }
  GET  /results/:id.glb -> generated GLB when OUTPUT_DIR local storage is active
  GET  /health    -> readiness; 503 once bring-up has spent its retry budget
  GET  /          -> unauthenticated descriptor for the platform's warmth probe

Environment variables (README.md carries the full table):
  API_KEY, GCS_BUCKET, OUTPUT_DIR, MAX_CONCURRENT, MODLY_MODELS,
  MODLY_DEFAULT_MODEL, WEIGHTS_GCS_URI, MODELS_DIR, WORKSPACE_DIR,
  EXTENSIONS_DIR, MODLY_API_DIR, MODLY_PORT, MODLY_START_TIMEOUT_S,
  MODLY_WARMUP, GENERATION_TIMEOUT_S, IMAGE_FETCH_TIMEOUT_S,
  MODEL_LOAD_ATTEMPTS, MODEL_LOAD_RETRY_BASE_S, MODEL_LOAD_RETRY_CAP_S
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import random
import shutil
import signal
import subprocess
import sys
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit

import httpx
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Response
from fastapi.responses import FileResponse
from google.api_core.exceptions import NotFound
from google.cloud import storage
from PIL import Image, ImageDraw
from pydantic import BaseModel, Field

import postprocess
from gltf_meshopt import decode_if_meshopt
from instance_health import (
    HEARTBEAT_SECS,
    MemorySample,
    read_memory,
    should_recycle,
    task_is_orphaned,
    trim_heap,
)
from request_policy import (
    FETCH_ATTEMPTS,
    TRIPOSG,
    PolicyError,
    build_generation_params,
    call_with_retry,
    interpret_job,
    parse_model_list,
    parse_postprocess,
    readiness_problems,
    resolve_model,
    workspace_relative,
)
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
log = logging.getLogger("modly")

SERVICE = "model-modly"
LANE = "modly"

API_KEY = os.environ["API_KEY"]
GCS_BUCKET = os.environ.get("GCS_BUCKET", "").strip()
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/output")
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "1"))
ENABLED_MODELS = parse_model_list(
    os.environ.get("MODLY_MODELS", "triposg/generate,hunyuan3d-mini-turbo/generate")
)
DEFAULT_MODEL = resolve_model(os.environ.get("MODLY_DEFAULT_MODEL", TRIPOSG), ENABLED_MODELS, ENABLED_MODELS[0])
# Weights are copied from GCS to local disk at bring-up (no FUSE mount: the
# safetensors loaders make random reads that the FUSE driver stalls on). Each
# enabled model lives at <WEIGHTS_GCS_URI>/<extension>/<node>/, mirroring the
# MODELS_DIR/<extension>/<node>/ layout Modly reads. Unset, MODELS_DIR must
# already hold the trees (a mounted volume, or a local run).
WEIGHTS_GCS_URI = os.environ.get("WEIGHTS_GCS_URI", "").rstrip("/")
MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/tmp/modly-models"))
WORKSPACE_DIR = Path(os.environ.get("WORKSPACE_DIR", "/tmp/modly-workspace"))
EXTENSIONS_DIR = Path(os.environ.get("EXTENSIONS_DIR", "/opt/modly-extensions"))
MODLY_API_DIR = Path(os.environ.get("MODLY_API_DIR", "/opt/modly/api"))
MODLY_PYTHON = os.environ.get("MODLY_PYTHON", sys.executable)
MODLY_PORT = int(os.environ.get("MODLY_PORT", "8765"))
MODLY_URL = f"http://127.0.0.1:{MODLY_PORT}"
MODLY_START_TIMEOUT_S = float(os.environ.get("MODLY_START_TIMEOUT_S", "180"))
# A warm-up generation proves the whole chain (extension venv, CUDA kernels,
# weights, background removal) before the instance reports ready, and leaves the
# default model resident so the first real job does not pay its load.
MODLY_WARMUP = os.environ.get("MODLY_WARMUP", "1") != "0"
GENERATION_TIMEOUT_S = float(os.environ.get("GENERATION_TIMEOUT_S", "600"))
READY_WAIT_S = float(os.environ.get("READY_WAIT_S", "1800"))
IMAGE_FETCH_TIMEOUT_S = float(os.environ.get("IMAGE_FETCH_TIMEOUT_S", "30"))
MODEL_LOAD_ATTEMPTS = int(os.environ.get("MODEL_LOAD_ATTEMPTS", "4"))
MODEL_LOAD_RETRY_BASE_S = float(os.environ.get("MODEL_LOAD_RETRY_BASE_S", "15"))
MODEL_LOAD_RETRY_CAP_S = float(os.environ.get("MODEL_LOAD_RETRY_CAP_S", "120"))
POLL_INTERVAL_S = 2.0
MESH_SUFFIXES = (".glb", ".gltf", ".obj", ".ply", ".stl")
# Environment the front holds that Modly and its extension subprocesses must not
# inherit: Modly copies os.environ into every extension process.
_PRIVATE_ENV = ("API_KEY",)

_bucket: Optional[storage.Bucket] = None
_local_storage: Optional[LocalStorage] = None
_sem: Optional[asyncio.Semaphore] = None
_ready: Optional[asyncio.Event] = None
_bringup_lock: Optional[asyncio.Lock] = None
_modly_proc: Optional[subprocess.Popen] = None
_load_error: Optional[str] = None
_load_attempts = 0
_modly_restarts = 0
_warmup_ms: Optional[int] = None
_gpu_name: Optional[str] = None
_shutting_down = False
# In-memory cache only: Cloud Run runs this service across several containers
# with no session affinity, so the durable source of truth is the
# `tasks/{task_id}.json` blob in GCS (see _update_task / _resolve_task).
_tasks: dict[str, dict] = {}
_task_locks: dict[str, asyncio.Lock] = {}
_live_tasks: set[str] = set()
_memory_baseline: Optional[MemorySample] = None
_draining = False
_restart_signalled = False


class ModlyUnavailable(RuntimeError):
    """The Modly backend stopped answering mid-job (crash, OOM, restart)."""


class ImageSourceError(ValueError):
    """A caller-supplied image or mesh could not be read. Safe to report verbatim."""


# ── Weight staging ────────────────────────────────────────────────────────────

def _gcs_split(uri: str) -> tuple[str, str]:
    bucket_name, _, prefix = uri[len("gs://"):].partition("/")
    return bucket_name, prefix.strip("/")


def _download_blob(blob, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and blob.size is not None and dest.stat().st_size == blob.size:
        return
    partial = dest.with_name(dest.name + ".part")
    blob.download_to_filename(str(partial))
    partial.replace(dest)


def _stage_weights() -> None:
    """Copy every enabled model's weight tree from GCS into MODELS_DIR.

    Files already present at the right size are skipped, so a bring-up retry or a
    Modly restart costs a listing, not a re-download.
    """
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    if not WEIGHTS_GCS_URI:
        log.info("WEIGHTS_GCS_URI unset; serving weights already in %s", MODELS_DIR)
        return
    if not WEIGHTS_GCS_URI.startswith("gs://"):
        raise ValueError(f"WEIGHTS_GCS_URI must be a gs:// URI, got {WEIGHTS_GCS_URI!r}")
    from concurrent.futures import ThreadPoolExecutor

    client = storage.Client()
    bucket_name, prefix = _gcs_split(WEIGHTS_GCS_URI)
    for model in ENABLED_MODELS:
        model_prefix = f"{prefix}/{model}/" if prefix else f"{model}/"
        blobs = [b for b in client.list_blobs(bucket_name, prefix=model_prefix) if not b.name.endswith("/")]
        if not blobs:
            raise FileNotFoundError(
                f"no weights staged at gs://{bucket_name}/{model_prefix}; "
                "run workers/modly/stage_weights.sh"
            )
        dest_root = MODELS_DIR / model
        t0 = time.time()
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda b: _download_blob(b, dest_root / b.name[len(model_prefix):]), blobs))
        total = sum(b.size or 0 for b in blobs)
        log.info(
            "staged %s: %d files, %.2f GB in %.1fs",
            model, len(blobs), total / 1e9, time.time() - t0,
        )


# ── Modly process ─────────────────────────────────────────────────────────────

def _modly_env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in _PRIVATE_ENV}
    env.update(
        {
            "MODELS_DIR": str(MODELS_DIR),
            "WORKSPACE_DIR": str(WORKSPACE_DIR),
            "EXTENSIONS_DIR": str(EXTENSIONS_DIR),
            "MODLY_API_URL": MODLY_URL,
            "SELECTED_MODEL_ID": DEFAULT_MODEL,
            # Weights are staged ahead of time; nothing may reach for the Hub.
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "PYTHONUNBUFFERED": "1",
        }
    )
    return env


def _start_modly() -> subprocess.Popen:
    """Launch Modly's FastAPI app on loopback, in its own process group."""
    global _modly_proc
    _stop_modly()
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    _modly_proc = subprocess.Popen(
        [
            MODLY_PYTHON, "-m", "uvicorn", "main:app",
            "--host", "127.0.0.1",
            "--port", str(MODLY_PORT),
            "--workers", "1",
            "--log-level", "warning",
        ],
        cwd=str(MODLY_API_DIR),
        env=_modly_env(),
        start_new_session=True,
    )
    log.info("Modly started (pid %d) on %s", _modly_proc.pid, MODLY_URL)
    return _modly_proc


def _stop_modly(timeout: float = 20.0) -> None:
    """Stop Modly and every extension subprocess it spawned (one process group)."""
    global _modly_proc
    proc = _modly_proc
    _modly_proc = None
    if proc is None or proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait(timeout=5)
    except ProcessLookupError:
        pass


def _modly_alive() -> bool:
    return _modly_proc is not None and _modly_proc.poll() is None


def _wait_modly_http(timeout: float) -> None:
    """Block until Modly answers /model/all (its registry is initialized by then)."""
    deadline = time.time() + timeout
    last: Optional[BaseException] = None
    with httpx.Client(base_url=MODLY_URL, timeout=10.0) as client:
        while time.time() < deadline:
            if not _modly_alive():
                code = _modly_proc.returncode if _modly_proc is not None else None
                raise RuntimeError(f"Modly exited during start (exit code {code})")
            try:
                if client.get("/model/all").status_code == 200:
                    return
            except httpx.HTTPError as exc:
                last = exc
            time.sleep(1.0)
    raise TimeoutError(f"Modly did not answer within {timeout:.0f}s ({type(last).__name__ if last else 'no response'})")


def _modly_readiness() -> list[str]:
    with httpx.Client(base_url=MODLY_URL, timeout=30.0) as client:
        all_status = client.get("/model/all").raise_for_status().json()
        errors = client.get("/extensions/errors").raise_for_status().json()
    return readiness_problems(ENABLED_MODELS, all_status, errors if isinstance(errors, dict) else {})


def _query_gpu_name() -> Optional[str]:
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=10, check=True,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    name = out.stdout.strip().splitlines()
    return name[0] if name else None


def _warmup_image_png() -> bytes:
    """A lit sphere on a white ground: a subject background removal can isolate."""
    size = 512
    img = Image.new("RGB", (size, size), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    for i in range(160, 0, -4):
        shade = int(60 + (160 - i) * 1.1)
        offset = (160 - i) // 3
        draw.ellipse(
            (256 - i - offset, 256 - i - offset, 256 + i - offset, 256 + i - offset),
            fill=(shade, int(shade * 0.7), int(shade * 0.5)),
        )
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def _warmup(client: httpx.AsyncClient) -> None:
    global _warmup_ms
    t0 = time.time()
    params, _ = build_generation_params(DEFAULT_MODEL, "draft", None, 0)
    collection = f"warmup-{uuid.uuid4().hex[:12]}"
    try:
        job_id = await _submit_generation(client, DEFAULT_MODEL, _warmup_image_png(), params, collection)
        await _await_generation(client, job_id, on_progress=None)
    finally:
        shutil.rmtree(WORKSPACE_DIR / collection, ignore_errors=True)
    _warmup_ms = int((time.time() - t0) * 1000)
    log.info("warm-up generation on %s finished in %.1fs", DEFAULT_MODEL, _warmup_ms / 1000)


async def _bring_up_once() -> None:
    global _memory_baseline, _gpu_name
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _stage_weights)
    await loop.run_in_executor(None, _start_modly)
    await loop.run_in_executor(None, _wait_modly_http, MODLY_START_TIMEOUT_S)
    problems = await loop.run_in_executor(None, _modly_readiness)
    if problems:
        raise RuntimeError("; ".join(problems))
    if _gpu_name is None:
        _gpu_name = await loop.run_in_executor(None, _query_gpu_name)
    if MODLY_WARMUP:
        async with httpx.AsyncClient(base_url=MODLY_URL, timeout=60.0) as client:
            await _warmup(client)
    await loop.run_in_executor(None, trim_heap)
    _memory_baseline = read_memory()
    if _memory_baseline is not None:
        log.info("memory after bring-up: %s", _memory_baseline.describe())


async def _bring_up_bg() -> None:
    """Stage weights, start Modly, prove it can generate, then signal readiness.

    Retried with exponential backoff, and _load_error stays unset while attempts
    remain, so a job that arrives mid-retry waits on _ready instead of failing
    against a half-written verdict (the 2026-09-02 lesson recorded in
    workers/model-trellis2/main.py). Only a spent budget latches the error; from
    there /health answers 503 and /infer refuses new work so callers fail over.
    """
    global _load_error, _load_attempts
    async with _bringup_lock:
        attempts = max(1, MODEL_LOAD_ATTEMPTS)
        for attempt in range(1, attempts + 1):
            _load_attempts = attempt
            try:
                await _bring_up_once()
                _load_error = None
                _ready.set()
                log.info("Modly ready (attempt %d, models %s)", attempt, ", ".join(ENABLED_MODELS))
                return
            except Exception as exc:  # noqa: BLE001 - surfaced via /health + task status
                await asyncio.get_event_loop().run_in_executor(None, _stop_modly)
                if attempt >= attempts:
                    _load_error = safe_error(exc, context="modly bring-up")
                    log.error("Modly bring-up FAILED after %d attempt(s): %s", attempt, exc)
                    return
                delay = min(MODEL_LOAD_RETRY_BASE_S * (2 ** (attempt - 1)), MODEL_LOAD_RETRY_CAP_S)
                log.warning(
                    "Modly bring-up attempt %d/%d failed (%s); retrying in %.0fs",
                    attempt, attempts, exc, delay,
                )
                await asyncio.sleep(delay)


async def _supervise_modly() -> None:
    """Restart Modly if it dies after a successful bring-up.

    A crashed backend with a green /health is the failure this guards against:
    the instance would keep accepting jobs it can only fail. Readiness is cleared
    first so new jobs wait, and the same retry budget governs the restart.
    """
    global _modly_restarts
    while not _shutting_down:
        await asyncio.sleep(5.0)
        if _shutting_down or not _ready.is_set() or _modly_alive():
            continue
        code = _modly_proc.returncode if _modly_proc is not None else None
        log.error("Modly exited unexpectedly (exit code %s); restarting", code)
        _ready.clear()
        _modly_restarts += 1
        await _bring_up_bg()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _bucket, _local_storage, _sem, _ready, _bringup_lock, _shutting_down
    if GCS_BUCKET:
        _bucket = storage.Client().bucket(GCS_BUCKET)
        _local_storage = None
    else:
        _bucket = None
        _local_storage = LocalStorage(OUTPUT_DIR)
    _sem = asyncio.Semaphore(MAX_CONCURRENT)
    _ready = asyncio.Event()
    _bringup_lock = asyncio.Lock()
    # Bring-up runs in the BACKGROUND: uvicorn runs the lifespan before it binds
    # the socket, and staging plus a warm-up generation outlasts Cloud Run's
    # startup probe window. Jobs that arrive early wait on _ready.
    bringup = asyncio.create_task(_bring_up_bg())
    supervisor = asyncio.create_task(_supervise_modly())
    log.info("Service starting, Modly coming up in background (models %s)", ", ".join(ENABLED_MODELS))
    try:
        yield
    finally:
        _shutting_down = True
        supervisor.cancel()
        bringup.cancel()
        await asyncio.get_event_loop().run_in_executor(None, _stop_modly)


app = FastAPI(title="modly", lifespan=lifespan)


def _require_api_key(authorization: str) -> None:
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


# ── Caller input ──────────────────────────────────────────────────────────────

def _source_label(src: str) -> str:
    if src.startswith("data:"):
        return "inline data uri"
    host = urlsplit(src).hostname
    return host or src[:60]


def _fetch_bytes(src: str) -> bytes:
    """Fetch one https source, SSRF-hardened, retrying transient failures."""
    label = _source_label(src)

    def attempt() -> bytes:
        return fetch_remote_bytes(src, timeout=IMAGE_FETCH_TIMEOUT_S)

    def note_retry(number: int, delay: float, exc: BaseException) -> None:
        log.warning(
            "fetch attempt %d/%d for %s failed (%s); retrying in %.1fs",
            number, FETCH_ATTEMPTS, label, type(exc).__name__, delay,
        )

    try:
        return call_with_retry(attempt, sleep=time.sleep, on_retry=note_retry)
    except UnsafeUrlError as exc:
        raise ImageSourceError(f"refused to fetch source ({label}): {exc}") from exc
    except httpx.HTTPStatusError as exc:
        raise ImageSourceError(f"source {label} returned HTTP {exc.response.status_code}") from exc
    except httpx.HTTPError as exc:
        raise ImageSourceError(
            f"source {label} unreachable after {FETCH_ATTEMPTS} attempts "
            f"({type(exc).__name__}); check the URL is publicly readable"
        ) from exc
    except ValueError as exc:
        raise ImageSourceError(f"source {label} rejected: {exc}") from exc


def _read_source(src: str, kind: str) -> bytes:
    if src.startswith("data:"):
        header, _, payload = src.partition(",")
        if ";base64" not in header:
            raise ImageSourceError(f"inline {kind} data uri must be base64")
        try:
            return base64.b64decode(payload, validate=True)
        except Exception as exc:  # noqa: BLE001 - caller's own payload, report it as such
            raise ImageSourceError(f"inline data uri is not valid base64: {exc}") from exc
    if src.startswith("https://"):
        return _fetch_bytes(src)
    raise ImageSourceError(f"unsupported {kind} source: {src[:60]}")


def _decode_image(src: str) -> Image.Image:
    """Caller image to RGBA. Alpha is kept: an existing cutout survives rembg."""
    if not (src.startswith("data:image") or src.startswith("https://")):
        raise ImageSourceError(f"unsupported image source: {src[:60]}")
    data = _read_source(src, "image")
    try:
        return Image.open(io.BytesIO(data)).convert("RGBA")
    except Exception as exc:  # noqa: BLE001 - undecodable caller input
        raise ImageSourceError(
            f"image source {_source_label(src)} is not a decodable image ({type(exc).__name__})"
        ) from exc


def _image_png(src: str) -> bytes:
    buf = io.BytesIO()
    _decode_image(src).save(buf, format="PNG")
    return buf.getvalue()


def _mesh_suffix(src: str) -> str:
    if src.startswith("data:"):
        mime = src[5:].split(";", 1)[0].split(",", 1)[0].lower()
        return {
            "model/gltf+json": ".gltf",
            "model/obj": ".obj",
            "model/stl": ".stl",
            "application/ply": ".ply",
        }.get(mime, ".glb")
    suffix = Path(urlsplit(src).path).suffix.lower()
    return suffix if suffix in MESH_SUFFIXES else ".glb"


def _load_caller_mesh(src: str):
    """Fetch, meshopt-decode and parse a caller mesh. Returns a trimesh.Trimesh."""
    data = _read_source(src, "mesh")
    suffix = _mesh_suffix(src)
    try:
        data, suffix = decode_if_meshopt(data, suffix)
    except ValueError as exc:
        raise ImageSourceError(f"mesh source {_source_label(src)}: {exc}") from exc
    try:
        return postprocess.load_mesh(data, suffix)
    except postprocess.MeshError as exc:
        raise ImageSourceError(f"mesh source {_source_label(src)}: {exc}") from exc


# ── Task records ──────────────────────────────────────────────────────────────

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
    """Merge `fields` into the task and persist it. No fields = a heartbeat."""
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
                lambda: _task_blob(task_id).upload_from_string(payload, content_type="application/json"),
            )
        else:
            await loop.run_in_executor(None, _get_local_storage().write_task, snapshot)
    return task


async def _heartbeat(task_id: str) -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_SECS)
        try:
            await _update_task(task_id)
        except Exception as exc:  # noqa: BLE001 - a missed beat must not kill the job
            log.warning("[%s] heartbeat write failed: %s", task_id, exc)


_TERMINAL_STATUSES = frozenset({"done", "failed"})


async def _resolve_task(task_id: str) -> dict:
    """Poll reader: trust the local cache only for terminal records, re-read the
    durable copy otherwise, and expire a record whose runner went silent."""
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
    status = task.get("status")
    if status in _TERMINAL_STATUSES:
        _tasks[task_id] = task
        return task
    if task_is_orphaned(status, task.get("updated_at"), time.time()):
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


# ── Modly calls ───────────────────────────────────────────────────────────────

async def _submit_generation(
    client: httpx.AsyncClient, model: str, png: bytes, params: dict, collection: str
) -> str:
    """POST /generate/from-image. Modly's own remesh and texture stages stay off:
    the front's post-process chain owns everything after the raw mesh."""
    try:
        res = await client.post(
            "/generate/from-image",
            files={"image": ("input.png", png, "image/png")},
            data={
                "model_id": model,
                "collection": collection,
                "remesh": "none",
                "enable_texture": "false",
                "params": json.dumps(params),
            },
        )
    except httpx.TransportError as exc:
        raise ModlyUnavailable(f"Modly unreachable on submit ({type(exc).__name__})") from exc
    if res.status_code != 200:
        raise RuntimeError(f"Modly refused the generation (HTTP {res.status_code}): {res.text[:300]}")
    job_id = res.json().get("job_id")
    if not job_id:
        raise RuntimeError("Modly accepted the generation without a job id")
    return job_id


async def _await_generation(client: httpx.AsyncClient, job_id: str, on_progress) -> Path:
    """Poll a Modly job to completion. Returns the output file's absolute path."""
    deadline = time.time() + GENERATION_TIMEOUT_S
    last: tuple[Any, Any] = (None, None)
    while True:
        try:
            res = await client.get(f"/generate/status/{job_id}")
        except httpx.TransportError as exc:
            raise ModlyUnavailable(f"Modly stopped answering mid-job ({type(exc).__name__})") from exc
        if res.status_code == 404:
            raise RuntimeError("Modly lost track of the generation job")
        res.raise_for_status()
        job = res.json()
        state, detail = interpret_job(job)
        if state == "done":
            path = (WORKSPACE_DIR / workspace_relative(detail)).resolve()
            if WORKSPACE_DIR.resolve() not in path.parents or not path.is_file():
                raise RuntimeError("Modly reported an output file that is not in its workspace")
            return path
        if state == "failed":
            raise RuntimeError(detail)
        current = (job.get("progress"), job.get("step"))
        if on_progress is not None and current != last:
            last = current
            await on_progress(job.get("progress"), job.get("step"))
        if time.time() > deadline:
            try:
                await client.post(f"/generate/cancel/{job_id}")
            except httpx.HTTPError as exc:
                log.warning("cancel of timed-out Modly job %s failed: %s", job_id, exc)
            raise TimeoutError(f"generation exceeded {GENERATION_TIMEOUT_S:.0f}s and was cancelled")
        await asyncio.sleep(POLL_INTERVAL_S)


async def _modly_op(client: httpx.AsyncClient, name: str, path: Path, params: dict) -> tuple[Path, dict]:
    """Run one Modly mesh op (repair | decimate | smooth) on a workspace file."""
    try:
        res = await client.post(f"/optimize/op/{name}", json={"path": str(path), "params": params})
    except httpx.TransportError as exc:
        raise ModlyUnavailable(f"Modly unreachable during {name} ({type(exc).__name__})") from exc
    if res.status_code != 200:
        try:
            detail = res.json().get("detail")
        except ValueError:
            detail = res.text
        raise RuntimeError(f"{name} failed (HTTP {res.status_code}): {str(detail)[:300]}")
    body = res.json()
    out = (WORKSPACE_DIR / workspace_relative(body.get("url"))).resolve()
    if not out.is_file():
        raise RuntimeError(f"{name} reported an output file that does not exist")
    details = {k: v for k, v in body.items() if k not in ("path", "url")}
    return out, details


# ── The job ───────────────────────────────────────────────────────────────────

async def _run_inference(task_id: str, *args, **kwargs) -> None:
    _live_tasks.add(task_id)
    beat = asyncio.create_task(_heartbeat(task_id))
    try:
        await _run_job(task_id, *args, **kwargs)
    finally:
        beat.cancel()
        _live_tasks.discard(task_id)
        _task_locks.pop(task_id, None)
        shutil.rmtree(WORKSPACE_DIR / task_id, ignore_errors=True)
        _recycle_if_bloated(task_id)


def _recycle_if_bloated(task_id: str) -> None:
    """Restart an idle instance whose memory ratcheted toward its ceiling (see
    workers/model-trellis2/main.py for the full rationale). Draining refuses new
    work with a 503 so callers fail over; queued jobs still finish first."""
    global _draining, _restart_signalled
    sample = read_memory()
    if sample is not None:
        log.info("[%s] memory after job: %s", task_id, sample.describe())
    if not _draining:
        if not should_recycle(sample, _memory_baseline):
            return
        _draining = True
        log.warning(
            "recycling instance: memory %s, up from %s after bring-up; draining %d queued job(s) first",
            sample.describe(),
            _memory_baseline.describe() if _memory_baseline else "unknown",
            len(_live_tasks),
        )
    if _live_tasks or _restart_signalled:
        return
    _restart_signalled = True
    log.warning("recycling instance: idle, restarting now")
    signal.raise_signal(signal.SIGTERM)


def _local_steps(original, final_path: Path, plan: dict[str, dict]) -> tuple[bytes, list[dict]]:
    """UV unwrap and bake on the final mesh. Blocking; runs in the executor.

    The bake source is the mesh as it was BEFORE Modly's ops: repair, decimate
    and smooth rewrite geometry and drop materials, so colour is read from the
    original surface and projected onto the final one.
    """
    applied: list[dict] = []
    mesh = postprocess.load_mesh(final_path.read_bytes(), final_path.suffix or ".glb")
    if "uv_unwrap" in plan:
        size = plan.get("bake", {}).get("texture_size", 1024)
        mesh, info = postprocess.uv_unwrap(mesh, size)
        applied.append({"step": "uv_unwrap", **info})
    if "bake" in plan:
        outcome = postprocess.bake(original, mesh, texture_size=plan["bake"]["texture_size"])
        mesh = outcome.mesh
        entry: dict[str, Any] = {"step": "bake", "baked": outcome.baked, "texture_size": plan["bake"]["texture_size"]}
        if outcome.baked:
            entry["coverage"] = round(outcome.coverage, 4)
        else:
            entry["reason"] = outcome.reason
        applied.append(entry)
    return postprocess.export_glb(mesh), applied


async def _run_job(
    task_id: str,
    model: str,
    params: dict,
    plan: list[tuple[str, dict]],
    images: Optional[list[str]],
    mesh_url: Optional[str],
) -> None:
    if _load_error:
        await _update_task(task_id, status="failed", error=f"pipeline unavailable: {_load_error}")
        return
    try:
        await asyncio.wait_for(_ready.wait(), timeout=READY_WAIT_S)
    except asyncio.TimeoutError:
        await _update_task(task_id, status="failed", error="pipeline not ready (Modly bring-up timed out)")
        return
    if _load_error:
        await _update_task(task_id, status="failed", error=f"pipeline unavailable: {_load_error}")
        return

    async with _sem:
        await _update_task(task_id, status="running", progress=0)
        loop = asyncio.get_event_loop()
        t0 = time.time()
        steps = dict(plan)
        applied: list[dict] = []
        task_dir = WORKSPACE_DIR / task_id
        try:
            async with httpx.AsyncClient(base_url=MODLY_URL, timeout=httpx.Timeout(600.0, connect=10.0)) as client:
                if images is not None:
                    png = await loop.run_in_executor(None, _image_png, images[0])

                    async def on_progress(progress, step):
                        await _update_task(task_id, progress=progress, step=step)

                    job_id = await _submit_generation(client, model, png, params, task_id)
                    current = await _await_generation(client, job_id, on_progress)
                    original = None
                    if "bake" in steps:
                        original = await loop.run_in_executor(
                            None, lambda: postprocess.load_mesh(current.read_bytes(), current.suffix or ".glb")
                        )
                else:
                    original = await loop.run_in_executor(None, _load_caller_mesh, mesh_url)
                    task_dir.mkdir(parents=True, exist_ok=True)
                    current = task_dir / "input.glb"
                    glb = await loop.run_in_executor(None, postprocess.export_glb, original)
                    await loop.run_in_executor(None, current.write_bytes, glb)

                for name in ("repair", "decimate", "smooth"):
                    if name in steps:
                        await _update_task(task_id, step=name)
                        current, details = await _modly_op(client, name, current, steps[name])
                        applied.append({"step": name, **steps[name], **details})

            if "uv_unwrap" in steps:
                await _update_task(task_id, step="bake" if "bake" in steps else "uv_unwrap")
                glb_bytes, local_applied = await loop.run_in_executor(None, _local_steps, original, current, steps)
                applied.extend(local_applied)
            else:
                glb_bytes = await loop.run_in_executor(None, current.read_bytes)
            glb_bytes, packed = await loop.run_in_executor(None, postprocess.pack_glb, glb_bytes)

            if _using_gcs():
                blob_name = f"raw-meshes/{LANE}/{task_id}.glb"
                blob = _bucket.blob(blob_name)
                await loop.run_in_executor(
                    None, lambda: blob.upload_from_string(glb_bytes, content_type="model/gltf-binary")
                )
                result_fields = {"result_gcs_url": f"https://storage.googleapis.com/{GCS_BUCKET}/{blob_name}"}
                result_label = result_fields["result_gcs_url"]
            else:
                result_path = await loop.run_in_executor(None, _get_local_storage().write_result, task_id, glb_bytes)
                result_fields = {"result_url": f"/results/{task_id}.glb", "result_path": str(result_path)}
                result_label = str(result_path)

            elapsed = time.time() - t0
            await _update_task(
                task_id,
                status="done",
                progress=100,
                step=None,
                **result_fields,
                views_used=1 if images is not None else 0,
                postprocess_applied=applied,
                packed=packed,
                bytes=len(glb_bytes),
                elapsed_ms=int(elapsed * 1000),
            )
            log.info(
                "[%s] done in %.1fs (model=%s steps=%s packed=%s) %d bytes -> %s",
                task_id, elapsed, model, [a["step"] for a in applied], packed, len(glb_bytes), result_label,
            )
        except (ImageSourceError, postprocess.MeshError) as exc:
            log.warning("[%s] caller input rejected: %s", task_id, exc)
            await _update_task(task_id, status="failed", error=str(exc), elapsed_ms=int((time.time() - t0) * 1000))
        except ModlyUnavailable as exc:
            log.error("[%s] %s", task_id, exc)
            await _update_task(
                task_id,
                status="failed",
                error="Modly backend stopped mid-job and is restarting; retry the request",
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
            await loop.run_in_executor(None, trim_heap)


# ── HTTP surface ──────────────────────────────────────────────────────────────

class InferRequest(BaseModel):
    images: Optional[list[str]] = Field(None, min_length=1, max_length=6)
    mesh_url: Optional[str] = Field(None, min_length=1, max_length=96 * 1024 * 1024)
    model: Optional[str] = None
    tier: Optional[str] = None
    seed: Optional[int] = None
    params: Optional[dict[str, Any]] = None
    postprocess: Optional[dict[str, Any]] = None
    body_type: str = "neutral"
    job_id: Optional[str] = None


def _plan_request(body: InferRequest) -> tuple[str, dict, list[tuple[str, dict]], list[str]]:
    if (body.images is None) == (body.mesh_url is None):
        raise PolicyError("send exactly one of images (image to 3D) or mesh_url (post-process a mesh)")
    plan = parse_postprocess(body.postprocess)
    model = resolve_model(body.model, ENABLED_MODELS, DEFAULT_MODEL)
    if body.mesh_url is not None:
        if not plan:
            raise PolicyError("mesh_url needs at least one postprocess step")
        return model, {}, plan, []
    params, dropped = build_generation_params(model, body.tier, body.params, body.seed, random.SystemRandom())
    return model, params, plan, dropped


@app.post("/infer", status_code=202)
async def infer(
    body: InferRequest,
    background_tasks: BackgroundTasks,
    authorization: str = Header(...),
) -> dict:
    _require_api_key(authorization)
    try:
        model, params, plan, dropped = _plan_request(body)
    except PolicyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if _load_error:
        raise HTTPException(status_code=503, detail=f"pipeline unavailable: {_load_error}")
    if _draining:
        raise HTTPException(status_code=503, detail="instance restarting to reclaim memory; retry shortly")
    task_id = str(uuid.uuid4())
    record: dict[str, Any] = {
        "status": "queued",
        "model": model if body.images is not None else None,
        "postprocess": [name for name, _ in plan],
    }
    if body.images is not None:
        record.update(seed=params["seed"], params=params, params_dropped=dropped)
    await _update_task(task_id, **record)
    background_tasks.add_task(_run_inference, task_id, model, params, plan, body.images, body.mesh_url)
    return {"task_id": task_id, "status": "queued", "model": record["model"]}


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
    """Service descriptor and the answer to the platform's keep-warm ping."""
    return {
        "service": SERVICE,
        "model": DEFAULT_MODEL,
        "models": ENABLED_MODELS,
        "ready": bool(_ready and _ready.is_set()),
        "endpoints": [
            "POST /infer",
            "GET /tasks/{task_id}",
            "GET /results/{task_id}.glb",
            "GET /health",
        ],
        "attribution": "Based on Modly (https://github.com/lightningpixel/modly) by Lightning Pixel",
    }


@app.get("/health")
async def health(response: Response) -> dict:
    """Readiness. A spent bring-up budget answers 503 so the platform probe and
    the Cloud Run liveness probe both treat the instance as down; a bring-up still
    in progress stays 200 so an ordinary cold start is never killed mid-load."""
    dead = _load_error is not None
    if dead:
        response.status_code = 503
    return {
        "ok": not dead,
        "model": DEFAULT_MODEL,
        "models": ENABLED_MODELS,
        "gpu_available": _gpu_name is not None,
        "gpu_name": _gpu_name,
        "ready": bool(_ready and _ready.is_set()),
        "modly_alive": _modly_alive(),
        "modly_pid": _modly_proc.pid if _modly_alive() else None,
        "modly_restarts": _modly_restarts,
        "warmup_ms": _warmup_ms,
        "load_error": _load_error,
        "load_attempts": _load_attempts,
        "draining": _draining,
        "postprocess_steps": ["repair", "decimate", "smooth", "uv_unwrap", "bake"],
        "output_backend": "gcs" if _using_gcs() else "local",
        "output_dir": None if _using_gcs() else str(_get_local_storage().output_dir),
    }
