"""Split and label logic of prepare_popsign.py (no MediaPipe or TensorFlow)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from prepare_popsign import SPLITS, build_labels, split_for_signer  # noqa: E402


def test_signer_always_lands_in_the_same_split():
    assert split_for_signer("signer-7") == split_for_signer("signer-7")


def test_split_is_roughly_80_10_10_across_many_signers():
    counts = {s: 0 for s in SPLITS}
    for i in range(4000):
        counts[split_for_signer(f"s{i}")] += 1
    assert 0.74 < counts["train"] / 4000 < 0.86
    assert 0.06 < counts["val"] / 4000 < 0.14
    assert 0.06 < counts["test"] / 4000 < 0.14


def test_labels_are_sorted_contiguous_and_deduplicated():
    labels = build_labels(["dog", "cat", "dog", "apple"])
    assert labels == {"apple": 0, "cat": 1, "dog": 2}
