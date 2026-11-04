"""Pins the texture metrics: identical images score perfectly, different ones do not,
the masked region is honoured, and the renderer paints only camera-facing texels."""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import face_projection as fpr  # noqa: E402
from eval import texture_eval as te  # noqa: E402
from test_face_projection import _sphere, _synthetic_landmarks  # noqa: E402


def _noise(seed=0):
    return np.random.RandomState(seed).randint(0, 255, (96, 96, 3), dtype=np.uint8)


def test_identical_images_are_perfect_and_different_are_not():
    a, b = _noise(0), _noise(1)
    m = np.ones((96, 96), bool)
    assert te.masked_ssim(a, a, m) > 0.999
    assert te.masked_ssim(a, b, m) < 0.2
    assert te.histogram_distance(a, a, m) < 1e-6
    flat = np.full((96, 96, 3), 40, np.uint8)
    assert te.histogram_distance(a, flat, m) > 0.3


def test_mask_excludes_pixels_outside_it():
    a = _noise(0)
    b = a.copy()
    b[:, 48:] = 255 - b[:, 48:]
    m = np.zeros((96, 96), bool)
    m[:, :40] = True
    assert te.masked_ssim(a, b, m) > 0.99
    assert te.masked_ssim(a, b, np.zeros((96, 96), bool)) is None


def test_renderer_paints_the_facing_hemisphere_with_the_atlas_colour():
    pos, nrm, uv, faces = _sphere()
    idx = np.arange(len(pos))
    pts, _, _ = _synthetic_landmarks(pos, idx, angle=0.0)
    cam = fpr.solve_camera(pts, idx, pos, 800, 800)
    skin = np.full((64, 64, 3), (200, 120, 80), np.uint8)
    img, vis = te.render_textured(pos, nrm, uv, faces, skin, cam)
    assert vis.sum() > 2000
    assert np.all(img[vis] == (200, 120, 80))
    assert not vis[0, 0]


def test_summary_enables_only_when_every_signal_improves():
    good = [{"ssim_before": .5, "ssim_after": .6, "hist_before": .3, "hist_after": .2, "seam_ok": True}]
    assert te.summarize(good)["enable_by_default"] is True
    assert te.summarize([dict(good[0], seam_ok=False)])["enable_by_default"] is False
    assert te.summarize([dict(good[0], ssim_after=.4)])["enable_by_default"] is False
    assert te.summarize([dict(good[0], hist_after=.4)])["enable_by_default"] is False
