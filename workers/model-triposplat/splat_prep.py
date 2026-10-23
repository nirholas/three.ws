"""
Pure helpers for the TripoSplat worker: input decoding, density validation and
output naming. Free of torch, FastAPI and google-cloud so the whole pre-inference
path runs on a CPU box and gates the Docker build (see test_splat_prep.py).
"""

from __future__ import annotations

import base64
import binascii
import io
from typing import Callable

from PIL import Image, UnidentifiedImageError

# Upstream caps a scene at 262,144 Gaussians (README); 8,192 is the floor below
# which the decoder output stops resembling the subject.
MIN_GAUSSIANS = 8192
MAX_GAUSSIANS = 262144
DEFAULT_GAUSSIANS = 131072
BLOB_PREFIX = "raw-splats/triposplat"
MAX_IMAGE_BYTES = 25 * 1024 * 1024


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


def open_rgba(data: bytes) -> Image.Image:
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("image is larger than the 25 MB limit")
    try:
        return Image.open(io.BytesIO(data)).convert("RGBA")
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("image bytes could not be decoded") from exc


def decode_image(src: str, *, fetch: Callable[[str], bytes]) -> Image.Image:
    """One caller-supplied image source to an RGBA image.

    ``data:image/...`` URIs decode in-process; ``https://`` URLs go through
    ``fetch`` (the SSRF-hardened fetcher in worker_security). Anything else is
    refused before it can reach the network.
    """
    if src.startswith("data:image"):
        return open_rgba(decode_data_uri(src))
    if src.startswith("https://"):
        return open_rgba(fetch(src))
    raise ValueError(f"unsupported image source: {src[:60]}")


def clamp_gaussians(value: int | None) -> int:
    """Validate a requested Gaussian count; None selects the default."""
    if value is None:
        return DEFAULT_GAUSSIANS
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("num_gaussians must be an integer")
    if value < MIN_GAUSSIANS or value > MAX_GAUSSIANS:
        raise ValueError(f"num_gaussians must be between {MIN_GAUSSIANS} and {MAX_GAUSSIANS}")
    return value


def splat_blob_name(task_id: str, ext: str) -> str:
    if ext not in ("ply", "splat"):
        raise ValueError("unsupported splat extension")
    return f"{BLOB_PREFIX}/{task_id}.{ext}"


def splat_public_url(bucket: str, blob_name: str) -> str:
    return f"https://storage.googleapis.com/{bucket}/{blob_name}"
