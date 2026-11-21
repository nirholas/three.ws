"""Lift an equirectangular distance map to a textured sphere-grid shell.

Pure numpy, no torch, so the geometry is unit-testable without a GPU.

Frame (glTF): +Y up, -Z forward, +X right, metres, camera at the origin. The
centre pixel of the equirect looks along -Z, image x grows to the right (+X),
image y grows downward (toward -Y).

Mesh: a uniform latitude/longitude grid of vertices along each pixel ray at its
measured distance. Longitude has W + 1 columns: column W repeats column 0 with
u = 1, so the wrap seam is closed geometrically (coincident positions) while the
texture coordinates stay continuous. Both poles are closed with a fan whose apex
is a per-triangle vertex, so every cap triangle gets a clean u. Triangles that
bridge a depth discontinuity are dropped by an edge test (see ``cull_mask``).
"""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass
from typing import Optional

import numpy as np

# Edge test. An edge is broken when it is both long relative to the ray spacing at its
# nearer end (a surface seen near edge-on, or a depth jump) and the two ends differ in
# distance by more than DEPTH_JUMP (relative). A smooth floor seen at a grazing angle is
# long but its neighbours differ little, so it survives. Checked on the five GPU verify
# photos by rendering the shells from the origin and from 1 m off-centre: foliage,
# rooflines and vehicle edges open clean disocclusion gaps with no stretched curtains,
# while floors and walls stay closed (README "Tuning").
EDGE_RATIO = 8.0
DEPTH_JUMP = 0.12


def directions(width: int, height: int) -> np.ndarray:
    """Unit ray per pixel centre, shape (height, width, 3), glTF frame."""
    yaw = ((np.arange(width, dtype=np.float64) + 0.5) / width - 0.5) * (2.0 * np.pi)
    pitch = (0.5 - (np.arange(height, dtype=np.float64) + 0.5) / height) * np.pi
    cp, sp = np.cos(pitch)[:, None], np.sin(pitch)[:, None]
    sy, cy = np.sin(yaw)[None, :], np.cos(yaw)[None, :]
    d = np.empty((height, width, 3), dtype=np.float64)
    d[..., 0] = sy * cp
    d[..., 1] = sp
    d[..., 2] = -cy * cp
    return d


def grid_size_for_budget(max_faces: int) -> tuple[int, int]:
    """(W, H) of a 2:1 grid whose full face count is at most ``max_faces``."""
    h = max(8, int(np.sqrt(max_faces / 4.0)))
    return 2 * h, h


def sample_grid(distance: np.ndarray, valid: np.ndarray, width: int, height: int):
    """Nearest-pixel resample at the grid's cell centres.

    Nearest, not area-averaged: averaging across a depth edge invents distances
    that bridge it, which is exactly the curtain the cull removes.
    """
    h0, w0 = distance.shape
    ys = np.minimum(((np.arange(height) + 0.5) * h0 / height).astype(int), h0 - 1)
    xs = np.minimum(((np.arange(width) + 0.5) * w0 / width).astype(int), w0 - 1)
    return distance[np.ix_(ys, xs)], valid[np.ix_(ys, xs)]


def fill_invalid(distance: np.ndarray, valid: np.ndarray) -> tuple[np.ndarray, Optional[float]]:
    """Put pixels the model rejected (sky, glass, specular) on a far dome so the
    photo still shows there. Returns (distance, dome radius or None)."""
    if valid.all() or not valid.any():
        return distance, None
    radius = float(np.clip(4.0 * np.percentile(distance[valid], 95), 20.0, 500.0))
    out = np.where(valid, distance, radius)
    return out, radius


@dataclass
class Shell:
    positions: np.ndarray  # (N, 3) float32
    uvs: np.ndarray        # (N, 2) float32, v measured from the top (image y)
    indices: np.ndarray    # (F, 3) uint32
    grid: tuple[int, int]
    culled_faces: int
    dome_radius: Optional[float]


def cull_mask(pa, pb, da, db, step_rad: np.ndarray, edge_ratio: float, depth_jump: float) -> np.ndarray:
    """True where the edge pa-pb is broken. ``step_rad`` is the angular spacing
    between the two rays, so ``min(da, db) * step`` is the edge length a surface
    facing the camera would have."""
    length = np.linalg.norm(pa - pb, axis=-1)
    expected = np.minimum(da, db) * step_rad
    ratio = length / np.maximum(expected, 1e-9)
    jump = np.abs(da - db) / np.maximum(np.minimum(da, db), 1e-9)
    return (ratio > edge_ratio) & (jump > depth_jump)


def build_shell(
    distance: np.ndarray,
    valid: np.ndarray,
    max_faces: int = 1_500_000,
    edge_ratio: float = EDGE_RATIO,
    depth_jump: float = DEPTH_JUMP,
    fill_sky: bool = True,
) -> Shell:
    width, height = grid_size_for_budget(max_faces)
    dist, ok = sample_grid(distance, valid, width, height)
    dome = None
    if fill_sky:
        dist, dome = fill_invalid(dist, ok)
        ok = np.ones_like(ok) if dome is not None else ok
    dist = np.where(ok, dist, 1.0)

    dirs = directions(width, height)
    pts = dirs * dist[..., None]

    # Longitude wrap: append column 0 again as column W (u = 1).
    pts_w = np.concatenate([pts, pts[:, :1]], axis=1)
    dist_w = np.concatenate([dist, dist[:, :1]], axis=1)
    ok_w = np.concatenate([ok, ok[:, :1]], axis=1)
    cols = width + 1
    # Column W is the seam duplicate: u = 1 + half a texel, the same texel as column 0
    # under REPEAT, so the texture is continuous across the wrap.
    u_col = (np.arange(cols, dtype=np.float64) + 0.5) / width
    v_row = (np.arange(height, dtype=np.float64) + 0.5) / height

    positions = pts_w.reshape(-1, 3)
    uvs = np.stack(np.meshgrid(u_col, v_row), axis=-1).reshape(-1, 2)
    idx = np.arange(height * cols).reshape(height, cols)
    a = idx[:-1, :-1].ravel()
    b = idx[:-1, 1:].ravel()
    c = idx[1:, :-1].ravel()
    d = idx[1:, 1:].ravel()
    # Wound counter-clockwise as seen from the origin (the shell's inside).
    tri_a = np.stack([a, c, b], axis=1)
    tri_b = np.stack([b, c, d], axis=1)

    pitch_step = np.pi / height
    yaw_step = 2.0 * np.pi / width

    flat_pts = positions
    flat_dist = dist_w.reshape(-1)
    flat_ok = ok_w.reshape(-1)
    lat = (0.5 - v_row) * np.pi
    cos_lat_row = np.repeat(np.cos(lat), cols)

    def edge_broken(i, j, step):
        return cull_mask(flat_pts[i], flat_pts[j], flat_dist[i], flat_dist[j], step, edge_ratio, depth_jump)

    step_h = yaw_step * cos_lat_row  # horizontal neighbour spacing shrinks with latitude
    broken = {}
    for name, (i, j, step) in {
        "ab": (a, b, step_h[a]),
        "ac": (a, c, np.full(a.shape, pitch_step)),
        "bc": (b, c, np.hypot(step_h[a], pitch_step)),
        "bd": (b, d, np.full(a.shape, pitch_step)),
        "cd": (c, d, step_h[c]),
    }.items():
        broken[name] = edge_broken(i, j, step)

    keep_a = flat_ok[a] & flat_ok[b] & flat_ok[c] & ~(broken["ab"] | broken["ac"] | broken["bc"])
    keep_b = flat_ok[b] & flat_ok[c] & flat_ok[d] & ~(broken["bc"] | broken["bd"] | broken["cd"])
    culled = int((~keep_a).sum() + (~keep_b).sum())
    tris = [tri_a[keep_a], tri_b[keep_b]]
    base = len(positions)
    extra_pos: list[np.ndarray] = []
    extra_uv: list[np.ndarray] = []

    # Pole fans. The apex is its own vertex per triangle so each gets a u that
    # does not smear the texture.
    for row, sign in ((0, 1.0), (height - 1, -1.0)):
        left = idx[row, :-1]
        right = idx[row, 1:]
        both = flat_ok[left] & flat_ok[right]
        step = np.full(left.shape, yaw_step * cos_lat_row[left[0]])
        edge = cull_mask(flat_pts[left], flat_pts[right], flat_dist[left], flat_dist[right], step, edge_ratio, depth_jump)
        use = both & ~edge
        culled += int((~use).sum())
        li, ri = left[use], right[use]
        r_apex = 0.5 * (flat_dist[li] + flat_dist[ri])
        apex = np.zeros((len(li), 3))
        apex[:, 1] = sign * r_apex
        apex_uv = np.stack(
            [0.5 * (uvs[li, 0] + uvs[ri, 0]), np.full(len(li), 0.0 if sign > 0 else 1.0)], axis=1
        )
        ids = base + sum(len(p) for p in extra_pos) + np.arange(len(li))
        extra_pos.append(apex)
        extra_uv.append(apex_uv)
        if sign > 0:
            tris.append(np.stack([ids, ri, li], axis=1))
        else:
            tris.append(np.stack([ids, li, ri], axis=1))

    if extra_pos:
        positions = np.concatenate([positions] + extra_pos)
        uvs = np.concatenate([uvs] + extra_uv)
    indices = np.concatenate(tris).astype(np.uint32)

    # Drop vertices no face references, so culled sky or noise does not bloat the file.
    used = np.zeros(len(positions), dtype=bool)
    used[indices.ravel()] = True
    remap = np.cumsum(used) - 1
    return Shell(
        positions=positions[used].astype(np.float32),
        uvs=uvs[used].astype(np.float32),
        indices=remap[indices].astype(np.uint32),
        grid=(width, height),
        culled_faces=culled,
        dome_radius=dome,
    )


def write_glb(path: str, shell: Shell, jpeg_bytes: bytes, extras: Optional[dict] = None) -> None:
    """Single textured mesh. KHR_materials_unlit so the photo is shown unshaded;
    the texture wraps in u (REPEAT) because the seam column carries u > 1."""
    pos = shell.positions.astype("<f4")
    uv = shell.uvs.astype("<f4")
    idx = shell.indices.astype("<u4")

    chunks: list[bytes] = []
    views: list[dict] = []

    def add(data: bytes, target: Optional[int] = None) -> int:
        while sum(len(c) for c in chunks) % 4:
            chunks.append(b"\x00")
        offset = sum(len(c) for c in chunks)
        chunks.append(data)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target:
            view["target"] = target
        views.append(view)
        return len(views) - 1

    v_idx = add(idx.tobytes(), 34963)
    v_pos = add(pos.tobytes(), 34962)
    v_uv = add(uv.tobytes(), 34962)
    v_img = add(jpeg_bytes)
    while sum(len(c) for c in chunks) % 4:
        chunks.append(b"\x00")
    binary = b"".join(chunks)

    gltf = {
        "asset": {"version": "2.0", "generator": "three.ws model-panodepth"},
        "extensionsUsed": ["KHR_materials_unlit"],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "pano_depth_shell"}],
        "meshes": [{
            "name": "pano_depth_shell",
            "primitives": [{"attributes": {"POSITION": 1, "TEXCOORD_0": 2}, "indices": 0, "material": 0, "mode": 4}],
        }],
        "materials": [{
            "name": "photo",
            "doubleSided": True,
            "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0.0, "roughnessFactor": 1.0},
            "extensions": {"KHR_materials_unlit": {}},
        }],
        "textures": [{"sampler": 0, "source": 0}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 33071}],
        "images": [{"bufferView": v_img, "mimeType": "image/jpeg"}],
        "accessors": [
            {"bufferView": v_idx, "componentType": 5125, "count": int(idx.size), "type": "SCALAR",
             "min": [int(idx.min())], "max": [int(idx.max())]},
            {"bufferView": v_pos, "componentType": 5126, "count": int(len(pos)), "type": "VEC3",
             "min": pos.min(axis=0).tolist(), "max": pos.max(axis=0).tolist()},
            {"bufferView": v_uv, "componentType": 5126, "count": int(len(uv)), "type": "VEC2"},
        ],
        "bufferViews": views,
        "buffers": [{"byteLength": len(binary)}],
    }
    if extras:
        gltf["asset"]["extras"] = extras
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack("<II", len(binary), 0x004E4942))
        f.write(binary)


def write_point_ply(path: str, distance: np.ndarray, valid: np.ndarray, rgb: np.ndarray, max_points: int) -> int:
    """Binary little-endian PLY, glTF frame, coloured, equal-area thinned.

    An equirectangular grid packs pixels toward the poles (each row has the same pixel
    count but a circumference proportional to cos(latitude)). Row r keeps a share of
    its pixels proportional to cos(latitude), so the point density per steradian is
    uniform, then a deterministic stride brings the total to max_points.
    """
    h, w = distance.shape
    dirs = directions(w, h)
    lat = (0.5 - (np.arange(h) + 0.5) / h) * np.pi
    row_keep = np.clip(np.cos(lat), 0.0, 1.0)
    cols = np.arange(w)
    thin = np.zeros((h, w), dtype=bool)
    for r in range(h):
        k = max(row_keep[r], 1e-3)
        phase = 0.5 * (r % 2)
        thin[r] = np.floor((cols + 1 + phase) * k) > np.floor((cols + phase) * k)
    sel = valid & thin
    pts = (dirs * distance[..., None])[sel].astype(np.float32)
    col = rgb[sel]
    n = len(pts)
    if n > max_points:
        keep = np.linspace(0, n - 1, max_points).astype(np.int64)
        pts, col = pts[keep], col[keep]
        n = max_points
    rec = np.empty(n, dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("r", "u1"), ("g", "u1"), ("b", "u1")])
    rec["x"], rec["y"], rec["z"] = pts[:, 0], pts[:, 1], pts[:, 2]
    rec["r"], rec["g"], rec["b"] = col[:, 0], col[:, 1], col[:, 2]
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        f"element vertex {n}\nproperty float x\nproperty float y\nproperty float z\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
    )
    with open(path, "wb") as f:
        f.write(header.encode("ascii"))
        f.write(rec.tobytes())
    return n
