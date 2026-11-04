"""Word-level sign decoding: softmax, top-k and the label map.

The sign model is a 250-way classifier (PopSign ASL v1.0 vocabulary) over the
same 390-column landmark layout as the fingerspelling model, so the browser
sends one frame format for both modes. Pure NumPy + stdlib; unit-tested in
test_signs_decode.py without a model runtime.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

TOP_K = 5


def softmax(logits: np.ndarray) -> np.ndarray:
    """Numerically stable softmax over the last axis."""
    x = np.asarray(logits, dtype=np.float64)
    x = x - x.max(axis=-1, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=-1, keepdims=True)


def load_labels(path: str | Path) -> list[str]:
    """{"sign": index, ...} -> list of sign names ordered by class index.

    Indices must be exactly 0..N-1: a gap means the label file and the weights
    came from different training runs, and serving it would mislabel signs.
    """
    with open(path, "r", encoding="utf-8") as f:
        mapping: dict[str, int] = json.load(f)
    indices = sorted(mapping.values())
    if indices != list(range(len(indices))):
        raise ValueError("label indices must be contiguous from 0")
    labels = [""] * len(indices)
    for name, idx in mapping.items():
        labels[idx] = name
    return labels


def top_k(logits: np.ndarray, labels: list[str], k: int = TOP_K) -> list[dict]:
    """(classes,) or (1, classes) logits -> [{sign, probability}] best first."""
    arr = np.asarray(logits, dtype=np.float64).reshape(-1)
    if arr.shape[0] != len(labels):
        raise ValueError(f"logits have {arr.shape[0]} classes but there are {len(labels)} labels")
    probs = softmax(arr)
    order = np.argsort(-probs)[: min(k, len(labels))]
    return [{"sign": labels[int(i)], "probability": round(float(probs[int(i)]), 4)} for i in order]
