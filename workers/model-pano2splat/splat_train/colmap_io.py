"""Reader for COLMAP sparse models (binary and text), numpy only.

Binary layout reference: https://colmap.github.io/format.html#binary-file-format
"""
import os
import struct
from dataclasses import dataclass

import numpy as np

from .errors import CorruptInput, UnsupportedInput

# model id -> (name, parameter count)
CAMERA_MODELS = {
    0: ('SIMPLE_PINHOLE', 3),
    1: ('PINHOLE', 4),
    2: ('SIMPLE_RADIAL', 4),
    3: ('RADIAL', 5),
    4: ('OPENCV', 8),
    5: ('OPENCV_FISHEYE', 8),
    6: ('FULL_OPENCV', 12),
    7: ('FOV', 5),
    8: ('SIMPLE_RADIAL_FISHEYE', 4),
    9: ('RADIAL_FISHEYE', 5),
    10: ('THIN_PRISM_FISHEYE', 12),
}
MODEL_IDS = {name: (mid, n) for mid, (name, n) in CAMERA_MODELS.items()}
SUPPORTED_MODELS = ('SIMPLE_PINHOLE', 'PINHOLE', 'SIMPLE_RADIAL', 'RADIAL', 'OPENCV')


@dataclass
class Camera:
    id: int
    model: str
    width: int
    height: int
    params: np.ndarray

    def intrinsics(self):
        """Return (K 3x3, dist coefficients in OpenCV order k1,k2,p1,p2)."""
        p = self.params
        m = self.model
        if m == 'SIMPLE_PINHOLE':
            fx = fy = p[0]; cx, cy = p[1], p[2]; dist = [0, 0, 0, 0]
        elif m == 'PINHOLE':
            fx, fy, cx, cy = p[:4]; dist = [0, 0, 0, 0]
        elif m == 'SIMPLE_RADIAL':
            fx = fy = p[0]; cx, cy = p[1], p[2]; dist = [p[3], 0, 0, 0]
        elif m == 'RADIAL':
            fx = fy = p[0]; cx, cy = p[1], p[2]; dist = [p[3], p[4], 0, 0]
        elif m == 'OPENCV':
            fx, fy, cx, cy = p[:4]; dist = [p[4], p[5], p[6], p[7]]
        else:
            raise UnsupportedInput(
                f'The reconstruction uses the {m} camera model, which this stage cannot train from. '
                'Re-run the reconstruction with perspective views (PINHOLE or OPENCV).',
                'unsupported_camera_model')
        K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], dtype=np.float64)
        return K, np.array(dist, dtype=np.float64)


@dataclass
class ColmapImage:
    id: int
    camera_id: int
    name: str
    qvec: np.ndarray  # w x y z, world to camera
    tvec: np.ndarray

    def w2c(self):
        w, x, y, z = self.qvec / np.linalg.norm(self.qvec)
        R = np.array([
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ])
        M = np.eye(4)
        M[:3, :3] = R
        M[:3, 3] = self.tvec
        return M


def _read(f, fmt):
    size = struct.calcsize('<' + fmt)
    buf = f.read(size)
    if len(buf) != size:
        raise CorruptInput('A COLMAP model file ends early, so the reconstruction is incomplete.', 'truncated_colmap_model')
    return struct.unpack('<' + fmt, buf)


def read_cameras_bin(path):
    cams = {}
    with open(path, 'rb') as f:
        (n,) = _read(f, 'Q')
        for _ in range(n):
            cid, mid, w, h = _read(f, 'iiQQ')
            if mid not in CAMERA_MODELS:
                raise UnsupportedInput(f'The reconstruction uses camera model id {mid}, which this stage does not know.', 'unsupported_camera_model')
            name, np_ = CAMERA_MODELS[mid]
            params = np.array(_read(f, 'd' * np_), dtype=np.float64)
            cams[cid] = Camera(cid, name, int(w), int(h), params)
    return cams


def read_images_bin(path):
    images = {}
    with open(path, 'rb') as f:
        (n,) = _read(f, 'Q')
        for _ in range(n):
            iid, qw, qx, qy, qz, tx, ty, tz, cid = _read(f, 'idddddddi')
            chars = bytearray()
            while True:
                c = f.read(1)
                if not c:
                    raise CorruptInput('A COLMAP model file ends early, so the reconstruction is incomplete.', 'truncated_colmap_model')
                if c == b'\x00':
                    break
                chars += c
            (n2d,) = _read(f, 'Q')
            f.seek(24 * n2d, 1)
            images[iid] = ColmapImage(iid, cid, chars.decode('utf-8'), np.array([qw, qx, qy, qz]), np.array([tx, ty, tz]))
    return images


def read_points3d_bin(path):
    with open(path, 'rb') as f:
        (n,) = _read(f, 'Q')
        xyz = np.zeros((n, 3), dtype=np.float64)
        rgb = np.zeros((n, 3), dtype=np.uint8)
        for i in range(n):
            _pid, x, y, z, r, g, b, _err, tl = _read(f, 'QdddBBBdQ')
            f.seek(8 * tl, 1)
            xyz[i] = (x, y, z)
            rgb[i] = (r, g, b)
    return xyz, rgb


def read_cameras_txt(path):
    cams = {}
    for line in _text_lines(path):
        t = line.split()
        name = t[1]
        if name not in MODEL_IDS:
            raise UnsupportedInput(f'The reconstruction uses camera model {name}, which this stage does not know.', 'unsupported_camera_model')
        cams[int(t[0])] = Camera(int(t[0]), name, int(t[2]), int(t[3]), np.array([float(v) for v in t[4:]]))
    return cams


def read_points3d_txt(path):
    xyz, rgb = [], []
    for line in _text_lines(path):
        t = line.split()
        xyz.append([float(v) for v in t[1:4]])
        rgb.append([int(v) for v in t[4:7]])
    return np.array(xyz, dtype=np.float64).reshape(-1, 3), np.array(rgb, dtype=np.uint8).reshape(-1, 3)


def _text_lines(path):
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            s = line.strip()
            if s and not s.startswith('#'):
                yield s


def _text_lines_keep_blank(path):
    with open(path, 'r', encoding='utf-8') as f:
        return [l.rstrip('\n') for l in f if not l.startswith('#')]


def find_model_dir(colmap_dir):
    for cand in ('sparse/0', 'sparse', '.'):
        d = os.path.join(colmap_dir, cand)
        if os.path.exists(os.path.join(d, 'cameras.bin')) or os.path.exists(os.path.join(d, 'cameras.txt')):
            return d
    raise CorruptInput(
        'No COLMAP reconstruction was found (expected sparse/0/cameras.bin, images.bin and points3D.bin).',
        'missing_colmap_model')


def read_model(colmap_dir):
    """Return (cameras, images, points xyz, points rgb) of the COLMAP model under colmap_dir."""
    d = find_model_dir(colmap_dir)
    try:
        if os.path.exists(os.path.join(d, 'cameras.bin')):
            cams = read_cameras_bin(os.path.join(d, 'cameras.bin'))
            imgs = read_images_bin(os.path.join(d, 'images.bin'))
            p3 = os.path.join(d, 'points3D.bin')
            xyz, rgb = read_points3d_bin(p3) if os.path.exists(p3) else (np.zeros((0, 3)), np.zeros((0, 3), np.uint8))
        else:
            cams = read_cameras_txt(os.path.join(d, 'cameras.txt'))
            lines = _text_lines_keep_blank(os.path.join(d, 'images.txt'))
            imgs = {}
            for line in lines[0::2]:
                t = line.split()
                if len(t) < 10:
                    continue
                imgs[int(t[0])] = ColmapImage(int(t[0]), int(t[8]), t[9],
                                              np.array([float(v) for v in t[1:5]]), np.array([float(v) for v in t[5:8]]))
            p3 = os.path.join(d, 'points3D.txt')
            xyz, rgb = read_points3d_txt(p3) if os.path.exists(p3) else (np.zeros((0, 3)), np.zeros((0, 3), np.uint8))
    except (struct.error, ValueError, IndexError, OSError) as e:
        raise CorruptInput('The COLMAP reconstruction files could not be read, they look damaged.', 'unreadable_colmap_model') from e
    return cams, imgs, xyz, rgb
