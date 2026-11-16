"""
three.ws GPU quickstart studio: the HTTP face of the local TripoSR engine.

  GET  /                     the studio page (upload or pick a sample, view the GLB)
  GET  /health               200 once the model is resident on the GPU, 503 before
  GET  /api/system           GPU, driver, CUDA and load timings
  GET  /api/samples          bundled sample inputs
  POST /api/generate         multipart: image=<file> or sample=<name>, resolution=<int>
  GET  /outputs/<id>.glb     a generated mesh
  GET  /outputs/<id>.png     the matted input the model actually saw
  POST /api/node/self-test   run the three.ws inference node's proof workload on CUDA

The notebook drives the same endpoints, so the model is loaded once per
container no matter how many cells or browser tabs use it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .core import (
    InputError,
    is_output_id,
    is_sample_name,
    new_output_id,
    open_image,
    parse_node_self_test,
    parse_resolution,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("three-ws.studio")

APP_DIR = Path(__file__).resolve().parent
SAMPLES_DIR = Path(os.environ.get("THREE_WS_SAMPLES", "/opt/three-ws/samples"))
OUTPUT_DIR = Path(os.environ.get("THREE_WS_OUTPUTS", "/workspace/outputs"))
NODE_DIR = Path(os.environ.get("THREE_WS_NODE_DIR", "/opt/node-operator"))
NODE_IDENTITY = os.environ.get("IDENTITY_PATH", "/workspace/identity/node-identity.json")

state: dict = {"engine": None, "error": None, "started_at": time.time(), "ready_at": None}


def _load_engine() -> None:
    from .engine import Engine

    try:
        state["engine"] = Engine()
        state["ready_at"] = time.time()
    except Exception as exc:
        log.exception("engine failed to load")
        state["error"] = str(exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    # Load in the background so /health answers 503 with a reason while the
    # 1.7 GB checkpoint moves to the GPU, instead of the port being closed.
    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, _load_engine)
    yield


app = FastAPI(title="three.ws GPU quickstart", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=APP_DIR / "static"), name="static")


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse((APP_DIR / "static" / "index.html").read_text(encoding="utf-8"))


@app.get("/health")
def health() -> JSONResponse:
    engine = state["engine"]
    body = {
        "ok": engine is not None,
        "model": "TripoSR",
        "model_loaded": engine is not None,
        "uptime_s": round(time.time() - state["started_at"], 1),
    }
    if engine is not None:
        body["gpu_name"] = engine.gpu_name
        body["startup_to_ready_s"] = round(state["ready_at"] - state["started_at"], 1)
        return JSONResponse(body)
    body["status"] = "failed" if state["error"] else "loading"
    if state["error"]:
        body["error"] = state["error"]
    return JSONResponse(body, status_code=503)


def _require_engine():
    engine = state["engine"]
    if engine is None:
        detail = state["error"] or "the model is still loading onto the GPU; retry in a few seconds"
        raise HTTPException(status_code=503, detail=detail)
    return engine


def _nvidia_smi() -> dict:
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip().splitlines()[0]
    except (OSError, subprocess.SubprocessError, IndexError) as exc:
        return {"error": f"nvidia-smi unavailable: {exc}"}
    name, driver, total, used, util = [part.strip() for part in out.split(",")]
    return {
        "name": name,
        "driver_version": driver,
        "memory_total_mb": int(total),
        "memory_used_mb": int(used),
        "utilization_pct": int(util),
    }


@app.get("/api/system")
def system() -> dict:
    engine = _require_engine()
    return {"engine": engine.describe(), "nvidia_smi": _nvidia_smi()}


@app.get("/api/samples")
def samples() -> dict:
    names = sorted(p.name for p in SAMPLES_DIR.iterdir() if is_sample_name(p.name))
    return {"samples": [{"name": n, "url": f"/samples/{n}"} for n in names]}


@app.get("/samples/{name}")
def sample_file(name: str) -> FileResponse:
    path = SAMPLES_DIR / name
    if not is_sample_name(name) or not path.is_file():
        raise HTTPException(status_code=404, detail="no such sample")
    return FileResponse(path)


@app.post("/api/generate")
async def generate(
    image: UploadFile | None = File(default=None),
    sample: str | None = Form(default=None),
    resolution: str | None = Form(default=None),
) -> dict:
    engine = _require_engine()
    try:
        mc_resolution = parse_resolution(resolution)
        if image is not None:
            data = await image.read()
            source = image.filename or "upload"
        elif sample:
            if not is_sample_name(sample) or not (SAMPLES_DIR / sample).is_file():
                raise InputError(f"unknown sample {sample!r}")
            data = (SAMPLES_DIR / sample).read_bytes()
            source = sample
        else:
            raise InputError("send an image file or a sample name")
        img = open_image(data)
    except InputError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    loop = asyncio.get_running_loop()
    started = time.perf_counter()
    try:
        result = await loop.run_in_executor(None, engine.generate, img, mc_resolution)
    except InputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("generation failed for %s", source)
        raise HTTPException(status_code=500, detail=f"generation failed: {type(exc).__name__}: {exc}") from exc
    wall_ms = round((time.perf_counter() - started) * 1000, 1)

    output_id = new_output_id()
    (OUTPUT_DIR / f"{output_id}.glb").write_bytes(result["glb"])
    (OUTPUT_DIR / f"{output_id}.png").write_bytes(result["input_png"])
    record = {
        "id": output_id,
        "source": source,
        "glb_url": f"/outputs/{output_id}.glb",
        "input_url": f"/outputs/{output_id}.png",
        "timings": result["timings"],
        "request_wall_ms": wall_ms,
        "mesh": result["mesh"],
        "peak_gpu_memory_mb": result["peak_gpu_memory_mb"],
        "gpu_name": engine.gpu_name,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (OUTPUT_DIR / f"{output_id}.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    log.info("generated %s from %s in %.0f ms on %s", output_id, source, wall_ms, engine.gpu_name)
    return record


@app.get("/outputs/{filename}")
def output_file(filename: str) -> FileResponse:
    stem, _, ext = filename.partition(".")
    if not is_output_id(stem) or ext not in ("glb", "png", "json"):
        raise HTTPException(status_code=404, detail="no such output")
    path = OUTPUT_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="no such output")
    media = {"glb": "model/gltf-binary", "png": "image/png", "json": "application/json"}[ext]
    return FileResponse(path, media_type=media)


@app.post("/api/node/self-test")
async def node_self_test() -> dict:
    """Run the inference node's proof workload (MiniLM-L6 on ONNX Runtime CUDA)."""
    env = {**os.environ, "DEVICE": "cuda", "IDENTITY_PATH": NODE_IDENTITY}
    Path(NODE_IDENTITY).parent.mkdir(parents=True, exist_ok=True)

    def _run() -> subprocess.CompletedProcess:
        return subprocess.run(
            ["node", "src/index.js", "--self-test"],
            cwd=NODE_DIR, env=env, capture_output=True, text=True, timeout=300,
        )

    loop = asyncio.get_running_loop()
    started = time.perf_counter()
    proc = await loop.run_in_executor(None, _run)
    wall_ms = round((time.perf_counter() - started) * 1000, 1)
    output = proc.stdout + proc.stderr
    try:
        parsed = parse_node_self_test(output)
    except ValueError:
        raise HTTPException(status_code=500, detail={"error": "node self-test failed", "output": output[-4000:]})
    parsed["process_wall_ms"] = wall_ms
    parsed["exit_code"] = proc.returncode
    return parsed
