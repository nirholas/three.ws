"""
Tests for dense_fit.py. A synthetic head (a unit sphere with a nasal ridge) is
photographed analytically: the "photo" is the Lambertian shading of the TRUE
surface, so the fit has a real signal to recover and the expected improvement is
known. torch-dependent tests skip where torch is absent (the portable CPU image
does not ship it; the RTX image does).
"""
import numpy as np
import pytest

import dense_fit
from face_projection import WeakPerspectiveCamera

torch = pytest.importorskip("torch")

W = H = 256
SCALE = 100.0


def _sphere(n_lat=44, n_lon=64):
    """Front-facing hemisphere-plus mesh, poles included, fixed topology."""
    lat = np.linspace(-np.pi / 2 * 0.98, np.pi / 2 * 0.98, n_lat)
    lon = np.linspace(-np.pi * 0.98, np.pi * 0.98, n_lon, endpoint=False)
    verts = []
    for a in lat:
        for b in lon:
            verts.append([np.cos(a) * np.sin(b), np.sin(a), np.cos(a) * np.cos(b)])
    verts = np.asarray(verts, dtype=np.float64)
    faces = []
    for i in range(n_lat - 1):
        for j in range(n_lon):
            j2 = (j + 1) % n_lon
            a, b = i * n_lon + j, i * n_lon + j2
            c, d = (i + 1) * n_lon + j, (i + 1) * n_lon + j2
            faces += [[a, b, c], [b, d, c]]
    return verts, np.asarray(faces, dtype=np.int64)


def _bump(x, y):
    """A nasal-ridge style bump in front of the face, smooth and compact."""
    return 0.10 * np.exp(-((x / 0.18) ** 2 + ((y + 0.05) / 0.35) ** 2))


def _camera():
    return WeakPerspectiveCamera(SCALE, np.eye(3), np.array([W / 2.0, -H / 2.0, 0.0]), W, H)


def _normals(v, f):
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    acc = np.zeros_like(v)
    for k in range(3):
        np.add.at(acc, f[:, k], fn)
    return acc / np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-12)


def _photo(verts, faces, light=(0.25, 0.35, 0.9)):
    """
    Photograph `verts` with the same Lambertian model the fit assumes (ambient
    plus a directional light, constant albedo): vertex shading is interpolated
    over front-facing triangles by a z-buffered orthographic rasteriser. The
    data is realisable, so a correct optimiser has a known answer to find.
    """
    l = np.asarray(light, dtype=np.float64)
    l /= np.linalg.norm(l)
    shade = 0.35 + 0.65 * np.clip(_normals(verts, faces) @ l, 0, 1)
    px = np.stack([verts[:, 0] * SCALE + W / 2.0, -verts[:, 1] * SCALE + H / 2.0], axis=1)
    img = np.full((H, W), 0.1)
    zbuf = np.full((H, W), -np.inf)
    cover = np.zeros((H, W), dtype=np.float32)
    for tri in faces:
        a, b, c = px[tri]
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-9 or den > 0:
            continue
        x0, x1 = int(max(min(a[0], b[0], c[0]) - 1, 0)), int(min(max(a[0], b[0], c[0]) + 2, W))
        y0, y1 = int(max(min(a[1], b[1], c[1]) - 1, 0)), int(min(max(a[1], b[1], c[1]) + 2, H))
        if x1 <= x0 or y1 <= y0:
            continue
        ys, xs = np.mgrid[y0:y1, x0:x1]
        w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
        w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
        w2 = 1 - w0 - w1
        ok = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        z = w0 * verts[tri[0], 2] + w1 * verts[tri[1], 2] + w2 * verts[tri[2], 2]
        ok &= z > zbuf[y0:y1, x0:x1]
        val = w0 * shade[tri[0]] + w1 * shade[tri[1]] + w2 * shade[tri[2]]
        img[y0:y1, x0:x1][ok] = val[ok]
        zbuf[y0:y1, x0:x1][ok] = z[ok]
        cover[y0:y1, x0:x1][ok] = 1.0
    rgb = np.stack([img * 0.85, img * 0.68, img * 0.58], axis=-1)
    return (np.clip(rgb, 0, 1) * 255).astype(np.uint8), cover


@pytest.fixture(scope="module")
def scene():
    verts, faces = _sphere()
    target = verts.copy()
    target[:, 2] = verts[:, 2] + np.where(verts[:, 2] > 0, _bump(verts[:, 0], verts[:, 1]), 0.0)
    photo, mask = _photo(target, faces)
    return verts, faces, photo, mask, target


def _fit(scene, **kw):
    verts, faces, photo, mask, _ = scene
    return dense_fit.fit_dense_head(
        verts, faces, _camera(), photo, mask, None, None, None,
        iterations=kw.pop("iterations", 150), time_budget=kw.pop("time_budget", 120),
        device="cpu", **kw,
    )


def test_fit_lowers_its_own_photometric_loss_and_closes_the_gap(scene):
    verts, _, _, _, target = scene
    res = _fit(scene, seed=3)
    assert res is not None
    assert res.loss_after < res.loss_before
    # Shading cannot see a uniform shift along the normal, so judge the relief
    # shape (offset removed), inside the region the bump lives in.
    region = (np.abs(verts[:, 0]) < 0.3) & (np.abs(verts[:, 1] + 0.05) < 0.5) & (verts[:, 2] > 0.5)
    truth = (target - verts)[region, 2]
    got = (res.positions - verts)[region, 2]
    corr = np.corrcoef(got, truth)[0, 1]
    assert corr > 0.6, f"recovered relief barely correlates with the truth ({corr:.2f})"
    resid = (got - got.mean()) - (truth - truth.mean())
    assert np.sqrt((resid ** 2).mean()) < np.sqrt(((truth - truth.mean()) ** 2).mean())


def test_topology_and_vertex_order_are_preserved(scene):
    verts, _, _, _, _ = scene
    res = _fit(scene, seed=1)
    assert res is not None
    assert res.positions.shape == verts.shape
    # vertex i stays near vertex i: nothing was reordered or resampled
    assert np.linalg.norm(res.positions - verts, axis=1).max() < 0.25


def test_displacement_bound_is_respected_structurally(scene, monkeypatch):
    verts, _, _, _, _ = scene
    monkeypatch.setenv("DENSE_FIT_MAX_DISP_FRAC", "0.01")
    res = _fit(scene, seed=2)
    assert res is not None
    height = np.ptp(verts[:, 1])
    assert res.max_displacement <= 0.01 * height * 1.0001


def test_deterministic_given_a_seed(scene):
    a = _fit(scene, seed=7, iterations=40)
    b = _fit(scene, seed=7, iterations=40)
    assert a is not None and b is not None
    np.testing.assert_allclose(a.positions, b.positions, atol=1e-5)


def test_time_budget_returns_none_not_an_exception(scene):
    verts, faces, photo, mask, _ = scene
    out = dense_fit.fit_dense_head(
        verts, faces, _camera(), photo, mask, None, None, None,
        iterations=500, time_budget=0.001, device="cpu",
    )
    assert out is None


def test_unusable_mesh_returns_none(scene):
    verts, faces, photo, mask, _ = scene
    assert dense_fit.fit_dense_head(verts[:10], faces, _camera(), photo, mask, device="cpu") is None


def test_mismatched_mask_returns_none(scene):
    verts, faces, photo, _, _ = scene
    bad = np.ones((10, 10), dtype=np.float32)
    assert dense_fit.fit_dense_head(verts, faces, _camera(), photo, bad, device="cpu") is None


def test_flat_photo_gives_no_improvement_and_falls_back(scene):
    verts, faces, _, mask, _ = scene
    flat = np.full((H, W, 3), 128, dtype=np.uint8)
    out = dense_fit.fit_dense_head(
        verts, faces, _camera(), flat, mask, None, None, None, iterations=30, device="cpu"
    )
    # A uniform photo carries no shape signal: either no improvement is found
    # (None) or the displacement stays tiny. It must never wander.
    assert out is None or out.max_displacement < 0.05


def test_eligibility_gate():
    ok = dict(yaw_deg=10.0, max_yaw_deg=35.0, landmarks_ok=True, camera_ok=True)
    assert dense_fit.eligible(**ok)
    assert not dense_fit.eligible(**{**ok, "yaw_deg": 36.0})
    assert not dense_fit.eligible(**{**ok, "landmarks_ok": False})
    assert not dense_fit.eligible(**{**ok, "camera_ok": False})
    assert not dense_fit.eligible(**{**ok, "yaw_deg": float("nan")})


def test_flag_defaults_off(monkeypatch):
    monkeypatch.delenv("DENSE_FIT", raising=False)
    assert not dense_fit.enabled()
    monkeypatch.setenv("DENSE_FIT", "1")
    assert dense_fit.enabled()
