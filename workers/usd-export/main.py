"""OpenUSD export service: a Forge GLB in, a validated simulation-ready USD package out.

Runs export.py (glTF -> UsdGeom/UsdShade/UsdSkel, CoACD collision, UsdPhysics
mass, UsdSemantics labels) and both validators (OpenUSD UsdValidation, the
usdchecker engine, and NVIDIA's omniverse-asset-validator) on every job, then
uploads the package to GCS. CPU only.

API contract:
  POST /export {
    glb_url: https url of a .glb (required; meshopt-compressed input is decoded),
    prompt?: str,          # drives the semantic class, density and typical size
    category?: str,        # forge model_category, a fallback when the prompt is unclassified
    label?: str,           # override of the semantic class label
    size_m?: float,        # override of the longest dimension in meters
    density_kg_m3?: float, # override of the material density
    creation_id?: str,     # recorded in the asset metadata
  } -> 202 { task_id, status, stage }     (200 with the finished task on a cache hit)

  GET /tasks/{task_id} -> {
    task_id, status: queued|running|done|error, stage, stages,
    files?: { usd, usda, usdz, zip, report }, summary?, error?
  }

  GET /health -> { ok, service, exporter, openusd }

Jobs are content-addressed: task_id = sha256(glb_url, options, exporter
version), and the task record lives in GCS at usd/<task_id>/status.json, so a
repeat request is a cache hit and any instance can answer a poll.

Environment variables:
  API_KEY        bearer secret (required)
  GCS_BUCKET     output bucket (required)
  MAX_CONCURRENT parallel exports per instance (default 2; CoACD is CPU bound)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import shutil
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from google.cloud import storage
from pydantic import BaseModel, Field, field_validator

from export import EXPORTER_VERSION, STAGES, ExportOptions, export_glb
from gltf_meshopt import decode_if_meshopt
from gltf_reader import InputFormatError
from worker_security import UnsafeUrlError, assert_safe_url, fetch_remote_bytes, require_api_key, safe_error

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("usd-export")

API_KEY = os.environ["API_KEY"]
GCS_BUCKET = os.environ["GCS_BUCKET"]
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "2"))
MAX_GLB_BYTES = 96 * 1024 * 1024
PREFIX = "usd"
# A record stuck in queued/running longer than this belonged to an instance
# that died mid-job; the next request for the same key starts it again.
STALE_SECONDS = 1800

CONTENT_TYPES = {
    ".usd": "model/vnd.usd",
    ".usda": "model/vnd.usda",
    ".usdz": "model/vnd.usdz+zip",
    ".zip": "application/zip",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
}

_bucket: Optional[storage.Bucket] = None
_sem: Optional[asyncio.Semaphore] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _bucket, _sem
    _bucket = storage.Client().bucket(GCS_BUCKET)
    _sem = asyncio.Semaphore(MAX_CONCURRENT)
    from pxr import Usd

    log.info("usd-export ready: %s, OpenUSD %s", EXPORTER_VERSION, Usd.GetVersion())
    yield


app = FastAPI(title="usd-export-service", lifespan=lifespan)


class ExportRequest(BaseModel):
    glb_url: str = Field(..., max_length=2048)
    prompt: Optional[str] = Field(None, max_length=2000)
    category: Optional[str] = Field(None, max_length=64)
    label: Optional[str] = Field(None, max_length=64)
    size_m: Optional[float] = Field(None, gt=0.01, le=500)
    density_kg_m3: Optional[float] = Field(None, gt=1, le=25000)
    creation_id: Optional[str] = Field(None, max_length=128)

    @field_validator("glb_url")
    @classmethod
    def _https(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith("https://"):
            raise ValueError("glb_url must be an https URL")
        return v

    def options_key(self) -> dict:
        return self.model_dump(exclude={"creation_id"})


def task_key(req: ExportRequest) -> str:
    body = json.dumps({"exporter": EXPORTER_VERSION, **req.options_key()}, sort_keys=True)
    return hashlib.sha256(body.encode()).hexdigest()[:40]


def _auth(authorization: Optional[str]) -> None:
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def _status_blob(key: str) -> storage.Blob:
    return _bucket.blob(f"{PREFIX}/{key}/status.json")


def _read_status(key: str) -> Optional[dict]:
    blob = _status_blob(key)
    try:
        return json.loads(blob.download_as_bytes())
    except Exception as exc:  # NotFound and transient read errors both mean "no record"
        if exc.__class__.__name__ != "NotFound":
            log.warning("status read failed for %s: %s", key, type(exc).__name__)
        return None


def _write_status(key: str, record: dict) -> None:
    record = {**record, "updated_at": int(time.time())}
    blob = _status_blob(key)
    blob.cache_control = "no-store"
    blob.upload_from_string(json.dumps(record), content_type="application/json")


def _public_url(key: str, rel: str) -> str:
    return f"https://storage.googleapis.com/{GCS_BUCKET}/{PREFIX}/{key}/{rel}"


def _summary(report: dict) -> dict:
    v = report.get("validation") or {}
    phys = report.get("physics") or {}

    def counts(kind: str) -> dict:
        r = v.get(kind) or {}
        return {tool: {"errors": len(r[tool]["errors"]), "warnings": len(r[tool]["warnings"])}
                for tool in ("usdchecker", "asset_validator") if tool in r}

    return {
        "label": report["semantics"]["label"],
        "group": report["semantics"].get("group"),
        "classified_by": report["semantics"].get("source"),
        "rigged": report.get("rigged"),
        "animated": report.get("animated"),
        "size_m": report["stats"].get("size_m"),
        "triangles": report["stats"].get("triangles"),
        "joints": report["stats"].get("joints"),
        "mass_kg": phys.get("mass_kg"),
        "mass_method": phys.get("mass_method"),
        "body": phys.get("body"),
        "hulls": (phys.get("collision") or {}).get("hulls"),
        "scale": report.get("scale"),
        "validation": {"passed": v.get("passed"), "usd": counts("usd"), "usdz": counts("usdz")},
        "seconds": report.get("seconds"),
    }


def _upload_dir(key: str, out_dir: Path) -> dict:
    for path in sorted(out_dir.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(out_dir).as_posix()
        blob = _bucket.blob(f"{PREFIX}/{key}/{rel}")
        blob.cache_control = "public, max-age=31536000, immutable"
        blob.upload_from_filename(str(path), content_type=CONTENT_TYPES.get(path.suffix, "application/octet-stream"))
    return {name: _public_url(key, f"asset.{ext}") for name, ext in
            (("usd", "usd"), ("usda", "usda"), ("usdz", "usdz"), ("zip", "zip"))} | {
        "report": _public_url(key, "report.json")}


def _run_export(key: str, req: ExportRequest, record: dict) -> None:
    def stage(name: str) -> None:
        record.update(status="running", stage=name)
        _write_status(key, record)

    work = Path(tempfile.mkdtemp(prefix="usd-export-"))
    try:
        stage("fetching")
        raw = fetch_remote_bytes(req.glb_url, timeout=60.0, max_bytes=MAX_GLB_BYTES)
        glb, _ = decode_if_meshopt(raw, ".glb")
        report = export_glb(glb, str(work / "out"), ExportOptions(
            prompt=req.prompt, category=req.category, label=req.label, size_m=req.size_m,
            density_kg_m3=req.density_kg_m3, source_url=req.glb_url, creation_id=req.creation_id,
        ), on_stage=stage)
        summary = _summary(report)
        if not report["validation"]["passed"]:
            failing = [f"{kind}/{tool}: {e['rule']}: {e['message'][:160]}"
                       for kind in ("usd", "usdz") for tool in ("usdchecker", "asset_validator")
                       for e in report["validation"][kind][tool]["errors"]][:5]
            log.error("export %s failed validation: %s", key, failing)
            record.update(status="error", stage="validating", summary=summary,
                          error="the exported USD did not pass validation: " + "; ".join(failing))
            _write_status(key, record)
            return
        stage("uploading")
        files = _upload_dir(key, work / "out")
        record.update(status="done", stage="done", files=files, summary=summary)
        _write_status(key, record)
        log.info("export %s done: %s %s kg, %ss", key, summary["label"], summary["mass_kg"], summary["seconds"])
    except (InputFormatError, UnsafeUrlError, ValueError) as exc:
        # Caller-fixable input problems (unsupported glTF features, Draco, a
        # blocked or oversized URL, a failed meshopt decode) are reported verbatim.
        record.update(status="error", error=str(exc)[:500])
        _write_status(key, record)
    except Exception as exc:
        record.update(status="error", error=safe_error(exc, context=f"usd export {key}"))
        _write_status(key, record)
    finally:
        shutil.rmtree(work, ignore_errors=True)


async def _guarded(key: str, req: ExportRequest, record: dict) -> None:
    async with _sem:
        await asyncio.to_thread(_run_export, key, req, record)


@app.post("/export", status_code=202)
async def export(req: ExportRequest, background: BackgroundTasks, authorization: Optional[str] = Header(None)):
    _auth(authorization)
    try:
        assert_safe_url(req.glb_url)
    except UnsafeUrlError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    key = task_key(req)
    existing = await asyncio.to_thread(_read_status, key)
    if existing:
        age = time.time() - existing.get("updated_at", 0)
        if existing.get("status") == "done":
            return JSONResponse(existing, status_code=200)
        if existing.get("status") in ("queued", "running") and age < STALE_SECONDS:
            return JSONResponse(existing, status_code=202)
    record = {
        "task_id": key, "status": "queued", "stage": "queued", "stages": ["fetching", *STAGES, "uploading"],
        "exporter": EXPORTER_VERSION, "created_at": int(time.time()),
        "request": {k: v for k, v in req.model_dump().items() if v is not None},
    }
    await asyncio.to_thread(_write_status, key, record)
    background.add_task(_guarded, key, req, record)
    return record


@app.get("/tasks/{task_id}")
async def get_task(task_id: str, authorization: Optional[str] = Header(None)) -> dict:
    _auth(authorization)
    if not task_id.isalnum() or len(task_id) > 64:
        raise HTTPException(status_code=400, detail="invalid task id")
    record = await asyncio.to_thread(_read_status, task_id)
    if record is None:
        raise HTTPException(status_code=404, detail="task not found")
    return record


@app.get("/health")
async def health() -> dict:
    from pxr import Usd

    return {"ok": True, "service": "usd-export", "exporter": EXPORTER_VERSION,
            "openusd": ".".join(str(x) for x in Usd.GetVersion())}
