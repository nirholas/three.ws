"""
Dense per-subject face geometry by analysis-by-synthesis (Track 3 of the fidelity
program).

The shipped morph (face_geometry.py) is driven by 468 sparse MediaPipe landmarks
diffused over the head, which closes about 60 percent of the template-to-person
identity gap but cannot place fine structure (nasal ridge, cheek hollows, brow
shelf). This module refines the morphed head by optimising a per-vertex
displacement field so that a differentiable shaded render of the head agrees with
the user's REAL photo. Only the user's photo is used: synthesised extra views were
measured and rejected for geometry (a synthesised 3/4 view reads as a different
person), so nothing here consumes view_synthesis output.

Losses (all differentiable, all in torch):
  photometric  luminance of the photo sampled at each visible face vertex versus a
               Lambertian shading of that vertex (ambient + directional light,
               constant skin albedo, light solved in closed form). Moving a vertex
               changes both where it samples the photo and its normal, which is
               the shape-from-shading signal. Eyes, lips and brows are excluded
               (they violate constant albedo).
  landmark     reprojection of the landmark-bound vertices onto MediaPipe's 2D
               landmarks, so the fit cannot drift off the face it is fitting.
  smoothness   uniform Laplacian of the displacement field.
  symmetry     soft mirror prior across the sagittal plane.
  silhouette   (only when PyTorch3D is importable, i.e. the RTX image) a soft
               rasterised silhouette that must stay inside the photo foreground.

Hard guarantees, each pinned by test_dense_fit.py:
  * vertex count and order never change (so skinning and the 52 ARKit morph
    targets stay valid under glb_ops.set_head_geometry);
  * every vertex moves at most DENSE_FIT_MAX_DISP_FRAC of the head height from its
    input position, along its own normal (displacement = bound * tanh(raw) * n,
    so the bound is structural, not a clip applied afterwards);
  * the result is deterministic for a given seed;
  * any failure, timeout, non-finite value or non-improving fit returns None so
    the caller keeps the morph output. A dense step never fails a job.

Licensing: torch is BSD, PyTorch3D is BSD-3. nvdiffrast (non-commercial) and
FLAME/MICA/BFM (licensed) are deliberately not used.
"""

from __future__ import annotations

import functools
import logging
import os
import time
from dataclasses import dataclass
from typing import Optional

import numpy as np

log = logging.getLogger("dense_fit")

# MediaPipe landmark groups that break the constant-albedo assumption.
_EXCLUDE_LANDMARKS = (
    # lips
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 185, 40, 39, 37, 0, 267, 269, 270, 409,
    # eyes
    33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
    362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398,
    # brows
    70, 63, 105, 66, 107, 55, 65, 52, 53, 46, 300, 293, 334, 296, 336, 285, 295, 282, 283, 276,
)


# Relative weights of the loss terms. Photometric residuals are small once
# normalised (about 1e-3 squared), so its weight is large by construction.
LOSS_WEIGHTS = {"photo": 400.0, "landmark": 40.0, "smooth": 0.05, "symmetry": 0.05,
                "reg": 0.01, "silhouette": 0.5}


DIFFUSION_ROUNDS = 4
MAX_PIXELS = 30000


def enabled() -> bool:
    """Opt-in flag. Ships off until the 40-face eval proves it (see docs)."""
    return os.environ.get("DENSE_FIT", "0") == "1"


def max_seconds() -> float:
    try:
        return max(float(os.environ.get("DENSE_FIT_MAX_SECONDS", "20")), 0.1)
    except ValueError:
        return 20.0


def max_disp_frac() -> float:
    try:
        return min(max(float(os.environ.get("DENSE_FIT_MAX_DISP_FRAC", "0.03")), 0.001), 0.2)
    except ValueError:
        return 0.03


def torch_available() -> bool:
    try:
        import torch  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return True


def pytorch3d_available() -> bool:
    try:
        import pytorch3d  # noqa: F401
        from pytorch3d.renderer.mesh.rasterize_meshes import rasterize_meshes  # noqa: F401
        from pytorch3d.structures import Meshes  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return True


@functools.lru_cache(maxsize=1)
def silhouette_available() -> bool:
    """True when the silhouette term will run: PyTorch3D importable and a CUDA device."""
    if not (torch_available() and pytorch3d_available()):
        return False
    import torch

    return bool(torch.cuda.is_available())


def eligible(*, yaw_deg: float, max_yaw_deg: float, landmarks_ok: bool, camera_ok: bool) -> bool:
    """
    Dense fit runs only on inputs the morph itself accepted: a frontal enough
    head, a successful landmark fit and a solved camera. Never for unusable
    inputs (those already skip the morph and the dense step must not rescue them).
    """
    return bool(landmarks_ok and camera_ok and np.isfinite(yaw_deg) and yaw_deg <= max_yaw_deg)


@dataclass
class FitResult:
    positions: np.ndarray        # (V, 3) refined, same order as the input
    loss_before: float
    loss_after: float
    iterations: int
    seconds: float
    used_silhouette: bool
    max_displacement: float      # in the input's own units


def _face_oval_mask(landmarks_px: np.ndarray, width: int, height: int) -> np.ndarray:
    """Filled convex hull of the landmarks, as a float mask the size of the photo."""
    import cv2

    mask = np.zeros((height, width), dtype=np.uint8)
    hull = cv2.convexHull(np.round(landmarks_px[:, :2]).astype(np.int32))
    cv2.fillConvexPoly(mask, hull, 255)
    return mask.astype(np.float32) / 255.0


def build_face_mask(landmarks_px: np.ndarray, width: int, height: int) -> np.ndarray:
    """Public alias used by the pipeline."""
    return _face_oval_mask(landmarks_px, width, height)


def _edges(faces: np.ndarray) -> np.ndarray:
    e = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]], axis=0)
    e = np.sort(e, axis=1)
    return np.unique(e, axis=0)


def _mirror_index(positions: np.ndarray) -> Optional[np.ndarray]:
    """
    For each vertex, the vertex across the sagittal plane (x mirrored about the
    median x). None when the head is not symmetric enough for a mirror prior to
    mean anything.
    """
    try:
        from scipy.spatial import cKDTree
    except Exception:  # noqa: BLE001
        return None
    cx = float(np.median(positions[:, 0]))
    mirrored = positions.copy()
    mirrored[:, 0] = 2.0 * cx - mirrored[:, 0]
    dist, idx = cKDTree(positions).query(mirrored)
    height = float(np.ptp(positions[:, 1])) or 1.0
    if float(np.median(dist)) > 0.02 * height:
        return None
    return idx.astype(np.int64)


def fit_dense_head(
    positions: np.ndarray,
    faces: np.ndarray,
    camera,
    photo_rgb: np.ndarray,
    face_mask: np.ndarray,
    landmarks_px: Optional[np.ndarray] = None,
    landmark_vertices: Optional[np.ndarray] = None,
    foreground: Optional[np.ndarray] = None,
    *,
    seed: int = 0,
    time_budget: Optional[float] = None,
    iterations: int = 120,
    device: Optional[str] = None,
) -> Optional[FitResult]:
    """
    Refine `positions` against the photo. Returns None on any failure so the
    caller keeps the morph output (never raises).

    Args:
        positions:         (V,3) morphed head vertices.
        faces:             (F,3) triangle indices.
        camera:            face_projection.WeakPerspectiveCamera for this photo.
        photo_rgb:         (H,W,3) uint8 photo.
        face_mask:         (H,W) float, 1 inside the face oval.
        landmarks_px:      (468,2) MediaPipe landmarks in photo pixels.
        landmark_vertices: (468,) head vertex bound to each landmark.
        foreground:        (H,W) float photo foreground, for the silhouette term.
    """
    started = time.time()
    budget = max_seconds() if time_budget is None else float(time_budget)
    try:
        return _fit(
            np.asarray(positions, dtype=np.float64), np.asarray(faces, dtype=np.int64), camera,
            photo_rgb, face_mask, landmarks_px, landmark_vertices, foreground,
            seed, budget, iterations, device, started,
        )
    except _DenseFitAbort as why:
        log.warning("dense fit skipped: %s", why)
    except Exception as exc:  # noqa: BLE001 - a refinement must never fail the job
        log.warning("dense fit failed (%s: %s); keeping morph output", type(exc).__name__, exc)
    return None


def _face_id_map(px: np.ndarray, depth: np.ndarray, faces: np.ndarray, h: int, w: int) -> np.ndarray:
    """
    Z-buffered face id per pixel (-1 = empty) for the projected head. Visibility
    is computed once: the displacement is bounded to a few percent of the head,
    so which triangle covers a pixel does not change during the fit; what does
    change (barycentric weights, interpolated normals) is recomputed
    differentiably from the live vertices.
    """
    ids = np.full((h, w), -1, dtype=np.int64)
    zbuf = np.full((h, w), np.inf)
    for fi, tri in enumerate(faces):
        a, b, c = px[tri]
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-9:
            continue
        x0 = int(max(np.floor(min(a[0], b[0], c[0])), 0))
        x1 = int(min(np.ceil(max(a[0], b[0], c[0])) + 1, w))
        y0 = int(max(np.floor(min(a[1], b[1], c[1])), 0))
        y1 = int(min(np.ceil(max(a[1], b[1], c[1])) + 1, h))
        if x1 <= x0 or y1 <= y0:
            continue
        ys, xs = np.mgrid[y0:y1, x0:x1]
        w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
        w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
        w2 = 1.0 - w0 - w1
        inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        z = w0 * depth[tri[0]] + w1 * depth[tri[1]] + w2 * depth[tri[2]]
        nearer = inside & (z < zbuf[y0:y1, x0:x1])
        ids[y0:y1, x0:x1][nearer] = fi
        zbuf[y0:y1, x0:x1][nearer] = z[nearer]
    return ids


class _DenseFitAbort(Exception):
    pass


def _fit(positions, faces, camera, photo_rgb, face_mask, landmarks_px, landmark_vertices,
         foreground, seed, budget, iterations, device, started):
    if not torch_available():
        raise _DenseFitAbort("torch is not installed in this image")
    import torch
    import torch.nn.functional as F

    n = positions.shape[0]
    if n < 100 or faces.ndim != 2 or faces.shape[1] != 3 or faces.max() >= n:
        raise _DenseFitAbort("unusable mesh")
    h, w = photo_rgb.shape[:2]
    if face_mask.shape != (h, w):
        raise _DenseFitAbort("face mask does not match the photo")

    dev = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    dtype = torch.float32
    gen = torch.Generator(device="cpu").manual_seed(int(seed))

    height = float(np.ptp(positions[:, 1]))
    if not np.isfinite(height) or height <= 0:
        raise _DenseFitAbort("degenerate head extent")
    bound = max_disp_frac() * height

    base = torch.as_tensor(positions, dtype=dtype, device=dev)
    tri = torch.as_tensor(faces, dtype=torch.long, device=dev)
    rot = torch.as_tensor(camera.R, dtype=dtype, device=dev)
    trans = torch.as_tensor(camera.t, dtype=dtype, device=dev)
    scale = float(camera.s)
    view_dir = torch.as_tensor(camera.view_direction(), dtype=dtype, device=dev)

    def project(v):
        mapped = scale * (v @ rot.T) + trans
        return torch.stack([mapped[:, 0], -mapped[:, 1]], dim=1), -mapped[:, 2]

    def vertex_normals(v):
        a, b, c = v[tri[:, 0]], v[tri[:, 1]], v[tri[:, 2]]
        fn = torch.cross(b - a, c - a, dim=1)
        acc = torch.zeros_like(v)
        for k in range(3):
            acc.index_add_(0, tri[:, k], fn)
        return F.normalize(acc, dim=1, eps=1e-12)

    # Luminance of the photo, mildly blurred so the first iterations see the low
    # frequencies (coarse-to-fine without a second pass).
    photo = torch.as_tensor(photo_rgb.astype(np.float32) / 255.0, dtype=dtype, device=dev)
    lum = (0.299 * photo[..., 0] + 0.587 * photo[..., 1] + 0.114 * photo[..., 2])[None, None]
    k = torch.tensor([1.0, 4.0, 6.0, 4.0, 1.0], dtype=dtype, device=dev)
    k2 = (k[:, None] * k[None, :]) / 256.0
    lum_blur = F.conv2d(F.pad(lum, (2, 2, 2, 2), mode="replicate"), k2[None, None])

    def sample(img, px):
        grid = torch.stack(
            [px[:, 0] / max(w - 1, 1) * 2.0 - 1.0, px[:, 1] / max(h - 1, 1) * 2.0 - 1.0], dim=1
        )[None, None]
        return F.grid_sample(img, grid, mode="bilinear", padding_mode="border",
                             align_corners=True)[0, 0, 0]

    mask_t = torch.as_tensor(face_mask.astype(np.float32), dtype=dtype, device=dev)[None, None]

    px0, depth0 = project(base)
    n0 = vertex_normals(base)
    facing = (n0 @ view_dir) > 0.35
    inside = sample(mask_t, px0.detach()) > 0.5
    valid = facing & inside
    if int(valid.sum()) < 60:
        raise _DenseFitAbort(f"only {int(valid.sum())} usable face vertices")

    # Pixel-level photometric samples. Shading is evaluated per pixel from the
    # barycentric blend of vertex normals, which gives each vertex dozens of
    # constraints instead of one (a per-vertex term was measured to memorise the
    # photo: its loss fell below the loss at the true surface while the relief
    # stayed wrong).
    ids_map = _face_id_map(px0.detach().cpu().numpy(), depth0.detach().cpu().numpy(), faces, h, w)
    rows, cols = np.nonzero(ids_map >= 0)
    pix_face = ids_map[rows, cols]
    keep = (face_mask[rows, cols] > 0.5)
    face_ok = (facing[tri[:, 0]] & facing[tri[:, 1]] & facing[tri[:, 2]]).cpu().numpy()
    keep &= face_ok[pix_face]
    if landmarks_px is not None:
        lp = np.asarray(landmarks_px, dtype=np.float64)
        excl = np.asarray([i for i in _EXCLUDE_LANDMARKS if i < len(lp)], dtype=np.int64)
        if len(excl):
            span = float(np.ptp(lp[:, 0])) or 1.0
            pts = lp[excl, :2]
            near = np.zeros(len(rows), dtype=bool)
            for lo in range(0, len(rows), 4096):
                dxy = np.stack([cols[lo:lo + 4096], rows[lo:lo + 4096]], axis=1)[:, None, :] - pts[None]
                near[lo:lo + 4096] = (np.linalg.norm(dxy, axis=2).min(axis=1) < 0.06 * span)
            keep &= ~near
    rows, cols, pix_face = rows[keep], cols[keep], pix_face[keep]
    if len(rows) > MAX_PIXELS:
        sel = np.sort(np.random.default_rng(int(seed)).choice(len(rows), MAX_PIXELS, replace=False))
        rows, cols, pix_face = rows[sel], cols[sel], pix_face[sel]
    if len(rows) < 200:
        raise _DenseFitAbort(f"only {len(rows)} usable face pixels")
    pix_xy = torch.as_tensor(np.stack([cols, rows], axis=1).astype(np.float32), device=dev)
    pix_tri = tri[torch.as_tensor(pix_face, dtype=torch.long, device=dev)]
    obs_raw = lum_blur[0, 0, torch.as_tensor(rows, device=dev), torch.as_tensor(cols, device=dev)]
    obs = obs_raw / obs_raw.mean().clamp_min(1e-4)

    def pixel_normals(px, nrm):
        a, b, c = px[pix_tri[:, 0]], px[pix_tri[:, 1]], px[pix_tri[:, 2]]
        den = (b[:, 1] - c[:, 1]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (a[:, 1] - c[:, 1])
        den = torch.where(den.abs() < 1e-9, torch.full_like(den, 1e-9), den)
        w0 = ((b[:, 1] - c[:, 1]) * (pix_xy[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (pix_xy[:, 1] - c[:, 1])) / den
        w1 = ((c[:, 1] - a[:, 1]) * (pix_xy[:, 0] - c[:, 0]) + (a[:, 0] - c[:, 0]) * (pix_xy[:, 1] - c[:, 1])) / den
        w2 = 1.0 - w0 - w1
        blended = (w0[:, None] * nrm[pix_tri[:, 0]] + w1[:, None] * nrm[pix_tri[:, 1]]
                   + w2[:, None] * nrm[pix_tri[:, 2]])
        return F.normalize(blended, dim=1, eps=1e-12)

    # Landmark term: de-duplicated (several landmarks share one vertex).
    lm_vi = lm_tgt = None
    if landmarks_px is not None and landmark_vertices is not None:
        lm_v = np.asarray(landmark_vertices, dtype=np.int64)
        m = min(len(lm_v), len(landmarks_px))
        uniq, first = np.unique(lm_v[:m], return_index=True)
        lm_vi = torch.as_tensor(uniq, dtype=torch.long, device=dev)
        lm_tgt = torch.as_tensor(np.asarray(landmarks_px)[:m][first, :2], dtype=dtype, device=dev)
        face_w = float(np.ptp(np.asarray(landmarks_px)[:m, 0])) or 1.0
    else:
        face_w = 1.0

    # Where the field may act: a soft region around the face; the back of the
    # head, neck and ears stay where the morph put them.
    if landmark_vertices is not None:
        anchor = positions[np.unique(np.asarray(landmark_vertices, dtype=np.int64))]
        dist = np.linalg.norm(positions[:, None, :] - anchor[None, :, :], axis=2).min(axis=1)
        region = np.clip(1.0 - dist / (0.12 * height), 0.0, 1.0)
    else:
        region = valid.cpu().numpy().astype(np.float64)
    region_t = torch.as_tensor(region, dtype=dtype, device=dev)[:, None]

    edges = torch.as_tensor(_edges(faces), dtype=torch.long, device=dev)
    deg = torch.zeros(n, dtype=dtype, device=dev)
    deg.index_add_(0, edges[:, 0], torch.ones(len(edges), dtype=dtype, device=dev))
    deg.index_add_(0, edges[:, 1], torch.ones(len(edges), dtype=dtype, device=dev))
    deg = deg.clamp_min(1.0)[:, None]

    def laplacian(x):
        acc = torch.zeros_like(x)
        acc.index_add_(0, edges[:, 0], x[edges[:, 1]])
        acc.index_add_(0, edges[:, 1], x[edges[:, 0]])
        return x - acc / deg

    mirror = _mirror_index(positions)
    mirror_t = torch.as_tensor(mirror, dtype=torch.long, device=dev) if mirror is not None else None

    sil_term = None
    if foreground is not None and pytorch3d_available() and dev.type == "cuda":
        sil_term = _SilhouetteTerm(torch, tri, foreground, h, w, dev, dtype)

    # One scalar per vertex, applied along the vertex's initial outward normal.
    # Lateral placement is already pinned by the landmark morph; shading only
    # constrains relief, so letting vertices also slide sideways would trade
    # relief for tangential drift and make the problem ill-posed.
    raw = 1e-4 * torch.randn((n, 1), generator=gen).to(dev)  # deterministic tie-break
    raw.requires_grad_(True)
    opt = torch.optim.Adam([raw], lr=0.08)

    def diffuse(x):
        # Band-limit the relief: a few rounds of neighbour averaging mean the
        # field cannot carry vertex-scale noise. With one observation per vertex
        # an unconstrained field simply memorises the photo (measured on the
        # synthetic head: the photometric loss collapsed below its value at the
        # TRUE surface while the relief stayed wrong).
        for _ in range(DIFFUSION_ROUNDS):
            acc = x.clone()
            acc.index_add_(0, edges[:, 0], x[edges[:, 1]])
            acc.index_add_(0, edges[:, 1], x[edges[:, 0]])
            x = acc / (deg + 1.0)
        return x

    def displaced():
        return base + bound * torch.tanh(diffuse(raw)) * region_t * n0

    def light_fit(shade_n, target):
        # Least squares for [ambient, lx, ly, lz] in lum = a + n . l
        a = torch.cat([torch.ones_like(shade_n[:, :1]), shade_n], dim=1)
        sol = torch.linalg.lstsq(a, target[:, None]).solution
        # Bas-relief ambiguity: a Lambertian photo with an unknown light is
        # explained equally by a relief and its inversion lit from behind.
        # A portrait is front lit, so keep the light within ~60 degrees of the
        # viewing direction; that picks the convex reading.
        lvec = sol[1:, 0]
        along = (lvec * view_dir).sum()
        perp = lvec - along * view_dir
        floor = 0.6 * perp.norm()
        if float(along) < float(floor):
            lvec = perp + floor * view_dir
            sol = torch.cat([sol[:1], lvec[:, None]], dim=0)
        return sol

    def losses(v, light=None):
        px, _ = project(v)
        nrm = vertex_normals(v)
        pn = pixel_normals(px, nrm)
        a = torch.cat([torch.ones_like(pn[:, :1]), pn], dim=1)
        if light is None:
            light = light_fit(pn.detach(), obs)
        pred = (a @ light)[:, 0]
        pred = pred / pred.mean().detach().clamp_min(1e-4)
        photo_l = F.huber_loss(pred, obs, delta=0.25)
        out = {"photo": photo_l}
        if lm_vi is not None:
            err = (px[lm_vi] - lm_tgt) / face_w
            out["landmark"] = (err ** 2).sum(dim=1).mean()
        d = (v - base)
        out["smooth"] = (laplacian(d) ** 2).sum(dim=1).mean() / (bound ** 2 + 1e-12)
        if mirror_t is not None:
            mirrored = d[mirror_t] * torch.tensor([-1.0, 1.0, 1.0], dtype=dtype, device=dev)
            out["symmetry"] = ((d - mirrored) ** 2).sum(dim=1).mean() / (bound ** 2 + 1e-12)
        out["reg"] = (d ** 2).sum(dim=1).mean() / (bound ** 2 + 1e-12)
        if sil_term is not None:
            out["silhouette"] = sil_term(project(v)[0])
        return out

    weights = LOSS_WEIGHTS

    def total(parts):
        return sum(weights[k] * v for k, v in parts.items())

    with torch.no_grad():
        before_parts = losses(displaced())
        before = float(total(before_parts))
    if not np.isfinite(before):
        raise _DenseFitAbort("non-finite initial loss")
    log.debug("dense fit initial losses: %s", {k: round(float(v), 6) for k, v in before_parts.items()})

    done = 0
    light = None
    for it in range(int(iterations)):
        if time.time() - started > budget:
            raise _DenseFitAbort(f"time budget {budget:.0f}s exceeded after {it} iterations")
        opt.zero_grad(set_to_none=True)
        if it % 10 == 0:
            with torch.no_grad():
                vv = displaced()
                px_, _ = project(vv)
                light = light_fit(pixel_normals(px_, vertex_normals(vv)), obs)
        loss = total(losses(displaced(), light))
        if not torch.isfinite(loss):
            raise _DenseFitAbort("non-finite loss during the fit")
        loss.backward()
        opt.step()
        done = it + 1

    with torch.no_grad():
        final = displaced()
        after_parts = losses(final)
        after = float(total(after_parts))
    log.debug("dense fit final losses: %s", {k: round(float(v), 6) for k, v in after_parts.items()})
    if not np.isfinite(after) or not np.all(np.isfinite(final.cpu().numpy())):
        raise _DenseFitAbort("non-finite result")
    if after >= before * 0.99:
        raise _DenseFitAbort(f"fit did not improve the loss ({before:.4f} -> {after:.4f})")

    out = final.detach().cpu().numpy().astype(np.float64)
    disp = float(np.linalg.norm(out - positions, axis=1).max())
    return FitResult(
        positions=out, loss_before=before, loss_after=after, iterations=done,
        seconds=time.time() - started, used_silhouette=sil_term is not None,
        max_displacement=disp,
    )


class _SilhouetteTerm:
    """
    PyTorch3D soft silhouette, one-sided: the rendered head must stay inside the
    photo foreground. One-sided because the foreground also contains hair and
    shoulders the face mesh does not cover, so a two-sided match would be wrong.
    Only built on the RTX image (CUDA + PyTorch3D); the portable path skips it.
    """

    def __init__(self, torch, tri, foreground, h, w, dev, dtype):
        from pytorch3d.renderer.mesh.rasterize_meshes import rasterize_meshes
        from pytorch3d.structures import Meshes

        self._torch = torch
        self._rasterize = rasterize_meshes
        self._Meshes = Meshes
        self._tri = tri
        self._h, self._w = h, w
        self._side = max(h, w)
        self._dev = dev
        self._dtype = dtype
        fg = np.zeros((self._side, self._side), dtype=np.float32)
        fg[:h, :w] = np.asarray(foreground, dtype=np.float32)
        self._outside = torch.as_tensor(1.0 - fg, dtype=dtype, device=dev)
        self._sigma = 1e-4

    def __call__(self, px):
        torch = self._torch
        s = float(self._side)
        # PyTorch3D screen NDC: +X to the left, +Y up, range [-1, 1] on the long side.
        ndc = torch.stack(
            [-(2.0 * px[:, 0] / s - 1.0), -(2.0 * px[:, 1] / s - 1.0), torch.zeros_like(px[:, 0])],
            dim=1,
        )
        meshes = self._Meshes(verts=[ndc], faces=[self._tri])
        pix_to_face, _, _, dists = self._rasterize(
            meshes, image_size=self._side, blur_radius=2e-3, faces_per_pixel=8,
            perspective_correct=False, cull_backfaces=False,
        )
        prob = torch.sigmoid(-dists / self._sigma) * (pix_to_face >= 0).to(self._dtype)
        sil = 1.0 - torch.prod(1.0 - prob, dim=-1)[0]
        return (sil * self._outside).mean() * 100.0
