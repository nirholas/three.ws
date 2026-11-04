"""Surface-normal estimator for AniGen's conditioning, in place of DSINE.

AniGen conditions its sparse-structure flow on a normal map of the input
image (AnigenImageTo3DPipeline.get_cond encodes it with DINOv2 alongside the
RGB). Upstream estimates that map with DSINE, fetched at load time from
GitHub (`torch.hub.load("hugoycj/DSINE-hub:main", ...)`, an unpinned branch).
DSINE's licence (Imperial College "DSINE SOFTWARE LICENCE AGREEMENT", clause
2(b), read 2026-11-04) permits use "solely for non-commercial, internal or
academic research purposes", which the paid Forge lane cannot satisfy: the
same reason this worker never installs nvdiffrast. patch_anigen.py swaps the
single `load_dsine(device)` call in from_pretrained for
`load_normal_estimator(device)` below; nothing else in the call path changes.

The stand-in is Marigold normals (prs-eth/marigold-normals-lcm-v0-1,
Apache-2.0 per its model card, read 2026-11-04) through diffusers'
MarigoldNormalsPipeline, loaded offline from ckpts/ (entrypoint.sh stages it).

Frames, which must line up exactly for AniGen to see the distribution it was
trained on:
  Marigold  x right, y up, z toward the viewer (diffusers' visualize_normals
            docstring: "Default direction is right / top / facing the
            observer").
  DSINE     OpenCV camera axes (x right, y down, z forward) with every normal
            pointing along its view ray (models/submodules.py RayReLU forces
            cos(n, ray) > 0). That is (-x, y, z) of Marigold's frame.
AniGen's estimate_normal negates x of whatever infer_pil returns, then maps
[-1, 1] to [0, 1]. So infer_pil returns DSINE's frame, and after AniGen's
negation the map is the OpenGL-style normal map DSINE produced: a flat
camera-facing surface comes out (0.5, 0.5, 1.0), the colour AniGen's own
no-estimator fallback paints (128, 128, 255).
"""

from __future__ import annotations

import os

MARIGOLD_DIRNAME = "marigold-normals-lcm-v0-1"
# The LCM checkpoint is distilled for 1 to 4 steps (model_index.json default
# is 1). Four steps with a five-member ensemble costs about 20 UNet passes at
# 768 px, a few seconds on an L4 next to AniGen's own minute-scale run, and
# gives a cleaner map than a single pass.
DENOISING_STEPS = 4
ENSEMBLE_SIZE = 5
PROCESSING_RESOLUTION = 768
SEED = 0


def to_dsine_frame(normals):
    """Marigold's (x right, y up, z to viewer) -> DSINE's (-x, y, z).

    `normals` is (B, 3, H, W), a torch tensor or numpy array."""
    out = normals.clone() if hasattr(normals, "clone") else normals.copy()
    out[:, 0] = -out[:, 0]
    return out


class MarigoldNormalPredictor:
    """Duck-types the DSINE-hub Predictor AniGen calls: infer_pil(image)
    returns a (1, 3, H, W) float tensor in DSINE's frame at the input's own
    resolution."""

    def __init__(self, pipe, device: str):
        self.pipe = pipe
        self.device = device

    def infer_pil(self, image):
        import torch

        generator = torch.Generator(device=self.device).manual_seed(SEED)
        with torch.no_grad():
            out = self.pipe(
                image,
                num_inference_steps=DENOISING_STEPS,
                ensemble_size=ENSEMBLE_SIZE,
                processing_resolution=PROCESSING_RESOLUTION,
                match_input_resolution=True,
                generator=generator,
                output_type="pt",
            )
        return to_dsine_frame(out.prediction.float())


def normals_model_path() -> str:
    return os.environ.get("NORMALS_MODEL_PATH") or os.path.join("ckpts", MARIGOLD_DIRNAME)


def load_normal_estimator(device: str = "cuda") -> MarigoldNormalPredictor:
    import torch
    from diffusers import MarigoldNormalsPipeline

    path = normals_model_path()
    if not os.path.isdir(path):
        raise FileNotFoundError(
            f"normal estimator checkpoint not found at {os.path.abspath(path)}; "
            "entrypoint.sh stages it from the weights bucket "
            "(workers/model-anigen/stage-assets.sh)"
        )
    pipe = MarigoldNormalsPipeline.from_pretrained(
        path, variant="fp16", torch_dtype=torch.float16, local_files_only=True
    )
    pipe.to(device)
    pipe.set_progress_bar_config(disable=True)
    return MarigoldNormalPredictor(pipe, device)
