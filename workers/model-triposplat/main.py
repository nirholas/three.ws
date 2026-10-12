"""
TripoSplat inference service - single image to 3D Gaussian splat
(VAST-AI-Research, MIT; weights also MIT, VAST-AI/TripoSplat on HuggingFace).

A flow-matching diffusion model decodes straight to a Gaussian splat (position,
scale, rotation, opacity and RGBA per splat), no intermediate mesh. The
pipeline's own `rmbg_path` (BiRefNet) removes the background internally, so
this worker hands it the raw decoded frame.

API contract (standard worker task shape, same as model-triposr/model-trellis):
  POST /infer   { images: [data-uri|url], num_gaussians?: int, seed?: int, job_id?: str }
             ->  202 { task_id, status: "queued", model: "triposplat" }

  GET  /tasks/:id -> { task_id, status, result_gcs_url?, num_gaussians?, error? }

  GET  /health    -> { ok, model, gpu_available }

Model weights pre-population (five safetensors files under WEIGHTS_DIR, per
the upstream README's download section):
  pip install huggingface_hub
  huggingface-cli download VAST-AI/TripoSplat --local-dir /tmp/triposplat
  gsutil -m cp -r /tmp/triposplat gs://three-ws-model-weights/triposplat/

Environment variables:
  API_KEY           - shared bearer secret
  GCS_BUCKET        - Cloud Storage bucket for output splats
  WEIGHTS_DIR       - local path to model weights (default: /weights/triposplat)
  MAX_CONCURRENT    - max parallel inferences (default: 1; the full decoder
                      pass is the heaviest single-image lane this platform runs)
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

import torch
from fastapi import FastAPI, HTTPException, Header, BackgroundTasks
from google.cloud import storage
from pydantic import BaseModel, Field

from image_prep import decode_image, splat_blob_name, splat_public_url
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
log = logging.getLogger("triposplat")

API_KEY = os.environ["API_KEY"]
GCS_BUCKET = os.environ["GCS_BUCKET"]
WEIGHTS_DIR = os.environ.get("WEIGHTS_DIR", "/weights/triposplat")
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "1"))

# TripoSplatPipeline.run() takes an uncapped num_gaussians; the upstream
# examples range 32768-262144, so that range is what this worker has actually
# been measured against. Clamp here rather than let a caller request an
# unbounded decode pass.
MIN_GAUSSIANS = 16_384
MAX_GAUSSIANS = 262_144
DEFAULT_GAUSSIANS = 131_072

_pipe = None
_bucket: Optional[storage.Bucket] = None
_sem: Optional[asyncio.Semaphore] = None
_tasks: dict[str, dict] = {}


def _load_pipeline():
    global _pipe
    # triposplat.py/model.py are not a pip package - the Dockerfile clones the
    # repo onto PYTHONPATH (same pattern as TripoSR's `tsr` package).
    from triposplat import TripoSplatPipeline

    log.info("Loading TripoSplat model from %s", WEIGHTS_DIR)
    _pipe = TripoSplatPipeline(
        ckpt_path=f"{WEIGHTS_DIR}/diffusion_models/triposplat_fp16.safetensors",
        decoder_path=f"{WEIGHTS_DIR}/vae/triposplat_vae_decoder_fp16.safetensors",
        dinov3_path=f"{WEIGHTS_DIR}/clip_vision/dino_v3_vit_h.safetensors",
        flux2_vae_encoder_path=f"{WEIGHTS_DIR}/vae/flux2-vae.safetensors",
        rmbg_path=f"{WEIGHTS_DIR}/background_removal/birefnet.safetensors",
        device="cuda",
    )
    log.info("TripoSplat model loaded")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _bucket, _sem
    _bucket = storage.Client().bucket(GCS_BUCKET)
    _sem = asyncio.Semaphore(MAX_CONCURRENT)
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _load_pipeline)
    log.info("Service ready - max_concurrent=%d", MAX_CONCURRENT)
    yield


app = FastAPI(title="model-triposplat", lifespan=lifespan)


def _require_api_key(authorization: str) -> None:
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def _fetch_image_bytes(url: str) -> bytes:
    # SSRF-hardened: https-only, private/loopback/link-local/metadata IPs
    # rejected after DNS resolution, redirects re-validated per hop, bounded.
    try:
        return fetch_remote_bytes(url, timeout=30)
    except UnsafeUrlError as exc:
        raise ValueError(f"refused to fetch image source: {exc}") from exc


def _decode_image(src: str):
    return decode_image(src, fetch=_fetch_image_bytes)


def _clamp_gaussians(value) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return DEFAULT_GAUSSIANS
    return max(MIN_GAUSSIANS, min(MAX_GAUSSIANS, n))


async def _run_inference(
    task_id: str, images: list[str], num_gaussians: int, seed: Optional[int]
) -> None:
    async with _sem:
        _tasks[task_id]["status"] = "running"
        loop = asyncio.get_event_loop()
        t0 = time.time()
        try:
            img = await loop.run_in_executor(None, _decode_image, images[0])

            def _generate():
                with tempfile.TemporaryDirectory() as tmp:
                    src_path = os.path.join(tmp, "input.png")
                    img.save(src_path, format="PNG")
                    run_kwargs = {"num_gaussians": num_gaussians, "show_progress": False}
                    if seed is not None:
                        run_kwargs["seed"] = seed
                    gaussian, _prepared = _pipe.run(src_path, **run_kwargs)
                    out_path = os.path.join(tmp, "output.splat")
                    gaussian.save_splat(out_path)
                    with open(out_path, "rb") as f:
                        return f.read()

            splat_bytes = await loop.run_in_executor(None, _generate)

            blob_name = splat_blob_name(task_id)
            blob = _bucket.blob(blob_name)
            await loop.run_in_executor(
                None,
                lambda: blob.upload_from_string(splat_bytes, content_type="application/octet-stream"),
            )
            gcs_url = splat_public_url(GCS_BUCKET, blob_name)

            elapsed = time.time() - t0
            _tasks[task_id].update({
                "status": "done",
                "result_gcs_url": gcs_url,
                "num_gaussians": num_gaussians,
                "bytes": len(splat_bytes),
                "elapsed_ms": int(elapsed * 1000),
            })
            log.info(
                "[%s] done in %.1fs - %d splats, %d bytes -> %s",
                task_id, elapsed, num_gaussians, len(splat_bytes), gcs_url,
            )

        except Exception as exc:
            _tasks[task_id].update({
                "status": "failed",
                "error": safe_error(exc, context=f"[{task_id}] inference"),
                "elapsed_ms": int((time.time() - t0) * 1000),
            })


class InferRequest(BaseModel):
    images: list[str] = Field(..., min_length=1, max_length=6)
    num_gaussians: int | None = None
    seed: int | None = None
    job_id: str | None = None


@app.post("/infer", status_code=202)
async def infer(
    body: InferRequest,
    background_tasks: BackgroundTasks,
    authorization: str = Header(...),
) -> dict:
    _require_api_key(authorization)
    task_id = str(uuid.uuid4())
    num_gaussians = (
        _clamp_gaussians(body.num_gaussians) if body.num_gaussians is not None else DEFAULT_GAUSSIANS
    )
    _tasks[task_id] = {"task_id": task_id, "status": "queued", "model": "triposplat"}
    background_tasks.add_task(_run_inference, task_id, body.images, num_gaussians, body.seed)
    return {"task_id": task_id, "status": "queued", "model": "triposplat"}


@app.get("/tasks/{task_id}")
async def get_task(task_id: str, authorization: str = Header(...)) -> dict:
    _require_api_key(authorization)
    task = _tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@app.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "model": "triposplat",
        "gpu_available": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "model_loaded": _pipe is not None,
    }
