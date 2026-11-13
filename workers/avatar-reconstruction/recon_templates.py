"""
Reconstruction templates: which avatar the selfie is painted onto and reshaped.

Every name the pipeline addresses a template by (head mesh, skin / hair / eye
materials, the UV map precomputed against its head) lives in one TemplateSpec
here, so no other module hardcodes a template's internals.

Two templates ship:

  wolf3d      templates/default.glb, the original Wolf3D avatar. One body for
              every body_type. Default.
  parametric  templates/parametric.glb, the owned CC0 parametric body (Anny /
              MakeHuman data) with the 52 ARKit shapes and 15 visemes transferred
              from ICT-FaceKit (MIT), built by
              scripts/build-reconstruction-template.mjs. body_type male / female
              / neutral bakes slider presets stored in the GLB itself.

RECON_TEMPLATE selects one at call time (so tests and the eval can switch it).
An unknown value is a deployment error and fails loudly instead of silently
reconstructing onto the wrong body.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

HERE = Path(__file__).parent
TEMPLATES_DIR = HERE / "templates"

BODY_TYPES = ("male", "female", "neutral")


@dataclass(frozen=True)
class TemplateSpec:
    key: str
    glb_path: Path
    uv_map_path: Path
    head_mesh: str
    skin_material: str
    hair_material: Optional[str]
    eye_material: str
    # "base_color": the eye material is untextured, set its baseColorFactor.
    # "iris_texture": recolour only the iris disc of the eye texture, keep the
    #                 sclera white (the GLB's extras give the iris layout).
    eye_mode: str
    # How far the skin texture is graded toward the sampled complexion outside
    # the photographed face oval. Wolf3D's skin texture carries painted detail
    # worth keeping, so it is only nudged; the parametric skin is one flat tone,
    # so it is pulled most of the way to the person.
    skin_tint_strength: float
    # How precompute_uv aligns MediaPipe's canonical face onto the head:
    # "unit_cube" normalises both point sets to a unit cube (Wolf3D, whose head
    # mesh is the face and scalp only); "anchors" fits scale and translation on
    # five facial anchors stored in the GLB (needed when the head mesh also
    # carries a neck, which would skew a bounding-box fit).
    uv_alignment: str


WOLF3D = TemplateSpec(
    key="wolf3d",
    glb_path=TEMPLATES_DIR / "default.glb",
    uv_map_path=HERE / "face_uv_map.json",
    head_mesh="Wolf3D_Head",
    skin_material="Wolf3D_Skin",
    hair_material="Wolf3D_Hair",
    eye_material="Wolf3D_Eye",
    eye_mode="base_color",
    skin_tint_strength=0.25,
    uv_alignment="unit_cube",
)

PARAMETRIC = TemplateSpec(
    key="parametric",
    glb_path=TEMPLATES_DIR / "parametric.glb",
    uv_map_path=HERE / "face_uv_map.parametric.json",
    head_mesh="Head",
    skin_material="Parametric_Skin",
    hair_material=None,
    eye_material="Parametric_Eyes",
    eye_mode="iris_texture",
    skin_tint_strength=0.85,
    uv_alignment="anchors",
)

TEMPLATES = {spec.key: spec for spec in (WOLF3D, PARAMETRIC)}
DEFAULT_TEMPLATE = "wolf3d"


def get(key: str) -> TemplateSpec:
    spec = TEMPLATES.get((key or "").strip().lower())
    if spec is None:
        raise ValueError(
            f"unknown reconstruction template {key!r}; expected one of {', '.join(sorted(TEMPLATES))}"
        )
    return spec


def active() -> TemplateSpec:
    """The template RECON_TEMPLATE selects (wolf3d when unset)."""
    return get(os.environ.get("RECON_TEMPLATE") or DEFAULT_TEMPLATE)


def load(spec: TemplateSpec, body_type: str = "neutral"):
    """
    Load the template as a pygltflib document, shaped for body_type.

    On the parametric template body_type bakes that preset's slider weights,
    skeleton and floor offset into the base geometry, so the output GLB is that
    body at rest with every slider still available. Wolf3D has one body, so
    body_type does not change it.
    """
    import glb_ops

    glb = glb_ops.load_glb(spec.glb_path.read_bytes())
    if body_type not in BODY_TYPES:
        body_type = "neutral"
    glb_ops.bake_body_type(glb, body_type)
    return glb
