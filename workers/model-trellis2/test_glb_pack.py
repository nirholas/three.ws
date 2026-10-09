"""Unit tests for GLB post-processing: alpha mode and the gltfpack step.

Needs numpy only; the gltfpack round trip runs when the binary is installed
(every built image has it):

    cd workers/model-trellis2 && python3 -m pytest test_glb_pack.py -q
"""

import json
import shutil
import struct

import numpy as np
import pytest

import glb_pack


class _Texture:
    def __init__(self, alpha):
        self.mode = "RGBA"
        self._array = np.dstack([np.zeros_like(alpha)] * 3 + [alpha])

    def __array__(self, dtype=None, copy=None):
        return self._array


class _Material:
    def __init__(self, texture):
        self.baseColorTexture = texture
        self.alphaMode = "OPAQUE"


class _Mesh:
    def __init__(self, alpha):
        self.visual = type("V", (), {"material": _Material(_Texture(alpha))})()


def test_solid_alpha_stays_opaque():
    assert glb_pack.alpha_mode_for(np.full((64, 64), 255, dtype=np.uint8)) == "OPAQUE"


def test_stray_seam_pixels_do_not_flip_a_solid_asset():
    alpha = np.full((100, 100), 255, dtype=np.uint8)
    alpha[0, :50] = 0
    assert glb_pack.alpha_mode_for(alpha) == "OPAQUE"


def test_translucent_regions_flip_to_blend():
    alpha = np.full((100, 100), 255, dtype=np.uint8)
    alpha[:20] = 40
    assert glb_pack.alpha_mode_for(alpha) == "BLEND"


def test_empty_plane_is_opaque():
    assert glb_pack.alpha_mode_for(np.zeros((0, 0), dtype=np.uint8)) == "OPAQUE"


def test_blend_if_translucent_sets_the_material():
    alpha = np.full((10, 10), 255, dtype=np.uint8)
    alpha[:5] = 10
    mesh = _Mesh(alpha)
    assert glb_pack.blend_if_translucent(mesh) == "BLEND"
    assert mesh.visual.material.alphaMode == "BLEND"


def test_mesh_without_a_texture_is_left_alone():
    assert glb_pack.blend_if_translucent(object()) == "OPAQUE"


def test_missing_gltfpack_returns_the_uncompressed_glb():
    data = b"glTF" + b"\x00" * 32
    out, packed = glb_pack.compress(data, gltfpack_bin="gltfpack-not-installed")
    assert out == data and packed is False


def _minimal_glb() -> bytes:
    positions = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype="<f4").tobytes()
    doc = {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3", "min": [0, 0, 0], "max": [1, 1, 0]}],
        "bufferViews": [{"buffer": 0, "byteLength": len(positions)}],
        "buffers": [{"byteLength": len(positions)}],
    }
    js = json.dumps(doc).encode()
    js += b" " * (-len(js) % 4)
    body = positions + b"\x00" * (-len(positions) % 4)
    total = 12 + 8 + len(js) + 8 + len(body)
    return (
        struct.pack("<4sII", b"glTF", 2, total)
        + struct.pack("<I4s", len(js), b"JSON") + js
        + struct.pack("<I4s", len(body), b"BIN\x00") + body
    )


@pytest.mark.skipif(shutil.which(glb_pack.GLTFPACK_BIN) is None, reason="gltfpack not installed")
def test_gltfpack_round_trip_yields_a_meshopt_glb():
    out, packed = glb_pack.compress(_minimal_glb())
    assert packed is True and out[:4] == b"glTF"
    js_len = int.from_bytes(out[12:16], "little")
    doc = json.loads(out[20:20 + js_len])
    assert "EXT_meshopt_compression" in (doc.get("extensionsUsed") or [])
