"""Rig geometry: how one equirect frame splits into N perspective views that share a centre.

Conventions match COLMAP's own panorama_sfm (pycolmap 4.2): the panorama frame has x right, y down,
z forward at the centre pixel; yaw grows to the right and pitch grows upward, so pixel (x, y) in a
W by H frame is yaw = (x / W - 0.5) * 360 and pitch = (0.5 - y / H) * 180.
"""

from dataclasses import dataclass

import numpy as np

VIEW_FOV_DEG = 90.0
VALID_VIEW_COUNTS = (8, 12, 14)


def view_layout(views: int) -> list[tuple[float, float]]:
    """(yaw_deg, pitch_deg) of each view. 8 around the horizon, 12 adds 4 tilted up, 14 adds zenith and nadir."""
    if views not in VALID_VIEW_COUNTS:
        raise ValueError(f"views must be one of {VALID_VIEW_COUNTS}")
    layout = [(45.0 * k, 0.0) for k in range(8)]
    if views >= 12:
        layout += [(45.0 + 90.0 * k, 45.0) for k in range(4)]
    if views == 14:
        layout += [(0.0, 90.0), (0.0, -90.0)]
    return layout


def cam_from_pano_rotation(yaw_deg: float, pitch_deg: float) -> np.ndarray:
    """3x3 rotation taking panorama-frame vectors into the view's camera frame."""
    pitch, yaw = np.deg2rad(-pitch_deg), np.deg2rad(-yaw_deg)
    cp, sp = np.cos(pitch), np.sin(pitch)
    cy, sy = np.cos(yaw), np.sin(yaw)
    rot_x = np.array([[1.0, 0.0, 0.0], [0.0, cp, -sp], [0.0, sp, cp]])
    rot_y = np.array([[cy, 0.0, sy], [0.0, 1.0, 0.0], [-sy, 0.0, cy]])
    return rot_x @ rot_y


def spherical_uv(rays_pano: np.ndarray) -> np.ndarray:
    """Normalised equirect coordinates (u, v in 0..1) of unit rays in the panorama frame."""
    yaw = np.arctan2(rays_pano[..., 0], rays_pano[..., 2])
    pitch = -np.arctan2(rays_pano[..., 1], np.hypot(rays_pano[..., 0], rays_pano[..., 2]))
    u = (1.0 + yaw / np.pi) / 2.0
    v = (1.0 - pitch * 2.0 / np.pi) / 2.0
    return np.stack([u, v], axis=-1)


def pano_ray(u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Unit rays in the panorama frame for normalised equirect coordinates (inverse of spherical_uv)."""
    yaw = (u * 2.0 - 1.0) * np.pi
    pitch = (1.0 - 2.0 * v) * np.pi / 2.0
    cp = np.cos(pitch)
    return np.stack([cp * np.sin(yaw), -np.sin(pitch), cp * np.cos(yaw)], axis=-1)


@dataclass(frozen=True)
class ViewCamera:
    """One virtual pinhole camera of the rig."""

    index: int
    yaw_deg: float
    pitch_deg: float
    size: int
    cam_from_pano: np.ndarray

    @property
    def focal(self) -> float:
        return (self.size / 2.0) / np.tan(np.deg2rad(VIEW_FOV_DEG) / 2.0)

    @property
    def principal(self) -> float:
        return self.size / 2.0

    @property
    def center_in_pano(self) -> np.ndarray:
        return self.cam_from_pano.T @ np.array([0.0, 0.0, 1.0])

    def rays_in_cam(self) -> np.ndarray:
        """Unit rays through every pixel centre, shape (size, size, 3), row-major (y, x)."""
        coords = np.arange(self.size, dtype=np.float64) + 0.5
        x, y = np.meshgrid(coords, coords)
        rays = np.stack([(x - self.principal) / self.focal, (y - self.principal) / self.focal, np.ones_like(x)], axis=-1)
        return rays / np.linalg.norm(rays, axis=-1, keepdims=True)

    def pano_uv_map(self) -> np.ndarray:
        """For every view pixel, the normalised equirect coordinate it samples, shape (size, size, 2)."""
        rays_pano = self.rays_in_cam() @ self.cam_from_pano
        return spherical_uv(rays_pano).astype(np.float32)

    def project_pano_rays(self, rays_pano: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Project panorama-frame rays into this view. Returns (xy pixels, in_front_and_inside mask)."""
        rays_cam = rays_pano @ self.cam_from_pano.T
        z = rays_cam[..., 2]
        safe_z = np.where(z > 1e-6, z, 1.0)
        x = rays_cam[..., 0] / safe_z * self.focal + self.principal
        y = rays_cam[..., 1] / safe_z * self.focal + self.principal
        inside = (z > 1e-6) & (x >= 0) & (x < self.size) & (y >= 0) & (y < self.size)
        return np.stack([x, y], axis=-1), inside


def build_rig(views: int, size: int) -> list[ViewCamera]:
    return [
        ViewCamera(i, yaw, pitch, size, cam_from_pano_rotation(yaw, pitch))
        for i, (yaw, pitch) in enumerate(view_layout(views))
    ]


def voronoi_owner(rig: list[ViewCamera]) -> np.ndarray:
    """For each view pixel of every camera, True where that camera is the closest rig centre to the ray.

    Each panorama pixel is therefore owned by exactly one view, so features are extracted once per pixel
    and views of one frame do not match each other.
    """
    centers = np.stack([c.center_in_pano for c in rig])
    owners = []
    for cam in rig:
        rays_pano = cam.rays_in_cam() @ cam.cam_from_pano
        owners.append(np.argmax(rays_pano @ centers.T, axis=-1) == cam.index)
    return np.stack(owners)


def view_name(frame: int, view: int) -> str:
    return f"{frame:05d}_{view:02d}.jpg"
