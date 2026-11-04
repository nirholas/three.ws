"""
Pure helpers for the LHM worker: input decoding, output discovery and naming.
Free of torch, FastAPI and google-cloud so the pre-inference path runs on a CPU
box and gates the Docker build (see test_lhm_prep.py).
"""

from __future__ import annotations

import base64
import binascii
import os
import re
from typing import Callable

from PIL import Image

from worker_security import UnsupportedImageError, open_caller_image

MAX_IMAGE_BYTES = 25 * 1024 * 1024
BLOB_PREFIX = "raw-splats/lhm"
ALLOWED_MODELS = ("LHM-500M-HF", "LHM-1B-HF")
DEFAULT_MODEL = "LHM-500M-HF"
_TASK_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def decode_data_uri(src: str) -> bytes:
    if "," not in src:
        raise ValueError("malformed data URI: no payload separator")
    header, payload = src.split(",", 1)
    if "base64" not in header:
        raise ValueError("unsupported data URI: only base64 payloads are accepted")
    try:
        return base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("malformed data URI: payload is not valid base64") from exc


def open_rgb(data: bytes) -> Image.Image:
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("image is larger than the 25 MB limit")
    try:
        return open_caller_image(data, "RGB")
    except UnsupportedImageError as exc:
        raise ValueError("image bytes could not be decoded (send PNG, JPEG or WEBP)") from exc


def decode_image(src: str, *, fetch: Callable[[str], bytes]) -> Image.Image:
    """One caller-supplied image source to an RGB image (data URI or https URL)."""
    if src.startswith("data:image"):
        return open_rgb(decode_data_uri(src))
    if src.startswith("https://"):
        return open_rgb(fetch(src))
    raise ValueError(f"unsupported image source: {src[:60]}")


def validate_model(name: str | None) -> str:
    if name is None:
        return DEFAULT_MODEL
    if name not in ALLOWED_MODELS:
        raise ValueError(f"model must be one of {', '.join(ALLOWED_MODELS)}")
    return name


def blob_name(task_id: str, ext: str) -> str:
    if not _TASK_ID.match(task_id):
        raise ValueError("task id must be a UUID")
    if ext not in ("ply",):
        raise ValueError("unsupported output extension")
    return f"{BLOB_PREFIX}/{task_id}.{ext}"


def public_url(bucket: str, name: str) -> str:
    return f"https://storage.googleapis.com/{bucket}/{name}"


def find_output_ply(root: str) -> str:
    """Newest .ply under ``root`` (upstream names it after the input image)."""
    found = []
    for base, _dirs, files in os.walk(root):
        for f in files:
            if f.lower().endswith(".ply"):
                p = os.path.join(base, f)
                found.append((os.path.getmtime(p), p))
    if not found:
        raise RuntimeError("LHM produced no .ply output")
    return max(found)[1]
