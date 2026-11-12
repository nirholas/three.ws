"""Tests for the vendored bake rasteriser (bake_raster.py).

Run with: python -m pytest test_bake_raster.py -q   (needs torch; CPU is enough)

Every test of the torch backend runs on CPU. The cross-backend comparison at the
bottom runs only where nvdiffrast and CUDA are both present (a GPU host with the
worker image); everywhere else it is skipped with that reason, never faked.
"""

from __future__ import annotations

import importlib.util
import math
import sys
import types

import pytest

torch = pytest.importorskip("torch")
# One thread: these tensors are small, and a shared CI or dev host with every
# core busy turns torch's thread pool into minutes of contention.
torch.set_num_threads(1)

import bake_raster  # noqa: E402

TB = bake_raster.TORCH_BACKEND
# Read once at import, before any test can register the nvdiffrast shim.
_NVDR_INSTALLED = importlib.util.find_spec("nvdiffrast") is not None


@pytest.fixture(autouse=True)
def _restore_nvdiffrast_modules():
    """install("torch") may register shim modules; never let one leak into the next test."""
    saved = {k: sys.modules.get(k) for k in ("nvdiffrast", "nvdiffrast.torch")}
    yield
    for key, mod in saved.items():
        if mod is None:
            sys.modules.pop(key, None)
        else:
            sys.modules[key] = mod


def clip(xy, z=None, w=None):
    """[V,2] NDC xy -> [1,V,4] clip-space positions (w=1 unless given)."""
    xy = torch.as_tensor(xy, dtype=torch.float32)
    n = xy.shape[0]
    zz = torch.zeros(n, 1) if z is None else torch.as_tensor(z, dtype=torch.float32).reshape(n, 1)
    ww = torch.ones(n, 1) if w is None else torch.as_tensor(w, dtype=torch.float32).reshape(n, 1)
    return torch.cat([xy * ww, zz * ww, ww], dim=-1).unsqueeze(0)


def tri(*rows):
    return torch.tensor(rows, dtype=torch.int32)


def pixel_centers(w, h):
    xs = (torch.arange(w, dtype=torch.float32) + 0.5) * 2 / w - 1
    ys = (torch.arange(h, dtype=torch.float32) + 0.5) * 2 / h - 1
    gy, gx = torch.meshgrid(ys, xs, indexing="ij")
    return gx, gy


def raster(pos, faces, res, **kw):
    ctx = TB.RasterizeCudaContext()
    return TB.rasterize(ctx, pos, faces, resolution=res, **kw)


# --- coverage and barycentrics ---------------------------------------------------


def test_half_square_coverage_matches_pixel_centres():
    # Lower-left half of the viewport: covered pixel centres satisfy x + y <= 0.
    pos = clip([[-1, -1], [1, -1], [-1, 1]])
    rast, _ = raster(pos, tri([0, 1, 2]), (8, 8))
    gx, gy = pixel_centers(8, 8)
    expected = (gx + gy) <= 1e-6
    assert torch.equal(rast[0, ..., 3] > 0, expected)
    # Row 0 is NDC y = -1 (bottom), the nvdiffrast / OpenGL convention.
    assert rast[0, 0, 0, 3] == 1 and rast[0, 7, 7, 3] == 0


def test_interpolated_position_reproduces_pixel_centre():
    pos = clip([[-0.9, -0.7], [0.8, -0.95], [0.1, 0.85]])
    faces = tri([0, 1, 2])
    rast, _ = raster(pos, faces, (64, 48))
    out, _ = TB.interpolate(pos[0, :, :2].contiguous(), rast, faces)
    mask = rast[0, ..., 3] > 0
    gx, gy = pixel_centers(48, 64)  # resolution is (height, width)
    assert mask.sum() > 500
    assert torch.allclose(out[0, ..., 0][mask], gx[mask], atol=1e-5)
    assert torch.allclose(out[0, ..., 1][mask], gy[mask], atol=1e-5)
    # Barycentric layout: (b0, b1) stored, b2 = 1 - b0 - b1, all in [0, 1].
    b = rast[0][mask][:, :2]
    assert (b >= 0).all() and (b.sum(-1) <= 1 + 1e-6).all()


def test_perspective_correct_barycentrics():
    # A 3D triangle seen through a pinhole: interpolating its world position must
    # land on the ray through the pixel centre (perspective-correct, not affine).
    world = torch.tensor([[-1.0, -1.0, -2.0], [1.5, -0.8, -6.0], [0.0, 1.2, -3.0]])
    f, near, far = 1.0, 0.1, 10.0
    proj = torch.tensor([
        [f, 0, 0, 0],
        [0, f, 0, 0],
        [0, 0, -(far + near) / (far - near), -2 * far * near / (far - near)],
        [0, 0, -1, 0],
    ])
    homog = torch.cat([world, torch.ones(3, 1)], dim=-1)
    pos = (homog @ proj.T).unsqueeze(0)
    faces = tri([0, 1, 2])
    rast, _ = raster(pos, faces, (96, 96))
    out, _ = TB.interpolate(world, rast, faces)
    mask = rast[0, ..., 3] > 0
    gx, gy = pixel_centers(96, 96)
    p = out[0][mask]
    assert mask.sum() > 300
    # Project the interpolated world point; it must reproject onto the pixel centre.
    assert torch.allclose(-f * p[:, 0] / p[:, 2], gx[mask], atol=2e-4)
    assert torch.allclose(-f * p[:, 1] / p[:, 2], gy[mask], atol=2e-4)
    # z/w channel equals the projected depth of that point.
    zc = proj[2, 2] * p[:, 2] + proj[2, 3]
    assert torch.allclose(rast[0][mask][:, 2], zc / -p[:, 2], atol=1e-4)


def test_quad_split_on_diagonal_has_no_holes_and_no_double_cover():
    pos = clip([[-1, -1], [1, -1], [1, 1], [-1, 1]])
    faces = tri([0, 1, 2], [0, 2, 3])
    rast, _ = raster(pos, faces, (33, 17))
    ids = rast[0, ..., 3]
    assert (ids > 0).all()
    assert set(ids.unique().tolist()) == {1.0, 2.0}


def test_winding_does_not_cull():
    cw = clip([[-1, -1], [-1, 1], [1, -1]])
    rast, _ = raster(cw, tri([0, 1, 2]), (16, 16))
    assert (rast[0, ..., 3] > 0).sum() > 100


def test_degenerate_and_offscreen_triangles_are_skipped():
    pos = clip([[0, 0], [0.5, 0.5], [1, 1], [3, 3], [4, 3], [3, 4]])
    rast, _ = raster(pos, tri([0, 1, 2], [3, 4, 5]), (16, 16))
    assert (rast[0, ..., 3] == 0).all()


def test_behind_camera_triangle_is_dropped():
    pos = clip([[-1, -1], [1, -1], [0, 1]], w=[1.0, -1.0, 1.0])
    rast, _ = raster(pos, tri([0, 1, 2]), (16, 16))
    assert (rast[0, ..., 3] == 0).all()


# --- depth test --------------------------------------------------------------------


def test_nearer_triangle_wins_regardless_of_order():
    far_tri = [[-1, -1], [1, -1], [0, 1]]
    near_tri = [[-1, -1], [1, -1], [0, 1]]
    pos = torch.cat([clip(far_tri, z=[0.5] * 3), clip(near_tri, z=[-0.5] * 3)], dim=1)
    rast, _ = raster(pos, tri([0, 1, 2], [3, 4, 5]), (16, 16))
    covered = rast[0, ..., 3] > 0
    assert (rast[0, ..., 3][covered] == 2).all()
    assert torch.allclose(rast[0, ..., 2][covered], torch.tensor(-0.5))
    rast2, _ = raster(pos, tri([3, 4, 5], [0, 1, 2]), (16, 16))
    assert (rast2[0, ..., 3][covered] == 1).all()


def test_equal_depth_tie_goes_to_lowest_triangle_id():
    pos = clip([[-1, -1], [1, -1], [0, 1]])
    rast, _ = raster(pos, tri([0, 1, 2], [0, 1, 2]), (8, 8))
    covered = rast[0, ..., 3] > 0
    assert (rast[0, ..., 3][covered] == 1).all()


def test_depth_outside_clip_range_is_clipped():
    pos = clip([[-1, -1], [1, -1], [0, 1]], z=[1.5] * 3)
    rast, _ = raster(pos, tri([0, 1, 2]), (8, 8))
    assert (rast[0, ..., 3] == 0).all()


# --- chunking, batching, ranges ------------------------------------------------------


def test_chunking_is_invisible_even_for_a_triangle_larger_than_the_budget():
    g = torch.Generator().manual_seed(7)
    xy = torch.rand(300, 2, generator=g) * 2 - 1
    z = torch.rand(300, generator=g) * 1.8 - 0.9
    faces = torch.randint(0, 300, (400, 3), generator=g, dtype=torch.int32)
    big = torch.cat([xy, torch.tensor([[-1.0, -1.0], [3.0, -1.0], [-1.0, 3.0]])])
    zb = torch.cat([z, torch.tensor([0.95, 0.95, 0.95])])
    faces = torch.cat([faces, torch.tensor([[300, 301, 302]], dtype=torch.int32)])
    pos = clip(big, z=zb)
    a, adb = raster(pos, faces, (64, 64), candidate_budget=1 << 22)
    b, bdb = raster(pos, faces, (64, 64), candidate_budget=4093)
    assert torch.equal(a, b)
    assert torch.equal(adb, bdb)


def test_instanced_minibatch():
    p0 = clip([[-1, -1], [1, -1], [0, 1]])
    p1 = clip([[-1, 1], [1, 1], [0, -1]])
    rast, _ = raster(torch.cat([p0, p1]), tri([0, 1, 2]), (16, 16))
    assert rast.shape == (2, 16, 16, 4)
    assert rast[0, 0, 8, 3] == 1 and rast[0, 15, 8, 3] == 0
    assert rast[1, 15, 8, 3] == 1 and rast[1, 0, 8, 3] == 0


def test_range_mode():
    pos = clip([[-1, -1], [0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]])[0]
    faces = tri([0, 1, 2], [3, 4, 5])
    ranges = torch.tensor([[0, 1], [1, 1]], dtype=torch.int32)
    rast, _ = raster(pos, faces, (16, 16), ranges=ranges)
    assert rast.shape == (2, 16, 16, 4)
    assert set(rast[0, ..., 3].unique().tolist()) == {0.0, 1.0}
    # Triangle ids stay global in range mode, as in nvdiffrast.
    assert set(rast[1, ..., 3].unique().tolist()) == {0.0, 2.0}


def test_uv_bake_chunked_offset_loop_matches_single_pass():
    # The exact loop o_voxel.postprocess.to_glb runs: rasterize face chunks and
    # write the chunk offset into the id channel.
    g = torch.Generator().manual_seed(3)
    n = 12
    cells = []
    for i in range(n):
        for j in range(n):
            x0, y0, s = i / n, j / n, 1 / n
            base = len(cells) * 4
            cells.append((base, [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]]))
    uvs = torch.tensor([v for _, quad in cells for v in quad], dtype=torch.float32)
    faces = torch.tensor(
        [f for base, _ in cells for f in ([base, base + 1, base + 2], [base, base + 2, base + 3])],
        dtype=torch.int32,
    )
    faces = faces[torch.randperm(faces.shape[0], generator=g)]
    uvs_rast = torch.cat([uvs * 2 - 1, torch.zeros_like(uvs[:, :1]), torch.ones_like(uvs[:, :1])], -1).unsqueeze(0)
    ctx = TB.RasterizeCudaContext()
    size = 64
    rast = torch.zeros((1, size, size, 4))
    step = 50
    for i in range(0, faces.shape[0], step):
        chunk, _ = TB.rasterize(ctx, uvs_rast, faces[i:i + step], resolution=[size, size])
        m = chunk[..., 3:4] > 0
        chunk[..., 3:4] += i
        rast = torch.where(m, chunk, rast)
    single, _ = TB.rasterize(ctx, uvs_rast, faces, resolution=[size, size])
    assert ((rast[0, ..., 3] > 0) == (single[0, ..., 3] > 0)).all()
    assert (rast[0, ..., 3] > 0).all()
    pos_a, _ = TB.interpolate(uvs, rast, faces)
    pos_b, _ = TB.interpolate(uvs, single, faces)
    assert torch.allclose(pos_a, pos_b, atol=1e-5)


# --- derivatives and autograd ------------------------------------------------------


def test_rast_db_matches_finite_differences():
    pos = clip([[-0.9, -0.8], [0.9, -0.6], [-0.2, 0.9]], w=[1.0, 2.0, 1.5])
    faces = tri([0, 1, 2])
    rast, db = raster(pos, faces, (64, 64))
    inside = rast[0, ..., 3] > 0
    core = inside[1:-1, 1:-1] & inside[2:, 1:-1] & inside[:-2, 1:-1] & inside[1:-1, 2:] & inside[1:-1, :-2]
    r = rast[0, ..., :2]
    dudx_fd = (r[1:-1, 2:, 0] - r[1:-1, :-2, 0]) / 2
    dvdy_fd = (r[2:, 1:-1, 1] - r[:-2, 1:-1, 1]) / 2
    assert core.sum() > 200
    assert torch.allclose(db[0, 1:-1, 1:-1, 0][core], dudx_fd[core], atol=2e-4)
    assert torch.allclose(db[0, 1:-1, 1:-1, 3][core], dvdy_fd[core], atol=2e-4)


def test_grad_db_false_returns_empty_derivatives():
    rast, db = raster(clip([[-1, -1], [1, -1], [0, 1]]), tri([0, 1, 2]), (8, 8), grad_db=False)
    assert db.numel() == 0


def test_gradients_flow_to_positions_and_attributes():
    pos = clip([[-0.9, -0.8], [0.9, -0.6], [-0.2, 0.9]]).requires_grad_(True)
    attr = torch.tensor([[1.0], [2.0], [3.0]], requires_grad=True)
    faces = tri([0, 1, 2])
    rast, _ = raster(pos, faces, (32, 32))
    out, _ = TB.interpolate(attr, rast, faces)
    out.sum().backward()
    assert pos.grad is not None and torch.isfinite(pos.grad).all() and pos.grad.abs().sum() > 0
    covered = int((rast[0, ..., 3] > 0).sum())
    assert torch.allclose(attr.grad.sum(), torch.tensor(float(covered)), atol=1e-3)


def test_triangle_id_encoding_round_trips_above_float_precision():
    ids = torch.tensor([1, 2, 16777215, 16777216, 16777217, 40000000], dtype=torch.int64)
    enc = bake_raster.encode_triangle_ids(ids)
    assert enc.dtype == torch.float32
    assert torch.equal(bake_raster.decode_triangle_ids(enc), ids)
    assert enc[0] == 1.0 and enc[3] == 16777216.0


# --- backend selection ---------------------------------------------------------------


def test_default_backend_is_nvdiffrast(monkeypatch):
    monkeypatch.delenv(bake_raster.BACKEND_ENV, raising=False)
    assert bake_raster.backend_name() == "nvdiffrast"


def test_backend_name_reads_env_and_rejects_unknown(monkeypatch):
    monkeypatch.setenv(bake_raster.BACKEND_ENV, " Torch ")
    assert bake_raster.backend_name() == "torch"
    assert bake_raster.load_backend() is TB
    monkeypatch.setenv(bake_raster.BACKEND_ENV, "pytorch3d")
    with pytest.raises(ValueError, match="pytorch3d"):
        bake_raster.backend_name()


def test_install_rebinds_dr_in_the_target_modules(monkeypatch):
    fake = types.ModuleType("fake_postprocess")
    fake.dr = object()
    monkeypatch.setitem(sys.modules, "fake_postprocess", fake)
    name = bake_raster.install("torch", modules=("fake_postprocess",))
    assert name == "torch" and fake.dr is TB


def test_install_torch_shims_nvdiffrast_when_it_is_not_installed(monkeypatch):
    if _NVDR_INSTALLED:
        pytest.skip("nvdiffrast is installed here, so no shim is registered")
    bake_raster.install("torch", modules=())
    import nvdiffrast.torch as dr  # resolves to the shim

    assert dr is TB
    # Asking for the real backend afterwards still fails loudly: the shim is not nvdiffrast.
    with pytest.raises(RuntimeError, match="BAKE_RASTER_BACKEND=torch"):
        bake_raster.load_backend("nvdiffrast")


def test_load_nvdiffrast_backend_fails_loudly_when_missing():
    if _NVDR_INSTALLED:
        pytest.skip("nvdiffrast is installed here")
    with pytest.raises(RuntimeError, match="BAKE_RASTER_BACKEND=torch"):
        bake_raster.load_backend("nvdiffrast")


# --- cross-backend comparison (GPU hosts only) ---------------------------------------

_HAS_NVDR = _NVDR_INSTALLED and torch.cuda.is_available()


def _unit_sphere(n_lat=24, n_lon=48):
    verts = []
    for i in range(n_lat + 1):
        th = math.pi * i / n_lat
        for j in range(n_lon):
            ph = 2 * math.pi * j / n_lon
            verts.append([math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph)])
    faces = []
    for i in range(n_lat):
        for j in range(n_lon):
            a, b = i * n_lon + j, i * n_lon + (j + 1) % n_lon
            c, d = a + n_lon, b + n_lon
            faces += [[a, c, b], [b, c, d]]
    return torch.tensor(verts), torch.tensor(faces, dtype=torch.int32)


# nvdiffrast snaps vertices to a fixed-point subpixel grid before it rasterises, so
# its coverage edges sit up to a few hundredths of a pixel off the exact ones (the
# real-mesh benchmark measured at most 0.044 px). The torch backend tests against
# the exact edges. Parity therefore means: every pixel where the two disagree lies
# within that snapping band of an edge, the torch backend never picks a triangle
# that misses the pixel centre, and wherever both pick the same triangle they
# agree to float precision.
SNAP_BAND_PX = 1 / 16


def _edge_distance_px(pos, faces, face_ids, ys, xs, height, width):
    """Signed distance in pixels from each pixel centre to the nearest edge of its face (> 0 inside)."""
    v = pos[0, faces[face_ids].long()]
    sx = (v[..., 0] / v[..., 3] + 1) * width / 2
    sy = (v[..., 1] / v[..., 3] + 1) * height / 2
    px, py = xs.double() + 0.5, ys.double() + 0.5
    sx, sy = sx.double(), sy.double()
    area = (sx[:, 1] - sx[:, 0]) * (sy[:, 2] - sy[:, 0]) - (sy[:, 1] - sy[:, 0]) * (sx[:, 2] - sx[:, 0])
    dist = []
    for a, b in ((0, 1), (1, 2), (2, 0)):
        ex, ey = sx[:, b] - sx[:, a], sy[:, b] - sy[:, a]
        cross = ex * (py - sy[:, a]) - ey * (px - sx[:, a])
        dist.append(cross * torch.sign(area) / torch.sqrt(ex * ex + ey * ey))
    return torch.stack(dist, -1).min(-1).values


@pytest.mark.skipif(not _HAS_NVDR, reason="nvdiffrast and CUDA are both required for the cross-backend check")
def test_torch_backend_matches_nvdiffrast_on_a_unit_mesh():
    import nvdiffrast.torch as nvdr

    verts, faces = _unit_sphere()
    verts, faces = verts.cuda(), faces.cuda()
    cam = torch.tensor([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, -3.0], [0, 0, 0, 1]], device="cuda")
    proj = torch.tensor([[1.6, 0, 0, 0], [0, 1.6, 0, 0], [0, 0, -1.02, -0.202], [0, 0, -1, 0]], device="cuda")
    pos = (torch.cat([verts, torch.ones_like(verts[:, :1])], -1) @ (proj @ cam).T).unsqueeze(0).contiguous()
    height, width = 256, 256
    ref, _ = nvdr.rasterize(nvdr.RasterizeCudaContext(), pos, faces, resolution=[height, width])
    got, _ = TB.rasterize(TB.RasterizeCudaContext(), pos, faces, resolution=[height, width])
    ri, gi = ref[0, ..., 3].long(), got[0, ..., 3].long()
    either = (ri > 0) | (gi > 0)
    same = (ri == gi) & (ri > 0)
    assert same.sum() / either.sum() > 0.99

    # Every pixel the torch backend covers has its centre inside the chosen triangle.
    ys, xs = torch.nonzero(gi > 0, as_tuple=True)
    assert _edge_distance_px(pos, faces, gi[ys, xs] - 1, ys, xs, height, width).min() > -1e-4

    # Every disagreement (other triangle, or covered by one backend only) is an edge
    # pixel inside nvdiffrast's snapping band.
    for ids, mask in ((ri, either & ~same & (ri > 0)), (gi, either & ~same & (gi > 0))):
        ys, xs = torch.nonzero(mask, as_tuple=True)
        dist = _edge_distance_px(pos, faces, ids[ys, xs] - 1, ys, xs, height, width)
        assert dist.abs().max() < SNAP_BAND_PX

    # Same triangle: barycentrics and depth agree to float precision.
    assert (ref[0, ..., :2][same] - got[0, ..., :2][same]).abs().max() < 1e-4
    assert (ref[0, ..., 2][same] - got[0, ..., 2][same]).abs().max() < 1e-5

    # What a bake samples: interpolated surface points over every pixel both cover.
    both = (ri > 0) & (gi > 0)
    a = nvdr.interpolate(verts[None].contiguous(), ref, faces)[0][0]
    b = nvdr.interpolate(verts[None].contiguous(), got, faces)[0][0]
    err = (a - b).norm(dim=-1)[both]
    assert torch.quantile(err, 0.999) < 1e-3 and err.max() < 1e-2
