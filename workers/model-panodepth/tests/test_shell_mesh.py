import json
import struct

import numpy as np

import shell_mesh


def _room(h=64, w=128, dist=3.0):
    return np.full((h, w), dist, dtype=np.float32), np.ones((h, w), dtype=bool)


def test_seam_vertices_coincide_and_uv_wraps():
    d, v = _room()
    shell = shell_mesh.build_shell(d, v, max_faces=20_000)
    w, h = shell.grid
    pos = shell.positions
    # The duplicated seam column has the same position as column 0 on every row.
    first = {tuple(np.round(p, 5)) for p in pos}
    assert len(first) < len(pos)  # duplicates exist (seam column)
    assert shell.uvs[:, 0].max() > 1.0  # u > 1 on the seam column, REPEAT wraps it
    assert shell.uvs[:, 0].min() > 0.0


def test_shell_radius_matches_input_distance():
    d, v = _room(dist=2.5)
    shell = shell_mesh.build_shell(d, v, max_faces=20_000)
    r = np.linalg.norm(shell.positions, axis=1)
    assert np.allclose(r, 2.5, atol=1e-3)


def test_depth_jump_is_culled_and_smooth_surface_kept():
    d, v = _room(64, 128, 2.0)
    d[:, 40:60] = 20.0  # a far window in a near wall: a depth discontinuity
    smooth = shell_mesh.build_shell(*_room(64, 128, 2.0), max_faces=20_000)
    jumpy = shell_mesh.build_shell(d, v, max_faces=20_000)
    assert smooth.culled_faces == 0
    assert jumpy.culled_faces > 0


def test_invalid_pixels_become_sky_dome():
    d, v = _room()
    v[:10, :] = False  # sky band
    shell = shell_mesh.build_shell(d, v, max_faces=20_000)
    assert shell.dome_radius is not None and shell.dome_radius >= 3.0


def test_ply_thins_poles_equal_area(tmp_path):
    h, w = 64, 128
    d, v = _room(h, w)
    rgb = np.zeros((h, w, 3), dtype=np.uint8)
    out = tmp_path / "s.ply"
    n = shell_mesh.write_point_ply(str(out), d, v, rgb, max_points=10_000_000)
    assert n < h * w
    raw = out.read_bytes()
    head_end = raw.index(b"end_header\n") + len(b"end_header\n")
    rec = np.frombuffer(raw[head_end:], dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("c", "u1", 3)])
    assert len(rec) == n
    y = rec["y"] / 3.0
    polar = np.abs(y) > np.sin(np.radians(75))
    equatorial = np.abs(y) < np.sin(np.radians(15))
    # Same solid angle per band would give equal counts per unit area: polar caps
    # (75-90) hold far fewer points than a naive grid dump would.
    naive_polar = int(h * 0.1667) * w
    assert polar.sum() < 0.5 * naive_polar
    assert equatorial.sum() > polar.sum()


def test_glb_structure(tmp_path):
    d, v = _room()
    shell = shell_mesh.build_shell(d, v, max_faces=20_000)
    from PIL import Image
    import io

    buf = io.BytesIO()
    Image.new("RGB", (64, 32), (120, 130, 140)).save(buf, "JPEG")
    out = tmp_path / "s.glb"
    shell_mesh.write_glb(str(out), shell, buf.getvalue(), extras={"k": 1})
    raw = out.read_bytes()
    magic, version, length = struct.unpack("<4sII", raw[:12])
    assert magic == b"glTF" and version == 2 and length == len(raw)
    jlen = struct.unpack("<I", raw[12:16])[0]
    gltf = json.loads(raw[20 : 20 + jlen])
    assert "KHR_materials_unlit" in gltf["extensionsUsed"]
    assert gltf["samplers"][0]["wrapS"] == 10497


def test_cull_on_real_street_depth():
    """Real MoGe-2 metric distance from the Oulu street photo (Insta360 X5, CC0),
    produced by the GPU verify job and halved to 960x480. Vegetation and building
    edges carry real depth jumps; the sky is invalid."""
    from pathlib import Path

    z = np.load(Path(__file__).parent / "oulu_street_depth.npz")
    dist = z["distance"].astype(np.float32)
    valid = z["valid"]
    shell = shell_mesh.build_shell(dist, valid, max_faces=200_000)
    assert shell.culled_faces > 100  # the tree and rooflines produce real discontinuities
    assert shell.culled_faces < 0.1 * len(shell.indices)  # but the scene is not shredded
    # No surviving triangle bridges a depth jump: every kept edge is short or smooth.
    pos, idx = shell.positions, shell.indices.reshape(-1, 3)
    r = np.linalg.norm(pos, axis=1)
    for a, b in ((0, 1), (1, 2), (2, 0)):
        ra, rb = r[idx[:, a]], r[idx[:, b]]
        length = np.linalg.norm(pos[idx[:, a]] - pos[idx[:, b]], axis=1)
        broken = (np.abs(ra - rb) / np.minimum(ra, rb) > 0.5) & (length > 1.0)
        assert broken.sum() == 0
