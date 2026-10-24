"""SAM 3D Objects (facebookresearch/sam-3d-objects, SAM License) pipeline wrapper.

One photo plus one mask per object in, one posed mesh per object out. Loading
and running the model needs torch, pytorch3d, kaolin and a 32 GB+ GPU, so every
heavy import lives inside a function: this module imports on a laptop and the
pure logic (masks, boxes, layout) is covered by test_scene_layout.py.

Upstream exposes its inference class only as notebook/inference.py in the
repository (it is not part of the pip package), so the Dockerfile leaves the
checkout at SAM3D_SRC and this module puts SAM3D_SRC/notebook on sys.path,
exactly as upstream's README does.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
from pathlib import Path

import numpy as np

import scene_layout as layout

log = logging.getLogger("model-sam3d-objects.pipeline")

_lock = threading.Lock()
_inference = None

MIN_OBJECT_FACES = 8


class ObjectReconstructionError(RuntimeError):
    """The model ran but produced no usable mesh for any requested object."""


def load_pipeline(checkpoint_dir: str, sam3d_src: str):
    """Load (once) and return upstream's Inference singleton."""
    global _inference
    with _lock:
        if _inference is None:
            config = Path(checkpoint_dir) / "pipeline.yaml"
            if not config.is_file():
                raise FileNotFoundError(
                    f"{config} is missing: stage the SAM 3D Objects checkpoints with "
                    "`npm run stage:sam3d-objects -- --accept-sam-license`"
                )
            # upstream's inference.py reads these at import time
            os.environ.setdefault("CONDA_PREFIX", os.environ.get("CUDA_HOME", "/usr/local/cuda"))
            os.environ.setdefault("LIDRA_SKIP_INIT", "true")
            notebook = str(Path(sam3d_src) / "notebook")
            if notebook not in sys.path:
                sys.path.append(notebook)
            from inference import Inference  # type: ignore[import-not-found]

            log.info("loading SAM 3D Objects: config=%s", config)
            _inference = Inference(str(config), compile=False)
        return _inference


def _to_numpy(value) -> np.ndarray:
    if hasattr(value, "detach"):
        value = value.detach().float().cpu().numpy()
    return np.asarray(value, dtype=np.float64)


def run_objects(image_rgb: np.ndarray, masks: list[np.ndarray], sources: list[str], seed: int) -> dict:
    """Reconstruct every masked object and lay the results out like the photo.

    Returns {"scene_glb": bytes, "objects": [manifest entries], "skipped": [...]}.
    The scene GLB has one named node per object (object_01, object_02, ...).
    A single object that fails is skipped and reported; the call fails only when
    none succeeds.
    """
    inference = _inference
    if inference is None:
        raise RuntimeError("pipeline is not loaded")

    posed_items: list[dict] = []
    manifest: list[dict] = []
    skipped: list[dict] = []

    for i, (mask, source) in enumerate(zip(masks, sources)):
        try:
            out = inference(image_rgb, mask, seed=seed)
            mesh = out.get("glb")
            if mesh is None or len(mesh.faces) < MIN_OBJECT_FACES:
                raise ObjectReconstructionError("the model returned no mesh for this object")
            verts = np.asarray(mesh.vertices, dtype=np.float64)
            faces = np.asarray(mesh.faces, dtype=np.int64)
            colors = None
            vis = getattr(mesh, "visual", None)
            if vis is not None and getattr(vis, "kind", None) == "vertex":
                colors = np.asarray(vis.vertex_colors)
            quat = _to_numpy(out["rotation"]).reshape(-1)[:4]
            trans = _to_numpy(out["translation"]).reshape(-1)[:3]
            scale = _to_numpy(out["scale"]).reshape(-1)
            posed = layout.pose_vertices(verts, quat, trans, scale)
            solo = layout.standalone_vertices(verts, scale)
        except Exception as exc:  # noqa: BLE001 - one bad object must not sink the scene
            log.warning("object %d failed: %s", i + 1, exc)
            skipped.append({"index": i, "reason": str(exc)[:200]})
            continue
        n = len(posed_items)
        posed_items.append({"vertices": posed, "faces": faces, "vertex_colors": colors})
        manifest.append(layout.manifest_entry(n, posed, faces, solo, quat, trans, scale, sources[i]))

    if not posed_items:
        reasons = "; ".join(s["reason"] for s in skipped) or "no objects"
        raise ObjectReconstructionError(f"no object could be reconstructed ({reasons})")

    scene_glb = layout.export_glb(layout.build_scene(posed_items))
    return {"scene_glb": scene_glb, "objects": manifest, "skipped": skipped}
