"""Decode a caller's equirectangular photo: sniff, decode, validate, describe.

Only three containers are accepted, identified by their magic bytes rather
than by the URL or a Content-Type header: JPEG, PNG and OpenEXR. JPEG and PNG
go through the vendored ``open_caller_image`` (format allowlist, decompression
bomb guard); EXR is decoded by OpenCV and tone-mapped to 8-bit sRGB, because
the model and the texture both want display-referred colour.
"""

from __future__ import annotations

import os

os.environ.setdefault("OPENCV_IO_ENABLE_OPENEXR", "1")

from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

from worker_security import UnsupportedImageError, open_caller_image

MAGIC = {
    b"\xff\xd8\xff": "jpeg",
    b"\x89PNG\r\n\x1a\n": "png",
    b"\x76\x2f\x31\x01": "exr",
}
# An equirect is exactly 2:1; stitchers round odd sizes, so allow 2 percent.
ASPECT_TOLERANCE = 0.02
MIN_WIDTH = 1024
# Bigger than any current 360 still (Insta360 X5 is 11904 px, the Pro 2 is
# 7680 px); a 16K stitch is the largest we expect to meet.
MAX_WIDTH = 16384

EXIF_MAKE = 0x010F
EXIF_MODEL = 0x0110


class NotEquirectError(ValueError):
    """The image decoded but is not a 2:1 equirectangular panorama."""


@dataclass
class Photo:
    rgb: np.ndarray  # (H, W, 3) uint8, sRGB
    format: str  # jpeg | png | exr
    camera_make: Optional[str] = None
    camera_model: Optional[str] = None

    @property
    def width(self) -> int:
        return int(self.rgb.shape[1])

    @property
    def height(self) -> int:
        return int(self.rgb.shape[0])


def sniff(data: bytes) -> str:
    for magic, kind in MAGIC.items():
        if data.startswith(magic):
            return kind
    raise UnsupportedImageError("image must be an equirectangular JPEG, PNG or OpenEXR file")


def check_equirect(width: int, height: int) -> None:
    if height <= 0 or abs(width / height - 2.0) > 2.0 * ASPECT_TOLERANCE:
        raise NotEquirectError(
            f"image is {width}x{height}; an equirectangular 360 photo is 2:1 (for example 5760x2880)"
        )
    if width < MIN_WIDTH:
        raise NotEquirectError(f"image is {width} px wide; send at least {MIN_WIDTH} px")
    if width > MAX_WIDTH:
        raise NotEquirectError(f"image is {width} px wide; the largest accepted is {MAX_WIDTH} px")


def tone_map_linear(linear: np.ndarray) -> np.ndarray:
    """Scene-linear RGB float -> 8-bit sRGB. Exposure puts the median luminance
    at 18 percent grey, Reinhard rolls off the highlights (sun, lamps)."""
    rgb = np.nan_to_num(np.asarray(linear, dtype=np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    rgb = np.clip(rgb, 0.0, None)
    lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    positive = lum[lum > 0]
    if positive.size:
        rgb *= 0.18 / max(float(np.median(positive)), 1e-6)
    rgb = rgb / (1.0 + rgb)
    srgb = np.where(rgb <= 0.0031308, 12.92 * rgb, 1.055 * np.power(rgb, 1.0 / 2.4) - 0.055)
    return np.clip(srgb * 255.0 + 0.5, 0, 255).astype(np.uint8)


def _decode_exr(data: bytes) -> np.ndarray:
    arr = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if arr is None:
        raise UnsupportedImageError("image is not a decodable OpenEXR file")
    if arr.ndim == 2:
        arr = np.repeat(arr[..., None], 3, axis=2)
    arr = cv2.cvtColor(arr[..., :3], cv2.COLOR_BGR2RGB)
    return tone_map_linear(arr)


def _exif_camera(img) -> tuple[Optional[str], Optional[str]]:
    try:
        exif = img.getexif()
    except Exception:  # noqa: BLE001 - a broken EXIF block must not fail the photo
        return None, None

    def clean(value) -> Optional[str]:
        if not isinstance(value, str):
            return None
        value = value.replace("\x00", "").strip()
        return value[:80] or None

    return clean(exif.get(EXIF_MAKE)), clean(exif.get(EXIF_MODEL))


def decode_photo(data: bytes) -> Photo:
    kind = sniff(data)
    if kind == "exr":
        rgb = _decode_exr(data)
        check_equirect(rgb.shape[1], rgb.shape[0])
        return Photo(rgb=rgb, format=kind)

    img = open_caller_image(data, formats=("JPEG",) if kind == "jpeg" else ("PNG",))
    check_equirect(*img.size)
    make, model = _exif_camera(img)
    rgb = np.asarray(img.convert("RGB"))
    return Photo(rgb=np.ascontiguousarray(rgb), format=kind, camera_make=make, camera_model=model)


def encode_texture(rgb: np.ndarray, max_width: int = 8192, quality: int = 90) -> tuple[bytes, int, int]:
    """JPEG texture for the shell, at most 8192x4096 (the largest texture
    WebGL2 guarantees on current desktop and mobile GPUs)."""
    h, w = rgb.shape[:2]
    if w > max_width:
        rgb = cv2.resize(rgb, (max_width, max_width // 2), interpolation=cv2.INTER_AREA)
        h, w = rgb.shape[:2]
    ok, buf = cv2.imencode(".jpg", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("could not encode the texture")
    return buf.tobytes(), w, h
