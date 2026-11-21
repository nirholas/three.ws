"""One photo to one result directory: depth.exr, scene.glb, scene.ply and stats."""

from __future__ import annotations

import os

os.environ.setdefault("OPENCV_IO_ENABLE_OPENEXR", "1")

import time
from pathlib import Path
from typing import Callable, Optional

import cv2
import numpy as np

import shell_mesh
import pano_depth
from pano_io import Photo, decode_photo, encode_texture

MODEL_ID = pano_depth.MODEL_ID
MODEL_LICENSE = pano_depth.MODEL_LICENSE
DEFAULT_MAX_POINTS = 2_000_000
DEFAULT_MAX_FACES = 1_500_000
MAX_POINTS_CAP = 8_000_000
MAX_FACES_CAP = 4_000_000


def write_depth_exr(path: Path, distance: np.ndarray, valid: np.ndarray) -> None:
    """Float32 metres; pixels the model rejected are 0."""
    out = np.where(valid, distance, 0.0).astype(np.float32)
    if not cv2.imwrite(str(path), out, [cv2.IMWRITE_EXR_TYPE, cv2.IMWRITE_EXR_TYPE_FLOAT]):
        raise RuntimeError("could not write depth.exr")


def run(
    image_bytes: bytes,
    out_dir: Path,
    model,
    max_points: int = DEFAULT_MAX_POINTS,
    mesh: bool = True,
    max_faces: int = DEFAULT_MAX_FACES,
    progress: Optional[Callable[[float, str], None]] = None,
) -> dict:
    """Process one equirect photo. Returns the stats dict the API reports."""

    def tick(p: float, stage: str) -> None:
        if progress:
            progress(p, stage)

    out_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    tick(0.05, "decode")
    photo: Photo = decode_photo(image_bytes)

    tick(0.1, "depth")
    result = pano_depth.estimate(model, photo.rgb, progress=lambda p: tick(0.1 + 0.5 * p, "depth"))
    distance, valid = result.distance, result.valid
    t_depth = result.timings["split_s"] + result.timings["infer_s"] + result.timings["merge_s"]
    if not valid.any():
        raise ValueError("The model found no usable depth in this image.")
    tick(0.6, "export")

    wh, ww = distance.shape
    write_depth_exr(out_dir / "depth.exr", distance, valid)
    n_points = shell_mesh.write_point_ply(str(out_dir / "scene.ply"), distance, valid, result.image, max_points)

    faces = 0
    t = time.time()
    shell = None
    if mesh:
        shell = shell_mesh.build_shell(distance, valid, max_faces=max_faces)
        jpg, tex_w, tex_h = encode_texture(photo.rgb)
        shell_mesh.write_glb(str(out_dir / "scene.glb"), shell, jpg, {
            "model": MODEL_ID, "units": "metres", "frame": "+Y up, -Z forward, camera at origin",
        })
        faces = int(len(shell.indices))
    t_mesh = time.time() - t

    tick(0.95, "upload")
    return {
        "width": photo.width,
        "height": photo.height,
        "depth_width": ww,
        "depth_height": wh,
        "median_depth_m": round(float(np.median(distance[valid])), 3),
        "points": n_points,
        "faces": faces,
        "model": MODEL_ID,
        "license": MODEL_LICENSE,
        "camera_model": " ".join(x for x in (photo.camera_make, photo.camera_model) if x) or None,
        "split_width": result.split_width,
        "metric_scale_factor": round(float(np.exp(result.scale_log_offset)), 4),
        "valid_fraction": round(float(valid.mean()), 4),
        "sky_fill_radius_m": None if shell is None or shell.dome_radius is None else round(shell.dome_radius, 1),
        "mesh_grid": None if shell is None else list(shell.grid),
        "culled_faces": 0 if shell is None else shell.culled_faces,
        "edge_ratio": shell_mesh.EDGE_RATIO,
        "depth_jump": shell_mesh.DEPTH_JUMP,
        "seconds": {"depth": round(t_depth, 2), **{k: round(v, 2) for k, v in result.timings.items()}, "mesh": round(t_mesh, 2), "total": round(time.time() - t0, 2)},
    }
