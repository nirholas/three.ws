"""Gravity alignment: rotate the solved model so +Y is up (the splat stage and the viewer assume it).

The rig frame is the panorama frame, so the rig's own up axis is -y (COLMAP cameras look along +z with y
down). When pano_stitch reports horizon_leveled that axis is true up and is used directly. Otherwise the
vertical vanishing direction is estimated from near-vertical line segments seen by the horizon views,
and the rig axis only breaks the sign.
"""

import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

MAX_FRAMES_FOR_LINES = 40
MIN_LINE_LENGTH_PX = 70.0
VERTICAL_TOLERANCE_DEG = 30.0
RANSAC_ITERATIONS = 3000
INLIER_ANGLE_DEG = 1.5
MIN_INLIERS = 60
MAX_TILT_FROM_PRIOR_DEG = 35.0


@dataclass(frozen=True)
class GravityResult:
    up_world: np.ndarray
    method: str
    inliers: int
    warning: str | None


def read_horizon_leveled(input_path: Path) -> bool | None:
    """True or False when a stitch.json sits next to the input, None when there is none."""
    folder = input_path if input_path.is_dir() else input_path.parent
    candidate = folder / "stitch.json"
    if not candidate.is_file():
        return None
    try:
        return bool(json.loads(candidate.read_text()).get("horizon_leveled"))
    except (OSError, ValueError):
        return None


def rotation_between(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Smallest rotation matrix taking unit vector a onto unit vector b."""
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if c > 1.0 - 1e-12:
        return np.eye(3)
    if c < -1.0 + 1e-12:
        axis = np.cross(a, [1.0, 0.0, 0.0])
        if np.linalg.norm(axis) < 1e-6:
            axis = np.cross(a, [0.0, 1.0, 0.0])
        axis /= np.linalg.norm(axis)
        return 2.0 * np.outer(axis, axis) - np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1.0 / (1.0 + c))


def rig_up_prior(rig_from_world_rotations: list[np.ndarray]) -> np.ndarray:
    """Mean world-space up of the panorama frame (rig frame -y) over the registered frames."""
    ups = np.stack([r.T @ np.array([0.0, -1.0, 0.0]) for r in rig_from_world_rotations])
    mean = ups.mean(axis=0)
    return mean / np.linalg.norm(mean)


def vertical_line_normals(image_bgr: np.ndarray, focal: float, principal: float) -> np.ndarray:
    """Unit normals (camera frame) of the viewing planes through near-vertical line segments of one view."""
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    lines = lsd.detect(gray)[0]
    if lines is None:
        return np.zeros((0, 3))
    segs = lines.reshape(-1, 4)
    dx, dy = segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1]
    length = np.hypot(dx, dy)
    angle_from_vertical = np.rad2deg(np.arctan2(np.abs(dx), np.abs(dy)))
    keep = (length >= MIN_LINE_LENGTH_PX) & (angle_from_vertical <= VERTICAL_TOLERANCE_DEG)
    segs = segs[keep]
    if len(segs) == 0:
        return np.zeros((0, 3))
    p1 = np.stack([(segs[:, 0] - principal) / focal, (segs[:, 1] - principal) / focal, np.ones(len(segs))], axis=1)
    p2 = np.stack([(segs[:, 2] - principal) / focal, (segs[:, 3] - principal) / focal, np.ones(len(segs))], axis=1)
    normals = np.cross(p1, p2)
    norms = np.linalg.norm(normals, axis=1)
    return normals[norms > 1e-9] / norms[norms > 1e-9, None]


def vertical_direction_from_normals(normals_world: np.ndarray, prior_up: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray | None, int]:
    """RANSAC the direction every vertical-line plane contains, constrained to stay near the prior up axis."""
    if len(normals_world) < MIN_INLIERS:
        return None, len(normals_world)
    sin_tol = np.sin(np.deg2rad(INLIER_ANGLE_DEG))
    cos_prior = np.cos(np.deg2rad(MAX_TILT_FROM_PRIOR_DEG))
    best_dir, best_count = None, 0
    n = len(normals_world)
    for _ in range(RANSAC_ITERATIONS):
        i, j = rng.integers(0, n, size=2)
        d = np.cross(normals_world[i], normals_world[j])
        norm = np.linalg.norm(d)
        if norm < 1e-6:
            continue
        d /= norm
        if np.dot(d, prior_up) < 0:
            d = -d
        if np.dot(d, prior_up) < cos_prior:
            continue
        count = int((np.abs(normals_world @ d) < sin_tol).sum())
        if count > best_count:
            best_dir, best_count = d, count
    if best_dir is None or best_count < MIN_INLIERS:
        return None, best_count
    inliers = normals_world[np.abs(normals_world @ best_dir) < sin_tol]
    _, _, vt = np.linalg.svd(inliers, full_matrices=False)
    refined = vt[-1]
    if np.dot(refined, prior_up) < 0:
        refined = -refined
    return refined, best_count


def estimate_up(
    leveled: bool | None,
    frame_rotations: list[np.ndarray],
    horizon_views: list[tuple[np.ndarray, np.ndarray, float, float]],
    seed: int = 0,
) -> GravityResult:
    """Up direction in the model's world frame.

    frame_rotations: rig_from_world rotation of each registered frame.
    horizon_views: (view image BGR, cam_from_world rotation, focal, principal) for sampled horizon views.
    """
    prior = rig_up_prior(frame_rotations)
    if leveled:
        return GravityResult(prior, "stitch_horizon_leveled", 0, None)
    normals = []
    for image, cam_from_world, focal, principal in horizon_views:
        n_cam = vertical_line_normals(image, focal, principal)
        if len(n_cam):
            normals.append(n_cam @ cam_from_world)
    if normals:
        direction, inliers = vertical_direction_from_normals(np.concatenate(normals), prior, np.random.default_rng(seed))
        if direction is not None:
            return GravityResult(direction, "vertical_vanishing_direction", inliers, None)
    note = "Too few vertical lines to estimate the up direction; used the camera's own up axis, so the scene may be slightly tilted."
    return GravityResult(prior, "rig_axis", 0, note)
