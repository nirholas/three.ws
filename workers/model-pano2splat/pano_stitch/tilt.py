"""Estimate how far an equirectangular frame is from level, from scene verticals.

Straight vertical edges in the world are great circles through the zenith on the sphere:
every such edge, seen as a plane through the camera centre, contains the true up direction.
So the up vector is the direction most orthogonal to the normals of those planes. Edges
are found in rectilinear views cut from the equirect, turned into plane normals, and the
up direction is fitted by iteratively reweighted least squares (smallest eigenvector of the
length weighted normal scatter matrix).

Used to measure the horizon levelling on real frames, so it reports the tilt of the frame
(angle between the fitted up and the frame's own up) and how many edges supported it.
"""

import math

import numpy as np

VIEW_COUNT = 8
VIEW_FOV_DEG = 90.0
VIEW_SIZE = 640
MIN_SEGMENT_PX = 70
FIRST_PASS_DEG = 12.0
FINAL_PASS_DEG = 2.5


def _view_rotation(yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def _render_view(cv2, equirect, yaw, size=VIEW_SIZE, fov=VIEW_FOV_DEG):
    h, w = equirect.shape[:2]
    f = (size / 2.0) / math.tan(math.radians(fov) / 2.0)
    xs, ys = np.meshgrid(np.arange(size) - size / 2.0 + 0.5, np.arange(size) - size / 2.0 + 0.5)
    rays = np.stack([xs / f, ys / f, np.ones_like(xs)], axis=-1)
    rays = rays @ _view_rotation(yaw).T
    rays /= np.linalg.norm(rays, axis=-1, keepdims=True)
    lon = np.arctan2(rays[..., 0], rays[..., 2])
    lat = np.arcsin(np.clip(-rays[..., 1], -1, 1))
    mx = ((lon / math.pi + 1.0) * 0.5 * w - 0.5).astype(np.float32)
    my = ((0.5 - lat / math.pi) * h - 0.5).astype(np.float32)
    return cv2.remap(equirect, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP), f


def plane_normals(equirect_rgb):
    """Normals (N,3) and lengths (N,) of near-vertical edges, in equirect view coordinates (y down)."""
    import cv2

    normals, lengths = [], []
    for k in range(VIEW_COUNT):
        yaw = 2 * math.pi * k / VIEW_COUNT
        view, f = _render_view(cv2, equirect_rgb, yaw)
        gray = cv2.cvtColor(view, cv2.COLOR_RGB2GRAY)
        gray = cv2.GaussianBlur(gray, (0, 0), 1.2)
        edges = cv2.Canny(gray, 50, 140)
        lines = cv2.HoughLinesP(edges, 1, math.pi / 360, threshold=60, minLineLength=MIN_SEGMENT_PX, maxLineGap=6)
        if lines is None:
            continue
        rot = _view_rotation(yaw)
        for x1, y1, x2, y2 in np.asarray(lines).reshape(-1, 4):
            if abs(y2 - y1) < 1.5 * abs(x2 - x1):
                continue
            c = VIEW_SIZE / 2.0
            p1 = np.array([(x1 - c) / f, (y1 - c) / f, 1.0])
            p2 = np.array([(x2 - c) / f, (y2 - c) / f, 1.0])
            n = np.cross(p1, p2)
            norm = np.linalg.norm(n)
            if norm < 1e-9:
                continue
            normals.append(rot @ (n / norm))
            lengths.append(math.hypot(x2 - x1, y2 - y1))
    return np.array(normals), np.array(lengths)


def fit_up(normals, lengths):
    """Return (up unit vector with y negative, supporting segments) or None."""
    if len(normals) < 6:
        return None
    up = np.array([0.0, -1.0, 0.0])
    for limit in (FIRST_PASS_DEG, 6.0, FINAL_PASS_DEG, FINAL_PASS_DEG):
        resid = np.degrees(np.arcsin(np.clip(np.abs(normals @ up), 0, 1)))
        keep = resid < limit
        if keep.sum() < 5:
            return None
        n = normals[keep]
        w = lengths[keep]
        scatter = (n * w[:, None]).T @ n
        vals, vecs = np.linalg.eigh(scatter)
        up = vecs[:, 0]
        if up[1] > 0:
            up = -up
    return up, int(keep.sum())


def estimate_tilt(equirect_rgb):
    """Tilt in degrees of the frame: {tilt_deg, roll_deg, pitch_deg, segments} or None when no verticals are found."""
    normals, lengths = plane_normals(equirect_rgb)
    fit = fit_up(normals, lengths)
    if fit is None:
        return None
    up, segments = fit
    tilt = math.degrees(math.acos(float(np.clip(-up[1], -1, 1))))
    return {
        "tilt_deg": round(tilt, 3),
        "roll_deg": round(math.degrees(math.atan2(up[0], -up[1])), 3),
        "pitch_deg": round(math.degrees(math.atan2(up[2], -up[1])), 3),
        "segments": segments,
    }


def main(argv=None):
    import argparse
    import json

    from PIL import Image

    p = argparse.ArgumentParser(prog="pano_stitch.tilt", description="Estimate the tilt of equirect frames from scene verticals.")
    p.add_argument("images", nargs="+")
    args = p.parse_args(argv)
    for path in args.images:
        print(json.dumps({"image": path, "tilt": estimate_tilt(np.asarray(Image.open(path).convert("RGB")))}))


if __name__ == "__main__":
    main()
