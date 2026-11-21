"""Dual fisheye to equirectangular stitching.

Geometry: for every output pixel the ray in the level view frame is rotated into the camera
body (per frame, by the horizon filter or a fixed basis), into each lens frame, and
projected with the lens model. The projection is evaluated on a coarse grid and upsampled
bilinearly: the maps are smooth, so a grid step of 8 pixels keeps the error below a tenth
of a pixel while making per frame cost a few percent of the warp.

Blending: each lens is weighted by 1 - smoothstep(85, 95 degrees, angle off its axis), so
the two images cross fade over the ten degrees around the seam. Exposure and white
balance of the two lenses are matched from the pixels both lenses see, with a slow moving
average so the gain does not flicker.
"""

import math

import numpy as np

from . import calibration as cal_mod

GRID_STEP = 8
FEATHER_NEAR_DEG = 85.0
FEATHER_FAR_DEG = 95.0
GAIN_SMOOTHING = 0.15
GAIN_LIMITS = (0.5, 2.0)
OVERLAP_MIN_WEIGHT = 0.05


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


class Geometry:
    """Coarse ray grid for one output size, reused for every frame."""

    def __init__(self, out_w, out_h, step=GRID_STEP):
        self.out_w, self.out_h, self.step = out_w, out_h, step
        self.cols = np.arange(-1, math.ceil(out_w / step) + 1)
        self.rows = np.arange(-1, math.ceil(out_h / step) + 1)
        x = (self.cols + 0.5) * step - 0.5
        y = (self.rows + 0.5) * step - 0.5
        lon = ((x + 0.5) / out_w * 2.0 - 1.0) * math.pi
        lat = math.pi / 2.0 - ((y + 0.5) / out_h) * math.pi
        cos_lat = np.cos(lat)[:, None]
        self.rays = np.stack(
            [cos_lat * np.sin(lon)[None, :], -np.sin(lat)[:, None] * np.ones_like(lon)[None, :], cos_lat * np.cos(lon)[None, :]],
            axis=-1,
        ).reshape(-1, 3)
        self.shape = (len(self.rows), len(self.cols))

    def coarse_maps(self, cal, frame_sizes, view_to_body, photo=False):
        """Per lens coarse (fu, fv, weight) grids for one view-to-body rotation."""
        out = []
        body_dirs = self.rays @ view_to_body.T
        for i, lens in enumerate(cal.lenses):
            d = body_dirs @ cal_mod.lens_pose(lens, i).T
            u, v, theta = cal_mod.project(lens, d)
            fw, fh = frame_sizes[i]
            fu, fv = cal_mod.to_frame(cal, i, u, v, fw, fh, photo=photo)
            deg = np.degrees(theta)
            w = (1.0 - smoothstep(FEATHER_NEAR_DEG, FEATHER_FAR_DEG, deg)) * (deg <= cal_mod.MAX_THETA_DEG)
            out.append((fu.reshape(self.shape).astype(np.float32), fv.reshape(self.shape).astype(np.float32), w.reshape(self.shape).astype(np.float32)))
        return out


class GainState:
    """Smoothed per lens, per channel gains that match the lenses in their overlap."""

    def __init__(self):
        self.gains = None

    def update(self, means):
        """means: (2, 3) mean colour of each lens over the overlap."""
        means = np.maximum(means, 1e-3)
        target = np.sqrt(means[0] * means[1])
        raw = np.clip(target[None, :] / means, *GAIN_LIMITS)
        self.gains = raw if self.gains is None else self.gains + GAIN_SMOOTHING * (raw - self.gains)
        return self.gains


def _upsample_cpu(cv2, grid, geo):
    full = cv2.resize(grid, (geo.out_w + 2 * geo.step, geo.out_h + 2 * geo.step), interpolation=cv2.INTER_LINEAR)
    return full[geo.step : geo.step + geo.out_h, geo.step : geo.step + geo.out_w]


class CpuBackend:
    name = "cpu"

    def __init__(self):
        import cv2

        self.cv2 = cv2

    def compose(self, frames, coarse, geo, gains, peak):
        cv2 = self.cv2
        warped, weights = [], []
        for img, (fu, fv, w) in zip(frames, coarse):
            mapx = _upsample_cpu(cv2, fu, geo)
            mapy = _upsample_cpu(cv2, fv, geo)
            warped.append(cv2.remap(img, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0))
            weights.append(_upsample_cpu(cv2, w, geo))
        w0, w1 = weights
        both = (w0 > OVERLAP_MIN_WEIGHT) & (w1 > OVERLAP_MIN_WEIGHT)
        if both.sum() > 1000:
            sub = both[::4, ::4]
            means = np.stack([img[::4, ::4][sub].mean(axis=0) for img in warped])
            g = gains.update(means)
        else:
            g = gains.gains if gains.gains is not None else np.ones((2, 3))
        total = np.maximum(w0 + w1, 1e-6)
        out = (warped[0].astype(np.float32) * (g[0] * (w0 / total)[..., None]) + warped[1].astype(np.float32) * (g[1] * (w1 / total)[..., None]))
        return np.clip(out + 0.5, 0, peak).astype(frames[0].dtype)


class TorchBackend:
    name = "cuda"

    def __init__(self, torch):
        self.torch = torch
        self.device = torch.device("cuda")

    def compose(self, frames, coarse, geo, gains, peak):
        torch = self.torch
        F = torch.nn.functional
        dev = self.device
        size = (geo.out_h + 2 * geo.step, geo.out_w + 2 * geo.step)

        def up(a):
            t = torch.from_numpy(a).to(dev)[None, None]
            t = F.interpolate(t, size=size, mode="bilinear", align_corners=False)
            return t[0, 0, geo.step : geo.step + geo.out_h, geo.step : geo.step + geo.out_w]

        warped, weights = [], []
        for img, (fu, fv, w) in zip(frames, coarse):
            h, wd = img.shape[:2]
            src = torch.from_numpy(img).to(dev).permute(2, 0, 1)[None].float()
            gx = (2.0 * up(fu) + 1.0) / wd - 1.0
            gy = (2.0 * up(fv) + 1.0) / h - 1.0
            grid = torch.stack([gx, gy], dim=-1)[None]
            warped.append(F.grid_sample(src, grid, mode="bilinear", padding_mode="zeros", align_corners=False)[0].permute(1, 2, 0))
            weights.append(up(w))
        w0, w1 = weights
        both = (w0 > OVERLAP_MIN_WEIGHT) & (w1 > OVERLAP_MIN_WEIGHT)
        if int(both.sum()) > 1000:
            means = np.stack([img[::4, ::4][both[::4, ::4]].mean(dim=0).cpu().numpy() for img in warped])
            g = gains.update(means)
        else:
            g = gains.gains if gains.gains is not None else np.ones((2, 3))
        g = torch.from_numpy(np.asarray(g, dtype=np.float32)).to(dev)
        total = torch.clamp(w0 + w1, min=1e-6)
        out = warped[0] * (g[0] * (w0 / total)[..., None]) + warped[1] * (g[1] * (w1 / total)[..., None])
        return torch.clamp(out + 0.5, 0, peak).to(dtype=torch.uint8 if peak <= 255 else torch.int32).cpu().numpy().astype(frames[0].dtype)


def pick_backend(prefer="auto"):
    """CUDA when PyTorch can see a GPU, otherwise NumPy and OpenCV on the CPU."""
    if prefer in ("auto", "cuda"):
        try:
            import torch

            if torch.cuda.is_available():
                return TorchBackend(torch)
        except ImportError:
            pass
        if prefer == "cuda":
            return CpuBackend()
    return CpuBackend()
