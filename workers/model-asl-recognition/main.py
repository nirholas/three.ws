"""ASL fingerspelling recognition worker.

Turns webcam signing into text: the browser extracts MediaPipe landmarks
client-side (tasks-vision), assembles the 390-column feature rows published by
GET /schema, and POSTs the frame matrix here; the worker runs the Kaggle-2023
1st-place fingerspelling model (Apache-2.0 weights, FSboard CC BY 4.0 corpus)
on CPU via LiteRT and returns the decoded text. Recognition is in-request
(sub-second for a typical utterance), so the service scales to zero.

API (bearer auth via API_KEY, same secret family as the reconstruction lanes):
  GET  /health      → { ok, model_loaded }
  GET  /schema      → { columns: [390 names], max_frames, min_frames }
  POST /transcribe  { frames: [[390 floats|null]...] }
                    → { text, confidence, frames, ms }
  GET  /signs-schema     → { columns, max_frames, min_frames, labels, top_k }
  POST /recognize-signs  { frames: [[390 floats|null]...] }
                    → { signs: [{sign, probability} x5], confidence, frames, ms }
                      (word-level; 503 signs_model_unavailable until the
                      PopSign model is baked in, see training/RESULTS.md)
"""

from __future__ import annotations

import asyncio
import hmac
import os
import time
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from decode import FEATURE_COLUMNS, MAX_FRAMES, MIN_FRAMES, decode_with_confidence, validate_frames
from signs import TOP_K, load_labels, top_k

MODEL_PATH = os.environ.get("MODEL_PATH", "/models/model.tflite")
API_KEY = os.environ.get("API_KEY", "")
# Word-level model: optional. The service serves fingerspelling without it and
# answers /recognize-signs with 503 rather than guessing.
SIGNS_MODEL_PATH = os.environ.get("SIGNS_MODEL_PATH", "/models/signs.tflite")
SIGNS_LABELS_PATH = os.environ.get("SIGNS_LABELS_PATH", "/models/signs_labels.json")

_runner = None
_input_name = None
_signs_runner = None
_signs_input_name = None
_signs_labels: list[str] = []
_lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _runner, _input_name
    from ai_edge_litert.interpreter import Interpreter

    interp = Interpreter(model_path=MODEL_PATH)
    _runner = interp.get_signature_runner()
    _input_name = list(_runner.get_input_details().keys())[0]
    _load_signs_model(Interpreter)
    yield


def _load_signs_model(Interpreter) -> None:
    global _signs_runner, _signs_input_name, _signs_labels
    if not (os.path.exists(SIGNS_MODEL_PATH) and os.path.exists(SIGNS_LABELS_PATH)):
        return
    labels = load_labels(SIGNS_LABELS_PATH)
    runner = Interpreter(model_path=SIGNS_MODEL_PATH).get_signature_runner()
    _signs_input_name = list(runner.get_input_details().keys())[0]
    _signs_labels = labels
    _signs_runner = runner


app = FastAPI(lifespan=lifespan)


def _check_auth(request: Request) -> None:
    # Fails closed like every other worker: an unset API_KEY must not turn the
    # public Cloud Run URL into an open inference endpoint. Constant-time
    # compare so the key cannot be recovered byte by byte from response timing.
    header = request.headers.get("authorization", "")
    expected = f"Bearer {API_KEY}"
    if not API_KEY or not hmac.compare_digest(header.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=401, detail="unauthorized")


class TranscribeBody(BaseModel):
    frames: list[list[float | None]]


@app.get("/health")
async def health():
    return {"ok": True, "model_loaded": _runner is not None, "signs_model_loaded": _signs_runner is not None}


@app.get("/schema")
async def schema(request: Request):
    _check_auth(request)
    return {"columns": FEATURE_COLUMNS, "max_frames": MAX_FRAMES, "min_frames": MIN_FRAMES}


@app.post("/transcribe")
async def transcribe(body: TranscribeBody, request: Request):
    _check_auth(request)
    try:
        arr = validate_frames(body.frames)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    t0 = time.time()
    async with _lock:
        logits = await asyncio.to_thread(_infer, arr)
    text, confidence = decode_with_confidence(logits)
    return {
        "text": text,
        "confidence": round(confidence, 3),
        "frames": int(arr.shape[0]),
        "ms": int((time.time() - t0) * 1000),
    }


def _infer(arr: np.ndarray) -> np.ndarray:
    out = _runner(**{_input_name: arr})
    return next(iter(out.values()))


@app.get("/signs-schema")
async def signs_schema(request: Request):
    _check_auth(request)
    return {
        "columns": FEATURE_COLUMNS,
        "max_frames": MAX_FRAMES,
        "min_frames": MIN_FRAMES,
        "labels": len(_signs_labels),
        "top_k": TOP_K,
    }


@app.post("/recognize-signs")
async def recognize_signs(body: TranscribeBody, request: Request):
    _check_auth(request)
    if _signs_runner is None or not _signs_labels:
        raise HTTPException(status_code=503, detail="signs_model_unavailable")
    try:
        arr = validate_frames(body.frames)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    t0 = time.time()
    async with _lock:
        logits = await asyncio.to_thread(_signs_infer, arr)
    signs = top_k(logits, _signs_labels, TOP_K)
    return {
        "signs": signs,
        "confidence": signs[0]["probability"],
        "frames": int(arr.shape[0]),
        "ms": int((time.time() - t0) * 1000),
    }


def _signs_infer(arr: np.ndarray) -> np.ndarray:
    out = _signs_runner(**{_signs_input_name: arr})
    return next(iter(out.values()))
