"""
Pixal3D inference service: 1 to 4 photos to a PBR-textured 3D asset
(TencentARC, MIT license; pixel-aligned image-to-3D built on TRELLIS.2).

This module is a thin FastAPI wrapper around TencentARC/Pixal3D's own
reference scripts (`inference.py` for the single-view path, `inference_mv.py`
for the posed multi-view path), vendored into the image and imported directly
(see PIXAL3D_SRC below) rather than reimplemented: `init_pipeline`,
`get_camera_params_wild_moge`, `make_rembg` and `to_cond_tensor` all run
exactly as upstream wrote them. What this file adds is: async task plumbing
(mirroring workers/model-trellis2/main.py), turning Forge's plain view labels
into the camera rig Pixal3D's multi-view path expects (camera_rig.py) when no
real camera data was given, and an optional MV-Adapter "fill in the other
sides" pre-step for a single photo (mv_adapter_fill.py).

API contract (consumed by the Forge router):
  POST /infer   { images: [data-uri|url, ...] (1 to 4), view_labels?: [str|null, ...],
                  fill_other_sides?: bool, resolution?: 1024|1536, tier?: str,
                  seed?: int, texture_size?: int, decimation_target?: int,
                  body_type?: str, job_id?: str }
             ->  202 { task_id, status: "queued" }

  One image with no view_labels and fill_other_sides unset or false runs the
  single-view path (MoGe-2 estimates the camera from the photo itself). Two
  to four images run the multi-view path: labels ("front"|"back"|"left"|
  "right") set each view's azimuth around a shared, MoGe-2-estimated camera;
  unlabeled slots spread evenly. Exactly one image with fill_other_sides=true
  first synthesizes the other three azimuths with MV-Adapter, then runs the
  same multi-view path on all four. The task record reports views_used.

  GET  /tasks/:id -> { task_id, status, result_gcs_url?, result_url?, resolution?,
                       resolution_served?, views_used?, alpha_mode?, packed?, error? }

  GET  /results/:id.glb -> generated GLB when OUTPUT_DIR local storage is active

  GET  /health    -> { ok, model, gpu_available, resolutions, load_error }.
                     503 with ok:false once a load attempt has spent its retry
                     budget, so a dead instance is drained.

  GET  /          -> { service, model, ready, endpoints }. Unauthenticated
                     descriptor for the platform's warmth probe.

Weights: gs://three-ws-model-weights/pixal3d (workers/model-pixal3d/stage_weights.sh).

Environment variables (README.md carries the full table):
  API_KEY               shared bearer secret
  GCS_BUCKET            optional Cloud Storage bucket for output meshes
  OUTPUT_DIR            local task and result volume when GCS_BUCKET is unset
  WEIGHTS_DIR           local weight tree (default: /weights/pixal3d)
  WEIGHTS_GCS_URI       optional gs:// tree; each sub-model streams to local disk,
                        loads, and is deleted, so peak disk is one checkpoint
  WEIGHTS_LOCAL_DIR     scratch for that streaming (default: /tmp/pixal3d-weights)
  PIXAL3D_SRC           vendored Pixal3D repo checkout (default: /opt/pixal3d-src)
  MVADAPTER_SRC         vendored MV-Adapter repo checkout (default: /opt/mvadapter-src)
  LOW_VRAM              "1" moves each stage's weights to the GPU only while it
                        runs (default: 1; a single L4 cannot hold the single-view
                        pipeline, the multi-view pipeline and MV-Adapter resident
                        at once at full precision)
  MAX_RESOLUTION        ceiling on the served resolution (default: 1536)
  MAX_CONCURRENT        max parallel inferences (default: 1)
  IMAGE_FETCH_TIMEOUT_S per-attempt image fetch timeout (default: 30)
  MODEL_LOAD_ATTEMPTS   weight-staging attempts before the error latches (default: 4)
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
import sys
import tempfile
import time
import uuid

import httpx

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

import camera_rig
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
log = logging.getLogger("pixal3d")

# Pixal3D's reference scripts (inference.py, inference_mv.py) live at the root
# of the vendored checkout, not inside the installable `pixal3d` package, so
# they are imported by adding that checkout to sys.path rather than pip-level
# packaging. MV-Adapter's reference script is imported the same way.
PIXAL3D_SRC = os.environ.get("PIXAL3D_SRC", "/opt/pixal3d-src")
MVADAPTER_SRC = os.environ.get("MVADAPTER_SRC", "/opt/mvadapter-src")
for _src in (PIXAL3D_SRC, MVADAPTER_SRC):
    if _src not in sys.path:
        sys.path.insert(0, _src)

API_KEY = os.environ["API_KEY"]
GCS_BUCKET = os.environ.get("GCS_BUCKET", "").strip()
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/output")
WEIGHTS_DIR = os.environ.get("WEIGHTS_DIR", "/weights/pixal3d")
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "1"))
MAX_RESOLUTION = int(os.environ.get("MAX_RESOLUTION", str(max(RESOLUTIONS))))
LOW_VRAM = os.environ.get("LOW_VRAM", "1") != "0"
# Same reasoning as workers/model-trellis2: Cloud Run's filesystem cannot hold a
# ~46 GB checkpoint tree next to the job's own memory budget, and GCS FUSE
# stalls on safetensors' random reads. Each sub-model streams to local disk,
# loads, and is deleted.
WEIGHTS_GCS_URI = os.environ.get("WEIGHTS_GCS_URI", "").rstrip("/")
WEIGHTS_LOCAL_DIR = os.environ.get("WEIGHTS_LOCAL_DIR", "/tmp/pixal3d-weights")
CONFIG_DIR = os.path.join(WEIGHTS_LOCAL_DIR, "config")
AUX_DIR = os.path.join(WEIGHTS_LOCAL_DIR, "aux")
MODEL_LOAD_ATTEMPTS = int(os.environ.get("MODEL_LOAD_ATTEMPTS", "4"))
MODEL_LOAD_RETRY_BASE_S = float(os.environ.get("MODEL_LOAD_RETRY_BASE_S", "15"))
MODEL_LOAD_RETRY_CAP_S = float(os.environ.get("MODEL_LOAD_RETRY_CAP_S", "120"))

_weights_ready: Optional[asyncio.Event] = None
_load_error: Optional[str] = None
_load_attempts = 0
_bucket: Optional[storage.Bucket] = None
_local_storage: Optional[LocalStorage] = None
_sem: Optional[asyncio.Semaphore] = None
# Lazily-loaded singletons. Only the pipeline(s) a request shape actually needs
# ever get moved to the GPU; see _get_single_pipeline / _get_mv_pipeline /
# _get_moge_model / mv_adapter_fill.get_pipeline. One lock per kind serializes
# the first caller's load against a second caller arriving mid-load.
_single_pipeline = None
_mv_pipeline = None
_moge_model = None
_single_lock: Optional[asyncio.Lock] = None
_mv_lock: Optional[asyncio.Lock] = None
_moge_lock: Optional[asyncio.Lock] = None
_tasks: dict[str, dict] = {}
_task_locks: dict[str, asyncio.Lock] = {}
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
    """Copy the DINOv3 conditioner and BiRefNet matte to local disk.

    They stay resident for the instance's life, unlike the per-stage flow
    checkpoints, which stream through on demand.
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
    """Make Pixal3D's per-model loader stream each checkpoint from GCS.

    `pixal3d.models.from_pretrained` resolves every model as
    `<CONFIG_DIR>/<name>`; the wrapper fetches `<name>.json` and
    `<name>.safetensors` from the weights prefix, loads them, and removes
    them, so disk and RAM never hold more than a couple checkpoints at once.
    """
    import pixal3d.models as p3d_models

    original = p3d_models.from_pretrained
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

    p3d_models.from_pretrained = streaming


def _patch_image_cond_configs(dinov3_local_dir: str) -> None:
    """Point both reference scripts' DinoV3 conditioner at the staged copy.

    Upstream hardcodes the ungated mirror `camenduru/dinov3-vitl16-pretrain-
    lvd1689m` in a module-level dict rather than reading it from pipeline.json
    (see pipeline_config.py's docstring), so the dict itself is rewritten here
    after import instead of being left to reach the Hub at serve time.
    """
    import inference as sv_ref
    import inference_mv as mv_ref

    for ref in (sv_ref, mv_ref):
        for cfg in ref.IMAGE_COND_CONFIGS.values():
            cfg["model_name"] = dinov3_local_dir


def _prepare_pipeline_path() -> str:
    """Return the config directory Pixal3D loads from, staging what it needs."""
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
            raise FileNotFoundError(f"Pixal3D weights incomplete at {WEIGHTS_GCS_URI}: {', '.join(missing)}")
        _stage_aux_weights(client, bucket_name, prefix)
        bucket = client.bucket(bucket_name)
        for name in ("pipeline.json", "pipeline_mv.json"):
            text = bucket.blob(f"{prefix}/{name}").download_as_text()
            pipeline_config.write_local_config(text, AUX_DIR, os.path.join(CONFIG_DIR, name))
        _install_streaming_loader(client, bucket_name, prefix)
        _patch_image_cond_configs(os.path.join(AUX_DIR, pipeline_config.DINOV3_DIR))
        return CONFIG_DIR

    root = Path(WEIGHTS_DIR)
    present = [str(p.relative_to(root)) for p in root.rglob("*") if p.is_file() or p.is_symlink()]
    missing = pipeline_config.missing_weights(present)
    if missing:
        raise FileNotFoundError(f"Pixal3D weights incomplete at {root}: {', '.join(missing)}")
    for name in ("pipeline.json", "pipeline_mv.json"):
        pipeline_config.write_local_config(
            (root / name).read_text(), root, Path(CONFIG_DIR) / name
        )
    pipeline_config.link_weight_tree(root, CONFIG_DIR)
    _patch_image_cond_configs(str(root / pipeline_config.DINOV3_DIR))
    return CONFIG_DIR


def _stage_weights_sync() -> None:
    """Blocking weight-staging step, run once in a background thread at startup.

    Unlike workers/model-trellis2 (one pipeline, loaded eagerly), Pixal3D's
    two pipelines and MV-Adapter's optional rung load lazily on first use (see
    _get_single_pipeline / _get_mv_pipeline), so startup only has to prove the
    weight tree is complete and build the local pipeline.json/pipeline_mv.json
    once, not touch the GPU.
    """
    _prepare_pipeline_path()


async def _stage_weights_bg() -> None:
    """Stage weights with retries; signal readiness so /infer stops refusing work.

    See workers/model-trellis2's identical comment: the very first exception
    is NOT latched. A transient staging blip must not turn into a permanently
    dead instance that Cloud Run's minScale keeps resident and in rotation.
    """
    global _load_error, _load_attempts
    loop = asyncio.get_event_loop()
    attempts = max(1, MODEL_LOAD_ATTEMPTS)
    for attempt in range(1, attempts + 1):
        _load_attempts = attempt
        try:
            await loop.run_in_executor(None, _stage_weights_sync)
            _load_error = None
            _weights_ready.set()
            log.info("Pixal3D weights staged and config written (attempt %d)", attempt)
            return
        except Exception as exc:  # noqa: BLE001 - surfaced via /health + task status
            if attempt >= attempts:
                _load_error = safe_error(exc, context="weight staging")
                log.error("Pixal3D weight staging FAILED after %d attempt(s): %s", attempt, exc)
                return
            delay = min(MODEL_LOAD_RETRY_BASE_S * (2 ** (attempt - 1)), MODEL_LOAD_RETRY_CAP_S)
            log.warning(
                "Pixal3D weight staging attempt %d/%d failed (%s); retrying in %.0fs",
                attempt, attempts, exc, delay,
            )
            await asyncio.sleep(delay)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _bucket, _local_storage, _sem, _weights_ready, _single_lock, _mv_lock, _moge_lock
    if GCS_BUCKET:
        _bucket = storage.Client().bucket(GCS_BUCKET)
        _local_storage = None
    else:
        _bucket = None
        _local_storage = LocalStorage(OUTPUT_DIR)
    _sem = asyncio.Semaphore(MAX_CONCURRENT)
    _weights_ready = asyncio.Event()
    _single_lock = asyncio.Lock()
    _mv_lock = asyncio.Lock()
    _moge_lock = asyncio.Lock()
    asyncio.create_task(_stage_weights_bg())
    log.info("Service starting, weight staging in background (max_concurrent=%d, low_vram=%s)", MAX_CONCURRENT, LOW_VRAM)
    yield


app = FastAPI(title="model-pixal3d", lifespan=lifespan)


def _require_api_key(authorization: str) -> None:
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


class ImageSourceError(ValueError):
    """A caller-supplied image could not be read. See workers/model-trellis2."""


IMAGE_FETCH_TIMEOUT_S = float(os.environ.get("IMAGE_FETCH_TIMEOUT_S", "30"))


def _source_label(src: str) -> str:
    if src.startswith("data:image"):
        return "inline data uri"
    host = urlsplit(src).hostname
    return host or src[:60]


def _fetch_image_bytes(src: str) -> bytes:
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
        raise ImageSourceError(f"image source {label} returned HTTP {exc.response.status_code}") from exc
    except httpx.HTTPError as exc:
        raise ImageSourceError(
            f"image source {label} unreachable after {FETCH_ATTEMPTS} attempts "
            f"({type(exc).__name__}); check the URL is publicly readable"
        ) from exc
    except ValueError as exc:
        raise ImageSourceError(f"image source {label} rejected: {exc}") from exc


def _decode_image(src: str) -> Image.Image:
    mode = "RGBA"
    if src.startswith("data:image"):
        b64 = src.split(",", 1)[1]
        try:
            raw = base64.b64decode(b64)
        except Exception as exc:  # noqa: BLE001 - caller's own payload
            raise ImageSourceError(f"inline data uri is not valid base64: {exc}") from exc
        return _open_image(raw, mode, "inline data uri")
    if src.startswith("https://"):
        return _open_image(_fetch_image_bytes(src), mode, _source_label(src))
    raise ImageSourceError(f"unsupported image source: {src[:60]}")


def _open_image(data: bytes, mode: str, label: str) -> Image.Image:
    try:
        return Image.open(io.BytesIO(data)).convert(mode)
    except Exception as exc:  # noqa: BLE001 - undecodable caller input
        raise ImageSourceError(f"image source {label} is not a decodable image ({type(exc).__name__})") from exc


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
                None, lambda: _task_blob(task_id).upload_from_string(payload, content_type="application/json")
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


async def _run_inference(task_id: str, *args, **kwargs) -> None:
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
    """See workers/model-trellis2's identical function for the full rationale:
    restart an idle instance before its ratcheted memory OOM-kills a job."""
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
            sample.describe(), _memory_baseline.describe() if _memory_baseline else "unknown", len(_live_tasks),
        )
    if _live_tasks or _restart_signalled:
        return
    _restart_signalled = True
    log.warning("recycling instance: idle, restarting now")
    signal.raise_signal(signal.SIGTERM)


def _release_gpu_memory() -> None:
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()
    trim_heap()


def _get_single_pipeline():
    """Lazily load Pixal3D's single-view pipeline (inference.py's own loader)."""
    global _single_pipeline, _memory_baseline
    if _single_pipeline is not None:
        return _single_pipeline
    import inference as sv_ref

    log.info("Loading Pixal3D single-view pipeline from %s", CONFIG_DIR)
    _single_pipeline = sv_ref.init_pipeline(model_path=CONFIG_DIR, low_vram=LOW_VRAM)
    trim_heap()
    if _memory_baseline is None:
        _memory_baseline = read_memory()
    log.info("Pixal3D single-view pipeline ready")
    return _single_pipeline


def _get_mv_pipeline():
    """Lazily load Pixal3D's multi-view pipeline (inference_mv.py's own loader)."""
    global _mv_pipeline
    if _mv_pipeline is not None:
        return _mv_pipeline
    import inference_mv as mv_ref

    log.info("Loading Pixal3D multi-view pipeline from %s", CONFIG_DIR)
    _mv_pipeline = mv_ref.init_pipeline(model_path=CONFIG_DIR, config_file="pipeline_mv.json", low_vram=LOW_VRAM)
    trim_heap()
    log.info("Pixal3D multi-view pipeline ready")
    return _mv_pipeline


def _get_moge_model():
    """Lazily load the MoGe-2 camera estimator, shared by both pipelines."""
    global _moge_model
    if _moge_model is not None:
        return _moge_model
    import inference as sv_ref

    log.info("Loading MoGe-2 camera estimator")
    _moge_model = sv_ref.load_moge_model(device="cuda" if torch.cuda.is_available() else "cpu")
    log.info("MoGe-2 ready")
    return _moge_model


def _estimate_camera_params(image: Image.Image, mesh_scale: float = 1.0) -> dict:
    """camera_angle_x / distance / mesh_scale for one photo, via MoGe-2.

    Pixal3D's own get_camera_params_wild_moge takes a file path (its single-
    view script always has one on disk already); an in-memory photo is
    written to a temp PNG first, exactly as that script does for its own
    preprocessed image.
    """
    import inference as sv_ref

    moge_model = _get_moge_model()
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        image.convert("RGB").save(tmp_path)
        return sv_ref.get_camera_params_wild_moge(
            tmp_path, moge_model, device="cuda" if torch.cuda.is_available() else "cpu",
            mesh_scale=mesh_scale, extend_pixel=0, image_resolution=512,
        )
    finally:
        os.remove(tmp_path)


def _square_crop(image: Image.Image) -> Image.Image:
    """Center-crop to a square. Pixal3D's multi-view conditioning tensors are
    built with a plain resize (to_cond_tensor), which assumes a square,
    well-framed input the way its own training renders always were."""
    w, h = image.size
    if w == h:
        return image
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return image.crop((left, top, left + side, top + side))


def _generate_single(
    image: Image.Image, resolution: int, seed: Optional[int], texture_size: Optional[int], decimation_target: Optional[int]
) -> tuple[bytes, str, bool]:
    """One synchronous single-photo generation, mirroring inference.py's run_inference."""
    import o_voxel

    pipeline = _get_single_pipeline()
    image_preprocessed = pipeline.preprocess_image(image)
    camera_params = _estimate_camera_params(image_preprocessed)
    torch.manual_seed(seed if seed is not None else 42)
    mesh_list, (_shape_slat, _tex_slat, res) = pipeline.run(
        image_preprocessed,
        camera_params=camera_params,
        seed=seed if seed is not None else 42,
        preprocess_image=False,
        return_latent=True,
        pipeline_type=PIPELINE_TYPES[resolution],
        max_num_tokens=49152,
    )
    return _mesh_to_glb(mesh_list[0], pipeline.pbr_attr_layout, res, resolution, texture_size, decimation_target)


def _generate_multiview(
    images: list[Image.Image],
    view_labels: list[Optional[str]],
    resolution: int,
    seed: Optional[int],
    texture_size: Optional[int],
    decimation_target: Optional[int],
) -> tuple[bytes, str, bool]:
    """One synchronous multi-view generation.

    No real camera data exists for these photos, so camera_rig turns the
    labels (or an even spacing when a slot carries none) into azimuths, a
    shared camera is estimated once from whichever photo lands at azimuth 0
    (Pixal3D requires frame 0 to be the canonical front view -- see
    camera_rig.py's module docstring), and the view bundle is built in the
    exact shape inference_mv.py's load_views() hands pipeline.run_mv.
    """
    import inference_mv as mv_ref
    import numpy as np

    pipeline = _get_mv_pipeline()
    azimuths = camera_rig.resolve_azimuths(view_labels)
    front_idx = azimuths.index(0.0) if 0.0 in azimuths else 0
    order = [front_idx] + [i for i in range(len(images)) if i != front_idx]
    ordered_images = [_square_crop(images[i]) for i in order]
    ordered_azimuths = [azimuths[i] for i in order]
    ordered_labels = [view_labels[i] for i in order]

    camera_params = _estimate_camera_params(ordered_images[0])
    distance = camera_params["distance"]
    rig = [camera_rig.transform_matrix_for_azimuth(az, distance) for az in ordered_azimuths]

    rembg = mv_ref.make_rembg(pipeline)
    matted = []
    for img in ordered_images:
        alpha = np.array(img.getchannel("A")) if img.mode == "RGBA" else None
        if alpha is not None and not np.all(alpha == 255):
            matted.append(img.convert("RGBA"))
        else:
            matted.append(rembg(img).convert("RGBA"))

    views = {
        "images": {
            size: torch.stack([mv_ref.to_cond_tensor(im, size) for im in matted], dim=0)[None]
            for size in (512, 1024)
        },
        "camera_angle_x": torch.tensor([[camera_params["camera_angle_x"]] * len(matted)], dtype=torch.float32),
        "camera_distance": torch.tensor([[distance] * len(matted)], dtype=torch.float32),
        "transform_matrix": torch.tensor([rig], dtype=torch.float32),
        "mesh_scale": camera_params["mesh_scale"],
        "view_names": [label or f"view{i}" for i, label in enumerate(ordered_labels)],
    }
    mv_ref.check_main_view(views)

    torch.manual_seed(seed if seed is not None else 42)
    mesh_list, (_shape_slat, _tex_slat, res) = pipeline.run_mv(
        views,
        seed=seed if seed is not None else 42,
        return_latent=True,
        pipeline_type=PIPELINE_TYPES[resolution],
        max_num_tokens=49152,
    )
    return _mesh_to_glb(mesh_list[0], pipeline.pbr_attr_layout, res, resolution, texture_size, decimation_target)


def _mesh_to_glb(mesh, attr_layout, grid_size, resolution, texture_size, decimation_target) -> tuple[bytes, str, bool]:
    """Bake a Pixal3D mesh to a packed GLB. Shared tail of both generate paths."""
    import o_voxel
    import numpy as np

    bake = bake_params(resolution, texture_size, decimation_target)
    glb = o_voxel.postprocess.to_glb(
        vertices=mesh.vertices,
        faces=mesh.faces,
        attr_volume=mesh.attrs,
        coords=mesh.coords,
        attr_layout=attr_layout,
        grid_size=grid_size,
        aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
        decimation_target=bake["decimation_target"],
        texture_size=bake["texture_size"],
        remesh=True,
        remesh_band=1,
        remesh_project=0,
    )
    # Pixal3D's own reference scripts apply this exact rotation after to_glb
    # to align the output with the platform's forward/up convention.
    rot = np.array(
        [[-1, 0, 0, 0], [0, 0, -1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=np.float64
    )
    glb.apply_transform(rot)
    alpha_mode = glb_pack.blend_if_translucent(glb)
    raw = glb.export(file_type="glb", extension_webp=True)
    packed_bytes, packed = glb_pack.compress(raw)
    return packed_bytes, alpha_mode, packed


async def _run_job(
    task_id: str,
    images: list[str],
    view_labels: list[Optional[str]] | None = None,
    fill_other_sides: bool = False,
    resolution: int | None = None,
    tier: str | None = None,
    seed: int | None = None,
    texture_size: int | None = None,
    decimation_target: int | None = None,
) -> None:
    if _load_error:
        await _update_task(task_id, status="failed", error=f"weights unavailable: {_load_error}")
        return
    try:
        await asyncio.wait_for(_weights_ready.wait(), timeout=900)
    except asyncio.TimeoutError:
        await _update_task(task_id, status="failed", error="weights not ready (staging timed out)")
        return
    if _load_error:
        await _update_task(task_id, status="failed", error=f"weights unavailable: {_load_error}")
        return

    requested = clamp_to_ceiling(resolve_resolution(resolution, tier), MAX_RESOLUTION)
    labels = list(view_labels) if view_labels else [None] * len(images)

    async with _sem:
        await _update_task(task_id, status="running", resolution=requested)
        loop = asyncio.get_event_loop()
        t0 = time.time()
        try:
            decoded = [await loop.run_in_executor(None, _decode_image, src) for src in images]

            served = requested
            while True:
                try:
                    if len(decoded) == 1 and fill_other_sides:
                        import mv_adapter_fill

                        extra = await loop.run_in_executor(None, mv_adapter_fill.synthesize_other_sides, decoded[0])
                        all_images = [decoded[0]] + extra
                        all_labels = ["front", "right", "back", "left"]
                        result = await loop.run_in_executor(
                            None, _generate_multiview, all_images, all_labels, served, seed, texture_size, decimation_target
                        )
                        views_used = len(all_images)
                    elif len(decoded) == 1:
                        result = await loop.run_in_executor(
                            None, _generate_single, decoded[0], served, seed, texture_size, decimation_target
                        )
                        views_used = 1
                    else:
                        result = await loop.run_in_executor(
                            None, _generate_multiview, decoded, labels, served, seed, texture_size, decimation_target
                        )
                        views_used = len(decoded)
                    break
                except torch.cuda.OutOfMemoryError:
                    await loop.run_in_executor(None, _release_gpu_memory)
                    smaller = step_down(served)
                    if smaller is None:
                        raise
                    log.warning("[%s] out of GPU memory at %d; retrying at %d", task_id, served, smaller)
                    served = smaller
            glb_bytes, alpha_mode, packed = result

            if _using_gcs():
                blob_name = f"raw-meshes/pixal3d/{task_id}.glb"
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
                **result_fields,
                views_used=views_used,
                resolution=requested,
                resolution_served=served,
                alpha_mode=alpha_mode,
                packed=packed,
                bytes=len(glb_bytes),
                elapsed_ms=int(elapsed * 1000),
            )
            log.info(
                "[%s] done in %.1fs (views=%d resolution=%d served=%d alpha=%s packed=%s) %d bytes -> %s",
                task_id, elapsed, views_used, requested, served, alpha_mode, packed, len(glb_bytes), result_label,
            )

        except ImageSourceError as exc:
            log.warning("[%s] image source rejected: %s", task_id, exc)
            await _update_task(task_id, status="failed", error=str(exc), elapsed_ms=int((time.time() - t0) * 1000))
        except Exception as exc:
            await _update_task(
                task_id, status="failed", error=safe_error(exc, context=f"[{task_id}] inference"),
                elapsed_ms=int((time.time() - t0) * 1000),
            )
        finally:
            await loop.run_in_executor(None, _release_gpu_memory)


class InferRequest(BaseModel):
    images: list[str] = Field(..., min_length=1, max_length=4)
    # "front" | "back" | "left" | "right" | null per slot, same order as images.
    # A slot without a recognized label spreads evenly among the unlabeled ones.
    view_labels: list[str | None] | None = None
    # Only valid with exactly one image: synthesize the other three azimuths
    # with MV-Adapter before running the multi-view path.
    fill_other_sides: bool = False
    body_type: str = "neutral"
    job_id: str | None = None
    resolution: int | None = None
    tier: str | None = None
    seed: int | None = None
    texture_size: int | None = None
    decimation_target: int | None = None


@app.post("/infer", status_code=202)
async def infer(body: InferRequest, background_tasks: BackgroundTasks, authorization: str = Header(...)) -> dict:
    _require_api_key(authorization)
    if _load_error:
        raise HTTPException(status_code=503, detail=f"weights unavailable: {_load_error}")
    if _draining:
        raise HTTPException(status_code=503, detail="instance restarting to reclaim memory; retry shortly")
    if body.fill_other_sides and len(body.images) != 1:
        raise HTTPException(status_code=400, detail="fill_other_sides requires exactly one image")
    if body.view_labels is not None and len(body.view_labels) != len(body.images):
        raise HTTPException(status_code=400, detail="view_labels must have one entry per image")

    task_id = str(uuid.uuid4())
    await _update_task(task_id, status="queued", model="pixal3d")
    background_tasks.add_task(
        _run_inference,
        task_id,
        body.images,
        body.view_labels,
        body.fill_other_sides,
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
        "service": "model-pixal3d",
        "model": "pixal3d",
        "ready": bool(_weights_ready and _weights_ready.is_set()),
        "endpoints": ["POST /infer", "GET /tasks/{task_id}", "GET /results/{task_id}.glb", "GET /health"],
    }


@app.get("/health")
async def health(response: Response) -> dict:
    dead = _load_error is not None
    if dead:
        response.status_code = 503
    return {
        "ok": not dead,
        "model": "pixal3d",
        "gpu_available": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "single_pipeline_loaded": _single_pipeline is not None,
        "mv_pipeline_loaded": _mv_pipeline is not None,
        "weights_ready": bool(_weights_ready and _weights_ready.is_set()),
        "load_error": _load_error,
        "load_attempts": _load_attempts,
        "draining": _draining,
        "resolutions": [r for r in RESOLUTIONS if r <= MAX_RESOLUTION],
        "default_resolution": DEFAULT_RESOLUTION,
        "max_images": 4,
        "output_backend": "gcs" if _using_gcs() else "local",
        "output_dir": None if _using_gcs() else str(_get_local_storage().output_dir),
    }
