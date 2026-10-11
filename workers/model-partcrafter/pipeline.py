"""
PartCrafter (wgsxm/PartCrafter, MIT) in-process pipeline wrapper: a single
reference image in, a part-separated GLB out. PartCrafter conditions a shared
TripoSG-derived diffusion transformer on the SAME image once per requested
part and decodes each pass into its own mesh in one shot (its own
`attention_kwargs={"num_parts": N}` call), so this wrapper loads the model
once and calls it directly, mirroring workers/model-anigen's importable-
pipeline pattern rather than workers/rig-nonhuman's subprocess-CLI one.

Upstream's own script (scripts/inference_partcrafter.py) exports each part as
its own `part_{i:02}.glb` plus a merged `object.glb` via
`get_colored_mesh_composition`. This worker instead builds ONE named-node GLB
scene directly (`part_01`, `part_02`, ... one-indexed, two digits), the exact
convention workers/segment emits, so a part-separated generation and a
segmented mesh look identical to every downstream consumer (Restyle Studio,
and the keep-the-rig node-name contract tracked in work order 078).
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Optional

from PIL import Image

log = logging.getLogger("model-partcrafter.pipeline")

_lock = threading.Lock()
_pipeline = None
_rmbg_net = None

MAX_NUM_PARTS = 16


def load_pipeline(partcrafter_weights_dir: str, rmbg_weights_dir: str, device: str = "cuda"):
    """Load (once) and return the (PartCrafterPipeline, BriaRMBG) pair.

    Import is deferred to call time, not module top: this lets
    test_app_contract.py exercise request validation and output handling
    without PartCrafter's checkout or its GPU dependencies installed.
    """
    global _pipeline, _rmbg_net
    with _lock:
        if _pipeline is None:
            import torch
            from src.models.briarmbg import BriaRMBG
            from src.pipelines.pipeline_partcrafter import PartCrafterPipeline

            log.info(
                "loading PartCrafter pipeline: weights=%s rmbg=%s",
                partcrafter_weights_dir, rmbg_weights_dir,
            )
            pipeline = PartCrafterPipeline.from_pretrained(partcrafter_weights_dir)
            pipeline = pipeline.to("cuda", torch.float16)
            rmbg_net = BriaRMBG.from_pretrained(rmbg_weights_dir).to(device)
            rmbg_net.eval()
            _pipeline = pipeline
            _rmbg_net = rmbg_net
        return _pipeline, _rmbg_net


class PartGenerationError(RuntimeError):
    """PartCrafter ran but produced nothing usable: every decoded part was
    empty, or fewer parts came back than requested. Not the caller's fault;
    the caller already passed a readable image and a valid part count."""


def _golden_ratio_color(index: int) -> str:
    """Same visual convention as workers/segment/segment_core.py: a distinct,
    evenly-spread hue per part so segmentation is visible even untextured."""
    import colorsys

    golden_ratio_conjugate = 0.618033988749895
    hue = (index * golden_ratio_conjugate) % 1.0
    r, g, b = colorsys.hsv_to_rgb(hue, 0.55, 0.92)
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


def run_partcrafter(
    image_bytes: bytes,
    output_glb: Path,
    *,
    partcrafter_weights_dir: str,
    rmbg_weights_dir: str,
    num_parts: int,
    seed: int = 0,
    num_tokens: int = 1024,
    num_inference_steps: int = 50,
    guidance_scale: float = 7.0,
    rmbg: bool = True,
) -> dict:
    """Run PartCrafter end to end on one reference image, writing a single
    named-node GLB (`part_01` .. `part_NN`) to `output_glb`, and return a
    parts manifest shaped like workers/segment's (so both sources render
    through the same Parts Studio / Restyle Studio UI)."""
    import io

    import numpy as np
    import torch
    import trimesh
    from accelerate.utils import set_seed

    from src.utils.image_utils import prepare_image

    pipeline, rmbg_net = load_pipeline(partcrafter_weights_dir, rmbg_weights_dir)
    set_seed(seed)

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    if rmbg:
        img_pil = prepare_image(image, bg_color=np.array([1.0, 1.0, 1.0]), rmbg_net=rmbg_net)
    else:
        img_pil = image

    with torch.no_grad():
        outputs = pipeline(
            image=[img_pil] * num_parts,
            attention_kwargs={"num_parts": num_parts},
            num_tokens=num_tokens,
            generator=torch.Generator(device=pipeline.device).manual_seed(seed),
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            max_num_expanded_coords=int(1e9),
            use_flash_decoder=False,
        ).meshes

    usable = 0
    scene = trimesh.Scene()
    parts_manifest: list[dict] = []
    for i, mesh in enumerate(outputs):
        if mesh is None or len(getattr(mesh, "vertices", [])) == 0:
            continue
        usable += 1
        node_name = f"part_{i + 1:02d}"
        color = _golden_ratio_color(i)
        rgba = trimesh.visual.color.hex_to_rgba(color)
        mesh.visual = trimesh.visual.ColorVisuals(mesh, vertex_colors=np.tile(rgba, (len(mesh.vertices), 1)))
        scene.add_geometry(mesh, node_name=node_name, geom_name=node_name)
        bbox = mesh.bounds
        parts_manifest.append({
            "id": node_name,
            "name": node_name,
            "region": node_name,
            "face_count": int(len(mesh.faces)),
            "vertex_count": int(len(mesh.vertices)),
            "bbox": {"min": bbox[0].tolist(), "max": bbox[1].tolist()},
            "centroid": mesh.centroid.tolist(),
            "volume": float(mesh.volume) if mesh.is_volume else 0.0,
            "color": color,
        })

    if usable == 0:
        raise PartGenerationError("PartCrafter decoded no usable parts from this image")

    output_glb.parent.mkdir(parents=True, exist_ok=True)
    scene.export(output_glb, file_type="glb")

    return {
        "glb_bytes": output_glb.read_bytes(),
        "parts": parts_manifest,
        "part_count": usable,
    }
