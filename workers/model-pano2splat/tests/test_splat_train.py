"""splat_train tests: CLI contract, COLMAP reading, PLY layout, SPZ round trip, preview video
probe, holdout determinism, scene geometry. GPU training is covered by test_gpu_training,
which runs when SPLAT_TRAIN_TEST_DATASET names a real COLMAP dataset and CUDA is present."""
import json
import os
import struct
import subprocess
import sys

import cv2
import numpy as np
import pytest

from splat_train import colmap_io, dataset, errors, export, preview, scene, video

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def write_colmap(root, model='PINHOLE', n_images=12, size=(96, 64), with_masks=False, truncate=False):
    """Write a small but geometrically consistent COLMAP binary dataset: cameras on an arc
    looking at the origin, textured images, and scattered points."""
    rng = np.random.default_rng(1)
    os.makedirs(os.path.join(root, 'images'), exist_ok=True)
    os.makedirs(os.path.join(root, 'sparse', '0'), exist_ok=True)
    w, h = size
    params = {'PINHOLE': [80.0, 80.0, w / 2, h / 2], 'OPENCV': [80.0, 80.0, w / 2, h / 2, -0.05, 0.01, 0.0, 0.0],
              'OPENCV_FISHEYE': [80.0, 80.0, w / 2, h / 2, 0.0, 0.0, 0.0, 0.0]}[model]
    mid = colmap_io.MODEL_IDS[model][0]
    with open(os.path.join(root, 'sparse', '0', 'cameras.bin'), 'wb') as f:
        f.write(struct.pack('<Q', 1))
        f.write(struct.pack('<iiQQ', 1, mid, w, h))
        f.write(struct.pack('<' + 'd' * len(params), *params))
    with open(os.path.join(root, 'sparse', '0', 'images.bin'), 'wb') as f:
        f.write(struct.pack('<Q', n_images))
        for i in range(n_images):
            ang = i * 0.15
            c = np.array([3 * np.sin(ang), 0.2, -3 * np.cos(ang)])
            z = -c / np.linalg.norm(c)
            x = np.cross([0, 1.0, 0], z)
            x /= np.linalg.norm(x)
            y = np.cross(z, x)
            R = np.stack([x, y, z])  # world to camera rows
            t = -R @ c
            qw = np.sqrt(max(0.0, 1 + R[0, 0] + R[1, 1] + R[2, 2])) / 2
            q = np.array([qw, (R[2, 1] - R[1, 2]) / (4 * qw), (R[0, 2] - R[2, 0]) / (4 * qw), (R[1, 0] - R[0, 1]) / (4 * qw)])
            name = f'{i:05d}_00.jpg'
            f.write(struct.pack('<idddddddi', i + 1, *q, *t, 1))
            f.write(name.encode() + b'\x00')
            f.write(struct.pack('<Q', 0))
            img = rng.integers(0, 255, (h, w, 3), dtype=np.uint8)
            cv2.imwrite(os.path.join(root, 'images', name), img)
            if with_masks:
                os.makedirs(os.path.join(root, 'masks'), exist_ok=True)
                m = np.full((h, w), 255, np.uint8)
                m[:, : w // 4] = 0
                cv2.imwrite(os.path.join(root, 'masks', name + '.png'), m)
    pts = rng.normal(0, 0.5, (500, 3))
    with open(os.path.join(root, 'sparse', '0', 'points3D.bin'), 'wb') as f:
        f.write(struct.pack('<Q', len(pts)))
        for i, p in enumerate(pts):
            f.write(struct.pack('<QdddBBBdQ', i + 1, *p, 10, 20, 30, 0.5, 1))
            f.write(struct.pack('<ii', 1, 0))
    if truncate:
        p = os.path.join(root, 'sparse', '0', 'images.bin')
        data = open(p, 'rb').read()
        open(p, 'wb').write(data[: len(data) // 2])
    return root


def run_cli(*args):
    p = subprocess.run([sys.executable, '-m', 'splat_train', *args], cwd=HERE, capture_output=True, text=True)
    return p


def last_error(p):
    return json.loads(p.stderr.strip().splitlines()[-1])


# ---- CLI contract and exit codes ----

def test_cli_missing_dataset_exits_3_with_json(tmp_path):
    p = run_cli('--colmap', str(tmp_path / 'nope'), '--out', str(tmp_path / 'o'))
    assert p.returncode == 3
    e = last_error(p)
    assert e['error'] == 'missing_colmap_model' and e['message'].endswith('.')


def test_cli_empty_dataset_exits_3(tmp_path):
    (tmp_path / 'd').mkdir()
    p = run_cli('--colmap', str(tmp_path / 'd'), '--out', str(tmp_path / 'o'))
    assert p.returncode == 3 and last_error(p)['error'] == 'missing_colmap_model'


def test_cli_truncated_model_exits_3(tmp_path):
    write_colmap(str(tmp_path / 'd'), truncate=True)
    p = run_cli('--colmap', str(tmp_path / 'd'), '--out', str(tmp_path / 'o'))
    assert p.returncode == 3, p.stderr
    assert last_error(p)['error'] in ('truncated_colmap_model', 'unreadable_colmap_model')


def test_cli_fisheye_camera_exits_2(tmp_path):
    write_colmap(str(tmp_path / 'd'), model='OPENCV_FISHEYE')
    p = run_cli('--colmap', str(tmp_path / 'd'), '--out', str(tmp_path / 'o'))
    assert p.returncode == 2, p.stderr
    assert last_error(p)['error'] == 'unsupported_camera_model'


def test_cli_missing_images_exits_3(tmp_path):
    write_colmap(str(tmp_path / 'd'))
    os.remove(tmp_path / 'd' / 'images' / '00003_00.jpg')
    p = run_cli('--colmap', str(tmp_path / 'd'), '--out', str(tmp_path / 'o'))
    assert p.returncode == 3 and last_error(p)['error'] == 'missing_images'


def test_cli_bad_arguments_exit_2_with_json(tmp_path):
    p = run_cli('--out', str(tmp_path))
    assert p.returncode == 2 and last_error(p)['error'] == 'invalid_arguments'


def test_cli_rejects_tiny_iteration_count(tmp_path):
    write_colmap(str(tmp_path / 'd'))
    p = run_cli('--colmap', str(tmp_path / 'd'), '--out', str(tmp_path / 'o'), '--iterations', '5')
    assert p.returncode == 2 and last_error(p)['error'] == 'invalid_arguments'


def test_cli_presets_resolve_and_flags_override():
    from splat_train import cli
    a = cli.build_parser().parse_args(['--colmap', 'x', '--out', 'y', '--preset', 'high'])
    assert cli.resolve(a) == (30000, 6_000_000)
    a = cli.build_parser().parse_args(['--colmap', 'x', '--out', 'y', '--preset', 'preview', '--max-gaussians', '500000'])
    assert cli.resolve(a) == (7000, 500000)
    a = cli.build_parser().parse_args(['--colmap', 'x', '--out', 'y'])
    assert cli.resolve(a) == (30000, 3_000_000)


# ---- COLMAP reading and dataset normalisation ----

def test_read_model_roundtrip(tmp_path):
    write_colmap(str(tmp_path / 'd'), n_images=5)
    cams, imgs, xyz, rgb = colmap_io.read_model(str(tmp_path / 'd'))
    assert cams[1].model == 'PINHOLE' and cams[1].width == 96
    assert len(imgs) == 5 and xyz.shape == (500, 3) and tuple(rgb[0]) == (10, 20, 30)
    w2c = imgs[1].w2c()
    c = np.linalg.inv(w2c)[:3, 3]
    assert np.allclose(c, [0, 0.2, -3], atol=1e-6)


def test_dataset_normalised_up_aligned_and_masks(tmp_path):
    write_colmap(str(tmp_path / 'd'), n_images=16, with_masks=True)
    ds = dataset.load_dataset(str(tmp_path / 'd'), holdout_every=8)
    centres = np.stack([f.c2w[:3, 3] for f in ds.frames])
    assert abs(np.linalg.norm(centres - centres.mean(0), axis=1).max() - 1.0) < 1e-6
    up = -np.mean([f.c2w[:3, 1] for f in ds.frames], axis=0)
    up /= np.linalg.norm(up)
    assert np.allclose(up, [0, -1, 0], atol=1e-6)  # world is Y-down, so scene up is -Y
    assert all(f.mask is not None and not f.mask[:, :10].any() and f.mask[:, -1].all() for f in ds.frames)
    assert len(ds.holdout) == 2 and not set(ds.holdout) & set(ds.train)


def test_dataset_undistorts_opencv_cameras(tmp_path):
    write_colmap(str(tmp_path / 'd'), model='OPENCV')
    ds = dataset.load_dataset(str(tmp_path / 'd'))
    f = ds.frames[0]
    assert f.image.shape[:2] == (f.height, f.width) and f.width <= 96 and f.K[0, 0] > 0


def test_dataset_downscales_to_max_side(tmp_path):
    write_colmap(str(tmp_path / 'd'), size=(200, 100))
    ds = dataset.load_dataset(str(tmp_path / 'd'), max_side=100)
    f = ds.frames[0]
    assert (f.width, f.height) == (100, 50) and abs(f.K[0, 0] - 80.0 / 2) < 1e-6


def test_dataset_memory_budget_shrinks_images(tmp_path):
    write_colmap(str(tmp_path / 'd'), size=(400, 300), n_images=6)
    ds = dataset.load_dataset(str(tmp_path / 'd'), max_side=400, memory_budget=6 * 200 * 150 * 3)
    assert ds.frames[0].width < 400


# ---- holdout split ----

def test_holdout_is_deterministic_and_one_per_block():
    a = scene.holdout_indices(100, 8)
    assert a == scene.holdout_indices(100, 8)
    assert len(a) == 12  # the 13th block holds only 4 images and its slot falls past the end
    assert [i // 8 for i in a] == list(range(12))


def test_holdout_covers_every_view_of_a_rig():
    held = scene.holdout_indices(8 * 40, 8)  # 8 views per frame, holdout every 8
    assert {i % 8 for i in held} == set(range(8))


def test_holdout_disabled_or_too_few():
    assert scene.holdout_indices(100, 0) == [] and scene.holdout_indices(5, 8) == []


# ---- scene geometry ----

def _orbit(n=40, r=3.0):
    poses = []
    for i in range(n):
        a = 2 * np.pi * i / n
        c = np.array([r * np.cos(a), 0.0, r * np.sin(a)])
        poses.append(scene.look_at(c, np.zeros(3)))
    return np.stack(poses)


def test_orbit_detected_and_looks_at_focus():
    c2ws = _orbit()
    poses, info = scene.plan_flythrough(c2ws, 90)
    assert info['orbit'] is True
    for p in poses[::10]:
        to = -p[:3, 3] / np.linalg.norm(p[:3, 3])
        assert np.dot(p[:3, 2], to) > 0.999


def test_forward_walk_looks_ahead_and_eases():
    poses = np.stack([scene.look_at(np.array([0.0, 0.0, 0.2 * i]), np.array([0.0, 0.0, 0.2 * i + 1])) for i in range(40)])
    out, info = scene.plan_flythrough(poses, 120)
    assert info['orbit'] is False
    assert np.allclose(out[60][:3, 2], [0, 0, 1], atol=1e-3)
    step = np.linalg.norm(np.diff(out[:, :3, 3], axis=0), axis=1)
    assert step[0] < step[60] and step[-1] < step[60]  # ease in and out


def test_rotation_between_handles_opposite_vectors():
    R = scene._rotation_between(np.array([0, 1.0, 0]), np.array([0, -1.0, 0]))
    assert np.allclose(R @ [0, 1, 0], [0, -1, 0]) and np.isclose(np.linalg.det(R), 1)


def test_scene_radius_ignores_far_outliers():
    pts = np.random.default_rng(0).normal(0, 1, (5000, 3))
    pts[:10] = 1000
    c, r = scene.scene_radius(pts, np.zeros((3, 3)), 3.0)
    assert r < 30


# ---- PLY layout and SPZ ----

def _gaussians(n=300, deg=3, seed=0):
    rng = np.random.default_rng(seed)
    k = (deg + 1) ** 2 - 1
    return dict(means=rng.normal(0, 1, (n, 3)).astype(np.float32), scales=rng.normal(-3, 0.3, (n, 3)).astype(np.float32),
                quats=rng.normal(0, 1, (n, 4)).astype(np.float32), opacities=rng.normal(1, 1, n).astype(np.float32),
                sh0=rng.normal(0, 0.5, (n, 1, 3)).astype(np.float32), shN=rng.normal(0, 0.1, (n, k, 3)).astype(np.float32))


def test_ply_header_and_attribute_order(tmp_path):
    g = _gaussians()
    p = str(tmp_path / 'a.ply')
    size = export.write_ply(p, **g)
    n, props = export.read_ply_header(p)
    expected = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2'] + [f'f_rest_{i}' for i in range(45)] + \
               ['opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']
    assert n == 300 and props == expected
    pos, arr, _ = export.read_ply_positions(p)
    assert np.allclose(pos, g['means'])
    assert np.allclose(arr[:, 6:9], g['sh0'].reshape(-1, 3))
    # f_rest is channel-major: first 15 columns are the red coefficients
    assert np.allclose(arr[:, 9:24], g['shN'][:, :, 0])
    assert np.allclose(arr[:, 24:39], g['shN'][:, :, 1])
    assert np.allclose(np.linalg.norm(arr[:, 58:62], axis=1), 1.0, atol=1e-5)
    header_len = open(p, 'rb').read().index(b'end_header\n') + len(b'end_header\n')
    assert size == header_len + 300 * len(props) * 4


def test_ply_lower_sh_degree_has_fewer_rest_properties(tmp_path):
    p = str(tmp_path / 'b.ply')
    export.write_ply(p, **_gaussians(deg=1))
    _, props = export.read_ply_header(p)
    assert [x for x in props if x.startswith('f_rest')] == [f'f_rest_{i}' for i in range(9)]


def test_spz_round_trip_positions(tmp_path):
    pytest.importorskip('spz')
    g = _gaussians(2000)
    ply = str(tmp_path / 'a.ply')
    spz_path = str(tmp_path / 'a.spz')
    ply_bytes = export.write_ply(ply, **g)
    spz_bytes = export.write_spz(ply, spz_path)
    assert 0 < spz_bytes < ply_bytes / 3
    back = export.read_spz_positions(spz_path)
    assert back.shape == g['means'].shape
    # SPZ stores positions as 24-bit fixed point with 12 fractional bits
    assert np.abs(back - g['means']).max() < 2e-3


# ---- preview video ----

def test_preview_video_is_1080p30_h264_and_short(tmp_path):
    out = str(tmp_path / 'preview.mp4')
    rng = np.random.default_rng(0)
    base = rng.integers(0, 255, (1080, 1920, 3), dtype=np.uint8)
    video.encode_frames(out, (np.roll(base, i * 7, axis=1) for i in range(45)))
    probe = json.loads(subprocess.check_output(
        ['ffprobe', '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', out]))
    s = probe['streams'][0]
    assert (s['codec_name'], s['width'], s['height'], s['pix_fmt']) == ('h264', 1920, 1080, 'yuv420p')
    assert s['r_frame_rate'] == '30/1' and s['nb_frames'] == '45'
    assert float(probe['format']['duration']) <= video.MAX_SECONDS
    data = open(out, 'rb').read(65536)
    assert data.find(b'moov') != -1 and data.find(b'moov') < (data.find(b'mdat') if b'mdat' in data else 1 << 30)


def test_preview_length_is_capped():
    assert preview.preview_frame_count(10_000) == video.MAX_SECONDS * video.FPS
    assert preview.preview_frame_count(2) == 8 * video.FPS


def test_preview_intrinsics_centre_and_fov():
    K = preview.preview_intrinsics()
    assert K[0, 2] == 960 and K[1, 2] == 540 and abs(2 * np.degrees(np.arctan(960 / K[0, 0])) - 75) < 1e-4


# ---- GPU training on a real dataset ----

DATASET = os.environ.get('SPLAT_TRAIN_TEST_DATASET')


@pytest.mark.skipif(not DATASET, reason='set SPLAT_TRAIN_TEST_DATASET to a real COLMAP dataset (needs CUDA)')
def test_gpu_training_end_to_end(tmp_path):
    p = run_cli('--colmap', DATASET, '--out', str(tmp_path), '--iterations', '400', '--max-gaussians', '200000',
                '--preview-video')
    assert p.returncode in (0, 4), p.stderr
    if p.returncode == 0:
        t = json.loads((tmp_path / 'train.json').read_text())
        assert t['bytes_ply'] == os.path.getsize(tmp_path / 'scene.ply') and t['bytes_spz'] == os.path.getsize(tmp_path / 'scene.spz')
        assert (tmp_path / 'preview.mp4').exists() and (tmp_path / 'poster.jpg').exists()
