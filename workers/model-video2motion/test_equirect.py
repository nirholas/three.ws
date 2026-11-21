"""Tests for the 360 (equirect) path: projection math, seam-safe tracking filters,
the tracker's loss and re-acquisition logic, root compensation and the request
contract. The geometry tests are pure NumPy/OpenCV; the footage tests run real
MediaPipe over real 360 clips and skip when the clips are not staged.

Run:  python -m pytest test_equirect.py -q
Real footage:  EQUIRECT_FIXTURE_DIR=/path/with/clips MODELS_DIR=... pytest test_equirect.py
"""

import json
import math
import os

import numpy as np
import pytest

os.environ.setdefault("API_KEY", "smoke-test-key")
os.environ.setdefault("GCS_BUCKET", "three-ws-video2motion-smoke")

import equirect  # noqa: E402
import main  # noqa: E402
from equirect import (  # noqa: E402
    AngleFilter,
    angles_to_dir,
    angles_to_pixel,
    camera_rotation,
    compensate_camera_rotation,
    crop_point_to_angles,
    dir_to_angles,
    perspective_maps,
    pixel_to_angles,
    wrap_deg,
)

HERE = os.path.dirname(__file__)
AUTH = {"Authorization": f"Bearer {os.environ['API_KEY']}"}


# ── contract C3 conventions ────────────────────────────────────────────────────


def test_pixel_angle_convention_matches_the_contract():
    w, h = 3840, 1920
    assert pixel_to_angles(w / 2, h / 2, w, h) == (0.0, 0.0)
    assert pixel_to_angles(w * 0.75, h / 2, w, h)[0] == pytest.approx(90.0)  # right is positive yaw
    assert pixel_to_angles(w / 2, h * 0.25, w, h)[1] == pytest.approx(45.0)  # up is positive pitch
    for yaw, pitch in [(-179.0, -80.0), (0.0, 0.0), (123.4, 56.7), (-90.0, 89.0)]:
        x, y = angles_to_pixel(yaw, pitch, w, h)
        back = pixel_to_angles(x, y, w, h)
        assert back[0] == pytest.approx(yaw, abs=1e-6) and back[1] == pytest.approx(pitch, abs=1e-6)


def test_dir_angle_round_trip_including_the_seam_and_poles():
    for yaw, pitch in [(179.9, 10.0), (-179.9, -10.0), (0.0, 89.0), (45.0, -60.0)]:
        got = dir_to_angles(angles_to_dir(yaw, pitch))
        assert wrap_deg(got[0] - yaw) == pytest.approx(0.0, abs=1e-6)
        assert got[1] == pytest.approx(pitch, abs=1e-6)


def test_wrap_deg_stays_in_half_open_range():
    assert wrap_deg(180.0) == -180.0
    assert wrap_deg(-180.0) == -180.0
    assert wrap_deg(541.0) == pytest.approx(-179.0)
    assert wrap_deg(-190.0) == pytest.approx(170.0)


# ── sphere to perspective projection ───────────────────────────────────────────


@pytest.mark.parametrize("yaw,pitch", [(0, 0), (90, 0), (-135, 20), (179, -30), (33, 70)])
def test_known_direction_lands_at_the_crop_centre(yaw, pitch):
    """The crop centred on (yaw, pitch) samples the equirect pixel for that
    direction at its centre, and the inverse mapping returns the direction."""
    eq_w, eq_h, out_w, out_h = 3840, 1920, 960, 540
    map_x, map_y = perspective_maps(eq_w, eq_h, yaw, pitch, 90.0, out_w, out_h)
    cx, cy = out_w // 2, out_h // 2
    # The centre of the image lies between four pixels; average them.
    mx = float(np.mean(map_x[cy - 1 : cy + 1, cx - 1 : cx + 1])) + 0.5
    my = float(np.mean(map_y[cy - 1 : cy + 1, cx - 1 : cx + 1])) + 0.5
    ex, ey = angles_to_pixel(yaw, pitch, eq_w, eq_h)
    dx = (mx - ex + eq_w / 2) % eq_w - eq_w / 2
    assert abs(dx) < 0.6 and abs(my - ey) < 0.6
    got = crop_point_to_angles(out_w / 2, out_h / 2, out_w, out_h, 90.0, yaw, pitch)
    assert wrap_deg(got[0] - yaw) == pytest.approx(0.0, abs=1e-6)
    assert got[1] == pytest.approx(pitch, abs=1e-6)


def test_crop_edges_span_the_requested_horizontal_fov():
    out_w, out_h, hfov = 1280, 720, 80.0
    left = crop_point_to_angles(0.0, out_h / 2, out_w, out_h, hfov, 0.0, 0.0)
    right = crop_point_to_angles(float(out_w), out_h / 2, out_w, out_h, hfov, 0.0, 0.0)
    assert right[0] - left[0] == pytest.approx(hfov, abs=1e-6)


def test_render_perspective_places_a_marked_direction_at_the_centre_across_the_seam():
    """Real remap over a real image: a marker painted at the seam shows up in
    the middle of a crop centred on it, whichever side of the seam it sits."""
    eq_w, eq_h = 2048, 1024
    eq = np.zeros((eq_h, eq_w, 3), dtype=np.uint8)
    # A bright block straddling the seam (yaw +-180) at the horizon.
    eq[eq_h // 2 - 20 : eq_h // 2 + 20, :24] = 255
    eq[eq_h // 2 - 20 : eq_h // 2 + 20, -24:] = 255
    crop = equirect.render_perspective(eq, 180.0, 0.0, 70.0, 640, 360)
    ys, xs = np.nonzero(crop[..., 0] > 127)
    assert xs.size > 200
    assert abs(xs.mean() - 320) < 6 and abs(ys.mean() - 180) < 6


def test_fov_adapts_to_body_size_and_is_clamped():
    near = equirect.fov_for_body(110.0, 16 / 9)
    far = equirect.fov_for_body(8.0, 16 / 9)
    assert far == equirect.FOV_MIN_DEG
    assert near == equirect.FOV_MAX_DEG
    mid = equirect.fov_for_body(30.0, 16 / 9)
    assert equirect.FOV_MIN_DEG < mid < equirect.FOV_MAX_DEG


def test_cube_faces_cover_the_sphere():
    views = equirect.cube_face_views()
    assert len(views) == 6
    rng = np.random.default_rng(7)
    pts = rng.normal(size=(500, 3))
    pts /= np.linalg.norm(pts, axis=1, keepdims=True)
    half = math.radians(equirect.CUBE_FACE_FOV_DEG / 2.0)
    for p in pts:
        best = max(np.dot(p, angles_to_dir(*v)) for v in views)
        assert best >= math.cos(math.radians(60.0))
    assert half > math.radians(45.0)


# ── seam-safe filtering ────────────────────────────────────────────────────────


def test_kalman_tracks_a_subject_across_the_seam_without_jumping():
    """Truth walks from yaw 150 through 180 to -150 at 20 deg/s with 1.5 deg of
    measurement noise; the smoothed track never jumps and stays near truth."""
    fps = 24.0
    rng = np.random.default_rng(3)
    n = 120
    truth = [wrap_deg(150.0 + 20.0 * i / fps) for i in range(n)]
    f = AngleFilter(fps)
    f.start(truth[0])
    for i in range(1, n):
        f.step(wrap_deg(truth[i] + rng.normal(0, 1.5)))
    smooth = f.smooth()
    wrapped = np.array([wrap_deg(a) for a in smooth])
    err = np.array([abs(wrap_deg(a - t)) for a, t in zip(wrapped[1:], truth[1:])])
    assert err.max() < 3.0
    steps = np.abs(np.diff(smooth))
    assert steps.max() < 3.0  # continuous: no 360 degree jump at the seam


def test_kalman_coasts_through_missing_measurements():
    fps = 24.0
    f = AngleFilter(fps)
    f.start(0.0, 0.0)
    for i in range(1, 30):
        f.step(30.0 * i / fps)
    for _ in range(8):
        f.step(None)
    coasted = f.x[0]
    assert coasted == pytest.approx(30.0 * (29 + 8) / fps, abs=6.0)


# ── tracker logic over rendered spheres ────────────────────────────────────────


class _MarkerDetector:
    """Finds the saturated-red figure drawn into a rendered crop: a real
    detector over real pixels, standing in for MediaPipe so the tracker's
    control flow (follow, lose, re-acquire) is exercised deterministically."""

    def __init__(self, hide_between=None):
        self.calls = 0
        self.hide_between = hide_between
        self.frame_index = -1

    def __call__(self, bgr):
        self.calls += 1
        mask = (bgr[..., 2] > 200) & (bgr[..., 1] < 60) & (bgr[..., 0] < 60)
        ys, xs = np.nonzero(mask)
        if xs.size < 40:
            return []
        return [equirect.Person(float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max()))]


def _sphere_with_person(yaw, pitch, w=1536, h=768, size_deg=(12.0, 30.0)):
    eq = np.full((h, w, 3), 90, dtype=np.uint8)
    cx, cy = angles_to_pixel(yaw, pitch, w, h)
    half_w = size_deg[0] / 360.0 * w / 2
    half_h = size_deg[1] / 180.0 * h / 2
    xs = (np.arange(int(cx - half_w), int(cx + half_w)) % w)
    eq[int(cy - half_h) : int(cy + half_h), xs] = (0, 0, 255)
    return eq


def test_tracker_follows_a_subject_crossing_the_seam_and_reports_it():
    fps = 12.0
    truth = [wrap_deg(160.0 + 18.0 * i / fps) for i in range(48)]
    frames = [_sphere_with_person(y, 0.0) for y in truth]
    det = _MarkerDetector()
    res = equirect.track_subject(lambda: iter(frames), det, fps, subject=(truth[0], 0.0))
    err = max(abs(wrap_deg(a - t)) for a, t in zip(res.yaw_deg, truth))
    assert err < 4.0
    assert res.lost_frames == 0 and res.reacquisitions == 0
    assert res.acquisition["method"] == "subject"
    assert np.all((res.fov_deg >= 50.0) & (res.fov_deg <= 110.0))
    entries = res.entries(fps)
    assert entries[0].keys() == {"t", "yaw_deg", "pitch_deg", "fov_deg"}


def test_tracker_acquires_the_largest_person_on_the_cube_faces_without_a_hint():
    fps = 12.0
    big = _sphere_with_person(-100.0, 5.0, size_deg=(14.0, 36.0))
    small = _sphere_with_person(60.0, 0.0, size_deg=(6.0, 16.0))
    both = np.where(small == (0, 0, 255), small, big)
    frames = [both.copy() for _ in range(20)]
    res = equirect.track_subject(lambda: iter(frames), _MarkerDetector(), fps)
    assert res.acquisition["method"] == "cube_faces"
    assert abs(wrap_deg(res.acquisition["yaw_deg"] + 100.0)) < 6.0
    assert abs(res.yaw_deg[-1] + 100.0) < 6.0


def test_tracker_acquires_a_person_standing_at_the_pole():
    frames = [_sphere_with_person(20.0, 78.0, size_deg=(20.0, 20.0)) for _ in range(12)]
    res = equirect.track_subject(lambda: iter(frames), _MarkerDetector(), 12.0)
    assert res.pitch_deg[-1] > 60.0


def test_tracker_reacquires_after_a_long_loss():
    fps = 12.0
    visible = [_sphere_with_person(40.0, 0.0) for _ in range(10)]
    empty = [np.full((768, 1536, 3), 90, dtype=np.uint8) for _ in range(14)]
    back = [_sphere_with_person(150.0, 0.0) for _ in range(14)]
    frames = visible + empty + back
    res = equirect.track_subject(lambda: iter(frames), _MarkerDetector(), fps, subject=(40.0, 0.0))
    assert res.lost_frames >= 14
    assert res.reacquisitions >= 1
    assert abs(res.yaw_deg[-1] - 150.0) < 6.0


def test_tracker_without_anyone_raises_a_clear_error():
    frames = [np.full((768, 1536, 3), 90, dtype=np.uint8) for _ in range(20)]
    with pytest.raises(RuntimeError, match="no person"):
        equirect.track_subject(lambda: iter(frames), _MarkerDetector(), 12.0)


def test_pick_prominent_prefers_the_person_who_moves():
    still = equirect.Candidate(10.0, 0.0, 30.0, 1.0)
    mover = equirect.Candidate(-80.0, 0.0, 28.0, 1.0)
    later = [equirect.Candidate(10.0, 0.0, 30.0, 1.0), equirect.Candidate(-60.0, 0.0, 28.0, 1.0)]
    assert equirect.pick_prominent([still, mover], later) is mover


# ── world-space root compensation ──────────────────────────────────────────────

TRACK_FIXTURE = os.path.join(HERE, "fixtures", "equirect_track.json")


def _circle_track(fps=24.0, seconds=6.0):
    """A subject walking a full circle around the camera at 1.8 m: the yaw to
    the subject sweeps 360 degrees, which the reframe camera follows."""
    n = int(fps * seconds)
    yaw = np.array([wrap_deg(-180.0 + 360.0 * i / n) for i in range(n)])
    pitch = np.full(n, -4.0)
    return yaw, pitch


def _upright_body_facing(world_yaw_deg: float) -> np.ndarray:
    """33 MediaPipe-convention landmarks (x right, y down, z forward) for an
    upright body whose shoulders/hips axis is perpendicular to world_yaw."""
    pts = np.zeros((33, 3))
    right = np.array([math.cos(math.radians(world_yaw_deg)), 0.0, -math.sin(math.radians(world_yaw_deg))])
    pts[23] = -0.10 * right + [0, 0.0, 0]  # left hip
    pts[24] = 0.10 * right + [0, 0.0, 0]  # right hip
    pts[11] = -0.20 * right + [0, -0.5, 0]  # left shoulder
    pts[12] = 0.20 * right + [0, -0.5, 0]  # right shoulder
    return pts


def test_compensation_recovers_world_orientation_on_a_circle_walk():
    """The subject keeps one world heading while the reframe camera swings
    around the circle: in camera space the body appears to rotate, and
    compensation puts it back, so the solved root orientation is constant."""
    from pose_solver import landmarks_to_clip

    yaw, pitch = _circle_track()
    if os.path.exists(TRACK_FIXTURE):
        with open(TRACK_FIXTURE) as fh:
            real = json.load(fh)
        yaw = np.array([e["yaw_deg"] for e in real["subject_track"]])
        pitch = np.array([e["pitch_deg"] for e in real["subject_track"]])
    n = len(yaw)
    world_body = _upright_body_facing(25.0)
    cam_space = np.stack([world_body @ camera_rotation(float(yaw[t]), float(pitch[t])) for t in range(n)])
    # cam_space[t] = R(t)^T applied to the world body (row-vector form).
    recovered = compensate_camera_rotation(cam_space, yaw, pitch)
    assert np.allclose(recovered, np.broadcast_to(world_body, recovered.shape), atol=1e-9)

    clip = landmarks_to_clip(recovered, fps=24.0, smooth=False)
    hips = next(t for t in clip["tracks"] if t["name"] == "Hips.quaternion")
    q = np.array(hips["values"]).reshape(-1, 4)
    assert np.abs(q - q[0]).max() < 1e-6

    uncompensated = landmarks_to_clip(cam_space, fps=24.0, smooth=False)
    q_raw = np.array(next(t for t in uncompensated["tracks"] if t["name"] == "Hips.quaternion")["values"]).reshape(-1, 4)
    assert np.abs(q_raw - q_raw[0]).max() > 0.5


def test_compensation_keeps_missing_hands_missing_and_pads_short_tracks():
    hands = np.full((5, 2, 21, 3), np.nan)
    hands[2, 0] = 1.0
    out = compensate_camera_rotation(hands, np.array([10.0, 20.0]), np.array([0.0, 0.0]))
    assert np.isnan(out[0]).all() and np.isnan(out[4]).all()
    assert np.isfinite(out[2, 0]).all()


# ── request contract ───────────────────────────────────────────────────────────


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    return TestClient(main.app)


@pytest.mark.parametrize(
    "extra",
    [
        {"projection": "cubemap"},
        {"projection": "equirect", "subject": {"yaw_deg": 181, "pitch_deg": 0}},
        {"projection": "equirect", "subject": {"yaw_deg": 0, "pitch_deg": -91}},
        {"projection": "equirect", "subject": {"yaw_deg": 0}},
    ],
)
def test_infer_rejects_bad_360_fields(client, extra):
    payload = {"video_url": "https://example.com/a.mp4", **extra}
    assert client.post("/infer", json=payload, headers=AUTH).status_code == 422


def test_infer_accepts_360_fields_and_defaults_stay_perspective(client):
    model = main.InferRequest(video_url="https://example.com/a.mp4")
    assert model.projection == "perspective" and model.subject is None
    ok = main.InferRequest(
        video_url="https://example.com/a.mp4",
        projection="equirect",
        subject={"yaw_deg": -180, "pitch_deg": 90},
    )
    assert ok.subject.yaw_deg == -180 and ok.subject.pitch_deg == 90


def test_equirect_requires_a_two_to_one_frame():
    with pytest.raises(RuntimeError, match="2:1"):
        equirect.require_equirect(1920, 1080)
    equirect.require_equirect(3840, 1920)
    equirect.require_equirect(7680, 3840)


def test_pick_prominent_prefers_the_upright_body_over_a_sideways_stitch_duplicate():
    # A subject close to a two-lens camera is seen twice at the stitch seam: the
    # real person upright, and a rotated, slightly larger copy. Tracking the copy
    # drags the reframe across the sphere once the real person is found.
    sideways_copy = equirect.Candidate(-154.0, -53.0, 31.0, 0.9, upright=0.0)
    real = equirect.Candidate(-5.0, 30.0, 27.0, 0.9, upright=1.0)
    assert equirect.pick_prominent([sideways_copy, real], []) is real


def test_upright_from_torso_vector():
    # Hips below shoulders in the image is upright, hips beside them is sideways.
    assert equirect.upright_score((0.5, 0.3), (0.5, 0.7)) == pytest.approx(1.0)
    assert equirect.upright_score((0.3, 0.5), (0.7, 0.5)) == pytest.approx(0.0, abs=1e-6)
    assert equirect.upright_score((0.5, 0.7), (0.5, 0.3)) == 0.0
