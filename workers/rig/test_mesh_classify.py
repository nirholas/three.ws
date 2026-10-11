"""Unit tests for mesh_classify.classify_mesh: synthetic point clouds, no GPU,
no network. A standing-humanoid-shaped cloud, a quadruped-shaped cloud, and an
asymmetric prop should land on opposite sides of the heuristic.

No GPU, no torch, no GCP: `python3 test_mesh_classify.py`.
"""

from __future__ import annotations

import sys

import numpy as np

from mesh_classify import HUMANOID, OTHER, classify_mesh


def _standing_humanoid_cloud(n: int = 2000) -> np.ndarray:
    """A tall, left-right symmetric capsule-ish cloud: torso + two
    mirrored arms + two mirrored legs, roughly a standing human's silhouette."""
    rng = np.random.default_rng(1)
    torso = rng.normal(0, 1, (n // 2, 3)) * [0.25, 0.9, 0.15]
    torso[:, 1] += 1.0
    leg_x = rng.choice([-0.15, 0.15], n // 4)
    legs = np.stack([
        leg_x + rng.normal(0, 0.05, n // 4),
        rng.uniform(-0.9, 0.3, n // 4),
        rng.normal(0, 0.05, n // 4),
    ], axis=1)
    arm_x = rng.choice([-0.4, 0.4], n // 4)
    arms = np.stack([
        arm_x + rng.normal(0, 0.05, n // 4),
        rng.uniform(0.6, 1.1, n // 4),
        rng.normal(0, 0.05, n // 4),
    ], axis=1)
    return np.concatenate([torso, legs, arms], axis=0)


def _quadruped_cloud(n: int = 2000) -> np.ndarray:
    """A long, low, symmetric cloud: body length and leg span both exceed
    shoulder height, like a wolf or a horse standing on four legs."""
    rng = np.random.default_rng(2)
    body = rng.normal(0, 1, (n // 2, 3)) * [1.4, 0.35, 0.3]
    body[:, 1] += 0.5
    leg_z = rng.choice([-0.25, 0.25], n // 2)
    leg_x = rng.uniform(-1.1, 1.1, n // 2)
    legs = np.stack([
        leg_x,
        rng.uniform(0.0, 0.5, n // 2),
        leg_z + rng.normal(0, 0.04, n // 2),
    ], axis=1)
    return np.concatenate([body, legs], axis=0)


def _asymmetric_prop_cloud(n: int = 2000) -> np.ndarray:
    """Tall enough to pass the height test, but an L-bracket: a tall post on
    one side and a low shelf spanning the footprint, with no mirror-image
    counterpart on the other side, like a leaning prop or a shelf unit."""
    rng = np.random.default_rng(3)
    post = np.stack([
        np.full(n // 2, 1.0) + rng.normal(0, 0.03, n // 2),
        rng.uniform(0.3, 3.0, n // 2),
        rng.normal(0, 0.03, n // 2),
    ], axis=1)
    shelf = np.stack([
        rng.uniform(0.0, 1.2, n // 2),
        rng.uniform(0.0, 0.3, n // 2),
        rng.normal(0, 0.03, n // 2),
    ], axis=1)
    return np.concatenate([post, shelf], axis=0)


def test_standing_humanoid_classifies_humanoid():
    assert classify_mesh(_standing_humanoid_cloud()) == HUMANOID


def test_quadruped_classifies_other():
    assert classify_mesh(_quadruped_cloud()) == OTHER


def test_asymmetric_prop_classifies_other():
    assert classify_mesh(_asymmetric_prop_cloud()) == OTHER


def test_degenerate_input_classifies_other():
    assert classify_mesh(np.zeros((0, 3))) == OTHER
    assert classify_mesh(np.zeros((2, 3))) == OTHER
    assert classify_mesh(np.zeros((10, 2))) == OTHER


def test_classification_is_deterministic():
    cloud = _standing_humanoid_cloud()
    assert classify_mesh(cloud) == classify_mesh(cloud)


if __name__ == "__main__":
    try:
        test_standing_humanoid_classifies_humanoid()
        test_quadruped_classifies_other()
        test_asymmetric_prop_classifies_other()
        test_degenerate_input_classifies_other()
        test_classification_is_deterministic()
    except AssertionError:
        print("\nFAILED")
        sys.exit(1)
    print("\nALL PASSED")
