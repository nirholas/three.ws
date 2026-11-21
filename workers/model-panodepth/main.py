"""model-panodepth: one equirectangular 360 photo to a metric depth shell.

Contract C2 (docs: prompts/finish/_context/insta360-00-CONTEXT.md):

  POST /infer   Bearer  { image_url, job_id?, max_points?, mesh? } -> 202 { task_id }
  GET  /tasks/{id}      -> { status, progress, stage, result?, error? }
  GET  /health          -> { ok, gpu_available, model, weights_present }

Environment: API_KEY (bearer secret), RESULT_BUCKET (results land in
gs://$RESULT_BUCKET/depth/<task_id>/), WEIGHTS_PATH (MoGe-2 checkpoint),
MAX_CONCURRENT (default 1), PANODEPTH_DEVICE (default cuda when present).
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

import pipeline
from pano_io import NotEquirectError
from storage import GcsStore, LocalStore
from worker_security import (
    UnsafeUrlError,
    UnsupportedImageError,
    assert_safe_url,
    fetch_remote_bytes,
    require_api_key,
    safe_error,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("panodepth")

API_KEY = os.environ["API_KEY"]
RESULT_BUCKET = os.environ.get("RESULT_BUCKET", "")
WEIGHTS_PATH = os.environ.get("WEIGHTS_PATH", "/weights/panodepth/moge-2-vitl-normal/model.pt")
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "1"))
MAX_IMAGE_BYTES = 200 * 1024 * 1024
TASK_HISTORY = 256

app = FastAPI(title="model-panodepth")

_tasks: dict[str, dict] = {}
_store = None
_model = None
_model_lock = threading.Lock()
_sem: Optional[asyncio.Semaphore] = None


def get_store():
    global _store
    if _store is None:
        _store = GcsStore(RESULT_BUCKET) if RESULT_BUCKET else LocalStore(Path(tempfile.gettempdir()) / "panodepth-results")
    return _store


def _device() -> str:
    forced = os.environ.get("PANODEPTH_DEVICE")
    if forced:
        return forced
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


def get_model():
    global _model
    with _model_lock:
        if _model is None:
            import pano_depth

            _model = pano_depth.load_model(WEIGHTS_PATH, _device())
    return _model


class InferRequest(BaseModel):
    image_url: str = Field(min_length=8, max_length=4096)
    job_id: Optional[str] = Field(default=None, max_length=128)
    max_points: int = Field(default=pipeline.DEFAULT_MAX_POINTS, ge=1000, le=pipeline.MAX_POINTS_CAP)
    mesh: bool = True
    max_faces: int = Field(default=pipeline.DEFAULT_MAX_FACES, ge=10_000, le=pipeline.MAX_FACES_CAP)


def _auth(authorization: Optional[str]) -> None:
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError:
        raise HTTPException(status_code=401, detail={"error": "unauthorized", "message": "Missing or invalid bearer token."})


def _error(code: str, message: str) -> dict:
    return {"code": code, "message": message}


def classify(exc: BaseException, task_id: str) -> dict:
    if isinstance(exc, UnsafeUrlError):
        return _error("unsafe_url", "The image address is not allowed. Use a public https link.")
    if isinstance(exc, httpx.HTTPError):
        return _error("fetch_failed", "The image could not be downloaded from that link.")
    if isinstance(exc, ValueError) and ("too large" in str(exc) or "exceeded" in str(exc)):
        return _error("image_too_large", "The image is larger than 200 MB.")
    if isinstance(exc, NotEquirectError):
        return _error("not_equirect", str(exc))
    if isinstance(exc, UnsupportedImageError):
        return _error("unsupported_image", str(exc))
    return _error("internal", safe_error(exc, context=f"panodepth task {task_id}"))


def _manifest(task: dict) -> dict:
    return {k: task[k] for k in ("task_id", "job_id", "status", "stage", "progress", "keys", "stats", "error", "created_at", "finished_at") if k in task}


def _public(task: dict) -> dict:
    out = {"task_id": task["task_id"], "status": task["status"], "stage": task.get("stage"), "progress": task.get("progress", 0.0)}
    if task["status"] == "succeeded":
        store = get_store()
        keys = task["keys"]
        out["result"] = {
            "glb_url": store.signed_url(keys["glb"]) if keys.get("glb") else None,
            "ply_url": store.signed_url(keys["ply"]),
            "depth_url": store.signed_url(keys["depth"]),
            "stats": task["stats"],
        }
    if task["status"] == "failed":
        out["error"] = task["error"]
    return out


def _run_task(task: dict, req: InferRequest) -> None:
    task_id = task["task_id"]
    work = Path(tempfile.mkdtemp(prefix=f"panodepth-{task_id}-"))
    try:
        task.update(status="running", stage="download", progress=0.02)
        data = fetch_remote_bytes(req.image_url, timeout=120.0, max_bytes=MAX_IMAGE_BYTES)

        def progress(p: float, stage: str) -> None:
            task.update(progress=round(p, 3), stage=stage)

        stats = pipeline.run(data, work, get_model(), max_points=req.max_points, mesh=req.mesh, max_faces=req.max_faces, progress=progress)

        task.update(stage="upload", progress=0.95)
        store = get_store()
        prefix = f"depth/{task_id}/"
        keys = {"depth": prefix + "depth.exr", "ply": prefix + "scene.ply", "glb": prefix + "scene.glb" if req.mesh else None}
        for name in ("depth.exr", "scene.ply") + (("scene.glb",) if req.mesh else ()):
            store.upload_file(prefix + name, work / name)
        task.update(status="succeeded", stage="done", progress=1.0, keys=keys, stats=stats, finished_at=time.time())
    except Exception as exc:  # noqa: BLE001 - every failure becomes a task error the caller can read
        task.update(status="failed", stage="failed", error=classify(exc, task_id), finished_at=time.time())
    finally:
        shutil.rmtree(work, ignore_errors=True)
        try:
            get_store().write_json(f"depth/{task_id}/task.json", _manifest(task))
        except Exception:  # noqa: BLE001 - the in-memory record still answers while this instance lives
            log.exception("could not persist manifest for %s", task_id)


async def _runner(task: dict, req: InferRequest) -> None:
    global _sem
    if _sem is None:
        _sem = asyncio.Semaphore(MAX_CONCURRENT)
    async with _sem:
        await asyncio.to_thread(_run_task, task, req)


@app.post("/infer", status_code=202)
async def infer(req: InferRequest, authorization: Optional[str] = Header(default=None)):
    _auth(authorization)
    try:
        await asyncio.to_thread(assert_safe_url, req.image_url)
    except UnsafeUrlError:
        raise HTTPException(status_code=400, detail={"error": "unsafe_url", "message": "The image address is not allowed. Use a public https link."})
    task_id = uuid.uuid4().hex
    task = {"task_id": task_id, "job_id": req.job_id, "status": "queued", "stage": "queued", "progress": 0.0, "created_at": time.time()}
    _tasks[task_id] = task
    while len(_tasks) > TASK_HISTORY:
        _tasks.pop(next(iter(_tasks)))
    asyncio.create_task(_runner(task, req))
    return {"task_id": task_id}


@app.get("/tasks/{task_id}")
async def get_task(task_id: str, authorization: Optional[str] = Header(default=None)):
    _auth(authorization)
    task = _tasks.get(task_id)
    if task is None:
        if len(task_id) != 32 or not all(c in "0123456789abcdef" for c in task_id):
            raise HTTPException(status_code=404, detail={"error": "not_found", "message": "No such task."})
        manifest = await asyncio.to_thread(get_store().read_json, f"depth/{task_id}/task.json")
        if manifest is None:
            raise HTTPException(status_code=404, detail={"error": "not_found", "message": "No such task."})
        task = manifest
    return await asyncio.to_thread(_public, task)


@app.get("/health")
async def health():
    import torch
    import pano_depth

    return {
        "ok": True,
        "gpu_available": bool(torch.cuda.is_available()),
        "model": pano_depth.MODEL_ID,
        "weights_present": os.path.isfile(WEIGHTS_PATH),
        "model_loaded": _model is not None,
    }
