"""The extracted landmark layout must equal the layout the worker serves.

Runs without MediaPipe or TensorFlow: it checks the shared column parser
against the served schema (inference_args.json is what GET /schema returns and
what the browser assembles) and the row builder against a stand-in result.
"""

import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from decode import FEATURE_COLUMNS, N_FEATURES  # noqa: E402
from columns import load_columns, parse_columns, result_to_row  # noqa: E402


def test_training_columns_are_the_served_columns():
    assert load_columns() == FEATURE_COLUMNS
    assert len(load_columns()) == N_FEATURES == 390


def test_every_column_parses_and_groups_have_the_published_sizes():
    parsed = parse_columns(load_columns())
    by_group = {}
    for _, group, _ in parsed:
        by_group[group] = by_group.get(group, 0) + 1
    assert by_group == {"face": 228, "left_hand": 63, "right_hand": 63, "pose": 36}


def test_unknown_columns_are_rejected():
    with pytest.raises(ValueError):
        parse_columns(["x_torso_3"])


def lm(x, y, z):
    return SimpleNamespace(x=x, y=y, z=z)


def test_row_follows_served_order_and_marks_missing_groups_nan():
    parsed = parse_columns(["x_pose_0", "y_left_hand_2", "z_face_1", "x_right_hand_5"])
    result = SimpleNamespace(
        pose_landmarks=[lm(0.5, 0.2, -0.1)],
        face_landmarks=[lm(0, 0, 0), lm(0.1, 0.2, 0.3)],
        left_hand_landmarks=[],
        right_hand_landmarks=None,
    )
    row = result_to_row(result, parsed)
    assert row[0] == pytest.approx(0.5)
    assert np.isnan(row[1])
    assert row[2] == pytest.approx(0.3)
    assert np.isnan(row[3])
    assert row.dtype == np.float32


def test_out_of_range_landmark_index_is_nan_not_an_error():
    parsed = parse_columns(["x_pose_30"])
    result = SimpleNamespace(pose_landmarks=[lm(1, 1, 1)])
    assert np.isnan(result_to_row(result, parsed)[0])
