"""Tests for normal_estimator.py, the DSINE replacement. numpy only for the
frame tests; the predictor test also needs torch and is skipped without it
(the Docker build has it, so it always runs there).

The property that matters: after AniGen's own estimate_normal post-processing
(negate x, map [-1, 1] to [0, 1]), our predictor's output is the same normal
map DSINE's would be. When the AniGen checkout is importable (inside the
image) the real upstream estimate_normal is used; otherwise a replica of its
three lines (anigen/utils/image_utils.py at the pinned commit).
"""

from __future__ import annotations

import sys

import numpy as np

from normal_estimator import MarigoldNormalPredictor, to_dsine_frame

_FAILED = False


def _check(cond: bool, label: str) -> None:
    global _FAILED
    print(f"  [{'ok' if cond else 'FAIL'}] {label}")
    if not cond:
        _FAILED = True


def _anigen_postprocess(pred):
    """anigen/utils/image_utils.py estimate_normal, after infer_pil."""
    pred = pred.copy()
    pred[:, 0, :, :] = -pred[:, 0, :, :]
    return (pred + 1) / 2.0


def _sphere_gl_normals(n: int = 33) -> np.ndarray:
    """Outward normals of a sphere seen head-on, in the OpenGL camera frame
    Marigold uses (x right, y up, z toward the viewer), as (1, 3, n, n).
    Row 0 is the top of the image."""
    ys, xs = np.mgrid[0:n, 0:n]
    x = (xs - (n - 1) / 2) / ((n - 1) / 2)
    y = -(ys - (n - 1) / 2) / ((n - 1) / 2)
    z = np.sqrt(np.clip(1 - x * x - y * y, 0, 1))
    v = np.stack([x, y, z])
    v /= np.linalg.norm(v, axis=0, keepdims=True)
    return v[None].astype(np.float32)


def test_dsine_frame_points_along_the_view_ray():
    """DSINE's RayReLU guarantees cos(n, ray) > 0 with OpenCV rays
    (x right, y down, z forward). Our conversion must satisfy the same
    invariant, or AniGen sees inverted geometry."""
    gl = _sphere_gl_normals()
    d = to_dsine_frame(gl)[0]
    n = gl.shape[-1]
    ys, xs = np.mgrid[0:n, 0:n]
    # Orthographic-ish rays for a centred object, flipped into OpenCV axes.
    ray = np.stack([(xs - n / 2) * 0.01, (ys - n / 2) * 0.01, np.ones_like(xs, dtype=float)])
    ray /= np.linalg.norm(ray, axis=0, keepdims=True)
    gl_cv = np.stack([gl[0, 0], -gl[0, 1], -gl[0, 2]])  # outward normal in OpenCV axes
    mask = gl[0, 2] > 0.2
    _check(np.all((d * ray).sum(0)[mask] > 0), "every DSINE-frame normal faces along its ray")
    _check(np.allclose(d, -gl_cv, atol=1e-6), "DSINE frame is the negated OpenCV outward normal")


def test_after_anigen_postprocess_the_map_is_the_gl_normal_map():
    gl = _sphere_gl_normals()
    out = _anigen_postprocess(to_dsine_frame(gl))
    _check(np.allclose(out, (gl + 1) / 2, atol=1e-6), "conditioning map == (n_gl + 1) / 2")
    c = out[0, :, 16, 16]
    _check(np.allclose(c, [0.5, 0.5, 1.0], atol=1e-6),
           f"camera-facing centre is AniGen's own fallback colour (128,128,255): {c.round(3)}")
    _check(out[0, 0, 16, -1] > 0.9 and out[0, 0, 16, 0] < 0.1, "right edge red-high, left edge red-low")
    _check(out[0, 1, 0, 16] > 0.9 and out[0, 1, -1, 16] < 0.1, "top edge green-high, bottom edge green-low")


def test_to_dsine_frame_does_not_mutate_its_input():
    gl = _sphere_gl_normals(5)
    before = gl.copy()
    to_dsine_frame(gl)
    _check(np.array_equal(gl, before), "input untouched")


def test_predictor_calls_marigold_and_returns_dsine_frame():
    try:
        import torch
    except ImportError:
        print("  [skip] torch not installed (runs in the Docker build)")
        return

    gl = torch.from_numpy(_sphere_gl_normals(8))
    calls = []

    class FakePipe:
        def __call__(self, image, **kwargs):
            calls.append((image, kwargs))

            class Out:
                prediction = gl.half()

            return Out()

    pred = MarigoldNormalPredictor(FakePipe(), "cpu").infer_pil("IMAGE")
    _check(len(calls) == 1 and calls[0][0] == "IMAGE", "passes the PIL image straight through")
    kw = calls[0][1]
    _check(kw.get("output_type") == "pt" and kw.get("match_input_resolution") is True,
           "asks for a tensor at the input's resolution")
    _check(kw.get("generator") is not None, "seeded, so the same image gives the same map")
    _check(pred.dtype == torch.float32 and tuple(pred.shape) == (1, 3, 8, 8), f"float32 (1,3,H,W): {pred.dtype} {tuple(pred.shape)}")
    _check(torch.allclose(pred, to_dsine_frame(gl.half().float())), "converted to DSINE's frame")

    try:
        from anigen.utils.image_utils import estimate_normal
    except Exception as exc:  # noqa: BLE001 - the checkout is only in the image
        print(f"  [skip] upstream estimate_normal not importable here ({type(exc).__name__})")
        return
    real = estimate_normal(None, MarigoldNormalPredictor(FakePipe(), "cpu"), "cpu")
    _check(torch.allclose(real, (gl + 1) / 2, atol=2e-3), "upstream estimate_normal yields the GL normal map")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            print(name)
            fn()
    if _FAILED:
        print("\nFAILED")
        sys.exit(1)
    print("\nALL PASSED")
