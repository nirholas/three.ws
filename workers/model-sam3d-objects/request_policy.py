"""Request validation for the SAM 3D Objects worker.

Pure Python (stdlib only) so it unit-tests without a GPU, torch or FastAPI.
Everything a caller can send is bounded here, before any URL is fetched or any
GPU time is spent, and every rejection is a caller-facing sentence.

A request names ONE photo and the objects to lift out of it. SAM 3D Objects
reconstructs an object from the photo plus a mask that says which pixels are
that object, so each object is given as either:

  * ``mask_urls``: one public https PNG per object (white = the object), or
  * ``boxes``: one normalized ``[x0, y0, x1, y1]`` box per object (0..1, origin
    top-left); the worker turns each box into a mask with GrabCut.

Masks win when both are present for the same request (a mask is exact, a box is
an estimate), and the two are never mixed within one request.
"""

from __future__ import annotations

import math
from typing import Any

# One photo can hold a roomful, but each object is a full diffusion pass and the
# scene is one GLB a phone has to open. Twelve is a generous room, not a stress test.
MAX_OBJECTS = 12
DEFAULT_MAX_OBJECTS = 8
MIN_BOX_SIDE = 0.04  # 4% of the frame: smaller is a speck the model cannot reconstruct
MIN_BOX_AREA = 0.002
MAX_URL_CHARS = 4096
SEED_MAX = 4_294_967_295


class RequestRejected(ValueError):
    """The request is malformed; the message is safe to show the caller."""


def _url(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise RequestRejected(f"{field} must be a non-empty https URL")
    value = value.strip()
    if len(value) > MAX_URL_CHARS:
        raise RequestRejected(f"{field} is longer than {MAX_URL_CHARS} characters")
    return value


def _box(raw: Any, index: int) -> tuple[float, float, float, float]:
    label = f"boxes[{index}]"
    if not isinstance(raw, (list, tuple)) or len(raw) != 4:
        raise RequestRejected(f"{label} must be [x0, y0, x1, y1]")
    try:
        x0, y0, x1, y1 = (float(v) for v in raw)
    except (TypeError, ValueError) as exc:
        raise RequestRejected(f"{label} must contain numbers") from exc
    if not all(math.isfinite(v) for v in (x0, y0, x1, y1)):
        raise RequestRejected(f"{label} must contain finite numbers")
    if not (0.0 <= x0 < x1 <= 1.0 and 0.0 <= y0 < y1 <= 1.0):
        raise RequestRejected(f"{label} must satisfy 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1 (fractions of the frame)")
    if (x1 - x0) < MIN_BOX_SIDE or (y1 - y0) < MIN_BOX_SIDE or (x1 - x0) * (y1 - y0) < MIN_BOX_AREA:
        raise RequestRejected(f"{label} is too small to reconstruct; choose an object that fills at least 4% of the frame width and height")
    return (x0, y0, x1, y1)


def validate_request(payload: dict) -> dict:
    """Return a normalized request or raise RequestRejected."""
    if not isinstance(payload, dict):
        raise RequestRejected("request body must be a JSON object")

    image_url = _url(payload.get("image_url"), "image_url")

    max_objects = payload.get("max_objects", DEFAULT_MAX_OBJECTS)
    if isinstance(max_objects, bool) or not isinstance(max_objects, int) or not 1 <= max_objects <= MAX_OBJECTS:
        raise RequestRejected(f"max_objects must be an integer from 1 to {MAX_OBJECTS}")

    seed = payload.get("seed")
    if seed is not None and (isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= SEED_MAX):
        raise RequestRejected("seed must be a non-negative integer")

    raw_masks = payload.get("mask_urls")
    raw_boxes = payload.get("boxes")
    if raw_masks is not None and raw_boxes is not None and raw_masks and raw_boxes:
        raise RequestRejected("send mask_urls or boxes, not both")

    mask_urls: list[str] = []
    boxes: list[tuple[float, float, float, float]] = []
    if raw_masks:
        if not isinstance(raw_masks, list):
            raise RequestRejected("mask_urls must be a list of https URLs")
        mask_urls = [_url(u, f"mask_urls[{i}]") for i, u in enumerate(raw_masks)]
    elif raw_boxes:
        if not isinstance(raw_boxes, list):
            raise RequestRejected("boxes must be a list of [x0, y0, x1, y1] boxes")
        boxes = [_box(b, i) for i, b in enumerate(raw_boxes)]
    else:
        raise RequestRejected("name the objects to reconstruct: send mask_urls (one PNG mask per object) or boxes (one [x0, y0, x1, y1] per object)")

    count = len(mask_urls) or len(boxes)
    if count > max_objects:
        raise RequestRejected(f"{count} objects requested but max_objects is {max_objects}")

    return {
        "image_url": image_url,
        "mask_urls": mask_urls,
        "boxes": boxes,
        "max_objects": max_objects,
        "seed": seed,
    }
