"""Forge by three.ws for NVIDIA Omniverse Kit.

Scripting API (Script Editor, a farm job, another extension)::

    import asyncio, threews.forge as forge
    outcome = await forge.generate_and_import("a brass ship lantern", lane="standard")
    print(outcome.imported.prim_path)
"""

from __future__ import annotations

from typing import Optional

from .controller import ForgeController, Outcome
from .extension import ThreeWSForgeExtension, get_controller
from .service import ForgeError, GenerationRequest, GenerationResult, LibraryModel
from .stage_import import ImportResult, StageImportError, import_glb, import_usd


async def generate_and_import(
    prompt: str = "",
    *,
    image_path: str = "",
    lane: str = "standard",
    name: str = "",
    placement: Optional[str] = None,
) -> Outcome:
    """Generate a model on three.ws and reference it into the open stage."""
    request = GenerationRequest(prompt=prompt, image_path=image_path, lane=lane, name=name)
    return await get_controller().generate(request, placement=placement)


__all__ = [
    "ForgeController",
    "ForgeError",
    "GenerationRequest",
    "GenerationResult",
    "ImportResult",
    "LibraryModel",
    "Outcome",
    "StageImportError",
    "ThreeWSForgeExtension",
    "generate_and_import",
    "get_controller",
    "import_glb",
    "import_usd",
]
