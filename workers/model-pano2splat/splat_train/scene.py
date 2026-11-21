"""Scene geometry helpers (numpy only): holdout split, gravity alignment, scale
normalisation, and the flythrough camera path.

Convention everywhere: camera-to-world matrices in the COLMAP/OpenCV camera frame
(x right, y down, z forward). The world frame after alignment is the standard 3DGS
one: +Y points DOWN, so "up" in the scene is -Y. The /splat viewer and the Inria
viewers expect exactly this, so the files open right side up without a flip.
"""
import math

import numpy as np
from scipy.interpolate import splev, splprep


def holdout_indices(n, every):
    """Deterministic holdout: exactly one image in every block of `every` consecutive
    images (sorted by name), at a position that rotates across blocks. A plain
    `i % every == 0` would hold out the same view of every rig frame (and so never
    train that direction at all) whenever `every` equals the views per frame."""
    if every is None or every <= 1 or n < every:
        return []
    stride = max(1, round(0.618 * every))
    while math.gcd(stride, every) != 1:
        stride += 1
    out = []
    for block in range(n // every + (1 if n % every else 0)):
        idx = block * every + (block * stride) % every
        if idx < n:
            out.append(idx)
    return out


def _rotation_between(a, b):
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if c < -1 + 1e-9:
        axis = np.cross(a, [1.0, 0, 0])
        if np.linalg.norm(axis) < 1e-6:
            axis = np.cross(a, [0, 1.0, 0])
        axis /= np.linalg.norm(axis)
        return 2 * np.outer(axis, axis) - np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx / (1 + c)


def estimate_up(c2ws):
    """Scene up in world coordinates: opposite of the mean camera 'down' axis."""
    down = c2ws[:, :3, 1].mean(axis=0)
    n = np.linalg.norm(down)
    if n < 1e-6:
        return np.array([0.0, -1.0, 0.0])
    return -down / n


def normalise_scene(c2ws, points, align_up=True):
    """Gravity-align, centre on the camera centroid and scale so the farthest camera is
    1.0 from the centre. Returns (c2ws, points, transform dict). Doing this to the
    poses before training means the learned spherical harmonics already live in the
    final frame, so nothing needs rotating at export."""
    centres = c2ws[:, :3, 3]
    A = np.eye(3)
    if align_up:
        A = _rotation_between(estimate_up(c2ws), np.array([0.0, -1.0, 0.0]))
    c0 = centres.mean(axis=0)
    spread = float(np.linalg.norm(centres - c0, axis=1).max())
    if spread < 1e-9 and len(points):
        spread = float(np.percentile(np.linalg.norm(points - c0, axis=1), 95))
    if spread < 1e-9:
        return None, None, None
    s = 1.0 / spread
    out = np.empty_like(c2ws)
    out[:, :3, :3] = np.einsum('ij,njk->nik', A, c2ws[:, :3, :3])
    out[:, :3, 3] = s * (centres - c0) @ A.T
    out[:, 3, :] = [0, 0, 0, 1]
    pts = (points @ A.T - A @ c0) * s if len(points) else points
    return out, pts, {'rotation': A.tolist(), 'centre': c0.tolist(), 'scale': s, 'aligned_up': bool(align_up)}


def scene_radius(points, centres, factor):
    """Robust scene radius: factor times the 99th percentile distance of sparse points
    and camera centres from the scene median. Gaussians beyond it are sky or floaters."""
    allp = np.concatenate([points, centres]) if len(points) else centres
    c = np.median(allp, axis=0)
    r = float(np.percentile(np.linalg.norm(allp - c, axis=1), 99))
    return c, max(r, 1e-6) * factor


def look_at(position, target, down=(0.0, 1.0, 0.0)):
    z = np.asarray(target, float) - position
    z /= np.linalg.norm(z)
    d = np.asarray(down, float)
    x = np.cross(d, z)
    if np.linalg.norm(x) < 1e-6:
        x = np.cross([0, 0, 1.0], z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    m = np.eye(4)
    m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = x, y, z, position
    return m


def orbit_focus(c2ws):
    """Least-squares point closest to every optical axis, and how orbit-like the capture is
    (mean cosine between each camera's forward axis and the direction to that point)."""
    o = c2ws[:, :3, 3]
    d = c2ws[:, :3, 2]
    A = np.zeros((3, 3))
    b = np.zeros(3)
    for oi, di in zip(o, d):
        P = np.eye(3) - np.outer(di, di)
        A += P
        b += P @ oi
    try:
        f = np.linalg.solve(A, b)
    except np.linalg.LinAlgError:
        return None, 0.0
    to = f - o
    nrm = np.linalg.norm(to, axis=1)
    ok = nrm > 1e-9
    if not ok.any():
        return None, 0.0
    cos = np.einsum('ij,ij->i', to[ok] / nrm[ok, None], d[ok]).mean()
    return f, float(cos)


def _dedupe_path(centres, tol):
    keep = [0]
    for i in range(1, len(centres)):
        if np.linalg.norm(centres[i] - centres[keep[-1]]) > tol:
            keep.append(i)
    return centres[keep], keep


def smoothstep(t):
    return t * t * (3 - 2 * t)


def plan_flythrough(c2ws, n_frames, orbit_cos_threshold=0.85):
    """Camera-to-world matrices for a flythrough along the capture path.

    Camera centres (frame order, rig duplicates removed) are fitted with a smoothing
    spline and sampled with ease in and out. Orientation looks ahead along the path;
    for orbit captures (every camera facing one focus) it looks at that focus instead,
    so an object scan reads as a turntable rather than a sideways drive-by."""
    centres = c2ws[:, :3, 3]
    tol = 1e-3 * max(float(np.ptp(centres, axis=0).max()), 1e-6)
    pts, _ = _dedupe_path(centres, tol)
    focus, cos = orbit_focus(c2ws)
    orbit = focus is not None and cos > orbit_cos_threshold
    t = smoothstep(np.linspace(0.0, 1.0, n_frames))
    if len(pts) >= 4:
        diffs = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        u = np.concatenate([[0], np.cumsum(diffs)])
        u /= u[-1]
        k = min(3, len(pts) - 1)
        # smoothing proportional to the path length squared keeps jitter out without cutting corners
        s = len(pts) * (0.002 * float(np.ptp(pts, axis=0).max())) ** 2
        tck, _ = splprep(pts.T, u=u, k=k, s=s)
        path = np.stack(splev(t, tck), axis=1)
        ahead = np.stack(splev(np.clip(t + 0.04, 0, 1), tck), axis=1)
        back = np.stack(splev(np.clip(t - 0.04, 0, 1), tck), axis=1)
    else:
        a, b = pts[0], pts[-1] if len(pts) > 1 else pts[0] + np.array([0, 0, 1e-3])
        path = a + t[:, None] * (b - a)
        ahead, back = path + (b - a), path - (b - a)
    poses = []
    for i in range(n_frames):
        if orbit:
            target = focus
        else:
            direction = ahead[i] - back[i]
            if np.linalg.norm(direction) < 1e-9:
                direction = c2ws[min(i, len(c2ws) - 1), :3, 2]
            target = path[i] + direction / np.linalg.norm(direction) * 0.5
        poses.append(look_at(path[i], target))
    return np.stack(poses), {'orbit': bool(orbit), 'orbit_cosine': cos, 'path_cameras': int(len(pts))}
