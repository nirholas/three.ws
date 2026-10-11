"""MV-Adapter "fill in the other sides": one photo in, three synthesized views out.

Wraps huanngzh/MV-Adapter's own reference script
(github.com/huanngzh/MV-Adapter, Apache-2.0; adapter weights on the Hub are
also Apache-2.0; its SDXL base, stabilityai/stable-diffusion-xl-base-1.0, is
CreativeML Open RAIL++-M, which permits commercial hosting) rather than
reimplementing the SDXL multi-view diffusion pipeline. `prepare_pipeline` and
`run_pipeline` are imported unmodified from the vendored checkout
(MVADAPTER_SRC) and called exactly as the script's own `__main__` block does.

This is the order's optional view-synthesis rung: Forge's single-photo
"Match my photo" lane only reaches this module when the caller asks
fill_other_sides=true. The default single-image lane and the given-multi-view
lane (main.py's _generate_single / _generate_multiview) never import it.

Background removal is deliberately NOT done here. Every image main.py decodes
is already RGBA (see _decode_image), so run_pipeline's own `reference_image.
mode == "RGBA"` branch always triggers upstream's preprocess_image (bounding-
box crop to content, composite onto neutral gray) without a second BiRefNet
load; the real alpha matte each synthesized view needs for reconstruction
comes afterward, from the multi-view Pixal3D pipeline's own rembg_model, the
same way it mattes every other multi-view input (see main.py's
_generate_multiview).
"""

from __future__ import annotations

import os

import torch
from PIL import Image

MVADAPTER_SRC = os.environ.get("MVADAPTER_SRC", "/opt/mvadapter-src")
MVADAPTER_WEIGHTS_DIR = os.environ.get("MVADAPTER_WEIGHTS_DIR", "/weights/mvadapter")
LOW_VRAM = os.environ.get("LOW_VRAM", "1") != "0"

# front=0, right=90, back=180, left=270: the same convention camera_rig.py uses.
AZIMUTH_DEG = [0, 90, 180, 270]
HEIGHT = WIDTH = 768
NUM_INFERENCE_STEPS = 30
GUIDANCE_SCALE = 3.0

_pipe = None


def _resolve(name: str, hub_fallback: str) -> str:
    """A locally-staged copy if stage_weights.sh ran, else the Hub id."""
    local = os.path.join(MVADAPTER_WEIGHTS_DIR, name)
    return local if os.path.isdir(local) else hub_fallback


def _move(pipe, device: str) -> None:
    pipe.to(device=device)
    # prepare_pipeline() moves cond_encoder separately from the rest of the
    # pipeline's components, so a device swap must do the same.
    pipe.cond_encoder.to(device=device)


def _get_pipeline():
    global _pipe
    if _pipe is not None:
        return _pipe
    import sys

    if MVADAPTER_SRC not in sys.path:
        sys.path.insert(0, MVADAPTER_SRC)
    from scripts.inference_i2mv_sdxl import prepare_pipeline

    device = "cuda" if torch.cuda.is_available() else "cpu"
    _pipe = prepare_pipeline(
        base_model=_resolve("sdxl-base", "stabilityai/stable-diffusion-xl-base-1.0"),
        vae_model=_resolve("sdxl-vae-fix", "madebyollin/sdxl-vae-fp16-fix"),
        unet_model=None,
        lora_model=None,
        adapter_path=_resolve("mv-adapter", "huanngzh/mv-adapter"),
        scheduler=None,
        num_views=len(AZIMUTH_DEG),
        device="cpu" if LOW_VRAM else device,
        dtype=torch.float16 if device == "cuda" else torch.float32,
    )
    if LOW_VRAM:
        _move(_pipe, "cpu")
    return _pipe


def synthesize_other_sides(image: Image.Image) -> list[Image.Image]:
    """Return the right, back and left views synthesized from one front photo.

    `image` is the caller's own photo, treated as the front view (azimuth 0);
    MV-Adapter also re-synthesizes a front view of its own, which is discarded
    in favor of the real photo the caller already has.
    """
    import sys

    if MVADAPTER_SRC not in sys.path:
        sys.path.insert(0, MVADAPTER_SRC)
    from scripts.inference_i2mv_sdxl import run_pipeline

    pipe = _get_pipeline()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if LOW_VRAM:
        _move(pipe, device)
    try:
        images, _reference = run_pipeline(
            pipe,
            num_views=len(AZIMUTH_DEG),
            text="",
            image=image.convert("RGBA"),
            height=HEIGHT,
            width=WIDTH,
            num_inference_steps=NUM_INFERENCE_STEPS,
            guidance_scale=GUIDANCE_SCALE,
            seed=-1,
            device=device,
            azimuth_deg=AZIMUTH_DEG,
        )
    finally:
        if LOW_VRAM:
            _move(pipe, "cpu")
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
    return images[1:4]
