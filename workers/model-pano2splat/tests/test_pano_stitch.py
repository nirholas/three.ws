"""pano_stitch: trailer parsing, lens math, pairing, levelling, exit codes, stitch.json."""

import json
import math
import shutil
import struct
import subprocess
from pathlib import Path

import numpy as np
import pytest

from pano_stitch import calibration as cal_mod
from pano_stitch import imu as imu_mod
from pano_stitch import layout, report, tilt
from pano_stitch import trailer as T
from pano_stitch.cli import run
from pano_stitch.errors import CorruptInput, UnsupportedInput

FIX = Path(__file__).parent / "fixtures" / "insta360"
X3 = FIX / "x3_trailer_only.insv"
X5 = FIX / "x5_indexed.insv"
ONE_R = FIX / "onerr_sample.insv"
needs_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg is not installed")


def make_trailer(records, indexed=False):
    """Build a trailer from {record id: bytes}, in the walked or the indexed layout."""
    payload = b""
    entries = []
    for rid, data in records.items():
        entries.append((rid, len(data), len(payload)))
        payload += data + (struct.pack("<BBI", 0, rid, len(data)) if not indexed else b"")
    if indexed:
        directory = b"".join(struct.pack("<BBII", rid, 0, ln, off) for rid, ln, off in entries)
        payload += directory + struct.pack("<BBI", 0, 0, len(directory))
    size = len(payload) + 72
    return payload + b"\0" * 32 + struct.pack("<II", size, 3) + T.MAGIC


def pb_string(num, text):
    raw = text.encode()
    return bytes([(num << 3) | 2, len(raw)]) + raw


# ---- trailer parsing on committed fixtures -------------------------------------------------


def test_x3_trailer_walked_layout():
    t = T.read_trailer(X3)
    md = t.metadata
    assert md.model == "Insta360 X3"
    assert md.calibration_v3 and not md.calibration_v6
    assert md.imu_packed and md.accel_range_g == 32.0 and md.gyro_range_dps == 2000.0
    assert set(t.records) >= {1, 3, 4}


def test_x5_trailer_indexed_layout():
    t = T.read_trailer(X5)
    md = t.metadata
    assert md.model == "Insta360 X5"
    assert md.calibration_v6 and md.calibration_v3
    assert {1, 3, 4} <= set(t.records)


def test_one_r_trailer_has_only_the_first_generation_calibration():
    md = T.read_trailer(ONE_R).metadata
    assert md.model.lower().replace(" ", "") == "insta360oner"
    assert md.calibration_v1 and not md.calibration_v3 and not md.calibration_v6


def test_walked_and_indexed_layouts_give_the_same_records(tmp_path):
    t = T.read_trailer(X3)
    records = {rid: t.record(rid) for rid in (1, 3, 4)}
    for indexed in (False, True):
        p = tmp_path / f"x{indexed}.insv"
        p.write_bytes(b"\0" * 100 + make_trailer(records, indexed))
        back = T.read_trailer(p)
        assert {rid: back.record(rid) for rid in records} == records


def test_file_without_trailer_reads_as_none(tmp_path):
    p = tmp_path / "plain.mp4"
    p.write_bytes(b"\0" * 4096)
    assert T.read_trailer(p) is None
    assert not T.has_trailer(p)


def test_impossible_trailer_size_is_corrupt(tmp_path):
    p = tmp_path / "bad.insv"
    p.write_bytes(b"\0" * 200 + b"\0" * 32 + struct.pack("<II", 10**9, 3) + T.MAGIC)
    with pytest.raises(CorruptInput):
        T.read_trailer(p)


def test_imu_and_exposure_decoding_on_x3():
    t = T.read_trailer(X3)
    ts, accel, gyro = T.decode_imu(t.record(3), t.metadata)
    assert len(ts) == 3000 and accel.shape == (3000, 3) and gyro.shape == (3000, 3)
    assert np.allclose(np.diff(ts), 0.001, atol=1e-4)
    assert 0.9 < np.linalg.norm(accel, axis=1).mean() < 1.1  # a camera at rest reads one g
    et, _ = T.decode_exposure(t.record(4))
    assert len(et) == 200 and np.all(np.diff(et) > 0)


# ---- lens model math ----------------------------------------------------------------------


def test_equidistant_axis_and_edge():
    lens = cal_mod.Lens(cal_mod.MODEL_EQUIDISTANT, cx=1000.0, cy=900.0, yaw=0, pitch=0, roll=0, radius=1000.0)
    u, v, th = cal_mod.project(lens, np.array([[0.0, 0.0, 1.0]]))
    assert (u[0], v[0], th[0]) == (1000.0, 900.0, 0.0)
    t = math.radians(50.0)  # half of the 100 degree full angle: half the radius
    u, v, _ = cal_mod.project(lens, np.array([[math.sin(t), 0.0, math.cos(t)]]))
    assert u[0] == pytest.approx(1500.0) and v[0] == pytest.approx(900.0)


def test_mei_without_distortion_matches_the_unified_model():
    lens = cal_mod.Lens(cal_mod.MODEL_MEI, cx=500.0, cy=400.0, yaw=0, pitch=0, roll=0, fx=300.0, fy=310.0, xi=0.0)
    t = math.radians(30.0)
    u, v, _ = cal_mod.project(lens, np.array([[0.0, math.sin(t), math.cos(t)]]))
    assert u[0] == pytest.approx(500.0) and v[0] == pytest.approx(400.0 + 310.0 * math.tan(t))
    lens.xi = 0.9  # the unified model: m = d_xy / (d_z + xi)
    u, v, _ = cal_mod.project(lens, np.array([[math.sin(t), 0.0, math.cos(t)]]))
    assert u[0] == pytest.approx(500.0 + 300.0 * math.sin(t) / (math.cos(t) + 0.9))


def test_radial_and_thin_prism_terms():
    lens = cal_mod.Lens(cal_mod.MODEL_MEI_R5, cx=0.0, cy=0.0, yaw=0, pitch=0, roll=0, fx=1.0, fy=1.0, xi=0.0,
                        k=(0.1, 0.02, 0, 0, 0), s=(0.01, 0, 0, 0))
    d = np.array([[0.3, 0.0, 1.0]])
    u, _, _ = cal_mod.project(lens, d)
    mx = 0.3
    r2 = mx * mx
    assert u[0] == pytest.approx(mx * (1 + 0.1 * r2 + 0.02 * r2 * r2) + 0.01 * r2)


def test_calibration_strings_parse_on_every_generation():
    for path, model in ((X3, cal_mod.MODEL_MEI), (X5, cal_mod.MODEL_MEI_R5), (ONE_R, cal_mod.MODEL_EQUIDISTANT)):
        cal = cal_mod.calibration_from_metadata(T.read_trailer(path).metadata)
        assert cal.model == model and len(cal.lenses) == 2 and cal.canvas_w > 0
    # the lens on the axis of a real calibration lands near the middle of its square
    cal = cal_mod.calibration_from_metadata(T.read_trailer(X5).metadata)
    for i, lens in enumerate(cal.lenses):
        axis = cal_mod.lens_pose(lens, i).T @ np.array([0.0, 0.0, 1.0])
        u, v, th = cal_mod.project(lens, (cal_mod.lens_pose(lens, i) @ axis)[None])
        assert th[0] == pytest.approx(0.0, abs=1e-9)
        assert abs(u[0] - cal.square * i - cal.square / 2) < 0.1 * cal.square


def test_to_frame_scales_the_calibration_square_to_the_decoded_frame():
    cal = cal_mod.Calibration("mei", [], canvas_w=4000, canvas_h=2000)
    u, v = cal_mod.to_frame(cal, 1, np.array([3000.0]), np.array([1000.0]), 1000, 1000, photo=True)
    assert (u[0], v[0]) == (500.0, 500.0)


def test_mirrored_roll():
    assert cal_mod.mirrored_roll(0.0) == 0.0
    assert cal_mod.mirrored_roll(90.5) == pytest.approx(89.5)
    assert cal_mod.mirrored_roll(-179.0) == pytest.approx(-181.0)


# ---- split pair logic --------------------------------------------------------------------


def test_pairing_orders_lens_zero_first():
    a, b = "/c/VID_20231218_150323_10_022.insv", "/c/VID_20231218_150323_00_022.insv"
    assert layout.pair_split_files([a, b]) == [b, a]


@pytest.mark.parametrize("paths", [
    ["/c/VID_20231218_150323_00_022.insv", "/c/VID_20231218_150324_10_022.insv"],
    ["/c/VID_20231218_150323_00_022.insv", "/c/VID_20231218_150323_00_023.insv"],
    ["/c/VID_20231218_150323_00_022.insv", "/c/clip.insv"],
    ["/c/VID_20231218_150323_00_022.insv"],
])
def test_pairing_rejects_files_that_are_not_one_recording(paths):
    with pytest.raises(UnsupportedInput) as exc:
        layout.pair_split_files(paths)
    assert exc.value.code == "bad_pair"


def test_sibling_is_found_next_to_the_lens_zero_file(tmp_path):
    a = tmp_path / "VID_20240101_101010_00_001.insv"
    b = tmp_path / "VID_20240101_101010_10_001.insv"
    a.write_bytes(b"x")
    assert layout.find_sibling(str(a)) is None
    b.write_bytes(b"x")
    assert layout.find_sibling(str(a)) == str(b)
    assert layout.find_sibling(str(b)) is None


def test_pair_by_trailer_when_names_were_lost(tmp_path):
    with_trailer = tmp_path / "source-0.insv"
    without = tmp_path / "source-1.insv"
    with_trailer.write_bytes(b"\0" * 64 + X3.read_bytes())
    without.write_bytes(b"\0" * 64)
    assert layout.pair_by_trailer([str(without), str(with_trailer)]) == [str(with_trailer), str(without)]
    with pytest.raises(UnsupportedInput):
        layout.pair_by_trailer([str(without), str(without)])


def test_supported_camera_names():
    for name in ("Insta360 X5", "Insta360 X3", "Insta360 X4", "Insta360 ONE X2", "Insta360 OneR", "Insta360 ONE RS"):
        layout.check_camera(name)
    for name in ("Insta360 GO 3", "Insta360 Ace Pro", ""):
        with pytest.raises(UnsupportedInput):
            layout.check_camera(name)


# ---- horizon levelling --------------------------------------------------------------------


def test_levelling_a_camera_at_rest_puts_down_at_down():
    n = 2000
    t = np.arange(n) * 0.001
    # IMU x reads minus one g when the camera is upright: down is body +x
    accel = np.tile([-0.8, 0.5, 0.33], (n, 1)) / np.linalg.norm([-0.8, 0.5, 0.33])
    gyro = np.zeros((n, 3))
    downs, quats = imu_mod.track_orientation(t, accel, gyro)
    mats = imu_mod.frame_rotations(np.array([0.5, 1.0, 1.5]), t, quats)
    expected_down = -(imu_mod.IMU_TO_BODY @ accel[0])
    for m in mats:
        assert m @ np.array([0.0, 1.0, 0.0]) == pytest.approx(expected_down, abs=1e-6)
        assert np.linalg.det(m) == pytest.approx(1.0)


def test_gyro_integration_tracks_a_rotation_about_gravity_free_axis():
    n = 3000
    t = np.arange(n) * 0.001
    gyro = np.zeros((n, 3))
    gyro[:, 0] = 30.0  # IMU x is body x: down is body x, so this is a spin about gravity
    accel = np.tile([-1.0, 0.0, 0.0], (n, 1))
    _, quats = imu_mod.track_orientation(t, accel, gyro)
    heading = imu_mod.heading_angles(quats)
    assert abs(abs(heading[-1] - heading[0]) - math.radians(30.0 * 2.999)) < 0.05


def test_heading_smoothing_removes_shake_but_keeps_the_walk():
    t = np.arange(4000) * 0.001
    walk = 0.2 * t
    shake = 0.05 * np.sin(2 * math.pi * 8 * t)
    smooth = imu_mod.gaussian_smooth(walk + shake, 200)
    assert np.abs(smooth[1000:3000] - walk[1000:3000]).max() < 0.01


def test_static_rotations_without_imu():
    mats = imu_mod.static_rotations(3)
    assert mats.shape == (3, 3, 3)
    assert mats[0] @ np.array([0.0, 1.0, 0.0]) == pytest.approx([1.0, 0.0, 0.0])


def test_tilt_estimator_recovers_a_known_tilt():
    import cv2  # noqa: F401  (the estimator needs OpenCV)

    w, h = 2000, 1000
    xs, ys = np.meshgrid((np.arange(w) + 0.5) / w * 2 - 1, (np.arange(h) + 0.5) / h)
    lon, lat = xs * math.pi, math.pi / 2 - ys * math.pi
    rays = np.stack([np.cos(lat) * np.sin(lon), -np.sin(lat), np.cos(lat) * np.cos(lon)], -1)
    roll = math.radians(6.0)
    c, s = math.cos(roll), math.sin(roll)
    world = rays @ np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]]).T  # the frame is rolled by 6 degrees
    wlon = np.degrees(np.arctan2(world[..., 0], world[..., 2]))
    wlat = np.degrees(np.arcsin(-world[..., 1]))
    stripes = ((wlon % 20.0) < 0.5) & (np.abs(wlat) < 55)
    img = np.where(stripes[..., None], 0, 235).astype(np.uint8).repeat(3, axis=2)
    est = tilt.estimate_tilt(img)
    assert est is not None and est["tilt_deg"] == pytest.approx(6.0, abs=0.7)


# ---- CLI contract -------------------------------------------------------------------------


def stderr_json(capsys):
    lines = [ln for ln in capsys.readouterr().err.strip().splitlines() if ln]
    return json.loads(lines[-1])


def test_missing_file_exits_3_with_json_on_stderr(tmp_path, capsys):
    assert run(["--input", str(tmp_path / "nope.insv"), "--out", str(tmp_path / "o")]) == 3
    err = stderr_json(capsys)
    assert err["error"] == "unreadable_input" and "nope.insv" in err["message"]


def test_file_without_trailer_exits_2(tmp_path, capsys):
    p = tmp_path / "plain.insv"
    p.write_bytes(b"\0" * 4096)
    assert run(["--input", str(p), "--out", str(tmp_path / "o")]) == 2
    assert stderr_json(capsys)["error"] == "no_insta360_trailer"


def test_unrecognised_camera_exits_2_and_names_the_model(tmp_path, capsys):
    p = tmp_path / "go.insv"
    p.write_bytes(b"\0" * 128 + make_trailer({1: pb_string(2, "Insta360 GO 3")}))
    assert run(["--input", str(p), "--out", str(tmp_path / "o")]) == 2
    err = stderr_json(capsys)
    assert err["error"] == "unsupported_camera" and "Insta360 GO 3" in err["message"]


def test_bad_arguments_exit_2(tmp_path, capsys):
    assert run(["--out", str(tmp_path)]) == 2
    assert stderr_json(capsys)["error"] == "bad_arguments"
    assert run(["--input", "a.insv", "--out", str(tmp_path), "--max-width", "10"]) == 2


def test_unexpected_failure_exits_1(tmp_path, capsys, monkeypatch):
    import pano_stitch.cli as cli

    def boom(_):
        raise RuntimeError("boom")

    monkeypatch.setattr(cli, "open_source", boom)
    assert run(["--input", "a.insv", "--out", str(tmp_path / "o")]) == 1
    err = stderr_json(capsys)
    assert err["error"] == "internal_error" and "boom" in err["message"]


# ---- stitch.json schema -------------------------------------------------------------------


def test_report_has_exactly_the_contract_keys():
    src = layout.Source(layout.LAYOUT_TWO_TRACK, False, ["a"], None, "Insta360 X5")
    result = {"calibration_model": "mei_r5", "width": 7680, "height": 3840, "fps": 25, "duration_s": 24.4, "frames": 610,
              "horizon_leveled": True, "imu_samples": 24816, "warnings": ["w"], "backend": "cpu", "encoder": "libx264"}
    rep = report.build_report(src, result)
    assert tuple(rep) == report.KEYS
    assert rep["lens_layout"] in ("two_track", "side_by_side", "split_pair")
    assert rep["calibration_model"] in ("equidistant", "mei", "mei_r5")
    assert isinstance(rep["warnings"], list)


# ---- end to end on small synthetic containers ---------------------------------------------


def run_ffmpeg(args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


@needs_ffmpeg
def test_split_pair_video_end_to_end(tmp_path, capsys):
    a = tmp_path / "VID_20240101_101010_00_001.insv"
    b = tmp_path / "VID_20240101_101010_10_001.insv"
    for p, pattern in ((a, "testsrc2"), (b, "smptebars")):
        run_ffmpeg(["-f", "lavfi", "-i", f"{pattern}=size=480x480:rate=25:duration=1.2", "-f", "lavfi", "-i", "sine=duration=1.2",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-f", "mp4", str(p)])
    with open(a, "ab") as f:
        f.write(X3.read_bytes())
    out = tmp_path / "out"
    assert run(["--input", f"{b},{a}", "--out", str(out), "--max-width", "480", "--level-horizon", "--trim-start", "0.2"]) == 0
    rep = json.loads((out / "stitch.json").read_text())
    assert tuple(rep) == report.KEYS
    assert rep["lens_layout"] == "split_pair" and rep["camera_model"] == "Insta360 X3" and rep["calibration_model"] == "mei"
    assert (rep["width"], rep["height"]) == (480, 240)
    assert 20 <= rep["frames"] <= 25
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", str(out / "equirect.mp4")],
                                      capture_output=True, text=True).stdout)
    kinds = {s["codec_type"] for s in probe["streams"]}
    assert kinds == {"video", "audio"}
    lines = [json.loads(ln) for ln in capsys.readouterr().out.splitlines() if ln.startswith("{")]
    assert lines[-1] == {"stage": "stitch", "progress": 1.0}
    assert all({"stage", "progress"} == set(ln) for ln in lines)


def test_sample_indices_keep_the_first_frame_of_each_output_interval():
    from pano_stitch.video import sample_indices

    assert sample_indices(50, 25.0, 2.0) == [0, 13, 25, 38]
    assert sample_indices(10, 30.0, None) == list(range(10))
    assert sample_indices(10, 30.0, 60.0) == list(range(10))
    assert sample_indices(1808, 30000 / 1001, 2.0)[:3] == [0, 15, 30]
    assert len(sample_indices(1808, 30000 / 1001, 2.0)) == 121


@needs_ffmpeg
def test_fps_stitches_only_the_sampled_frames_and_keeps_the_lenses_in_step(tmp_path):
    # Every source frame is a flat grey of 16 + 4 x its index (inside TV range), in both lenses, so the
    # stitched frames show exactly which source frames were kept.
    a = tmp_path / "VID_20240101_101010_00_001.insv"
    b = tmp_path / "VID_20240101_101010_10_001.insv"
    for p in (a, b):
        run_ffmpeg(["-f", "lavfi", "-i", "color=c=gray:size=320x320:rate=25:duration=2", "-f", "lavfi", "-i", "sine=duration=2",
                    "-vf", "geq=lum='16+N*4':cb=128:cr=128", "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv420p", "-c:a", "aac",
                    "-shortest", "-f", "mp4", str(p)])
    with open(a, "ab") as f:
        f.write(X3.read_bytes())
    out = tmp_path / "out"
    assert run(["--input", f"{a},{b}", "--out", str(out), "--max-width", "320", "--fps", "2"]) == 0
    rep = json.loads((out / "stitch.json").read_text())
    assert rep["frames"] == 4 and rep["fps"] == 2.0
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(out / "equirect.mp4"), "-vf", "crop=32:32:144:64,extractplanes=y", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                         capture_output=True, check=True).stdout
    lum = [float(np.frombuffer(raw[i * 1024:(i + 1) * 1024], np.uint8).mean()) for i in range(len(raw) // 1024)]
    assert len(lum) == 4
    assert [round((v - 16) / 4) for v in lum] == [0, 13, 25, 38]
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", str(out / "equirect.mp4")],
                                      capture_output=True, text=True).stdout)
    assert {s["codec_type"] for s in probe["streams"]} == {"video"}


@needs_ffmpeg
def test_missing_imu_is_reported_as_a_warning_not_a_failure(tmp_path):
    t = T.read_trailer(X3)
    a = tmp_path / "VID_20240101_101010_00_001.insv"
    b = tmp_path / "VID_20240101_101010_10_001.insv"
    for p in (a, b):
        run_ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=320x320:rate=25:duration=0.6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-f", "mp4", str(p)])
    with open(a, "ab") as f:
        f.write(make_trailer({1: t.record(1)}))
    out = tmp_path / "o"
    assert run(["--input", f"{a},{b}", "--out", str(out), "--max-width", "320", "--level-horizon"]) == 0
    rep = json.loads((out / "stitch.json").read_text())
    assert rep["horizon_leveled"] is False and rep["imu_samples"] == 0
    assert any(w.startswith("no_imu") for w in rep["warnings"])


@needs_ffmpeg
def test_insp_photo_end_to_end_writes_gpano_and_keeps_exif(tmp_path):
    from PIL import Image

    side = 400
    yy, xx = np.mgrid[0:side, 0:side]
    base = np.stack([xx * 255 // side, yy * 255 // side, (xx + yy) * 255 // (2 * side)], -1).astype(np.uint8)
    img = Image.fromarray(np.concatenate([base, base[::-1]], axis=1))
    exif = Image.Exif()
    exif.get_ifd(0x8769)[0x9003] = "2024:05:06 07:08:09"
    exif.get_ifd(0x8825)[2] = (51.0, 30.0, 0.0)
    exif.get_ifd(0x8825)[1] = "N"
    exif[0x010F] = "Test Maker"
    p = tmp_path / "IMG_20240506_070809_00_001.insp"
    img.save(p, "JPEG", quality=92, exif=exif.tobytes())
    with open(p, "ab") as f:
        f.write(X5.read_bytes()[-T.read_tail(open(X5, "rb"), X5.stat().st_size)[0] :])
    out = tmp_path / "out"
    assert run(["--input", str(p), "--out", str(out), "--max-width", "400"]) == 0
    rep = json.loads((out / "stitch.json").read_text())
    assert rep["frames"] == 1 and rep["camera_model"] == "Insta360 X5" and (rep["width"], rep["height"]) == (400, 200)
    result = Image.open(out / "equirect.jpg")
    assert result.size == (400, 200)
    raw = (out / "equirect.jpg").read_bytes()
    assert b"ProjectionType>equirectangular<" in raw
    got = result.getexif()
    assert got[0x010F] == "Test Maker" and got.get_ifd(0x8769)[0x9003] == "2024:05:06 07:08:09"
    assert got.get_ifd(0x8825)[1] == "N"


# NVENC opens H.264 only up to 4096 pixels wide; HEVC goes to 8192. A 5.7K X3
# clip at the standard preset (max width 7680) is 5760 wide, so picking
# h264_nvenc for it failed with "Error while opening encoder" on the L4.
def _fake_encoders(monkeypatch, names):
    from pano_stitch import video

    listing = "\n".join(f" V....D {n}  encoder" for n in names)

    class Done:
        stdout = listing

    monkeypatch.setattr(video.subprocess, "run", lambda *a, **k: Done())
    return video


ALL_ENCODERS = ["h264_nvenc", "hevc_nvenc", "libx264", "libx265"]


def test_eight_bit_within_h264_nvenc_limits_stays_on_h264(monkeypatch):
    video = _fake_encoders(monkeypatch, ALL_ENCODERS)
    _, codec = video.encoder_plan(False, "cuda", 3840, 1920)
    assert codec == "h264_nvenc"


def test_eight_bit_wider_than_h264_nvenc_uses_hevc_nvenc(monkeypatch):
    video = _fake_encoders(monkeypatch, ALL_ENCODERS)
    args, codec = video.encoder_plan(False, "cuda", 5760, 2880)
    assert codec == "hevc_nvenc"
    assert args[args.index("-pix_fmt") + 1] == "yuv420p"
    assert args[args.index("-profile:v") + 1] == "main"


def test_wider_than_any_nvenc_falls_back_to_software(monkeypatch):
    video = _fake_encoders(monkeypatch, ALL_ENCODERS)
    assert video.encoder_plan(False, "cuda", 11520, 5760)[1] == "libx264"
    assert video.encoder_plan(True, "cuda", 11520, 5760)[1] == "libx265"


def test_wide_eight_bit_without_hevc_nvenc_uses_libx264(monkeypatch):
    video = _fake_encoders(monkeypatch, ["h264_nvenc", "libx264", "libx265"])
    assert video.encoder_plan(False, "cuda", 5760, 2880)[1] == "libx264"


def test_ten_bit_and_cpu_choices_are_unchanged(monkeypatch):
    video = _fake_encoders(monkeypatch, ALL_ENCODERS)
    assert video.encoder_plan(True, "cuda", 7680, 3840)[1] == "hevc_nvenc"
    assert video.encoder_plan(False, "cpu", 3840, 1920)[1] == "libx264"
    assert video.encoder_plan(True, "cpu", 3840, 1920)[1] == "libx265"
