"""Masks that keep the camera operator, the selfie stick and the sky out of feature extraction and training.

All masks are computed once per frame on a low-resolution equirect (1024 by 512) and then resampled into
each rig view through the same ray maps used to render the views, so a mask can never disagree with its view.

Person segmentation: torchvision DeepLabV3 (MobileNetV3-Large, COCO subset with the VOC labels, torchvision is
BSD-3-Clause). It runs on the lower-hemisphere views where the operator always is, not on the whole sphere.
Sky: a classical, dependency-free detector (bright, flat, blue-or-white regions connected to the zenith band).
"""

import threading
from dataclasses import dataclass

import cv2
import numpy as np

from .geometry import ViewCamera, cam_from_pano_rotation, pano_ray

LOW_W, LOW_H = 1024, 512
PERSON_CLASS = 15
STICK_RADIUS_DEG = 14.0
SEG_VIEW = 384
SEG_VIEW_FOV_DEG = 100.0
LOWER_VIEWS = [(0.0, -90.0)] + [(90.0 * k, -45.0) for k in range(4)]
SKY_FLAT_STD = 9.0
SKY_MIN_BRIGHTNESS = 120
SEED_ROWS_FRAC = 0.12

_seg_lock = threading.Lock()


class PersonSegmenter:
    """Lazy-loaded DeepLabV3-MobileNetV3 person segmenter."""

    def __init__(self, device: str | None = None):
        import torch
        from torchvision.models.segmentation import DeepLabV3_MobileNet_V3_Large_Weights, deeplabv3_mobilenet_v3_large

        self._torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        weights = DeepLabV3_MobileNet_V3_Large_Weights.DEFAULT
        self.model = deeplabv3_mobilenet_v3_large(weights=weights).eval().to(self.device)
        self.mean = torch.tensor([0.485, 0.456, 0.406], device=self.device).view(1, 3, 1, 1)
        self.std = torch.tensor([0.229, 0.224, 0.225], device=self.device).view(1, 3, 1, 1)
        self.license = "torchvision DeepLabV3-MobileNetV3-Large (BSD-3-Clause code, COCO-subset weights)"

    def person_masks(self, images_bgr: list[np.ndarray]) -> list[np.ndarray]:
        torch = self._torch
        batch = np.stack([cv2.cvtColor(i, cv2.COLOR_BGR2RGB) for i in images_bgr])
        tensor = torch.from_numpy(batch).permute(0, 3, 1, 2).float().div(255.0).to(self.device)
        tensor = (tensor - self.mean) / self.std
        with _seg_lock, torch.no_grad():
            logits = self.model(tensor)["out"]
        labels = logits.argmax(1).cpu().numpy()
        return [(l == PERSON_CLASS) for l in labels]


def _lower_view_cameras() -> list[ViewCamera]:
    cams = []
    for i, (yaw, pitch) in enumerate(LOWER_VIEWS):
        cams.append(ViewCamera(i, yaw, pitch, SEG_VIEW, cam_from_pano_rotation(yaw, pitch)))
    return cams


def _wide_focal(size: int) -> float:
    return (size / 2.0) / np.tan(np.deg2rad(SEG_VIEW_FOV_DEG) / 2.0)


def _low_res_rays() -> np.ndarray:
    xs = (np.arange(LOW_W) + 0.5) / LOW_W
    ys = (np.arange(LOW_H) + 0.5) / LOW_H
    u, v = np.meshgrid(xs, ys)
    return pano_ray(u, v)


_LOW_RAYS = _low_res_rays()


def _stick_cap() -> np.ndarray:
    """Pixels within STICK_RADIUS_DEG of the nadir, where the pole and the operator's hands always are."""
    cos_limit = np.cos(np.deg2rad(STICK_RADIUS_DEG))
    return (-_LOW_RAYS[..., 1]) < -cos_limit


class OperatorMasker:
    """Produces a low-res equirect boolean mask (True = operator or stick) for each frame."""

    def __init__(self, segmenter: PersonSegmenter):
        self.segmenter = segmenter
        self.cams = []
        for i, (yaw, pitch) in enumerate(LOWER_VIEWS):
            rot = cam_from_pano_rotation(yaw, pitch)
            self.cams.append((rot, i))
        self.stick = _stick_cap()
        focal = _wide_focal(SEG_VIEW)
        coords = np.arange(SEG_VIEW, dtype=np.float64) + 0.5
        x, y = np.meshgrid(coords, coords)
        rays = np.stack([(x - SEG_VIEW / 2) / focal, (y - SEG_VIEW / 2) / focal, np.ones_like(x)], axis=-1)
        rays /= np.linalg.norm(rays, axis=-1, keepdims=True)
        self.view_rays = rays
        self.focal = focal
        self.maps = []
        for rot, _ in self.cams:
            uv = _spherical(self.view_rays @ rot)
            self.maps.append(((uv[..., 0] * LOW_W - 0.5).astype(np.float32), (uv[..., 1] * LOW_H - 0.5).astype(np.float32)))
        self.cam_lookup = []
        for rot, _ in self.cams:
            rays_cam = _LOW_RAYS @ rot.T
            z = rays_cam[..., 2]
            safe = np.where(z > 1e-6, z, 1.0)
            px = rays_cam[..., 0] / safe * focal + SEG_VIEW / 2
            py = rays_cam[..., 1] / safe * focal + SEG_VIEW / 2
            inside = (z > 1e-6) & (px >= 0) & (px < SEG_VIEW) & (py >= 0) & (py < SEG_VIEW)
            self.cam_lookup.append((px.astype(np.float32), py.astype(np.float32), inside))

    def operator_mask(self, low_bgr: np.ndarray) -> np.ndarray:
        images = [cv2.remap(low_bgr, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP) for mx, my in self.maps]
        persons = self.segmenter.person_masks(images)
        out = self.stick.copy()
        for person, (px, py, inside) in zip(persons, self.cam_lookup):
            sampled = cv2.remap(person.astype(np.uint8) * 255, px, py, cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
            out |= (sampled > 127) & inside
        out &= _LOW_RAYS[..., 1] > -0.17
        out |= self.stick
        return cv2.dilate(out.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) > 0


def _spherical(rays: np.ndarray) -> np.ndarray:
    from .geometry import spherical_uv

    return spherical_uv(rays)


def sky_mask(low_bgr: np.ndarray) -> np.ndarray:
    """True where the pixel is sky: flat, bright, blue or white, and connected to the zenith band."""
    gray = cv2.cvtColor(low_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    mean = cv2.blur(gray, (7, 7))
    sq = cv2.blur(gray * gray, (7, 7))
    std = np.sqrt(np.maximum(sq - mean * mean, 0.0))
    b, g, r = [low_bgr[..., i].astype(np.int16) for i in range(3)]
    bluish = (b >= r) & (b >= g - 12)
    white = (np.minimum(np.minimum(b, g), r) > 170)
    candidate = (std < SKY_FLAT_STD) & (mean > SKY_MIN_BRIGHTNESS) & (bluish | white)
    candidate = cv2.morphologyEx(candidate.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, labels = cv2.connectedComponents(candidate, connectivity=8)
    if count <= 1:
        return np.zeros(gray.shape, dtype=bool)
    seed_rows = max(1, int(LOW_H * SEED_ROWS_FRAC))
    touching = np.unique(labels[:seed_rows][candidate[:seed_rows] > 0])
    sky = np.isin(labels, touching[touching > 0])
    sky = cv2.dilate(sky.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))) > 0
    return sky


@dataclass
class FrameMasks:
    """Low-res equirect masks for one frame, True = exclude."""

    exclude: np.ndarray | None


def view_keep_mask(exclude_low: np.ndarray | None, uv: np.ndarray, size: int) -> np.ndarray | None:
    """Resample a low-res exclusion mask into one view. Returns uint8 0/255 (255 = keep) or None when nothing is excluded."""
    if exclude_low is None or not exclude_low.any():
        return None
    map_x = (uv[..., 0] * LOW_W - 0.5).astype(np.float32)
    map_y = (uv[..., 1] * LOW_H - 0.5).astype(np.float32)
    sampled = cv2.remap(exclude_low.astype(np.uint8) * 255, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    return np.where(sampled > 127, 0, 255).astype(np.uint8)
