"""The 390-column landmark layout, shared by data prep, training and the tests.

The layout is whatever the serving worker publishes in inference_args.json
(GET /schema), which is also what src/sign-input.js assembles in the browser.
Training data must be built with exactly this selection and order, so every
script derives it from that one file instead of re-listing landmarks.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np

ARGS_PATH = Path(__file__).resolve().parent.parent / "inference_args.json"
COLUMN_RE = re.compile(r"^([xyz])_(face|left_hand|right_hand|pose)_(\d+)$")

# MediaPipe HolisticLandmarkerResult attribute for each schema group, the same
# mapping GROUP_FIELDS in src/sign-input.js uses.
RESULT_FIELDS = {
    "face": "face_landmarks",
    "left_hand": "left_hand_landmarks",
    "right_hand": "right_hand_landmarks",
    "pose": "pose_landmarks",
}


def load_columns(path: Path = ARGS_PATH) -> list[str]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)["selected_columns"]


def parse_columns(columns: list[str]) -> list[tuple[str, str, int]]:
    """["x_face_61", ...] -> [("x", "face", 61), ...]; unknown names raise."""
    out = []
    for name in columns:
        m = COLUMN_RE.match(name)
        if not m:
            raise ValueError(f"unrecognised landmark column: {name}")
        out.append((m.group(1), m.group(2), int(m.group(3))))
    return out


def result_to_row(result, parsed: list[tuple[str, str, int]]) -> np.ndarray:
    """One HolisticLandmarkerResult -> (390,) float32 row, NaN where a group or
    landmark is absent (the model is trained to treat NaN as a missing hand)."""
    row = np.full(len(parsed), np.nan, dtype=np.float32)
    cache: dict[str, list | None] = {}
    for i, (coord, group, idx) in enumerate(parsed):
        if group not in cache:
            people = getattr(result, RESULT_FIELDS[group], None)
            cache[group] = people if people else None
        lms = cache[group]
        if lms is not None and idx < len(lms):
            row[i] = getattr(lms[idx], coord)
    return row
