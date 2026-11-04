"""Request/response contract and license gate for the UltraTex texture worker.

Pure Python (pydantic + stdlib): importable without torch, a GPU or GCS, so the
contract and the gate are unit-testable on any machine. The request model is
field-for-field the one in workers/texture/main.py so the router can swap the
two by URL alone.
"""

from __future__ import annotations

import os
from typing import Mapping, Optional

from pydantic import BaseModel, Field, field_validator

# The only value that opens the gate. Setting it is a statement that the
# operator holds a commercial license for the FLUX base model the UltraTex LoRA
# is applied to. UltraTex's own code and LoRA weights are MIT; both released
# backbones (FLUX.1-dev, FLUX.2-Klein-base-9B) are non-commercial by their
# Black Forest Labs licenses. See docs/research/forge-texture-ab.md.
LICENSE_ACK_ENV = "ULTRATEX_BASE_MODEL_LICENSE_ACK"
LICENSE_ACK_VALUE = "commercial-license-held"

MATERIAL_CLASS_PBR = ("person", "metal", "wood", "fabric", "plastic", "glass")
TEXTURE_SIZES = (512, 1024, 2048)


class TextureRequest(BaseModel):
    mesh: str = Field(..., description="https URL to input GLB mesh")
    prompt: str = Field(..., min_length=3, max_length=500)
    negative_prompt: str = Field(default="blurry, low quality, distorted, watermark")
    num_views: int = Field(default=8, ge=4, le=8)
    texture_size: int = Field(default=2048)
    material_class: Optional[str] = Field(default=None)

    @field_validator("texture_size")
    @classmethod
    def validate_size(cls, v: int) -> int:
        if v not in TEXTURE_SIZES:
            raise ValueError("texture_size must be 512, 1024, or 2048")
        return v

    @field_validator("material_class")
    @classmethod
    def validate_material_class(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in MATERIAL_CLASS_PBR:
            raise ValueError(f"material_class must be one of {sorted(MATERIAL_CLASS_PBR)}")
        return v


def license_gate(env: Optional[Mapping[str, str]] = None) -> dict:
    """Report whether the base-model license acknowledgement is present."""
    source = os.environ if env is None else env
    acknowledged = source.get(LICENSE_ACK_ENV, "") == LICENSE_ACK_VALUE
    return {
        "open": acknowledged,
        "env": LICENSE_ACK_ENV,
        "expected": LICENSE_ACK_VALUE,
        "reason": None
        if acknowledged
        else "UltraTex runs on FLUX base models whose licenses are non-commercial; "
        "set the acknowledgement only after a commercial license is held",
    }
