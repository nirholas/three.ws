"""Mesh output parity: chamfer distance and fixed-view render PSNR / SSIM.

Used by bench_trt.py and trt_build.py to compare an accelerated output against
the PyTorch output for the same input and seed. Thresholds live in
trt_policy.py. Pure numpy / scipy / scikit-image (all already in the worker
image), so it runs on CPU, on any machine.

Renders are orthographic point splats: each mesh is sampled densely
(area-weighted, fixed seed), every sample is projected to a 512 px grid for six
axis-aligned views, and each pixel keeps the nearest sample. The pixel value
mixes normalized depth and |normal . view|, so both silhouette and surface
orientation count. Dense sampling (4M points) leaves well under 0.1% of covered
pixels empty, and `noise_floor` measures what two independent samplings of the
SAME mesh score, so the thresholds can be read against the method's own noise.
"""

from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree
from skimage.metrics import peak_signal_noise_ratio, structural_similarity

EXTENT = 1.01
RENDER_PX = 512
RENDER_SAMPLES = 4_000_000
CHAMFER_SAMPLES = 200_000

# (axis index, sign): the camera looks along -sign*axis from the +sign side.
VIEWS = ((0, 1), (0, -1), (1, 1), (1, -1), (2, 1), (2, -1))


def sample_surface(vertices: np.ndarray, faces: np.ndarray, count: int, seed: int):
    """Area-weighted uniform samples on the triangle soup, with face normals."""
    v = np.asarray(vertices, dtype=np.float64)
    f = np.asarray(faces, dtype=np.int64)
    tri = v[f]
    cross = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    area = 0.5 * np.linalg.norm(cross, axis=1)
    total = area.sum()
    if not np.isfinite(total) or total <= 0:
        raise ValueError("mesh has no surface area")
    rng = np.random.default_rng(seed)
    pick = rng.choice(len(f), size=count, p=area / total)
    r1 = np.sqrt(rng.random(count))
    r2 = rng.random(count)
    a, b, c = tri[pick, 0], tri[pick, 1], tri[pick, 2]
    points = (1 - r1)[:, None] * a + (r1 * (1 - r2))[:, None] * b + (r1 * r2)[:, None] * c
    normals = cross[pick]
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
    return points.astype(np.float32), normals.astype(np.float32)


def chamfer(mesh_a, mesh_b, samples: int = CHAMFER_SAMPLES, seed: int = 0) -> float:
    """Mean of the two directed mean nearest-neighbour distances (not squared)."""
    pa, _ = sample_surface(*mesh_a, samples, seed)
    pb, _ = sample_surface(*mesh_b, samples, seed + 1)
    da, _ = cKDTree(pb).query(pa, workers=-1)
    db, _ = cKDTree(pa).query(pb, workers=-1)
    return float(0.5 * (da.mean() + db.mean()))


def render_views(mesh, px: int = RENDER_PX, samples: int = RENDER_SAMPLES, seed: int = 0):
    """Six orthographic splat renders, float32 in [0, 1], background 0."""
    points, normals = sample_surface(*mesh, samples, seed)
    images = []
    for axis, sign in VIEWS:
        u_axis, v_axis = [i for i in range(3) if i != axis]
        u = ((points[:, u_axis] + EXTENT) / (2 * EXTENT) * px).astype(np.int64)
        v = ((points[:, v_axis] + EXTENT) / (2 * EXTENT) * px).astype(np.int64)
        inside = (u >= 0) & (u < px) & (v >= 0) & (v < px)
        # distance from the camera plane: smaller is nearer
        depth = (EXTENT - sign * points[:, axis])[inside]
        flat = (v[inside] * px + u[inside])
        shade = np.abs(normals[inside, axis])
        order = np.lexsort((depth, flat))  # by pixel, then nearest first
        flat_sorted = flat[order]
        first = np.ones(len(order), dtype=bool)
        first[1:] = flat_sorted[1:] != flat_sorted[:-1]
        winners = order[first]
        img = np.zeros(px * px, dtype=np.float32)
        near = 1.0 - depth[winners] / (2 * EXTENT)
        img[flat[winners]] = 0.5 * near + 0.5 * shade[winners]
        images.append(img.reshape(px, px))
    return images


def render_scores(images_a, images_b) -> tuple[float, float]:
    psnrs, ssims = [], []
    for a, b in zip(images_a, images_b):
        if np.array_equal(a, b):
            psnrs.append(99.0)
        else:
            psnrs.append(float(peak_signal_noise_ratio(a, b, data_range=1.0)))
        ssims.append(float(structural_similarity(a, b, data_range=1.0)))
    return float(np.mean(psnrs)), float(np.mean(ssims))


def compare(mesh_a, mesh_b) -> dict:
    """Full parity row for one input. Both renders use the same sampling seed,
    so two identical meshes score PSNR 99 / SSIM 1 / chamfer at the sampling
    floor."""
    psnr, ssim = render_scores(render_views(mesh_a, seed=7), render_views(mesh_b, seed=7))
    return {
        "chamfer": chamfer(mesh_a, mesh_b),
        "psnr": psnr,
        "ssim": ssim,
        "verts_a": int(len(mesh_a[0])),
        "verts_b": int(len(mesh_b[0])),
        "faces_a": int(len(mesh_a[1])),
        "faces_b": int(len(mesh_b[1])),
    }


def noise_floor(mesh) -> dict:
    """What the method scores for one mesh against itself with independent
    samplings: the floor every threshold must sit above."""
    psnr, ssim = render_scores(render_views(mesh, seed=7), render_views(mesh, seed=8))
    return {"chamfer": chamfer(mesh, mesh, seed=10), "psnr": psnr, "ssim": ssim}
