"""Load a COLMAP dataset into memory: undistorted, downscaled uint8 images, optional masks,
camera-to-world poses and the sparse points, normalised into the training frame."""
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import cv2
import numpy as np

from . import colmap_io, scene
from .errors import CorruptInput

DEFAULT_MEMORY_BUDGET = 10 * 1024 ** 3
MIN_IMAGES = 3


@dataclass
class Frame:
    name: str
    c2w: np.ndarray
    K: np.ndarray
    width: int
    height: int
    image: np.ndarray
    mask: np.ndarray = None


@dataclass
class Dataset:
    frames: list
    points: np.ndarray
    colors: np.ndarray
    holdout: list
    train: list
    transform: dict
    info: dict = field(default_factory=dict)


def _first_existing(paths):
    for p in paths:
        if os.path.isfile(p):
            return p
    return None


def _image_path(root, name):
    return _first_existing([os.path.join(root, 'images', name)])


def _mask_path(root, name):
    stem = os.path.splitext(name)[0]
    return _first_existing([
        os.path.join(root, 'masks', name + '.png'),
        os.path.join(root, 'masks', stem + '.png'),
        os.path.join(root, 'masks', name),
    ])


class _Undistorter:
    """Per-camera, per-size remap that removes lens distortion and crops to the valid area."""

    def __init__(self):
        self.cache = {}
        self.lock = threading.Lock()

    def get(self, cam_id, K, dist, w, h):
        key = (cam_id, w, h)
        with self.lock:
            return self._get(key, K, dist, w, h)

    def _get(self, key, K, dist, w, h):
        if key not in self.cache:
            if not np.any(dist):
                self.cache[key] = None
            else:
                newK, roi = cv2.getOptimalNewCameraMatrix(K, dist, (w, h), 0, (w, h))
                map1, map2 = cv2.initUndistortRectifyMap(K, dist, None, newK, (w, h), cv2.CV_16SC2)
                x, y, rw, rh = roi
                if rw < 16 or rh < 16:
                    x, y, rw, rh = 0, 0, w, h
                K2 = newK.copy()
                K2[0, 2] -= x
                K2[1, 2] -= y
                self.cache[key] = (map1, map2, (x, y, rw, rh), K2)
        return self.cache[key]


def _fit_budget(sizes, max_side, budget):
    """Largest side <= max_side such that all decoded images fit in `budget` bytes."""
    def total(side):
        t = 0
        for w, h in sizes:
            s = min(1.0, side / max(w, h))
            t += int(w * s) * int(h * s) * 3
        return t
    side = max_side
    while side > 256 and total(side) > budget:
        side = int(side * 0.9)
    return side


def load_dataset(colmap_dir, max_side=1600, holdout_every=8, align_up=True,
                 memory_budget=DEFAULT_MEMORY_BUDGET, workers=8):
    cams, imgs, xyz, rgb = colmap_io.read_model(colmap_dir)
    entries = sorted(imgs.values(), key=lambda i: i.name)
    if len(entries) < MIN_IMAGES:
        raise CorruptInput(f'Only {len(entries)} images are registered in the reconstruction; at least {MIN_IMAGES} are needed.', 'too_few_images')
    missing = [e.name for e in entries if _image_path(colmap_dir, e.name) is None]
    if missing:
        raise CorruptInput(f'{len(missing)} images listed in the reconstruction are missing from the images folder (first: {missing[0]}).', 'missing_images')
    for e in entries:
        if e.camera_id not in cams:
            raise CorruptInput('The reconstruction refers to a camera that is not defined.', 'unreadable_colmap_model')

    side = _fit_budget([(cams[e.camera_id].width, cams[e.camera_id].height) for e in entries], max_side, memory_budget)
    undist = _Undistorter()
    # intrinsics are resolved first so unsupported camera models fail before any decoding
    intr = {cid: c.intrinsics() for cid, c in cams.items() if any(e.camera_id == cid for e in entries)}

    def load(entry):
        cam = cams[entry.camera_id]
        K, dist = intr[entry.camera_id]
        img = cv2.imread(_image_path(colmap_dir, entry.name), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if img is None:
            raise CorruptInput(f'The image {entry.name} could not be decoded.', 'unreadable_image')
        h0, w0 = img.shape[:2]
        scale = min(1.0, side / max(w0, h0))
        w, h = max(1, int(round(w0 * scale))), max(1, int(round(h0 * scale)))
        sx, sy = w / cam.width, h / cam.height
        Ks = K.copy()
        Ks[0, :] *= sx
        Ks[1, :] *= sy
        if (w, h) != (w0, h0):
            img = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
        mpath = _mask_path(colmap_dir, entry.name)
        mask = None
        if mpath:
            m = cv2.imread(mpath, cv2.IMREAD_GRAYSCALE)
            if m is None:
                raise CorruptInput(f'The mask for {entry.name} could not be decoded.', 'unreadable_image')
            mask = cv2.resize(m, (w, h), interpolation=cv2.INTER_NEAREST)
        u = undist.get(entry.camera_id, Ks, dist, w, h)
        if u is not None:
            map1, map2, (x, y, rw, rh), Ks = u
            img = cv2.remap(img, map1, map2, cv2.INTER_LINEAR)[y:y + rh, x:x + rw]
            if mask is not None:
                mask = cv2.remap(mask, map1, map2, cv2.INTER_NEAREST)[y:y + rh, x:x + rw]
            h, w = img.shape[:2]
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        return img, (mask > 127) if mask is not None else None, Ks, w, h

    with ThreadPoolExecutor(max_workers=workers) as pool:
        loaded = list(pool.map(load, entries))

    w2c = np.stack([e.w2c() for e in entries])
    c2w = np.linalg.inv(w2c)
    finite = np.isfinite(xyz).all(axis=1) if len(xyz) else np.zeros(0, bool)
    xyz, rgb = xyz[finite], rgb[finite]
    c2w_n, pts_n, transform = scene.normalise_scene(c2w, xyz, align_up=align_up)
    if c2w_n is None:
        raise CorruptInput('All cameras sit at the same spot, so there is no parallax to reconstruct from.', 'degenerate_poses')
    frames = [Frame(e.name, c2w_n[i], loaded[i][2], loaded[i][3], loaded[i][4], loaded[i][0], loaded[i][1])
              for i, e in enumerate(entries)]
    hold = scene.holdout_indices(len(frames), holdout_every)
    hs = set(hold)
    train = [i for i in range(len(frames)) if i not in hs]
    info = {'images': len(frames), 'image_side': side, 'points3d': int(len(pts_n)),
            'masked_images': sum(1 for f in frames if f.mask is not None)}
    return Dataset(frames, pts_n, rgb, hold, train, transform, info)
