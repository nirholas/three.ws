"""Per-unit lens calibration from the Insta360 trailer and the lens projection math.

Three calibration generations exist (freeKC/raw360-formats docs/insta360.md and
docs/stitching-math.md, MIT; the per-term layout of V6 checked against alexvaut/insv-stitch,
MIT, and against real X3 and X5 files):

    V1  equidistant fisheye: radius cx cy yaw pitch roll per lens
    V3  Mei unified model, three radial and two tangential terms
    V6  Mei with five radial terms, tangential and thin-prism terms

All pixel values are in a calibration canvas of one square area per lens side by side.
`to_frame` maps a canvas pixel to a pixel of the decoded frame of that lens.
"""

import math
from dataclasses import dataclass, field

import numpy as np

from .errors import CorruptInput, UnsupportedInput
from .trailer import parse_calibration_string

MODEL_EQUIDISTANT = "equidistant"
MODEL_MEI = "mei"
MODEL_MEI_R5 = "mei_r5"

EQUIDISTANT_FULL_ANGLE_DEG = 100.0
MAX_THETA_DEG = 100.0


@dataclass
class Lens:
    model: str
    cx: float
    cy: float
    yaw: float
    pitch: float
    roll: float
    fx: float = 0.0
    fy: float = 0.0
    xi: float = 0.0
    radius: float = 0.0
    k: tuple = (0.0, 0.0, 0.0, 0.0, 0.0)
    p: tuple = (0.0, 0.0)
    s: tuple = (0.0, 0.0, 0.0, 0.0)
    translation: tuple = (0.0, 0.0, 0.0)


@dataclass
class Calibration:
    model: str
    lenses: list
    canvas_w: int
    canvas_h: int
    crop: tuple = ()  # (srcW, srcH, dstW, dstH, offX, offY) of the video window
    extra: dict = field(default_factory=dict)

    @property
    def square(self):
        return self.canvas_w // 2


def _split_lenses(tokens, per_lens, head=1):
    if len(tokens) < head + 2 * per_lens + 1 or int(tokens[0]) != 2:
        raise CorruptInput("corrupt_calibration", "The camera calibration in the file has an unexpected size.")
    return [tokens[head + i * per_lens : head + (i + 1) * per_lens] for i in range(2)]


def parse_v1(text):
    t = parse_calibration_string(text)
    a, b = _split_lenses(t, 6)
    w, h = int(t[13]), int(t[14])
    lenses = [Lens(MODEL_EQUIDISTANT, cx=x[1], cy=x[2], yaw=x[3], pitch=x[4], roll=x[5], radius=x[0]) for x in (a, b)]
    return Calibration(MODEL_EQUIDISTANT, lenses, w, h)


def parse_v3(text):
    t = parse_calibration_string(text)
    a, b = _split_lenses(t, 19)
    lenses = []
    for x in (a, b):
        lenses.append(
            Lens(
                MODEL_MEI, xi=x[0], fx=x[1], fy=x[2], cx=x[3], cy=x[4], yaw=x[5], pitch=x[6], roll=x[7],
                translation=(x[8], x[9], x[10]), k=(x[11], x[12], x[13], 0.0, 0.0), p=(x[14], x[15]),
            )
        )
    return Calibration(MODEL_MEI, lenses, int(a[16]), int(a[17]))


def parse_v6(text):
    t = parse_calibration_string(text)
    a, b = _split_lenses(t, 27)
    lenses = []
    for x in (a, b):
        c = x[11:24]
        lenses.append(
            Lens(
                MODEL_MEI_R5, xi=x[0], fx=x[1], fy=x[2], cx=x[3], cy=x[4], yaw=x[5], pitch=x[6], roll=x[7],
                translation=(x[8], x[9], x[10]), k=(c[0], c[1], c[2], c[3], c[4]), p=(c[5], c[6]), s=(c[7], c[8], c[9], c[10]),
            )
        )
    return Calibration(MODEL_MEI_R5, lenses, int(a[24]), int(a[25]))


def calibration_from_metadata(md):
    """Pick the richest calibration the file carries: V6, then V3, then V1."""
    if md.calibration_v6:
        cal = parse_v6(md.calibration_v6)
    elif md.calibration_v3:
        cal = parse_v3(md.calibration_v3)
    elif md.calibration_v1:
        cal = parse_v1(md.calibration_v1)
    else:
        raise UnsupportedInput("no_calibration", f"The {md.model or 'camera'} file carries no lens calibration, so it cannot be stitched.")
    cal.crop = md.crop
    return cal


def mirrored_roll(roll):
    """The strings give the roll mirrored about the nearest quarter turn."""
    return 2.0 * round(roll / 90.0) * 90.0 - roll


def _rx(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=np.float64)


def _ry(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=np.float64)


def _rz(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=np.float64)


def lens_pose(lens, index):
    """Rotation from the Insta360 body frame (x right, y down, z along lens 0) to the lens frame."""
    r = math.radians
    return _rz(r(mirrored_roll(lens.roll))) @ _rx(math.pi * index) @ _rx(r(lens.pitch)) @ _ry(r(lens.yaw))


def project(lens, d):
    """Project lens-frame directions d (N, 3) to calibration canvas pixels.

    Returns (u, v, theta) where theta is the angle off the optical axis in radians."""
    d = d / np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-12)
    dx, dy, dz = d[:, 0], d[:, 1], d[:, 2]
    theta = np.arccos(np.clip(dz, -1.0, 1.0))
    if lens.model == MODEL_EQUIDISTANT:
        rho = lens.radius * theta / math.radians(EQUIDISTANT_FULL_ANGLE_DEG)
        sin_t = np.maximum(np.sin(theta), 1e-12)
        return lens.cx + rho * dx / sin_t, lens.cy + rho * dy / sin_t, theta
    denom = np.maximum(dz + lens.xi, 1e-9)
    mx, my = dx / denom, dy / denom
    r2 = mx * mx + my * my
    k1, k2, k3, k4, k5 = lens.k
    radial = 1.0 + r2 * (k1 + r2 * (k2 + r2 * (k3 + r2 * (k4 + r2 * k5))))
    p1, p2 = lens.p
    s1, s2, s3, s4 = lens.s
    r4 = r2 * r2
    xd = mx * radial + 2.0 * p1 * mx * my + p2 * (r2 + 2.0 * mx * mx) + s1 * r2 + s2 * r4
    yd = my * radial + p1 * (r2 + 2.0 * my * my) + 2.0 * p2 * mx * my + s3 * r2 + s4 * r4
    return lens.fx * xd + lens.cx, lens.fy * yd + lens.cy, theta


def to_frame(cal, index, u, v, frame_w, frame_h, photo=False):
    """Map canvas pixels of lens `index` to pixels of a decoded frame region of that lens.

    Photos scale the canvas square onto the frame height. Videos show the window of
    metadata field 27 centred in the area of each lens (measured on X3 and X5 files)."""
    origin = cal.square * index
    u = u - origin
    if photo or not cal.crop:
        scale = frame_h / cal.square
        return u * scale, v * scale
    src_w, src_h, dst_w, dst_h = cal.crop[:4]
    off_x = (src_w - dst_w) / 2.0
    off_y = (src_h - dst_h) / 2.0
    scale = frame_w / dst_w
    return (u - off_x) * scale, (v - off_y) * (frame_h / dst_h)
