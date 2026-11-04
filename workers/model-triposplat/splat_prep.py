"""
Pure helpers for the TripoSplat worker: input decoding, density validation and
output naming. Free of torch, FastAPI and google-cloud so the whole pre-inference
path runs on a CPU box and gates the Docker build (see test_splat_prep.py).
"""

from __future__ import annotations

import base64
import binascii
from typing import Callable

from PIL import Image

from worker_security import UnsupportedImageError, open_caller_image

# Upstream's TripoSplatPipeline asserts 32,768 <= num_gaussians <= 262,144
# (`_validate_num_gaussians` in triposplat.py). Refusing out-of-range counts here
# turns that assertion into an input error instead of a failed GPU job.
MIN_GAUSSIANS = 32768
MAX_GAUSSIANS = 262144
DEFAULT_GAUSSIANS = 131072
BLOB_PREFIX = "raw-splats/triposplat"

# The five checkpoints TripoSplatPipeline needs, keyed by its constructor
# argument, as paths relative to the weights prefix (the Hugging Face layout of
# VAST-AI/TripoSplat that stage-assets.sh mirrors into the bucket).
WEIGHT_FILES = {
    "ckpt_path": "diffusion_models/triposplat_fp16.safetensors",
    "decoder_path": "vae/triposplat_vae_decoder_fp16.safetensors",
    "dinov3_path": "clip_vision/dino_v3_vit_h.safetensors",
    "flux2_vae_encoder_path": "vae/flux2-vae.safetensors",
    "rmbg_path": "background_removal/birefnet.safetensors",
}
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
        return open_caller_image(data, "RGBA")
    except UnsupportedImageError as exc:
        raise ValueError("image bytes could not be decoded (send PNG, JPEG or WEBP)") from exc


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


def pipeline_weight_paths(local_dir: str) -> dict[str, str]:
    """TripoSplatPipeline constructor kwargs pointing at a staged weights dir."""
    return {arg: f"{local_dir.rstrip('/')}/{rel}" for arg, rel in WEIGHT_FILES.items()}


def weight_blob_names(prefix: str) -> list[str]:
    """GCS object names to stage, under the bucket's weights prefix."""
    base = prefix.strip("/")
    return [f"{base}/{rel}" if base else rel for rel in WEIGHT_FILES.values()]


def splat_blob_name(task_id: str, ext: str) -> str:
    if ext not in ("ply", "splat"):
        raise ValueError("unsupported splat extension")
    return f"{BLOB_PREFIX}/{task_id}.{ext}"


def splat_public_url(bucket: str, blob_name: str) -> str:
    return f"https://storage.googleapis.com/{bucket}/{blob_name}"
