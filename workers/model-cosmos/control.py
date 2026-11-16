"""Control-video decoding for the depth and edge transfer modes.

The browser records its three.js render with MediaRecorder (WebM VP8/VP9, or MP4
on Safari) and sends it as-is. This module decodes it with PyAV, resamples it
to the clip's frame count, resizes to the output geometry, and builds the hint
Cosmos 3 expects:

  depth  the render is already a depth pass (near = bright, Depth-Anything
         convention). Frames are converted to 3-channel grayscale.
  edge   the render is RGB. Canny with upstream's inference "medium" preset
         (cosmos-transfer2.5 control_input.py: thresholds 100/200) turns each
         frame into a white-on-black edge map.
"""

from __future__ import annotations

import io
from typing import Iterable

import av
import cv2
import numpy as np
from PIL import Image

CANNY_LOW = 100
CANNY_HIGH = 200
MIN_SOURCE_FRAMES = 2


class ControlError(ValueError):
    """The control video could not be used. The message is safe to return to callers."""


def decode_frames(data: bytes) -> list[np.ndarray]:
    """Decode every video frame to an RGB uint8 array."""
    try:
        with av.open(io.BytesIO(data), mode="r") as container:
            if not container.streams.video:
                raise ControlError("control_video has no video track")
            stream = container.streams.video[0]
            stream.thread_type = "AUTO"
            frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]
    except ControlError:
        raise
    except (av.FFmpegError, ValueError, OSError) as exc:
        raise ControlError(f"control_video could not be decoded: {exc}") from exc
    if len(frames) < MIN_SOURCE_FRAMES:
        raise ControlError(f"control_video needs at least {MIN_SOURCE_FRAMES} frames (got {len(frames)})")
    return frames


def resample_indices(source_count: int, target_count: int) -> list[int]:
    """Evenly spread target_count picks across source_count frames (repeats when the source is short)."""
    if source_count <= 0 or target_count <= 0:
        raise ValueError("frame counts must be positive")
    if target_count == 1:
        return [0]
    step = (source_count - 1) / (target_count - 1)
    return [min(source_count - 1, int(round(i * step))) for i in range(target_count)]


def fit_frame(frame: np.ndarray, width: int, height: int) -> np.ndarray:
    """Center-crop to the target aspect, then resize. Keeps the layout undistorted."""
    h, w = frame.shape[:2]
    target_aspect = width / height
    if w / h > target_aspect:
        new_w = int(round(h * target_aspect))
        x0 = (w - new_w) // 2
        frame = frame[:, x0 : x0 + new_w]
    elif w / h < target_aspect:
        new_h = int(round(w / target_aspect))
        y0 = (h - new_h) // 2
        frame = frame[y0 : y0 + new_h]
    interp = cv2.INTER_AREA if frame.shape[1] > width else cv2.INTER_LINEAR
    return cv2.resize(frame, (width, height), interpolation=interp)


def depth_hint(frame: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
    return np.repeat(gray[:, :, None], 3, axis=2)


def edge_hint(frame: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, CANNY_LOW, CANNY_HIGH)
    return np.repeat(edges[:, :, None], 3, axis=2)


def build_hint_frames(frames: Iterable[np.ndarray], mode: str, *, num_frames: int, width: int, height: int) -> list[Image.Image]:
    frames = list(frames)
    if mode == "depth":
        transform = depth_hint
    elif mode == "edge":
        transform = edge_hint
    else:
        raise ValueError(f"no control hint for mode {mode!r}")
    picks = resample_indices(len(frames), num_frames)
    out = []
    for index in picks:
        fitted = fit_frame(frames[index], width, height)
        out.append(Image.fromarray(transform(fitted)))
    if mode == "edge":
        edge_density = float(np.mean([np.asarray(img)[:, :, 0].mean() for img in out[:: max(1, len(out) // 8)]]) / 255.0)
        if edge_density < 0.001:
            raise ControlError("control_video produced no edges; the render looks blank")
    if mode == "depth":
        spread = float(np.asarray(out[0])[:, :, 0].std())
        if spread < 1.0:
            raise ControlError("control_video depth pass is flat; the render looks blank")
    return out


def control_videos_for(data: bytes, mode: str, *, num_frames: int, width: int, height: int) -> dict[str, list[Image.Image]]:
    """Decode a caller control video into the pipeline's control_videos mapping."""
    frames = decode_frames(data)
    return {mode: build_hint_frames(frames, mode, num_frames=num_frames, width=width, height=height)}
