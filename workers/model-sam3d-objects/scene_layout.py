"""Pure geometry for the SAM 3D Objects worker: masks, poses and the scene GLB.

numpy, PIL and trimesh only (cv2 is imported lazily for GrabCut), so it
unit-tests without torch or a GPU. The model-facing code lives in pipeline.py.

Conventions, from facebookresearch/sam-3d-objects at the pinned commit:

  * ``output["glb"]`` is a trimesh in a Y-up frame. Upstream's ``to_glb`` makes
    it from the decoder's native Z-up vertices with ``v @ DECODER_TO_GLB``.
  * ``output["rotation"|"translation"|"scale"]`` place the object in the camera
    frame of the photo, applied to the decoder-native vertices (upstream's
    ``make_scene`` applies them to the gaussians' native xyz). The rotation is a
    PyTorch3D quaternion, real part first.
  * The camera frame is PyTorch3D's: +X left, +Y up, +Z away from the camera.
    glTF viewers look down -Z with +X right, so the final conversion flips X and Z.

The returned scene therefore reads like the photo: the camera sits at the origin
looking down -Z, objects stand where the photo shows them, at the model's own
relative scale (the layout is relative, not metric: no tape measure was in frame).
"""

from __future__ import annotations

import io
from typing import Sequence

import numpy as np

# upstream to_glb: vertices @ [[1, 0, 0], [0, 0, -1], [0, 1, 0]]  =>  (x, y, z) -> (x, z, -y)
_DECODER_TO_GLB = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)
_GLB_TO_DECODER = _DECODER_TO_GLB.T  # orthonormal: the inverse is the transpose
_CAMERA_TO_GLTF = np.diag([-1.0, 1.0, -1.0])


def glb_to_decoder_vertices(vertices: np.ndarray) -> np.ndarray:
    """Undo upstream's decoder-to-GLB axis change."""
    return np.asarray(vertices, dtype=np.float64) @ _GLB_TO_DECODER


def quat_wxyz_to_matrix(q: Sequence[float]) -> np.ndarray:
    """Rotation matrix for a real-first quaternion (PyTorch3D convention)."""
    w, x, y, z = (float(v) for v in q)
    n = w * w + x * x + y * y + z * z
    if not np.isfinite(n) or n < 1e-12:
        raise ValueError("quaternion has no rotation")
    s = 2.0 / n
    return np.array(
        [
            [1 - s * (y * y + z * z), s * (x * y - z * w), s * (x * z + y * w)],
            [s * (x * y + z * w), 1 - s * (x * x + z * z), s * (y * z - x * w)],
            [s * (x * z - y * w), s * (y * z + x * w), 1 - s * (x * x + y * y)],
        ],
        dtype=np.float64,
    )


def pose_vertices(
    glb_vertices: np.ndarray,
    quat_wxyz: Sequence[float],
    translation: Sequence[float],
    scale: Sequence[float] | float,
) -> np.ndarray:
    """Place an object's GLB-frame vertices in the glTF scene frame of the photo."""
    native = glb_to_decoder_vertices(glb_vertices)
    scale_vec = np.broadcast_to(np.asarray(scale, dtype=np.float64).reshape(-1), (3,)) if np.ndim(scale) else np.full(3, float(scale))
    posed = (native * scale_vec) @ quat_wxyz_to_matrix(quat_wxyz).T + np.asarray(translation, dtype=np.float64).reshape(3)
    return posed @ _CAMERA_TO_GLTF.T


def standalone_vertices(glb_vertices: np.ndarray, scale: Sequence[float] | float) -> np.ndarray:
    """The object on its own: scaled, centred on X/Z and resting on y = 0."""
    verts = np.asarray(glb_vertices, dtype=np.float64)
    scale_vec = np.broadcast_to(np.asarray(scale, dtype=np.float64).reshape(-1), (3,)) if np.ndim(scale) else np.full(3, float(scale))
    # Scale in the decoder frame, where the model's axes mean what the scale means.
    native = glb_to_decoder_vertices(verts) * scale_vec
    out = native @ _DECODER_TO_GLB
    lo, hi = out.min(axis=0), out.max(axis=0)
    out[:, 0] -= (lo[0] + hi[0]) / 2.0
    out[:, 2] -= (lo[2] + hi[2]) / 2.0
    out[:, 1] -= lo[1]
    return out


def box_to_pixels(box: Sequence[float], width: int, height: int) -> tuple[int, int, int, int]:
    """Normalized [x0, y0, x1, y1] to an integer pixel rectangle inside the image."""
    x0, y0, x1, y1 = box
    px0 = min(max(int(round(x0 * width)), 0), width - 1)
    py0 = min(max(int(round(y0 * height)), 0), height - 1)
    px1 = min(max(int(round(x1 * width)), px0 + 1), width)
    py1 = min(max(int(round(y1 * height)), py0 + 1), height)
    return px0, py0, px1, py1


def mask_from_png_bytes(data: bytes, width: int, height: int) -> np.ndarray:
    """Decode a caller's mask PNG to a boolean (height, width) array.

    An RGBA mask uses its alpha channel when the alpha is not constant,
    otherwise its luminance. The mask is resized to the photo with nearest
    neighbour so a slightly different export size still lines up.
    """
    from PIL import Image

    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as exc:  # noqa: BLE001 - PIL raises many types for a bad file
        raise ValueError("mask is not a readable image") from exc
    if img.mode in ("RGBA", "LA"):
        alpha = np.asarray(img.getchannel("A"))
        channel = alpha if alpha.min() != alpha.max() else np.asarray(img.convert("L"))
    else:
        channel = np.asarray(img.convert("L"))
    if channel.shape != (height, width):
        channel = np.asarray(Image.fromarray(channel).resize((width, height), Image.NEAREST))
    mask = channel > 127
    if not mask.any():
        raise ValueError("mask is empty (no white pixels)")
    return mask


def grabcut_mask(image_rgb: np.ndarray, box_px: tuple[int, int, int, int], iterations: int = 5) -> np.ndarray:
    """Estimate an object mask from a box with GrabCut (OpenCV, Apache-2.0)."""
    import cv2

    x0, y0, x1, y1 = box_px
    h, w = image_rgb.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    rect = (x0, y0, x1 - x0, y1 - y0)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR), mask, rect, bgd, fgd, iterations, cv2.GC_INIT_WITH_RECT)
    out = (mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)
    box_area = max((x1 - x0) * (y1 - y0), 1)
    # GrabCut can collapse to almost nothing on a low-contrast box; the box itself
    # is then the honest answer, because an empty mask would fail the model.
    if out.sum() < 0.05 * box_area:
        out = np.zeros((h, w), bool)
        out[y0:y1, x0:x1] = True
    return out


def object_name(index: int) -> str:
    return f"object_{index + 1:02d}"


def build_scene(objects: Sequence[dict]):
    """One trimesh.Scene, one named node per object, laid out like the photo.

    Each item needs ``vertices`` (already posed), ``faces`` and optional
    ``vertex_colors``.
    """
    import trimesh

    scene = trimesh.Scene()
    for i, obj in enumerate(objects):
        name = object_name(i)
        mesh = trimesh.Trimesh(vertices=obj["vertices"], faces=obj["faces"], process=False)
        if obj.get("vertex_colors") is not None:
            mesh.visual.vertex_colors = obj["vertex_colors"]
        scene.add_geometry(mesh, node_name=name, geom_name=name)
    return scene


def export_glb(scene_or_mesh) -> bytes:
    buf = io.BytesIO()
    scene_or_mesh.export(buf, file_type="glb")
    return buf.getvalue()


def _round(values, n=4):
    return [round(float(v), n) for v in np.asarray(values).reshape(-1)]


def manifest_entry(index: int, posed: np.ndarray, faces: np.ndarray, standalone: np.ndarray,
                   quat_wxyz, translation, scale, source: str) -> dict:
    """Machine-readable record of one reconstructed object."""
    lo, hi = posed.min(axis=0), posed.max(axis=0)
    size = standalone.max(axis=0) - standalone.min(axis=0)
    return {
        "id": object_name(index),
        "name": object_name(index),
        "source": source,  # "mask" or "box"
        "face_count": int(len(faces)),
        "vertex_count": int(len(posed)),
        "bbox": {"min": _round(lo), "max": _round(hi)},
        "centroid": _round((lo + hi) / 2.0),
        "size": _round(size),  # width, height, depth of the object on its own, layout units
        "pose": {"translation": _round(translation), "rotation_wxyz": _round(quat_wxyz, 6), "scale": _round(scale)},
    }
