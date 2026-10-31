"""LATO.2 artist-mesh retopology worker (Meshy, MIT code and weights).

Mesh in, clean low-poly triangle mesh out (200 to 5000 vertices). LATO.2 is a
generative sampler (V-Flow places vertices, T-Flow connects them) so it can tear
the topology; every result is gated by lato_policy and re-drawn with another seed,
and a mesh that never passes is reported as `error_kind: "quality"` so the API
falls back to QuadriFlow instead of shipping a broken asset.

  POST /retopo  {mesh: url, target_faces?: 200..10000, output_format?: glb}  -> 202 {task_id}
  GET  /tasks/{id}
  GET  /health
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import trimesh
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from google.cloud import storage
from pydantic import BaseModel, Field, field_validator

import lato_policy as lp
import lato_run as lr
from gltf_meshopt import decode_if_meshopt
from worker_security import UnsafeUrlError, fetch_remote_bytes, require_api_key, safe_error

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("lato2")

API_KEY = os.environ["API_KEY"]
GCS_BUCKET = os.environ["GCS_BUCKET"]
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "1"))
MAX_MESH_BYTES = 128 * 1024 * 1024
INPUT_SUFFIXES = {".glb", ".gltf", ".obj", ".stl", ".ply", ".off"}
OUTPUT_FORMATS = {"glb", "obj", "ply"}

_bucket: Optional[storage.Bucket] = None
_sem: Optional[asyncio.Semaphore] = None
_tasks: dict[str, dict] = {}


class InputError(ValueError):
    """The caller's file cannot be used; the message is safe to return verbatim."""


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _bucket, _sem
    _bucket = storage.Client().bucket(GCS_BUCKET)
    _sem = asyncio.Semaphore(MAX_CONCURRENT)
    ckpt = lr.LATO_ROOT / "ckpt"
    present = sorted(p.name for p in ckpt.glob("*.pt")) if ckpt.is_dir() else []
    log.info("lato2 ready, %d checkpoints in %s", len(present), ckpt)
    yield


app = FastAPI(title="model-lato2", lifespan=lifespan)


def _auth(authorization: str) -> None:
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def _load_source(url: str) -> trimesh.Trimesh:
    try:
        data = fetch_remote_bytes(url, timeout=60, max_bytes=MAX_MESH_BYTES)
    except UnsafeUrlError as exc:
        raise InputError(f"refused to fetch mesh: {exc}") from exc
    suffix = Path(url.split("?")[0]).suffix.lower()
    if suffix not in INPUT_SUFFIXES:
        suffix = ".glb"
    data, suffix = decode_if_meshopt(data, suffix)
    try:
        loaded = trimesh.load(io.BytesIO(data), file_type=suffix.lstrip("."), process=False)
    except Exception as exc:
        raise InputError(f"could not read the mesh as {suffix.lstrip('.').upper()}") from exc
    if isinstance(loaded, trimesh.Scene):
        parts = [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh)]
        if not parts:
            raise InputError("the file contains no triangle geometry")
        textured = [m for m in parts if getattr(m.visual, "kind", None) == "texture"]
        loaded = max(textured, key=lambda m: len(m.faces)) if textured else trimesh.util.concatenate(parts)
    if not isinstance(loaded, trimesh.Trimesh) or len(loaded.faces) == 0:
        raise InputError("the file contains no triangle geometry")
    return loaded


def _export(result: lr.RetopoResult, fmt: str) -> tuple[bytes, str]:
    mesh = trimesh.Trimesh(result.vertices, result.faces, process=False)
    if result.colors is not None:
        mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, vertex_colors=result.colors)
    mesh.fix_normals()
    ctype = {"glb": "model/gltf-binary", "obj": "text/plain", "ply": "application/octet-stream"}[fmt]
    return mesh.export(file_type=fmt), ctype


def _run(mesh_url: str, target_faces: int, fmt: str) -> tuple[bytes, str, lr.RetopoResult]:
    source = _load_source(mesh_url)
    result = lr.retopologize(source, target_faces)
    blob, ctype = _export(result, fmt)
    return blob, ctype, result


async def _process(task_id: str, mesh_url: str, target_faces: int, fmt: str) -> None:
    async with _sem:
        task = _tasks[task_id]
        task["status"] = "running"
        t0 = time.time()
        loop = asyncio.get_event_loop()
        try:
            blob, ctype, res = await loop.run_in_executor(None, _run, mesh_url, target_faces, fmt)
            name = f"lato2/{task_id}.{fmt}"
            await loop.run_in_executor(
                None, lambda: _bucket.blob(name).upload_from_string(blob, content_type=ctype))
            task.update({
                "status": "done",
                "result_url": f"https://storage.googleapis.com/{GCS_BUCKET}/{name}",
                "face_count": res.report["faces"],
                "vertex_count": res.report["vertices"],
                "watertight": res.report["watertight"],
                "boundary_edge_ratio": round(res.report["boundary_edge_ratio"], 4),
                "fidelity": round(res.fidelity, 4),
                "seed": res.seed,
                "attempts": res.attempts,
                "textured": res.colors is not None,
                "texture_kind": "vertex_color" if res.colors is not None else None,
                "output_format": fmt,
                "bytes": len(blob),
                "elapsed_ms": int((time.time() - t0) * 1000),
            })
        except InputError as exc:
            task.update({"status": "failed", "error": str(exc), "error_kind": "input",
                         "elapsed_ms": int((time.time() - t0) * 1000)})
        except lr.RetopoRejected as exc:
            log.info("[%s] gated out: %s %s", task_id, exc.reason, exc.attempts)
            task.update({"status": "failed", "error_kind": "quality", "error": exc.reason,
                         "attempts": exc.attempts,
                         "elapsed_ms": int((time.time() - t0) * 1000)})
        except Exception as exc:
            task.update({"status": "failed", "error_kind": "internal",
                         "error": safe_error(exc, context=f"[{task_id}] lato2"),
                         "elapsed_ms": int((time.time() - t0) * 1000)})


class RetopoRequest(BaseModel):
    mesh: str = Field(..., description="https URL of the input mesh (GLB/GLTF/OBJ/STL/PLY/OFF)")
    target_faces: int = Field(default=4000, ge=200, le=10_000)
    output_format: str = Field(default="glb")

    @field_validator("output_format")
    @classmethod
    def _fmt(cls, v: str) -> str:
        v = v.lower().lstrip(".")
        if v not in OUTPUT_FORMATS:
            raise ValueError(f"output_format must be one of {sorted(OUTPUT_FORMATS)}")
        return v


@app.post("/retopo", status_code=202)
async def retopo(body: RetopoRequest, background_tasks: BackgroundTasks,
                 authorization: str = Header(...)) -> dict:
    _auth(authorization)
    task_id = str(uuid.uuid4())
    _tasks[task_id] = {"task_id": task_id, "status": "queued", "output_format": body.output_format,
                       "vertex_budget": lp.vertex_budget_from_faces(body.target_faces)}
    background_tasks.add_task(_process, task_id, body.mesh, body.target_faces, body.output_format)
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
    return {"ok": True, "service": "model-lato2"}
