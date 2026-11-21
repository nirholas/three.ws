"""
model-pano2splat: 360 footage to a Gaussian splat scene.

A service shell around three stage CLIs (pano_stitch, pano_sfm, splat_train) that
run as subprocesses. Implements contract C1 of prompts/finish/_context/insta360-00-CONTEXT.md.

  POST   /infer          202 { task_id }
  GET    /tasks/{id}     status, stage, progress, result, error
  DELETE /tasks/{id}     cancel (kills the stage process group)
  GET    /health         GPU, COLMAP, gsplat, stage packages

One task runs at a time per instance (the GPU is the bottleneck); the rest wait in
a queue and report status "queued" with their position. Environment:

  API_KEY         bearer secret shared by the reconstruction workers (required)
  RESULT_BUCKET   output bucket (default three-ws-pano-captures)
  STORE_DIR       use a local directory instead of Cloud Storage (offline runs and tests)
  WORK_DIR        scratch space for downloads and stage outputs (default the system temp dir)
  MAX_SOURCE_BYTES  per-task download cap (default 8 GiB)
  SIGNING_SA      override the service account that signs result URLs
"""

from __future__ import annotations

import collections
import logging
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator

import health as health_mod
from pipeline import (
    STITCHED_KINDS,
    PipelineError,
    PipelineRequest,
    run_pipeline,
)
from results import GcsStore, LocalStore
from source_fetch import MAX_SOURCE_BYTES, ByteBudget
from stages import Cancelled, StageRunner
from worker_security import UnsafeUrlError, assert_safe_url, require_api_key, safe_error

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("pano2splat")

RESULT_BUCKET = os.environ.get("RESULT_BUCKET", "three-ws-pano-captures")
MAX_QUEUE = int(os.environ.get("MAX_QUEUE", "8"))
TASK_HISTORY = 256
HEARTBEAT_S = 30.0
# A manifest that says "running" but has not been touched for this long belongs to
# an instance that is gone (scale-in, crash, redeploy).
STALE_AFTER_S = 3 * HEARTBEAT_S

TASK_ID_RE = re.compile(r"^[0-9a-f]{32}$")
MAX_VIDEO_SOURCES = 16
MAX_IMAGE_SOURCES = 1000

RESULT_FIELDS = {
    "ply": ("ply_url", "scene.ply"),
    "spz": ("spz_url", "scene.spz"),
    "preview": ("preview_url", "preview.mp4"),
    "poster": ("poster_url", "poster.jpg"),
}


class Trim(BaseModel):
    start_s: float = Field(0, ge=0)
    end_s: Optional[float] = Field(None, gt=0)

    @model_validator(mode="after")
    def _ordered(self):
        if self.end_s is not None and self.end_s <= self.start_s:
            raise ValueError("trim.end_s must be greater than trim.start_s")
        return self


class InferRequest(BaseModel):
    task: Literal["splat", "stitch"]
    source_url: Optional[str] = Field(None, max_length=4096)
    source_urls: Optional[list[str]] = Field(None, max_length=MAX_IMAGE_SOURCES)
    source_kind: Literal["equirect_video", "equirect_images", "insv", "insp"]
    trim: Optional[Trim] = None
    quality: Literal["preview", "standard", "high"] = "standard"
    job_id: Optional[str] = Field(None, max_length=128)

    def urls(self) -> list[str]:
        urls = ([self.source_url] if self.source_url else []) + list(self.source_urls or [])
        return list(dict.fromkeys(urls))


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def validate_request(req: InferRequest) -> list[str]:
    """Semantic checks the schema cannot express. Returns the de-duplicated URL list."""
    urls = req.urls()
    if not urls:
        raise ApiError(400, "invalid_request", "Provide source_url or source_urls.")
    if req.task == "stitch" and req.source_kind not in STITCHED_KINDS:
        raise ApiError(400, "unsupported_input", "Stitching applies to Insta360 .insv and .insp files only.")
    if req.task == "splat" and req.source_kind == "insp":
        raise ApiError(400, "unsupported_input", "A single 360 photo cannot be reconstructed into a splat. Send a video or several photos.")
    if req.source_kind == "equirect_video" and len(urls) != 1:
        raise ApiError(400, "invalid_request", "equirect_video takes exactly one source file.")
    if req.source_kind == "insp" and len(urls) != 1:
        raise ApiError(400, "invalid_request", "insp takes exactly one source file.")
    if req.source_kind == "insv" and len(urls) > MAX_VIDEO_SOURCES:
        raise ApiError(400, "invalid_request", f"insv takes at most {MAX_VIDEO_SOURCES} source files.")
    for url in urls:
        try:
            assert_safe_url(url)
        except UnsafeUrlError as exc:
            raise ApiError(400, "unsafe_source_url", f"That source address is not allowed: {exc}.") from exc
    return urls


class TaskManager:
    """Queue, single worker thread, task state and manifest persistence."""

    def __init__(self, store, work_dir: Optional[str] = None, max_queue: int = MAX_QUEUE):
        self.store = store
        self.work_dir = work_dir
        self.max_queue = max_queue
        self.lock = threading.Lock()
        self.wake = threading.Condition(self.lock)
        self.tasks: dict[str, dict] = {}
        self.order: collections.deque[str] = collections.deque()
        self.queue: collections.deque[str] = collections.deque()
        self.runners: dict[str, StageRunner] = {}
        self._stop = False
        self._stop_evt = threading.Event()
        self._threads: list[threading.Thread] = []

    # lifecycle
    def start(self) -> None:
        for target in (self._worker_loop, self._heartbeat_loop):
            t = threading.Thread(target=target, daemon=True)
            t.start()
            self._threads.append(t)

    def stop(self) -> None:
        self._stop_evt.set()
        with self.lock:
            self._stop = True
            self.wake.notify_all()

    # submission
    def submit(self, req: InferRequest, urls: list[str]) -> str:
        with self.lock:
            if len(self.queue) >= self.max_queue:
                raise ApiError(429, "busy", "This worker is at capacity. Try again in a few minutes.")
            task_id = uuid.uuid4().hex
            now = time.time()
            task = {
                "task_id": task_id,
                "task": req.task,
                "job_id": req.job_id,
                "source_kind": req.source_kind,
                "quality": req.quality,
                "urls": urls,
                "trim": req.trim.model_dump() if req.trim else None,
                "status": "queued",
                "stage": None,
                "progress": 0.0,
                "created_at": now,
                "updated_at": now,
                "result_keys": None,
                "stats": None,
                "timings_s": None,
                "error": None,
            }
            self.tasks[task_id] = task
            self.order.append(task_id)
            self.queue.append(task_id)
            while len(self.order) > TASK_HISTORY:
                old = self.order.popleft()
                if self.tasks.get(old, {}).get("status") in ("succeeded", "failed", "cancelled"):
                    self.tasks.pop(old, None)
                else:
                    self.order.append(old)
                    break
            self.wake.notify_all()
        self._persist(task_id)
        return task_id

    # reads
    def get(self, task_id: str) -> Optional[dict]:
        with self.lock:
            task = self.tasks.get(task_id)
            if task is not None:
                snap = dict(task)
                snap["queue_position"] = (
                    self.queue.index(task_id) + 1 if task_id in self.queue else None
                )
                return self._public(snap)
        stored = self.store.read_json(f"{task_id}/task.json")
        if stored is None:
            return None
        if stored["status"] in ("queued", "running") and time.time() - stored.get("updated_at", 0) > STALE_AFTER_S:
            stored["status"] = "failed"
            stored["error"] = {
                "code": "worker_lost",
                "message": "The worker running this task restarted before it finished. Submit it again.",
            }
        return self._public(stored)

    def _public(self, t: dict) -> dict:
        body: dict = {
            "task_id": t["task_id"],
            "task": t["task"],
            "job_id": t.get("job_id"),
            "status": t["status"],
            "stage": t.get("stage"),
            "progress": t.get("progress", 0.0),
        }
        if t.get("queue_position") is not None:
            body["queue_position"] = t["queue_position"]
        if t["status"] == "succeeded":
            result: dict = {}
            keys = t.get("result_keys") or {}
            for name, (field, _fname) in RESULT_FIELDS.items():
                if name in keys:
                    result[field] = self.store.signed_url(keys[name])
            if "equirect" in keys:
                result["equirect_url"] = self.store.signed_url(keys["equirect"])
            result["stats"] = t.get("stats") or {}
            body["result"] = result
        if t.get("error"):
            body["error"] = t["error"]
        return body

    # cancel
    def cancel(self, task_id: str) -> Optional[dict]:
        with self.lock:
            task = self.tasks.get(task_id)
            if task is None:
                return None
            if task["status"] == "queued":
                self.queue.remove(task_id)
                task["status"] = "cancelled"
                task["updated_at"] = time.time()
                runner = None
            elif task["status"] == "running":
                runner = self.runners.get(task_id)
            else:
                return {"status": task["status"]}
        if runner is not None:
            runner.cancel()
            deadline = time.time() + 30
            while time.time() < deadline:
                with self.lock:
                    if task["status"] == "cancelled":
                        break
                time.sleep(0.05)
        self._persist(task_id)
        with self.lock:
            return {"status": task["status"] if task["status"] != "running" else "cancelled"}

    # persistence
    def _persist(self, task_id: str) -> None:
        with self.lock:
            task = self.tasks.get(task_id)
            if task is None:
                return
            snap = dict(task)
            snap["updated_at"] = time.time()
            task["updated_at"] = snap["updated_at"]
        try:
            self.store.write_json(f"{task_id}/task.json", snap)
        except Exception:  # noqa: BLE001 - a manifest write must never kill a running task
            log.exception("manifest write failed for %s", task_id)

    def _heartbeat_loop(self) -> None:
        while True:
            if self._stop_evt.wait(HEARTBEAT_S):
                return
            with self.lock:
                active = [tid for tid, t in self.tasks.items() if t["status"] in ("queued", "running")]
            for tid in active:
                self._persist(tid)

    # execution
    def _worker_loop(self) -> None:
        while True:
            with self.lock:
                while not self.queue and not self._stop:
                    self.wake.wait()
                if self._stop:
                    return
                task_id = self.queue.popleft()
                task = self.tasks[task_id]
                task["status"] = "running"
                task["stage"] = "download"
                runner = StageRunner()
                self.runners[task_id] = runner
            self._persist(task_id)
            try:
                self._execute(task_id, task, runner)
            finally:
                with self.lock:
                    self.runners.pop(task_id, None)
                self._persist(task_id)

    def _execute(self, task_id: str, task: dict, runner: StageRunner) -> None:
        work = Path(tempfile.mkdtemp(prefix=f"p2s-{task_id[:8]}-", dir=self.work_dir))
        last_persist = [0.0]

        def report(stage: str, progress: float) -> None:
            with self.lock:
                task["stage"] = stage
                task["progress"] = progress
            if time.time() - last_persist[0] > 5:
                last_persist[0] = time.time()
                self._persist(task_id)

        trim = task.get("trim") or {}
        req = PipelineRequest(
            task=task["task"],
            source_kind=task["source_kind"],
            urls=task["urls"],
            quality=task["quality"],
            trim_start_s=trim.get("start_s") if trim else None,
            trim_end_s=trim.get("end_s") if trim else None,
        )
        try:
            out = run_pipeline(req, work, report, runner, ByteBudget(MAX_SOURCE_BYTES))
            report("upload", 0.97)
            keys = {}
            for name, path in out.files.items():
                fname = path.name if name == "equirect" else RESULT_FIELDS[name][1]
                key = f"{task_id}/{fname}"
                self.store.upload_file(key, path)
                keys[name] = key
            with self.lock:
                task["result_keys"] = keys
                task["stats"] = out.stats
                task["timings_s"] = out.timings_s
                task["status"] = "succeeded"
                task["stage"] = "upload"
                task["progress"] = 1.0
        except Cancelled:
            with self.lock:
                task["status"] = "cancelled"
        except PipelineError as exc:
            log.warning("task %s failed: %s %s", task_id, exc.code, exc.message)
            with self.lock:
                task["status"] = "failed"
                task["error"] = {"code": exc.code, "message": exc.message}
        except Exception as exc:  # noqa: BLE001 - boundary: report, never crash the worker thread
            message = safe_error(exc, context=f"task {task_id}")
            with self.lock:
                task["status"] = "failed"
                task["error"] = {"code": "internal_error", "message": message}
        finally:
            shutil.rmtree(work, ignore_errors=True)


def make_store():
    store_dir = os.environ.get("STORE_DIR")
    return LocalStore(Path(store_dir)) if store_dir else GcsStore(RESULT_BUCKET)


manager: Optional[TaskManager] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global manager
    manager = TaskManager(make_store(), work_dir=os.environ.get("WORK_DIR"))
    manager.start()
    log.info("pano2splat ready: bucket=%s", RESULT_BUCKET)
    yield
    manager.stop()


app = FastAPI(title="model-pano2splat", lifespan=lifespan)


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": code, "message": message})


@app.exception_handler(ApiError)
async def _api_error(_req: Request, exc: ApiError):
    return _error(exc.status, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def _validation_error(_req: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
    return _error(400, "invalid_request", f"Invalid request{': ' + where if where else ''}. {first.get('msg', '')}".strip())


def _auth(authorization: Optional[str]) -> None:
    try:
        require_api_key(authorization, os.environ.get("API_KEY", ""))
    except PermissionError as exc:
        raise ApiError(401, "unauthorized", "Missing or invalid bearer token.") from exc


@app.post("/infer", status_code=202)
def infer(req: InferRequest, authorization: Optional[str] = Header(None)):
    _auth(authorization)
    urls = validate_request(req)
    task_id = manager.submit(req, urls)
    return {"task_id": task_id}


@app.get("/tasks/{task_id}")
def get_task(task_id: str, authorization: Optional[str] = Header(None)):
    _auth(authorization)
    if not TASK_ID_RE.match(task_id):
        raise ApiError(404, "not_found", "No such task.")
    body = manager.get(task_id)
    if body is None:
        raise ApiError(404, "not_found", "No such task.")
    return body


@app.delete("/tasks/{task_id}")
def delete_task(task_id: str, authorization: Optional[str] = Header(None)):
    _auth(authorization)
    if not TASK_ID_RE.match(task_id):
        raise ApiError(404, "not_found", "No such task.")
    res = manager.cancel(task_id)
    if res is None:
        raise ApiError(404, "not_found", "No such task on this worker.")
    return res


@app.get("/health")
def health():
    return health_mod.report(MAX_SOURCE_BYTES)
