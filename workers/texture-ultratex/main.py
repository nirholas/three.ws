"""texture-ultratex: UltraTex texturing behind the workers/texture HTTP contract.

OFF BY DEFAULT. Every route except /health answers 503 `license_gate_closed`
until ULTRATEX_BASE_MODEL_LICENSE_ACK is set (see contract.py). The surface is
identical to workers/texture so the router selects a worker by URL alone:
POST /texture -> 202 {task_id, status}; GET /tasks/{id}; GET /health.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException

from contract import TextureRequest, license_gate
from tracing import install_tracing
from ultratex_runner import RunnerUnavailable, run_ultratex
from worker_security import fetch_remote_bytes, require_api_key, safe_error

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("texture-ultratex")

API_KEY = os.environ["API_KEY"]
GCS_BUCKET = os.environ.get("GCS_BUCKET", "")
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "1"))
JOB_TIMEOUT_S = int(os.environ.get("JOB_TIMEOUT_S", "540"))
MAX_MESH_BYTES = 200 * 1024 * 1024

_tasks: dict[str, dict] = {}
_sem = asyncio.Semaphore(MAX_CONCURRENT)
_bucket = None

app = FastAPI(title="texture-ultratex")
install_tracing(app, "texture-ultratex")


def _bucket_handle():
    global _bucket
    if _bucket is None:
        from google.cloud import storage

        _bucket = storage.Client().bucket(GCS_BUCKET)
    return _bucket


def _require_open_gate() -> None:
    gate = license_gate()
    if not gate["open"]:
        raise HTTPException(status_code=503, detail={"error": "license_gate_closed", **gate})


def _auth(authorization: str) -> None:
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


async def _process(task_id: str, body: TextureRequest) -> None:
    async with _sem:
        task = _tasks[task_id]
        task["status"] = "running"
        loop = asyncio.get_running_loop()
        t0 = time.time()
        try:
            mesh = await loop.run_in_executor(
                None, lambda: fetch_remote_bytes(body.mesh, max_bytes=MAX_MESH_BYTES)
            )
            glb = await asyncio.wait_for(
                loop.run_in_executor(
                    None, run_ultratex, mesh, body.prompt, body.negative_prompt,
                    body.num_views, body.texture_size, JOB_TIMEOUT_S,
                ),
                JOB_TIMEOUT_S + 15,
            )
            blob_name = f"textured-ultratex/{task_id}.glb"
            blob = _bucket_handle().blob(blob_name)
            await loop.run_in_executor(
                None, lambda: blob.upload_from_string(glb, content_type="model/gltf-binary")
            )
            task.update({
                "status": "done",
                "result_url": f"https://storage.googleapis.com/{GCS_BUCKET}/{blob_name}",
                "bytes": len(glb),
                "elapsed_ms": int((time.time() - t0) * 1000),
            })
        except RunnerUnavailable as exc:
            task.update({"status": "failed", "error": str(exc), "elapsed_ms": int((time.time() - t0) * 1000)})
        except Exception as exc:
            task.update({
                "status": "failed",
                "error": safe_error(exc, context=f"[{task_id}] ultratex"),
                "elapsed_ms": int((time.time() - t0) * 1000),
            })


@app.post("/texture", status_code=202)
async def texture_mesh(body: TextureRequest, background_tasks: BackgroundTasks,
                       authorization: str = Header(...)) -> dict:
    _auth(authorization)
    _require_open_gate()
    task_id = str(uuid.uuid4())
    _tasks[task_id] = {"task_id": task_id, "status": "queued", "prompt": body.prompt}
    background_tasks.add_task(_process, task_id, body)
    return {"task_id": task_id, "status": "queued"}


@app.get("/tasks/{task_id}")
async def get_task(task_id: str, authorization: str = Header(...)) -> dict:
    _auth(authorization)
    task = _tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@app.get("/health")
async def health() -> dict:
    gate = license_gate()
    return {
        "ok": True,
        "service": "texture-ultratex",
        "license_gate_open": gate["open"],
        "license_gate_env": gate["env"],
        "runtime_configured": bool(os.environ.get("ULTRATEX_INFER_CMD", "").strip()),
    }
