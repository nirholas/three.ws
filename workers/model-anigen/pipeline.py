"""
AniGen (VAST-AI-Research/AniGen, MIT) in-process pipeline wrapper: a single
reference image in, one rigged GLB out. Unlike workers/rig-nonhuman's UniRig
+ SkinTokens chain, AniGen is an importable Python pipeline (confirmed by its
own minimal inference script, example.py), not a subprocess CLI, so this
worker loads the model once and calls it directly.

The pipeline always runs with fill_holes=False and texture_size=0: see
patch_anigen.py's module docstring for why (nvdiffrast's restrictive
license). This drops two things AniGen can optionally add, neither load-bearing
for a rigged asset: raster-visibility hole-filling, and a baked UV texture.
What ships instead: the real per-vertex colors AniGen's own decoder predicts
(convert_to_glb_from_data's vertex_colors path), the real predicted skeleton,
and the real predicted skin weights, every bit of it the model's genuine
output.
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path

from PIL import Image

log = logging.getLogger("model-anigen.pipeline")

_lock = threading.Lock()
_pipeline = None


def load_pipeline(ss_flow_path: str, slat_flow_path: str, device: str = "cuda"):
    """Load (once) and return the AnigenImageTo3DPipeline singleton.

    Import is deferred to call time, not module top: this lets
    test_pipeline.py exercise request validation and output handling without
    AniGen's checkout or its GPU dependencies installed.
    """
    global _pipeline
    with _lock:
        if _pipeline is None:
            from anigen.pipelines import AnigenImageTo3DPipeline

            log.info("loading AniGen pipeline: ss=%s slat=%s", ss_flow_path, slat_flow_path)
            pipeline = AnigenImageTo3DPipeline.from_pretrained(
                ss_flow_path=ss_flow_path,
                slat_flow_path=slat_flow_path,
                device=device,
            )
            pipeline.cuda()
            _pipeline = pipeline
        return _pipeline


class RigAtGenerationError(RuntimeError):
    """AniGen ran but produced nothing usable: an empty mesh, or no output
    file despite reporting success. Not the caller's fault; the caller
    already passed a readable image."""


def run_anigen(
    image_bytes: bytes,
    output_glb: Path,
    *,
    ss_flow_path: str,
    slat_flow_path: str,
    seed: int = 42,
    joints_density: int = 1,
) -> None:
    """Run AniGen end to end on one reference image, writing a rigged GLB
    (skeleton + skin weights + vertex colors) to `output_glb`."""
    import io

    pipeline = load_pipeline(ss_flow_path, slat_flow_path)
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    outputs = pipeline.run(
        image,
        seed=seed,
        joints_density=joints_density,
        fill_holes=False,
        texture_size=0,
        output_glb=str(output_glb),
    )

    if not output_glb.exists():
        raise RigAtGenerationError(
            "AniGen reported success but wrote no output GLB"
        )
    joints = outputs.get("joints")
    if joints is None or len(joints) == 0:
        raise RigAtGenerationError(
            "AniGen produced a mesh with no predicted skeleton"
        )
