"""Equirectangular 360 photo -> metric distance map, with MoGe-2.

MoGe-2 is a perspective model, so the panorama is split into the 20 views of an
icosahedron (90 degree field of view each, the layout MoGe's own panorama
script uses), every view is inferred on its own, and the per-view distance maps
are fused back onto the sphere with MoGe's multi-scale Poisson merge.

The merge solves for the gradients and Laplacian of log distance only, which
fixes the shape of the panorama but leaves one global scale free. MoGe-2's
per-view output is metric, so the scale is recovered afterwards: the robust
median of (per-view log distance minus merged log distance) over every pixel a
view sees and marks valid is the log of the missing factor.
"""

from __future__ import annotations

import os

os.environ.setdefault("OPENCV_IO_ENABLE_OPENEXR", "1")

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import cv2
import numpy as np

try:
    import utils3d_moge as utils3d
except ImportError:  # pragma: no cover - upstream renamed the package once already
    import utils3d

from moge.utils.panorama import get_panorama_cameras, merge_panorama_depth, split_panorama_image

MODEL_ID = "Ruicheng/moge-2-vitl-normal"
MODEL_LICENSE = "MIT"

# The panorama is resampled to this width before it is split; 4096 px across
# 360 degrees is ~11 px per degree, which is more than a 90 degree view at
# VIEW_RESOLUTION samples (768 / 90 = 8.5 px per degree), so splitting never
# upsamples.
SPLIT_WIDTH = int(os.environ.get("PANODEPTH_SPLIT_WIDTH", "4096"))
# Per-view resolution fed to MoGe-2. The model rescales internally to its token
# budget (resolution_level 9 = 3600 tokens = ~840 px square for ViT-L/14), so
# 768 keeps every view at roughly the model's native density.
VIEW_RESOLUTION = int(os.environ.get("PANODEPTH_VIEW_RESOLUTION", "768"))
# Resolution of the merged distance map (and of depth.exr). MoGe's panorama
# script merges at 1920x960; the Poisson solve grows superlinearly past that.
MERGE_WIDTH = int(os.environ.get("PANODEPTH_MERGE_WIDTH", "1920"))
BATCH_SIZE = int(os.environ.get("PANODEPTH_BATCH_SIZE", "4"))
RESOLUTION_LEVEL = 9


@dataclass
class DepthResult:
    distance: np.ndarray  # (H, W) float32 metres along the view ray; 0 where invalid
    valid: np.ndarray  # (H, W) bool, MoGe-2's validity mask (False on sky and unknown)
    image: np.ndarray  # (H, W, 3) uint8 RGB, the panorama at the merge resolution
    split_width: int
    view_resolution: int
    scale_log_offset: float
    timings: dict = field(default_factory=dict)

    @property
    def width(self) -> int:
        return int(self.distance.shape[1])

    @property
    def height(self) -> int:
        return int(self.distance.shape[0])


def load_model(weights_path: str | Path, device: str):
    import torch
    from moge.model.v2 import MoGeModel

    model = MoGeModel.from_pretrained(str(weights_path)).to(torch.device(device)).eval()
    if device.startswith("cuda"):
        model.half()
    return model


def _resize_equirect(image: np.ndarray, width: int) -> np.ndarray:
    if image.shape[1] == width:
        return image
    interp = cv2.INTER_AREA if image.shape[1] > width else cv2.INTER_CUBIC
    return cv2.resize(image, (width, width // 2), interpolation=interp)


def _infer_views(model, views: list[np.ndarray], intrinsics: list[np.ndarray], progress: Callable[[float], None]):
    import torch

    device = model.device
    use_fp16 = device.type == "cuda"
    fov_x_deg = np.rad2deg(utils3d.np.intrinsics_to_fov(np.asarray(intrinsics))[0])
    distances, masks = [], []
    with torch.inference_mode():
        for start in range(0, len(views), BATCH_SIZE):
            batch = np.stack(views[start:start + BATCH_SIZE])
            tensor = torch.from_numpy(batch).to(device).permute(0, 3, 1, 2).float().div_(255.0)
            fov = torch.as_tensor(fov_x_deg[start:start + BATCH_SIZE], dtype=torch.float32, device=device)
            out = model.infer(
                tensor,
                resolution_level=RESOLUTION_LEVEL,
                fov_x=fov,
                apply_mask=False,
                use_fp16=use_fp16,
            )
            distances.extend(out["points"].float().norm(dim=-1).cpu().numpy())
            masks.extend(out["mask"].cpu().numpy().astype(bool))
            progress(min(1.0, (start + len(batch)) / len(views)))
    return distances, masks


def _metric_log_offset(
    merged: np.ndarray,
    merged_valid: np.ndarray,
    distances: list[np.ndarray],
    masks: list[np.ndarray],
    extrinsics: np.ndarray,
    intrinsics: list[np.ndarray],
) -> float:
    """log(scale) that maps the merged map back onto the metric per-view maps."""
    from moge.utils.panorama import spherical_uv_to_directions

    height, width = merged.shape
    directions = spherical_uv_to_directions(utils3d.np.uv_map(height, width))
    log_merged = np.log(np.clip(merged, 1e-6, None))
    diffs = []
    for i, dist in enumerate(distances):
        uv, depth = utils3d.np.project_cv(directions, extrinsics=extrinsics[i], intrinsics=intrinsics[i])
        inside = (depth > 0) & (uv > 0).all(axis=-1) & (uv < 1).all(axis=-1)
        pix = utils3d.np.uv_to_pixel(np.clip(uv, 0, 1), dist.shape).astype(np.float32)
        view_valid = cv2.remap(masks[i].astype(np.uint8), pix[..., 0], pix[..., 1], cv2.INTER_NEAREST) > 0
        log_view = cv2.remap(np.log(np.clip(dist, 1e-6, None)).astype(np.float32), pix[..., 0], pix[..., 1], cv2.INTER_LINEAR)
        sel = inside & view_valid & merged_valid
        if sel.any():
            diffs.append((log_view - log_merged)[sel])
    if not diffs:
        raise ValueError("no view produced valid depth")
    return float(np.median(np.concatenate(diffs)))


def estimate(model, image: np.ndarray, progress: Optional[Callable[[float], None]] = None) -> DepthResult:
    """Run the full split, infer, merge, rescale chain on one RGB equirect."""
    report = progress or (lambda _p: None)
    timings: dict[str, float] = {}

    t = time.perf_counter()
    split_src = _resize_equirect(image, SPLIT_WIDTH)
    extrinsics, intrinsics = get_panorama_cameras()
    views = split_panorama_image(split_src, extrinsics, intrinsics, VIEW_RESOLUTION)
    timings["split_s"] = time.perf_counter() - t

    t = time.perf_counter()
    distances, masks = _infer_views(model, views, intrinsics, lambda p: report(0.7 * p))
    timings["infer_s"] = time.perf_counter() - t

    t = time.perf_counter()
    merge_w = min(MERGE_WIDTH, split_src.shape[1])
    merged, merged_valid = merge_panorama_depth(merge_w, merge_w // 2, distances, masks, extrinsics, intrinsics)
    offset = _metric_log_offset(merged, merged_valid, distances, masks, extrinsics, intrinsics)
    distance = (merged * np.exp(offset)).astype(np.float32)
    distance[~merged_valid] = 0.0
    timings["merge_s"] = time.perf_counter() - t
    report(0.85)

    return DepthResult(
        distance=distance,
        valid=merged_valid,
        image=_resize_equirect(image, merge_w),
        split_width=int(split_src.shape[1]),
        view_resolution=VIEW_RESOLUTION,
        scale_log_offset=offset,
        timings=timings,
    )
