"""360 (equirectangular) support for the video2motion worker.

A 360 camera never loses its subject, but the pose model only understands
perspective images: the equirect frame is stretched toward the poles and splits
the person at the seam. This module reframes the sphere into a flat perspective
view that follows the person, so the existing pose pipeline runs unchanged on
the reframe.

Conventions (contract C3 of the insta360 campaign):
  * yaw 0 / pitch 0 is the centre pixel of the equirect frame, yaw grows to the
    right, pitch grows upward: ``yaw = (x / W - 0.5) * 360``,
    ``pitch = (0.5 - y / H) * 180``.
  * Directions live in the OpenCV camera convention at yaw 0 / pitch 0
    (x right, y down, z forward), the same convention MediaPipe world landmarks
    use, so a reframe camera at (yaw, pitch) is the rotation ``Ry(yaw) @ Rx(pitch)``.

Everything here is pure NumPy/OpenCV except ``PoseBoxDetector``, which imports
MediaPipe lazily so the geometry and filter tests run without it.
"""

from __future__ import annotations

import math
import os
import subprocess
from dataclasses import dataclass, field
from typing import Callable, Iterable, Iterator, Optional

import numpy as np

FOV_MIN_DEG = 50.0
FOV_MAX_DEG = 110.0
PITCH_LIMIT_DEG = 89.0
# The subject should fill about this fraction of the reframe's vertical extent.
BODY_FILL = 0.62
LOST_FRAMES_BEFORE_REACQUIRE = 10
REACQUIRE_RETRY_FRAMES = 5
# Cube-face views overlap a little so nobody is cut exactly on a face edge.
CUBE_FACE_FOV_DEG = 100.0


# ── angles and directions ──────────────────────────────────────────────────────


def wrap_deg(angle: float) -> float:
    """Wrap an angle in degrees to [-180, 180)."""
    return (float(angle) + 180.0) % 360.0 - 180.0


def pixel_to_angles(x: float, y: float, width: int, height: int) -> tuple[float, float]:
    """Equirect pixel to (yaw_deg, pitch_deg) per contract C3."""
    return (x / width - 0.5) * 360.0, (0.5 - y / height) * 180.0


def angles_to_pixel(yaw_deg: float, pitch_deg: float, width: int, height: int) -> tuple[float, float]:
    """(yaw_deg, pitch_deg) to equirect pixel; the inverse of pixel_to_angles."""
    return (wrap_deg(yaw_deg) / 360.0 + 0.5) * width, (0.5 - pitch_deg / 180.0) * height


def angles_to_dir(yaw_deg: float, pitch_deg: float) -> np.ndarray:
    """Unit direction (x right, y down, z forward) for a yaw and pitch."""
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    return np.array(
        [math.cos(pitch) * math.sin(yaw), -math.sin(pitch), math.cos(pitch) * math.cos(yaw)]
    )


def dir_to_angles(v: np.ndarray) -> tuple[float, float]:
    """Inverse of angles_to_dir for any non-zero vector."""
    v = np.asarray(v, dtype=np.float64)
    n = np.linalg.norm(v)
    if n < 1e-12:
        raise ValueError("zero-length direction")
    v = v / n
    return math.degrees(math.atan2(v[0], v[2])), math.degrees(math.asin(float(np.clip(-v[1], -1.0, 1.0))))


def angular_distance_deg(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle angle between two (yaw, pitch) directions, in degrees."""
    c = float(np.clip(np.dot(angles_to_dir(*a), angles_to_dir(*b)), -1.0, 1.0))
    return math.degrees(math.acos(c))


def camera_rotation(yaw_deg: float, pitch_deg: float) -> np.ndarray:
    """Rotation taking reframe-camera axes to equirect-world axes."""
    y, p = math.radians(yaw_deg), math.radians(pitch_deg)
    ry = np.array([[math.cos(y), 0.0, math.sin(y)], [0.0, 1.0, 0.0], [-math.sin(y), 0.0, math.cos(y)]])
    rx = np.array([[1.0, 0.0, 0.0], [0.0, math.cos(p), -math.sin(p)], [0.0, math.sin(p), math.cos(p)]])
    return ry @ rx


def clamp_fov(hfov_deg: float) -> float:
    return float(np.clip(hfov_deg, FOV_MIN_DEG, FOV_MAX_DEG))


def focal_px(hfov_deg: float, out_w: int) -> float:
    return (out_w / 2.0) / math.tan(math.radians(hfov_deg) / 2.0)


def fov_for_body(body_height_deg: float, aspect: float) -> float:
    """Horizontal FOV (clamped) that frames a body of the given angular height."""
    vfov = max(body_height_deg, 1.0) / BODY_FILL
    vfov = min(vfov, 170.0)
    hfov = 2.0 * math.degrees(math.atan(math.tan(math.radians(vfov) / 2.0) * aspect))
    return clamp_fov(hfov)


# ── rendering ──────────────────────────────────────────────────────────────────


def perspective_maps(
    eq_w: int, eq_h: int, yaw_deg: float, pitch_deg: float, hfov_deg: float, out_w: int, out_h: int
) -> tuple[np.ndarray, np.ndarray]:
    """cv2.remap maps sampling an equirect frame through a perspective camera."""
    f = focal_px(hfov_deg, out_w)
    xs = (np.arange(out_w, dtype=np.float64) + 0.5 - out_w / 2.0) / f
    ys = (np.arange(out_h, dtype=np.float64) + 0.5 - out_h / 2.0) / f
    gx, gy = np.meshgrid(xs, ys)
    rays = np.stack([gx, gy, np.ones_like(gx)], axis=-1)
    world = rays @ camera_rotation(yaw_deg, pitch_deg).T
    norm = np.linalg.norm(world, axis=-1)
    lon = np.arctan2(world[..., 0], world[..., 2])
    lat = np.arcsin(np.clip(-world[..., 1] / norm, -1.0, 1.0))
    map_x = ((lon / (2.0 * math.pi) + 0.5) * eq_w - 0.5).astype(np.float32)
    map_y = ((0.5 - lat / math.pi) * eq_h - 0.5).astype(np.float32)
    return map_x, map_y


def render_perspective(
    eq_frame: np.ndarray, yaw_deg: float, pitch_deg: float, hfov_deg: float, out_w: int, out_h: int
) -> np.ndarray:
    """Render a perspective view of an equirect frame (BGR or RGB, any channels)."""
    import cv2

    eq_h, eq_w = eq_frame.shape[:2]
    map_x, map_y = perspective_maps(eq_w, eq_h, yaw_deg, pitch_deg, hfov_deg, out_w, out_h)
    return cv2.remap(
        eq_frame, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP
    )


def crop_point_to_angles(
    px: float, py: float, out_w: int, out_h: int, hfov_deg: float, yaw_deg: float, pitch_deg: float
) -> tuple[float, float]:
    """A pixel of a perspective crop to the (yaw, pitch) it looks at."""
    f = focal_px(hfov_deg, out_w)
    ray = np.array([(px - out_w / 2.0) / f, (py - out_h / 2.0) / f, 1.0])
    return dir_to_angles(camera_rotation(yaw_deg, pitch_deg) @ ray)


def cube_face_views() -> list[tuple[float, float]]:
    """(yaw, pitch) of six 90 degree faces: four around the horizon, up and down."""
    return [(0.0, 0.0), (90.0, 0.0), (180.0, 0.0), (-90.0, 0.0), (0.0, 90.0), (0.0, -90.0)]


# ── filtering on the sphere ────────────────────────────────────────────────────


class AngleFilter:
    """Constant-velocity Kalman filter for one angle with seam-safe innovations.

    The state is kept unwrapped (continuous through +-180) and measurements are
    unwrapped against the prediction, so a subject crossing the seam produces no
    jump. ``output`` wraps back into [-180, 180) only at the edge.
    """

    def __init__(self, fps: float, sigma_accel: float = 120.0, sigma_meas: float = 2.0):
        self.dt = 1.0 / fps
        dt = self.dt
        self.F = np.array([[1.0, dt], [0.0, 1.0]])
        self.Q = sigma_accel**2 * np.array([[dt**4 / 4, dt**3 / 2], [dt**3 / 2, dt**2]])
        self.R = sigma_meas**2
        self.x: Optional[np.ndarray] = None
        self.P: Optional[np.ndarray] = None
        self.history: list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]] = []

    def start(self, angle: float, velocity: float = 0.0) -> None:
        self.x = np.array([angle, velocity])
        self.P = np.diag([self.R, 90.0**2])

    @property
    def started(self) -> bool:
        return self.x is not None

    def predicted(self) -> float:
        return float((self.F @ self.x)[0])

    def step(self, measurement: Optional[float]) -> float:
        """Advance one frame; returns the filtered unwrapped angle."""
        x_pred = self.F @ self.x
        P_pred = self.F @ self.P @ self.F.T + self.Q
        if measurement is None:
            x_new, P_new = x_pred, P_pred
        else:
            z = x_pred[0] + wrap_deg(measurement - x_pred[0])
            s = P_pred[0, 0] + self.R
            k = P_pred[:, 0] / s
            x_new = x_pred + k * (z - x_pred[0])
            P_new = P_pred - np.outer(k, P_pred[0, :])
        self.history.append((x_pred, P_pred, x_new, P_new))
        self.x, self.P = x_new, P_new
        return float(x_new[0])

    def smooth(self) -> np.ndarray:
        """Rauch-Tung-Striebel pass over every step taken: unwrapped angles."""
        n = len(self.history)
        if n == 0:
            return np.zeros(0)
        xs = [h[2] for h in self.history]
        Ps = [h[3] for h in self.history]
        out = [None] * n
        out[-1] = xs[-1]
        for t in range(n - 2, -1, -1):
            x_pred_next, P_pred_next = self.history[t + 1][0], self.history[t + 1][1]
            c = Ps[t] @ self.F.T @ np.linalg.inv(P_pred_next)
            out[t] = xs[t] + c @ (out[t + 1] - x_pred_next)
        return np.array([o[0] for o in out])


def smooth_scalar(values: np.ndarray, alpha: float = 0.2) -> np.ndarray:
    """Zero-phase exponential smoothing (forward then backward) of a 1D series."""
    values = np.asarray(values, dtype=np.float64)
    if values.size < 2:
        return values.copy()
    fwd = values.copy()
    for t in range(1, len(fwd)):
        fwd[t] = fwd[t - 1] + alpha * (values[t] - fwd[t - 1])
    out = fwd.copy()
    for t in range(len(out) - 2, -1, -1):
        out[t] = out[t + 1] + alpha * (fwd[t] - out[t + 1])
    return out


# ── subject detection ──────────────────────────────────────────────────────────


@dataclass
class Person:
    """A detected person box in the pixels of the image it was found in."""

    x0: float
    y0: float
    x1: float
    y1: float
    score: float = 1.0

    @property
    def centre(self) -> tuple[float, float]:
        return (self.x0 + self.x1) / 2.0, (self.y0 + self.y1) / 2.0

    @property
    def height(self) -> float:
        return self.y1 - self.y0


Detector = Callable[[np.ndarray], list]


class PoseBoxDetector:
    """People boxes from MediaPipe PoseLandmarker (IMAGE mode, up to 3 people)."""

    def __init__(self, model_path: str, num_poses: int = 3):
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision

        self._vision = vision
        self._landmarker = vision.PoseLandmarker.create_from_options(
            vision.PoseLandmarkerOptions(
                base_options=mp_python.BaseOptions(model_asset_path=model_path),
                running_mode=vision.RunningMode.IMAGE,
                num_poses=num_poses,
                min_pose_detection_confidence=0.4,
                min_tracking_confidence=0.4,
            )
        )

    def close(self) -> None:
        self._landmarker.close()

    def __call__(self, bgr: np.ndarray) -> list[Person]:
        import cv2
        import mediapipe as mp

        h, w = bgr.shape[:2]
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        result = self._landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        people = []
        for pose in result.pose_landmarks:
            pts = [(lm.x, lm.y) for lm in pose if lm.visibility is not None and lm.visibility >= 0.5]
            if len(pts) < 6:
                continue
            xs = np.clip([p[0] for p in pts], 0.0, 1.0) * w
            ys = np.clip([p[1] for p in pts], 0.0, 1.0) * h
            vis = float(np.mean([lm.visibility for lm in pose]))
            people.append(Person(float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max()), vis))
        return people


@dataclass
class Candidate:
    yaw: float
    pitch: float
    height_deg: float
    score: float


def person_to_candidate(p: Person, view: tuple[float, float], hfov: float, w: int, h: int) -> Candidate:
    cx, cy = p.centre
    yaw, pitch = crop_point_to_angles(cx, cy, w, h, hfov, view[0], view[1])
    f = focal_px(hfov, w)
    height_deg = math.degrees(2.0 * math.atan(p.height / 2.0 / f))
    return Candidate(yaw, pitch, height_deg, p.score)


def detect_on_cube_faces(
    eq_frame: np.ndarray, detect: Detector, face_px: int = 640
) -> list[Candidate]:
    """People anywhere on the sphere: six overlapping 100 degree face renders.

    Duplicates of a person seen by two faces are merged (kept: the taller box).
    """
    found: list[Candidate] = []
    for view in cube_face_views():
        crop = render_perspective(eq_frame, view[0], view[1], CUBE_FACE_FOV_DEG, face_px, face_px)
        for person in detect(crop):
            found.append(person_to_candidate(person, view, CUBE_FACE_FOV_DEG, face_px, face_px))
    found.sort(key=lambda c: -c.height_deg)
    merged: list[Candidate] = []
    for cand in found:
        if all(angular_distance_deg((cand.yaw, cand.pitch), (m.yaw, m.pitch)) > 15.0 for m in merged):
            merged.append(cand)
    return merged


def pick_prominent(
    first: list[Candidate], later: list[Candidate]
) -> Optional[Candidate]:
    """Largest person, weighted up when they moved between the sampled frames."""
    if not first:
        return None
    best, best_score = None, -1.0
    for cand in first:
        motion = 0.0
        if later:
            motion = min(
                angular_distance_deg((cand.yaw, cand.pitch), (o.yaw, o.pitch)) for o in later
            )
        score = cand.height_deg * (1.0 + min(motion / 10.0, 1.0))
        if score > best_score:
            best, best_score = cand, score
    return best


# ── the tracker ────────────────────────────────────────────────────────────────


@dataclass
class TrackResult:
    yaw_deg: np.ndarray
    pitch_deg: np.ndarray
    fov_deg: np.ndarray
    lost_frames: int
    reacquisitions: int
    acquisition: dict
    measured: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=bool))

    def entries(self, fps: float) -> list[dict]:
        return [
            {
                "t": round(i / fps, 4),
                "yaw_deg": round(float(self.yaw_deg[i]), 3),
                "pitch_deg": round(float(self.pitch_deg[i]), 3),
                "fov_deg": round(float(self.fov_deg[i]), 2),
            }
            for i in range(len(self.yaw_deg))
        ]


DETECT_W, DETECT_H = 960, 540


def track_subject(
    open_frames: Callable[[], Iterable[np.ndarray]],
    detect: Detector,
    fps: float,
    subject: Optional[tuple[float, float]] = None,
    acquire_samples: int = 4,
) -> TrackResult:
    """Follow one person across the sphere; returns a smoothed per-frame track.

    ``open_frames`` returns a fresh iterator over the equirect frames each call
    (acquisition and tracking each decode from the start, so no frame buffer
    sits in memory). ``subject`` (yaw, pitch) starts the track there; otherwise
    the most prominent person on six cube-face renders of ``acquire_samples``
    frames spread over about two seconds is chosen. A person lost for more than
    LOST_FRAMES_BEFORE_REACQUIRE frames is searched for again on the cube
    faces, preferring whoever is nearest the last known direction.
    """
    acquisition: dict = {"method": "subject" if subject else "cube_faces"}

    fyaw, fpitch = AngleFilter(fps), AngleFilter(fps, sigma_accel=80.0)
    start = subject
    if start is None:
        stride = max(1, int(round(fps * 0.5)))
        sample_idx = [i * stride for i in range(acquire_samples)]
        cands_by_sample: dict[int, list[Candidate]] = {}
        for idx, frame in enumerate(open_frames()):
            if idx > sample_idx[-1]:
                break
            if idx in sample_idx:
                cands_by_sample[idx] = detect_on_cube_faces(frame, detect)
        populated = [i for i in sorted(cands_by_sample) if cands_by_sample[i]]
        if not populated:
            raise RuntimeError("no person detected anywhere on the sphere")
        first = cands_by_sample[populated[0]]
        later = cands_by_sample[populated[-1]] if populated[-1] != populated[0] else []
        chosen = pick_prominent(first, later)
        start = (chosen.yaw, chosen.pitch)
        acquisition.update(
            yaw_deg=round(chosen.yaw, 2),
            pitch_deg=round(chosen.pitch, 2),
            candidates=len(first),
            body_height_deg=round(chosen.height_deg, 1),
        )
        height_deg = chosen.height_deg
    else:
        acquisition.update(yaw_deg=round(subject[0], 2), pitch_deg=round(subject[1], 2))
        height_deg = 45.0

    fyaw.start(start[0])
    fpitch.start(float(np.clip(start[1], -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG)))
    aspect = 16.0 / 9.0
    hfov = fov_for_body(height_deg, aspect)
    fovs: list[float] = []
    measured: list[bool] = []
    lost_run, lost_total, reacq = 0, 0, 0

    for frame in open_frames():
        pred = (wrap_deg(fyaw.predicted()), float(np.clip(fpitch.predicted(), -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG)))
        crop = render_perspective(frame, pred[0], pred[1], hfov, DETECT_W, DETECT_H)
        people = detect(crop)
        meas: Optional[Candidate] = None
        if people:
            centre = (DETECT_W / 2.0, DETECT_H / 2.0)
            best = min(
                people,
                key=lambda p: math.hypot(p.centre[0] - centre[0], p.centre[1] - centre[1]) - 0.25 * p.height,
            )
            meas = person_to_candidate(best, pred, hfov, DETECT_W, DETECT_H)
            if angular_distance_deg((meas.yaw, meas.pitch), pred) > 0.75 * hfov:
                meas = None

        if meas is None:
            lost_run += 1
            lost_total += 1
            if lost_run > LOST_FRAMES_BEFORE_REACQUIRE and (lost_run - LOST_FRAMES_BEFORE_REACQUIRE - 1) % REACQUIRE_RETRY_FRAMES == 0:
                cands = detect_on_cube_faces(frame, detect)
                if cands:
                    nearest = min(cands, key=lambda c: angular_distance_deg((c.yaw, c.pitch), pred))
                    meas = nearest
                    reacq += 1
                    lost_run = 0
        else:
            lost_run = 0

        if meas is not None:
            fyaw.step(meas.yaw)
            fpitch.step(float(np.clip(meas.pitch, -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG)))
            height_deg = 0.7 * height_deg + 0.3 * meas.height_deg
            hfov = fov_for_body(height_deg, aspect)
            measured.append(True)
        else:
            fyaw.step(None)
            fpitch.step(None)
            measured.append(False)
        fovs.append(hfov)

    if not fovs:
        raise RuntimeError("no frames to track")
    yaw = np.array([wrap_deg(a) for a in fyaw.smooth()])
    pitch = np.clip(fpitch.smooth(), -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG)
    fov = np.clip(smooth_scalar(np.array(fovs)), FOV_MIN_DEG, FOV_MAX_DEG)
    return TrackResult(yaw, pitch, fov, lost_total, reacq, acquisition, np.array(measured))


# ── world-space root compensation ──────────────────────────────────────────────


def compensate_camera_rotation(
    landmarks: np.ndarray, yaw_deg: np.ndarray, pitch_deg: np.ndarray
) -> np.ndarray:
    """Rotate per-frame camera-space landmarks into the equirect world frame.

    ``landmarks`` is (T, ..., 3) in the MediaPipe camera convention of the
    reframe; the result expresses them in the 360 camera's own frame, so the
    solved root orientation no longer includes the reframe camera's motion.
    NaN rows (undetected hands) stay NaN. Frames beyond the track reuse its
    last entry.
    """
    out = np.array(landmarks, dtype=np.float64, copy=True)
    n = len(yaw_deg)
    for t in range(out.shape[0]):
        i = min(t, n - 1)
        out[t] = out[t] @ camera_rotation(float(yaw_deg[i]), float(pitch_deg[i])).T
    return out


# ── video plumbing ─────────────────────────────────────────────────────────────

WORK_WIDTH = int(os.environ.get("EQUIRECT_WORK_WIDTH", "3840"))
REFRAME_W, REFRAME_H = 1920, 1080


def probe_size(path: str) -> tuple[int, int]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
         "-of", "csv=p=0:s=x", path],
        capture_output=True, text=True, timeout=60,
    )
    if out.returncode != 0 or "x" not in out.stdout:
        raise RuntimeError("could not read the video dimensions")
    w, h = out.stdout.strip().split("x")[:2]
    return int(w), int(h)


def require_equirect(width: int, height: int) -> None:
    """An equirect frame is 2:1; anything else is not a stitched 360 video."""
    if height <= 0 or abs(width / height - 2.0) > 0.04:
        raise RuntimeError(
            f"projection equirect needs a 2:1 stitched frame; got {width}x{height}"
        )


def decode_working_equirect(raw_path: str, out_path: str, fps: int, seconds: float) -> tuple[int, int]:
    """Cap an equirect source to WORK_WIDTH, the job fps and duration (video only).

    Visually lossless H.264 so the reframe samples real detail; returns (w, h).
    """
    src_w, src_h = probe_size(raw_path)
    require_equirect(src_w, src_h)
    width = min(src_w, WORK_WIDTH)
    width -= width % 2
    height = width // 2
    height -= height % 2
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", raw_path, "-t", f"{seconds:.2f}",
         "-an", "-vf", f"fps={fps},scale={width}:{height}", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "12", "-pix_fmt", "yuv420p", out_path],
        capture_output=True, text=True, timeout=1800,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr[-400:]}")
    return width, height


def iter_video_frames(path: str) -> Iterator[np.ndarray]:
    import cv2

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError("could not open the working video")
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                return
            yield frame
    finally:
        cap.release()


def render_reframe_video(
    eq_path: str, track: TrackResult, fps: int, out_path: str, audio_path: Optional[str], seconds: float
) -> int:
    """Render the 1080p perspective video that follows the track; returns frames."""
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
           "-s", f"{REFRAME_W}x{REFRAME_H}", "-r", str(fps), "-i", "-"]
    if audio_path:
        cmd += ["-i", audio_path, "-map", "0:v", "-map", "1:a:0?", "-c:a", "aac", "-b:a", "128k",
                "-t", f"{seconds:.2f}"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-map_metadata", "-1", "-movflags", "+faststart", out_path]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    frames = 0
    try:
        for i, frame in enumerate(iter_video_frames(eq_path)):
            j = min(i, len(track.yaw_deg) - 1)
            view = render_perspective(
                frame, float(track.yaw_deg[j]), float(track.pitch_deg[j]), float(track.fov_deg[j]),
                REFRAME_W, REFRAME_H,
            )
            proc.stdin.write(view.tobytes())
            frames += 1
        proc.stdin.close()
        proc.wait(timeout=900)
    except Exception:
        proc.kill()
        raise
    if proc.returncode != 0:
        err = proc.stderr.read().decode("utf-8", "replace")[-400:]
        raise RuntimeError(f"reframe encode failed: {err}")
    return frames
