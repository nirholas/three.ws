import numpy as np
import pytest
import trimesh
from PIL import Image

import lato_policy as lp
import lato_run as lr


def source_sphere():
    m = trimesh.creation.icosphere(subdivisions=4, radius=3.0)
    m.apply_translation([10, 0, 5])
    return m


def good_runner(verts, faces, vert_num, seed):
    # A clean, lower-poly sphere in the normalised frame: what a passing model run returns.
    s = trimesh.creation.icosphere(subdivisions=3, radius=0.5)
    return np.asarray(s.vertices), np.asarray(s.faces)


def test_good_run_is_returned_in_the_source_frame():
    src = source_sphere()
    res = lr.retopologize(src, 1500, runner=good_runner)
    assert res.report["watertight"]
    assert res.seed == 42
    lo, hi = res.vertices.min(axis=0), res.vertices.max(axis=0)
    assert np.allclose((lo + hi) / 2, src.bounds.mean(axis=0), atol=0.05)
    assert (hi - lo).max() == pytest.approx(6.0, rel=0.02)


def test_torn_first_draw_is_retried_with_another_seed():
    calls = []

    def runner(verts, faces, vert_num, seed):
        calls.append(seed)
        v, f = good_runner(verts, faces, vert_num, seed)
        return (v, f[: int(len(f) * 0.8)]) if seed == 42 else (v, f)

    res = lr.retopologize(source_sphere(), 1500, runner=runner)
    assert calls == [42, 7]
    assert res.seed == 7
    assert [a["reason"] for a in res.attempts] == ["holes", "ok"]


def test_every_draw_torn_is_rejected_with_the_gate_reason():
    def runner(verts, faces, vert_num, seed):
        v, f = good_runner(verts, faces, vert_num, seed)
        return v, f[: int(len(f) * 0.8)]

    with pytest.raises(lr.RetopoRejected) as exc:
        lr.retopologize(source_sphere(), 1500, runner=runner)
    assert exc.value.reason == "holes"
    assert len(exc.value.attempts) == 3


def test_a_mesh_that_drifted_from_the_input_is_rejected():
    def runner(verts, faces, vert_num, seed):
        v, f = good_runner(verts, faces, vert_num, seed)
        return v + np.array([0.4, 0, 0]), f

    with pytest.raises(lr.RetopoRejected) as exc:
        lr.retopologize(source_sphere(), 1500, runner=runner)
    assert exc.value.reason == "drifted_from_input"


def test_inference_crash_on_every_seed_is_a_rejection_not_an_exception_leak():
    def runner(*_):
        raise RuntimeError("CUDA out of memory")

    with pytest.raises(lr.RetopoRejected) as exc:
        lr.retopologize(source_sphere(), 1500, runner=runner)
    assert exc.value.reason == "inference_failed"


def test_texture_colours_follow_the_source_surface():
    src = trimesh.creation.icosphere(subdivisions=3)
    uv = np.column_stack([
        0.5 + np.arctan2(src.vertices[:, 1], src.vertices[:, 0]) / (2 * np.pi),
        0.5 + np.arcsin(np.clip(src.vertices[:, 2], -1, 1)) / np.pi,
    ])
    img = Image.new("RGB", (64, 64), (255, 0, 0))
    src.visual = trimesh.visual.TextureVisuals(uv=uv, image=img)
    colors = lr.transfer_colors(src, np.asarray(src.vertices) * 1.001)
    assert colors.shape == (len(src.vertices), 4)
    assert (colors[:, 0] == 255).all() and (colors[:, 1] == 0).all()


def test_untextured_source_yields_no_colours():
    assert lr.transfer_colors(trimesh.creation.icosphere(), np.zeros((1, 3))) is None
