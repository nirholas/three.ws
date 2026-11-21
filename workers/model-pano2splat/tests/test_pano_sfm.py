"""pano_sfm tests: CLI contract, rig geometry, frame selection on real frames, COLMAP output readability."""

import json
import os
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

from pano_sfm import frames, geometry, gravity

WORKER = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "pano_sfm"


def run_cli(*args: str) -> subprocess.CompletedProcess:
    env = dict(os.environ, PYTHONPATH=str(WORKER))
    return subprocess.run([sys.executable, "-m", "pano_sfm", *args], capture_output=True, text=True, env=env, cwd=WORKER)


def last_json_line(text: str) -> dict:
    return json.loads(text.strip().splitlines()[-1])


# CLI contract


def test_missing_required_args_exit_2_with_json_on_stderr():
    proc = run_cli()
    assert proc.returncode == 2
    err = last_json_line(proc.stderr)
    assert set(err) == {"error", "message"} and err["error"] == "bad_arguments"


def test_invalid_views_value_exits_2():
    proc = run_cli("--input", "x", "--out", "y", "--views", "9")
    assert proc.returncode == 2
    assert last_json_line(proc.stderr)["error"] == "bad_arguments"


def test_missing_input_exits_3(tmp_path):
    proc = run_cli("--input", str(tmp_path / "nope.mp4"), "--out", str(tmp_path / "o"))
    assert proc.returncode == 3
    err = last_json_line(proc.stderr)
    assert err["error"] == "input_missing" and err["message"].endswith(".")


def test_corrupt_video_exits_3(tmp_path):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"not a video at all")
    proc = run_cli("--input", str(bad), "--out", str(tmp_path / "o"))
    assert proc.returncode == 3
    assert last_json_line(proc.stderr)["error"] == "unreadable_video"


def test_non_equirect_video_exits_2(tmp_path):
    clip = tmp_path / "wide.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=640x480:rate=5:duration=2", "-pix_fmt", "yuv420p", str(clip)],
        check=True,
    )
    proc = run_cli("--input", str(clip), "--out", str(tmp_path / "o"))
    assert proc.returncode == 2
    assert last_json_line(proc.stderr)["error"] == "not_equirectangular"


def test_empty_photo_folder_exits_3(tmp_path):
    (tmp_path / "photos").mkdir()
    proc = run_cli("--input", str(tmp_path / "photos"), "--out", str(tmp_path / "o"))
    assert proc.returncode == 3
    assert last_json_line(proc.stderr)["error"] == "no_images"


def test_single_photo_exits_2(tmp_path):
    img = tmp_path / "a.jpg"
    cv2.imwrite(str(img), np.zeros((200, 400, 3), np.uint8))
    proc = run_cli("--input", str(img), "--out", str(tmp_path / "o"))
    assert proc.returncode == 2
    assert last_json_line(proc.stderr)["error"] == "single_image"


def test_progress_lines_are_c1_shaped(tmp_path):
    from pano_sfm import progress

    import io, contextlib

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        progress.emit("frames", 0.25)
    assert json.loads(buf.getvalue()) == {"stage": "frames", "progress": 0.25}


# Rig geometry


@pytest.mark.parametrize("views,expected", [(8, 8), (12, 12), (14, 14)])
def test_layout_counts(views, expected):
    assert len(geometry.view_layout(views)) == expected


def test_view_yaw_grows_to_the_right_and_pitch_up():
    right = geometry.cam_from_pano_rotation(90.0, 0.0)
    forward_in_pano = right.T @ np.array([0.0, 0.0, 1.0])
    u, v = geometry.spherical_uv(forward_in_pano)
    assert abs(u - 0.75) < 1e-9 and abs(v - 0.5) < 1e-9
    up = geometry.cam_from_pano_rotation(0.0, 45.0)
    u, v = geometry.spherical_uv(up.T @ np.array([0.0, 0.0, 1.0]))
    assert abs(u - 0.5) < 1e-9 and abs(v - 0.25) < 1e-9


def test_uv_roundtrip():
    rng = np.random.default_rng(1)
    uv = rng.uniform(0.02, 0.98, size=(500, 2))
    back = geometry.spherical_uv(geometry.pano_ray(uv[:, 0], uv[:, 1]))
    assert np.allclose(uv, back, atol=1e-9)


def test_known_3d_point_projects_consistently_into_overlapping_views():
    rig = geometry.build_rig(12, 800)
    direction = geometry.pano_ray(np.array(0.62), np.array(0.41))
    seen = 0
    for cam in rig:
        xy, inside = cam.project_pano_rays(direction)
        if not inside:
            continue
        seen += 1
        ray_cam = np.array([(xy[0] - cam.principal) / cam.focal, (xy[1] - cam.principal) / cam.focal, 1.0])
        ray_pano = cam.cam_from_pano.T @ (ray_cam / np.linalg.norm(ray_cam))
        assert np.allclose(ray_pano, direction, atol=1e-9)
    assert seen >= 2


def test_rig_relative_rotations_compose_back_to_the_view_rotations():
    from pano_sfm import solve

    rig = geometry.build_rig(8, 640)
    config = solve.make_rig_config(rig)
    ref = rig[0].cam_from_pano
    for cam, cfg in zip(rig, config.cameras):
        if cfg.cam_from_rig is None:
            assert cam.index == 0
            continue
        rel = cfg.cam_from_rig.rotation.matrix()
        assert np.allclose(rel @ ref, cam.cam_from_pano, atol=1e-9)
        assert np.allclose(cfg.cam_from_rig.translation, 0.0)
        assert cfg.camera.focal_length == pytest.approx(cam.focal)


def test_voronoi_ownership_partitions_the_sphere():
    rig = geometry.build_rig(8, 128)
    owners = geometry.voronoi_owner(rig)
    assert owners.shape == (8, 128, 128)
    assert owners.any(axis=(1, 2)).all()


def test_view_names_follow_the_contract():
    assert geometry.view_name(7, 3) == "00007_03.jpg"


# Frame selection on real frames (public-domain NASA 360 footage, see fixtures/pano_sfm/README.md)


def real_frames() -> list[np.ndarray]:
    paths = sorted(FIXTURES.glob("real_*.jpg"))
    if not paths:
        pytest.fail("committed real fixture frames are missing")
    return [cv2.cvtColor(cv2.imread(str(p)), cv2.COLOR_BGR2GRAY) for p in paths]


def test_blur_is_rejected_relative_to_the_clips_own_distribution():
    sharp = real_frames()
    blurred = [cv2.GaussianBlur(f, (0, 0), 6) for f in sharp[:2]]
    scores = np.array([frames.laplacian_sharpness(f) for f in sharp + blurred])
    keep = frames.reject_blurry(scores)
    assert keep[: len(sharp)].all()
    assert not keep[len(sharp) :].any()


def test_stationary_duplicates_are_dropped_and_motion_is_kept():
    sharp = real_frames()
    small = [cv2.resize(f, (frames.FLOW_W, frames.FLOW_H), interpolation=cv2.INTER_AREA) for f in sharp]
    still = [small[0], small[0].copy(), small[0].copy()]
    assert frames.drop_duplicates(still, [0, 1, 2]) == [0]
    shifted = np.roll(small[0], 12, axis=1)
    assert frames.drop_duplicates([small[0], shifted], [0, 1]) == [0, 1]


def test_cap_spreads_frames_evenly_over_time():
    times = np.arange(100) * 0.5
    picked = frames.spread_evenly(times, list(range(100)), 10)
    assert len(picked) == 10 and picked[0] == 0 and picked[-1] == 99
    gaps = np.diff(picked)
    assert gaps.max() - gaps.min() <= 2


def test_photo_folder_sorted_by_exif_then_name(tmp_path):
    from PIL import Image

    folder = tmp_path / "p"
    folder.mkdir()
    for name, stamp in [("b.jpg", "2026:01:01 10:00:00"), ("a.jpg", "2026:01:01 11:00:00"), ("c.jpg", None)]:
        im = Image.new("RGB", (800, 400), (50, 90, 130))
        exif = Image.Exif()
        if stamp:
            exif.get_ifd(0x8769)[0x9003] = stamp
        im.save(folder / name, exif=exif)
    files = sorted(folder.iterdir(), key=lambda p: (frames._exif_time(p) or "~", frames._natural_key(p)))
    assert [p.name for p in files] == ["b.jpg", "a.jpg", "c.jpg"]


# Gravity


def test_rotation_between_maps_up_onto_plus_y():
    rng = np.random.default_rng(3)
    for _ in range(20):
        a = rng.normal(size=3)
        a /= np.linalg.norm(a)
        rot = gravity.rotation_between(a, np.array([0.0, 1.0, 0.0]))
        assert np.allclose(rot @ a, [0.0, 1.0, 0.0], atol=1e-9)
        assert np.allclose(rot @ rot.T, np.eye(3), atol=1e-9)


def test_vertical_direction_ransac_recovers_a_tilted_up_axis():
    rng = np.random.default_rng(5)
    up = np.array([0.1, 1.0, 0.05])
    up /= np.linalg.norm(up)
    basis = np.linalg.svd(up.reshape(1, 3))[2][1:]
    angles = rng.uniform(0, 2 * np.pi, 400)
    normals = np.cos(angles)[:, None] * basis[0] + np.sin(angles)[:, None] * basis[1]
    noise = rng.normal(scale=0.002, size=normals.shape)
    normals = (normals + noise) / np.linalg.norm(normals + noise, axis=1, keepdims=True)
    outliers = rng.normal(size=(120, 3))
    outliers /= np.linalg.norm(outliers, axis=1, keepdims=True)
    est, inliers = gravity.vertical_direction_from_normals(np.vstack([normals, outliers]), np.array([0.0, 1.0, 0.0]), np.random.default_rng(0))
    assert est is not None and inliers >= 350
    assert np.degrees(np.arccos(np.clip(est @ up, -1, 1))) < 0.5


# COLMAP output readable by pycolmap (needs a real solved dataset: PANO_SFM_TEST_OUTPUT or the committed clip run)


def solved_dataset() -> Path | None:
    env = os.environ.get("PANO_SFM_TEST_OUTPUT")
    return Path(env) if env else None


@pytest.mark.skipif(solved_dataset() is None, reason="set PANO_SFM_TEST_OUTPUT to a pano_sfm output directory")
def test_output_dataset_reads_in_pycolmap_and_matches_sfm_json():
    import pycolmap

    out = solved_dataset()
    rec = pycolmap.Reconstruction(out / "sparse" / "0")
    stats = json.loads((out / "sfm.json").read_text())
    assert rec.num_reg_images() == stats["registered_images"]
    assert rec.num_points3D() == stats["points3d"]
    for image in rec.images.values():
        assert (out / "images" / image.name).is_file()
        assert image.name.count("_") == 1 and image.name.endswith(".jpg")
    assert stats["registration_ratio"] >= 0.6


def test_vocab_tree_resolves_to_none_when_the_download_cannot_happen(tmp_path, monkeypatch):
    """COLMAP aborts the process when its own vocab tree download fails (seen on Cloud Run), so we resolve it first."""
    from pano_sfm import solve

    monkeypatch.delenv("PANO_SFM_VOCAB_TREE", raising=False)
    assert solve.resolve_vocab_tree(tmp_path, url="http://127.0.0.1:9/none.bin") is None


def test_vocab_tree_env_path_wins_and_must_exist(tmp_path, monkeypatch):
    from pano_sfm import solve

    tree = tmp_path / "tree.bin"
    tree.write_bytes(b"x")
    monkeypatch.setenv("PANO_SFM_VOCAB_TREE", str(tree))
    assert solve.resolve_vocab_tree(tmp_path) == tree
    monkeypatch.setenv("PANO_SFM_VOCAB_TREE", str(tmp_path / "missing.bin"))
    assert solve.resolve_vocab_tree(tmp_path) is None


def test_vocab_tree_cached_copy_is_checksum_verified(tmp_path, monkeypatch):
    from pano_sfm import solve

    monkeypatch.delenv("PANO_SFM_VOCAB_TREE", raising=False)
    (tmp_path / solve.VOCAB_TREE_NAME).write_bytes(b"corrupt")
    assert solve.resolve_vocab_tree(tmp_path, url="http://127.0.0.1:9/none.bin") is None
