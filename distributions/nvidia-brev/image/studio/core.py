"""
Pure helpers for the three.ws GPU quickstart studio.

Nothing here imports torch, CUDA or FastAPI, so the whole module is exercised
by tests/test_core.py on a CPU box and at image build time. engine.py and
server.py are the only callers.
"""

from __future__ import annotations

import io
import re
import secrets
import statistics
from dataclasses import dataclass, field

from PIL import Image, UnidentifiedImageError

# Only these decoders ever see caller bytes. Pillow can open dozens of formats;
# a demo box that anyone with the link can reach does not need the long tail.
ALLOWED_FORMATS = ("PNG", "JPEG", "WEBP")
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 40_000_000

# Marching cubes grid. 256 is upstream's default and what the production
# three.ws lane runs; the bounds keep a single request inside one GPU's memory.
MC_RESOLUTION_DEFAULT = 256
MC_RESOLUTION_MIN = 64
MC_RESOLUTION_MAX = 320

# TripoSR's tokenizer normalises a 3-channel image, and upstream's run.py fills
# the matted-out background with mid gray before flattening. Same value here.
MATTE_FILL = 0.5
FOREGROUND_RATIO = 0.85

_OUTPUT_ID = re.compile(r"^[a-f0-9]{16}$")
_SAMPLE_NAME = re.compile(r"^[a-z0-9_]+\.(png|jpe?g|webp)$")

# The ordered stage list every timing report uses. engine.py records exactly
# these keys; the notebook and the studio page render them in this order.
STAGES = (
    ("background_removal_ms", "Background removal (U2-Net on ONNX Runtime CUDA)"),
    ("model_forward_ms", "TripoSR forward pass (image to triplane)"),
    ("mesh_extraction_ms", "Marching cubes on the GPU (torchmcubes)"),
    ("export_ms", "GLB export (trimesh)"),
)


class InputError(ValueError):
    """The caller sent something we refuse. The message is safe to show."""


def new_output_id() -> str:
    return secrets.token_hex(8)


def is_output_id(value: str) -> bool:
    return bool(_OUTPUT_ID.match(value or ""))


def is_sample_name(value: str) -> bool:
    return bool(_SAMPLE_NAME.match(value or ""))


def parse_resolution(raw) -> int:
    """Accept the marching-cubes resolution from a form field or JSON body."""
    if raw is None or raw == "":
        return MC_RESOLUTION_DEFAULT
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise InputError("resolution must be an integer") from exc
    if not MC_RESOLUTION_MIN <= value <= MC_RESOLUTION_MAX:
        raise InputError(
            f"resolution must be between {MC_RESOLUTION_MIN} and {MC_RESOLUTION_MAX}"
        )
    return value


def open_image(data: bytes) -> Image.Image:
    """Decode PNG, JPEG or WEBP bytes into a loaded PIL image, or raise InputError."""
    if not data:
        raise InputError("the image is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise InputError(f"the image is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    try:
        img = Image.open(io.BytesIO(data), formats=ALLOWED_FORMATS)
        if img.width * img.height > MAX_PIXELS:
            raise InputError("the image has too many pixels (40 megapixels at most)")
        img.load()
    except InputError:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise InputError("the file is not a PNG, JPEG or WEBP image") from exc
    return img


@dataclass
class TimingReport:
    """Per-stage GPU timings for one generation, in milliseconds."""

    stages: dict = field(default_factory=dict)

    def record(self, key: str, ms: float) -> None:
        if key not in dict(STAGES):
            raise KeyError(f"unknown stage {key}")
        self.stages[key] = round(float(ms), 1)

    @property
    def total_ms(self) -> float:
        return round(sum(self.stages.values()), 1)

    def as_dict(self) -> dict:
        ordered = {key: self.stages[key] for key, _ in STAGES if key in self.stages}
        ordered["total_ms"] = self.total_ms
        return ordered


def summarize_runs(reports: list[dict]) -> dict:
    """Median and min/max per stage across warm runs (the notebook benchmark)."""
    if not reports:
        raise ValueError("no runs to summarize")
    keys = [key for key, _ in STAGES] + ["total_ms"]
    summary = {}
    for key in keys:
        values = [r[key] for r in reports if key in r]
        if not values:
            continue
        summary[key] = {
            "median": round(statistics.median(values), 1),
            "min": round(min(values), 1),
            "max": round(max(values), 1),
            "runs": len(values),
        }
    return summary


_SELF_TEST = re.compile(
    r"self-test (?P<status>OK|FAILED): (?P<model>\S+), (?P<dims>\d+) dims, ran on "
    r"(?P<device>\S+) \((?P<dtype>[^)]+)\) in (?P<ms>\d+)ms"
)
_IDENTITY = re.compile(r"identity (?P<pubkey>[1-9A-HJ-NP-Za-km-z]{32,44})")


def parse_node_self_test(stdout: str) -> dict:
    """Read the node operator's --self-test line into a dict.

    The line format is fixed by packages/node-operator/src/index.js:
    "[node] self-test OK: <model>, <n> dims, ran on <device> (<dtype>) in <ms>ms".
    """
    match = _SELF_TEST.search(stdout or "")
    if not match:
        raise ValueError("node operator output did not contain a self-test result line")
    result = {
        "ok": match.group("status") == "OK",
        "model": match.group("model"),
        "dimensions": int(match.group("dims")),
        "device": match.group("device"),
        "dtype": match.group("dtype"),
        "elapsed_ms": int(match.group("ms")),
    }
    identity = _IDENTITY.search(stdout)
    if identity:
        result["public_key"] = identity.group("pubkey")
    return result
