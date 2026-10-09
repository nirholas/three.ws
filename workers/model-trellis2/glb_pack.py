"""Post-processing for a TRELLIS.2 GLB: keep transparency, then meshopt-compress.

numpy and the stdlib only (the trimesh scene is duck-typed), so the decisions
unit test without a GPU (test_glb_pack.py).

Two jobs:

  1. Alpha. o_voxel's to_glb bakes opacity into the base colour texture's alpha
     channel but always declares the material OPAQUE, so a viewer ignores it and
     a leaf or a glass pane renders as a solid card. `blend_if_translucent`
     flips the material to BLEND when the baked alpha is genuinely translucent.
  2. Compression. `gltfpack -cc` rewrites the GLB with EXT_meshopt_compression
     and quantized attributes, the same encoding three.ws avatars ship with, so
     the viewer's existing MeshoptDecoder reads it. Textures pass through
     untouched (no -tc), which keeps the baked PBR maps and alpha byte-exact.
     A failed pack never fails the job: the uncompressed GLB is still a valid
     asset, so it is returned and the reason is logged.
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import numpy as np

log = logging.getLogger("glb-pack")

GLTFPACK_BIN = os.environ.get("GLTFPACK_BIN", "gltfpack")
GLTFPACK_TIMEOUT_S = int(os.environ.get("GLTFPACK_TIMEOUT_S", "300"))

# A texel counts as translucent below this alpha, and the asset only flips to
# BLEND when enough of the texture is: stray inpainting pixels at UV seams must
# not turn a solid object into a sorted-transparency one.
TRANSLUCENT_BELOW = 245
TRANSLUCENT_MIN_FRACTION = 0.01


def alpha_mode_for(alpha: np.ndarray) -> str:
    """OPAQUE or BLEND for a baked alpha plane (uint8, any shape)."""
    plane = np.asarray(alpha)
    if plane.size == 0:
        return "OPAQUE"
    translucent = float(np.count_nonzero(plane < TRANSLUCENT_BELOW)) / plane.size
    return "BLEND" if translucent >= TRANSLUCENT_MIN_FRACTION else "OPAQUE"


def blend_if_translucent(mesh) -> str:
    """Set the mesh material's alphaMode from its baked texture and return it."""
    material = getattr(getattr(mesh, "visual", None), "material", None)
    texture = getattr(material, "baseColorTexture", None)
    if material is None or texture is None or getattr(texture, "mode", "") != "RGBA":
        return "OPAQUE"
    mode = alpha_mode_for(np.asarray(texture)[..., 3])
    material.alphaMode = mode
    return mode


def compress(glb: bytes, gltfpack_bin: Optional[str] = None) -> tuple[bytes, bool]:
    """Meshopt-compress a GLB. Returns (bytes, compressed)."""
    binary = gltfpack_bin or GLTFPACK_BIN
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in.glb"
        dst = Path(tmp) / "out.glb"
        src.write_bytes(glb)
        try:
            subprocess.run(
                [binary, "-i", str(src), "-o", str(dst), "-cc"],
                check=True,
                capture_output=True,
                timeout=GLTFPACK_TIMEOUT_S,
            )
            packed = dst.read_bytes()
        except FileNotFoundError:
            log.warning("gltfpack not found at %s; serving the uncompressed GLB", binary)
            return glb, False
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            detail = getattr(exc, "stderr", b"") or b""
            log.warning("gltfpack failed (%s %s); serving the uncompressed GLB", type(exc).__name__, detail[-300:])
            return glb, False
    if packed[:4] != b"glTF":
        log.warning("gltfpack produced a non-GLB output; serving the uncompressed GLB")
        return glb, False
    return packed, True
