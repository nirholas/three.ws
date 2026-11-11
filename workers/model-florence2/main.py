"""
Florence-2 describe service: captions, tags, objects and alt text for the
poster image of every three.ws creation.

API contract:
  POST /describe  { image_url?: https url, image?: data-uri or base64 }
               -> 200 { caption, detailed, tags[], objects[{label, box}],
                        model, model_version, device, latency_ms }
       400 when the image is missing, unreachable, unsafe or not a PNG/JPEG/WEBP.
       Synchronous: one describe is about a second on an L4, well inside a
       request, so there is no task queue to poll.

  GET  /health    -> { ok, loaded, device, model }

Environment variables:
  API_KEY            shared bearer secret (required; avatar-reconstruction-key)
  FLORENCE2_MODEL    weights repo (default florence-community/Florence-2-large-ft)
  FLORENCE2_BEAMS    beam count for generation (default 3)
"""

from __future__ import annotations

import base64
import binascii
import logging
import os
import threading
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

import describe as florence
from fetch import fetch_poster
from worker_security import (
    UnsafeUrlError,
    UnsupportedImageError,
    open_caller_image,
    require_api_key,
    safe_error,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("florence2")

API_KEY = os.environ["API_KEY"]
MAX_IMAGE_BYTES = 12 * 1024 * 1024


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Load in the background so /health answers during the weight load and
    # Cloud Run's startup probe can tell "loading" from "dead".
    threading.Thread(target=florence.load, daemon=True).start()
    yield


app = FastAPI(title="three.ws Florence-2 describe", lifespan=lifespan)


class DescribeRequest(BaseModel):
    image_url: Optional[str] = Field(default=None, max_length=4096)
    image: Optional[str] = Field(default=None, max_length=17_000_000)


def decode_inline(image: str) -> bytes:
    payload = image.split(",", 1)[1] if image.startswith("data:") else image
    try:
        return base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(400, "image is not valid base64") from exc


def image_bytes(req: DescribeRequest) -> bytes:
    if req.image:
        data = decode_inline(req.image)
    elif req.image_url:
        try:
            data = fetch_poster(req.image_url, timeout=20.0, max_bytes=MAX_IMAGE_BYTES)
        except UnsafeUrlError as exc:
            raise HTTPException(400, f"image_url refused: {exc}") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(400, f"image_url could not be fetched ({type(exc).__name__})") from exc
    else:
        raise HTTPException(400, "send image_url or image")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "image is larger than 12 MB")
    return data


@app.get("/health")
def health():
    return {"ok": True, "loaded": florence.loaded(), "device": florence.device(), "model": florence.MODEL_ID}


@app.post("/describe")
async def describe_endpoint(req: DescribeRequest, authorization: Optional[str] = Header(default=None)):
    try:
        require_api_key(authorization, API_KEY)
    except PermissionError as exc:
        raise HTTPException(401, "unauthorized") from exc
    data = await run_in_threadpool(image_bytes, req)
    try:
        img = open_caller_image(data, "RGB")
    except UnsupportedImageError as exc:
        raise HTTPException(400, str(exc)) from exc
    try:
        return await run_in_threadpool(florence.describe, img)
    except Exception as exc:  # noqa: BLE001 - boundary: opaque message out, traceback logged
        raise HTTPException(500, safe_error(exc, context="describe")) from exc
