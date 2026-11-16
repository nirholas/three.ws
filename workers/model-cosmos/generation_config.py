"""Request validation and per-mode sampling settings for the Cosmos world worker.

Pure Python with no torch import, so the contract is unit-testable on any host.

Four modes, one checkpoint (nvidia/Cosmos3-Nano through diffusers'
Cosmos3OmniModularPipeline):

  text   text-to-world    prompt only
  image  image-to-world   prompt + a still that becomes frame 0
  depth  layout transfer  prompt + a depth control video
  edge   layout transfer  prompt + an RGB render the worker turns into Canny edges

Sampling numbers follow NVIDIA's published defaults: the text2video and
image2video sample_args (35 steps, guidance 6.0, flow shift 10, 24 fps) and the
transfer depth/edge specs (50 steps, guidance 3.0, control guidance 1.5,
121-frame chunks with one conditional frame, 30 fps).
"""

from __future__ import annotations

import base64
import binascii
import re
from dataclasses import dataclass, field
from typing import Optional

MODES = ("text", "image", "depth", "edge")
TRANSFER_MODES = frozenset({"depth", "edge"})

# (resolution, aspect_ratio) -> (height, width); the 480 and 720 rows of the
# upstream RESOLUTION_RATIO_DICT. 16:9 is the only aspect /cosmos produces.
RESOLUTIONS: dict[str, dict[str, tuple[int, int]]] = {
    "480": {"16,9": (480, 832)},
    "720": {"16,9": (720, 1280)},
}
DEFAULT_RESOLUTION = "720"
ASPECT_RATIO = "16,9"

# The VAE compresses time 4x, so a clip is 1 + 4k frames.
MIN_FRAMES = 33
MAX_FRAMES = 121
DEFAULT_FRAMES = 121

PROMPT_MIN_CHARS = 3
PROMPT_MAX_CHARS = 600

# Caller payload ceilings (decoded bytes).
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_CONTROL_BYTES = 48 * 1024 * 1024

FLOW_SHIFT = 10.0


@dataclass(frozen=True)
class ModePreset:
    steps: int
    guidance: float
    fps: int
    negative_file: str
    control_guidance: Optional[float] = None


PRESETS: dict[str, ModePreset] = {
    "text": ModePreset(steps=35, guidance=6.0, fps=24, negative_file="negative_video.json"),
    "image": ModePreset(steps=35, guidance=6.0, fps=24, negative_file="negative_video.json"),
    "depth": ModePreset(
        steps=50, guidance=3.0, fps=30, negative_file="negative_transfer.json", control_guidance=1.5
    ),
    "edge": ModePreset(
        steps=50, guidance=3.0, fps=30, negative_file="negative_transfer.json", control_guidance=1.5
    ),
}


class RequestError(ValueError):
    """Caller input the worker refuses. The message is safe to return as-is."""


@dataclass
class GenerationRequest:
    mode: str
    prompt: str
    seed: int
    resolution: str
    num_frames: int
    height: int
    width: int
    preset: ModePreset
    image_bytes: Optional[bytes] = None
    control_bytes: Optional[bytes] = None
    extras: dict = field(default_factory=dict)

    @property
    def fps(self) -> int:
        return self.preset.fps

    @property
    def duration_label(self) -> str:
        """Upstream's compact duration label, e.g. '5s' for 121 frames at 24 fps."""
        return f"{int(self.num_frames / self.fps)}s"


_DATA_URL_RE = re.compile(r"^data:([a-z0-9.+/-]+);base64,(.*)$", re.IGNORECASE | re.DOTALL)
IMAGE_MIME = frozenset({"image/png", "image/jpeg", "image/webp"})
VIDEO_MIME = frozenset({"video/webm", "video/mp4"})


def decode_data_url(value: object, *, allowed: frozenset[str], max_bytes: int, label: str) -> tuple[str, bytes]:
    """Decode a base64 data URL, enforcing its MIME type and size."""
    if not isinstance(value, str) or not value:
        raise RequestError(f"{label} must be a base64 data URL")
    match = _DATA_URL_RE.match(value.strip())
    if not match:
        raise RequestError(f"{label} must be a base64 data URL")
    mime = match.group(1).lower().split(";")[0]
    if mime not in allowed:
        raise RequestError(f"{label} must be one of {', '.join(sorted(allowed))} (got {mime})")
    payload = match.group(2)
    # Reject before decoding: base64 inflates by 4/3.
    if len(payload) > (max_bytes * 4) // 3 + 8:
        raise RequestError(f"{label} is larger than {max_bytes // (1024 * 1024)} MB")
    try:
        data = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise RequestError(f"{label} is not valid base64") from exc
    if not data:
        raise RequestError(f"{label} is empty")
    if len(data) > max_bytes:
        raise RequestError(f"{label} is larger than {max_bytes // (1024 * 1024)} MB")
    return mime, data


def _coerce_int(value: object, label: str) -> int:
    if isinstance(value, bool):
        raise RequestError(f"{label} must be an integer")
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and re.fullmatch(r"-?\d{1,12}", value.strip()):
        return int(value.strip())
    raise RequestError(f"{label} must be an integer")


def normalize_frames(value: object) -> int:
    if value is None:
        return DEFAULT_FRAMES
    frames = _coerce_int(value, "num_frames")
    if frames < MIN_FRAMES or frames > MAX_FRAMES or (frames - 1) % 4 != 0:
        raise RequestError(f"num_frames must be 1 + 4k between {MIN_FRAMES} and {MAX_FRAMES}")
    return frames


def parse_request(body: object, *, default_resolution: str = DEFAULT_RESOLUTION) -> GenerationRequest:
    """Validate an /infer body into a GenerationRequest or raise RequestError."""
    if not isinstance(body, dict):
        raise RequestError("body must be a JSON object")

    mode = body.get("mode", "text")
    if mode not in MODES:
        raise RequestError(f"mode must be one of {', '.join(MODES)}")

    prompt = body.get("prompt")
    if not isinstance(prompt, str):
        raise RequestError("prompt is required")
    prompt = " ".join(prompt.split())
    if len(prompt) < PROMPT_MIN_CHARS or len(prompt) > PROMPT_MAX_CHARS:
        raise RequestError(f"prompt must be {PROMPT_MIN_CHARS}-{PROMPT_MAX_CHARS} characters")

    seed_raw = body.get("seed")
    seed = 0 if seed_raw is None else _coerce_int(seed_raw, "seed")
    if seed < 0 or seed > 2**31 - 1:
        raise RequestError("seed must be between 0 and 2147483647")

    resolution = str(body.get("resolution") or default_resolution)
    if resolution not in RESOLUTIONS:
        raise RequestError(f"resolution must be one of {', '.join(RESOLUTIONS)}")
    height, width = RESOLUTIONS[resolution][ASPECT_RATIO]

    num_frames = normalize_frames(body.get("num_frames"))

    image_bytes = None
    control_bytes = None
    if mode == "image":
        _, image_bytes = decode_data_url(
            body.get("image"), allowed=IMAGE_MIME, max_bytes=MAX_IMAGE_BYTES, label="image"
        )
    elif mode in TRANSFER_MODES:
        _, control_bytes = decode_data_url(
            body.get("control_video"), allowed=VIDEO_MIME, max_bytes=MAX_CONTROL_BYTES, label="control_video"
        )

    return GenerationRequest(
        mode=mode,
        prompt=prompt,
        seed=seed,
        resolution=resolution,
        num_frames=num_frames,
        height=height,
        width=width,
        preset=PRESETS[mode],
        image_bytes=image_bytes,
        control_bytes=control_bytes,
    )


def eta_seconds(progress: float, elapsed: float) -> Optional[int]:
    """Remaining time extrapolated from the observed step rate, or None before the first step."""
    if progress <= 0 or elapsed <= 0:
        return None
    if progress >= 1:
        return 0
    return max(0, int(round(elapsed / progress * (1 - progress))))
