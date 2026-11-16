"""Web-compressed GLBs (meshopt, quantized attributes, WebP) are decoded into
plain glTF that the Kit asset converter can read, and import at the right size.

``data/box_web.glb`` and the golden vectors below were encoded by the reference
meshoptimizer and glTF-Transform tools (``scripts/make_web_fixture.mjs``), not
by the code under test.
"""

from __future__ import annotations

import io
import os
import tempfile

import numpy as np
import omni.kit.test
import omni.usd
from pxr import Usd, UsdGeom

from .. import gltf_compat as gc
from ..stage_import import StageImportError, import_glb
from .glb_fixture import BOX_MAX, BOX_MIN, box_glb

FIXTURE = os.path.join(os.path.dirname(__file__), "data", "box_web.glb")

# name: (encoded hex, count, stride, mode, filter, reference decoder output hex)
GOLDEN = {
    "quaternion": ("a0013f000000b1b285013f0000000a0905013f000000b1b0ca013f0000000a0407013f000000b1b2f3013f0000000a0908013b000000050400000000000000000000000000000000000000000000000000000000000000ff07", 4, 8, "ATTRIBUTES", "QUATERNION", "000000000000ff7f0f40fa3ffa3ffa3f0000825a0000825a66e661263333dc6b"),
    "exponential": ("a0013c000000c0bf013f000000542b3700013f0000000a051400013f00000028403f0120000000013f0000000a0514010300000074013f0000008972180118000000013f0000000a05140000000000000000000000000000000000000000000800f400ecfff4003000f4", 4, 12, "ATTRIBUTES", "EXPONENTIAL", "0000003f0000a0bf000040400080c94200000000000028c20000e0400000004100001041000000000000000000e84046"),
    "sequence": ("d100040400020810040416040400000000", 12, 2, "INDICES", "NONE", "000001000200020001000300070008000900030004000500"),
    "triangles32": ("e1f01000ff40ffc09a0c0202007687566778a9866589689801690000", 15, 4, "TRIANGLES", "NONE", "000000000100000002000000020000000100000003000000020000000300000004000000a0860100a1860100a2860100040000000300000005000000"),
}


def _accessor(doc, bin_chunk, index):
    acc = doc["accessors"][index]
    view = doc["bufferViews"][acc["bufferView"]]
    dtype = np.dtype(gc._DTYPES[acc["componentType"]])
    comps = gc._COMPONENTS[acc["type"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or comps * dtype.itemsize
    return np.ndarray((acc["count"], comps), dtype, buffer=bin_chunk, offset=start, strides=(stride, dtype.itemsize))


class TestGltfCompat(omni.kit.test.AsyncTestCase):
    async def setUp(self):
        with open(FIXTURE, "rb") as fh:
            self.web = fh.read()

    async def test_golden_vectors_match_the_reference_decoder(self):
        for name, (src, count, stride, mode, filt, want) in GOLDEN.items():
            got = gc.decode_meshopt(bytes.fromhex(src), count, stride, mode, filt)
            self.assertEqual(got.hex(), want, name)

    async def test_fixture_uses_all_three_encodings(self):
        doc, _ = gc._split_glb(self.web)
        self.assertEqual(set(doc["extensionsRequired"]), {"EXT_meshopt_compression", "KHR_mesh_quantization", "EXT_texture_webp"})
        self.assertTrue(gc.needs_rewrite(self.web))

    async def test_rewrite_is_plain_gltf_with_the_original_geometry(self):
        plain = gc.make_kit_compatible(self.web)
        doc, bin_chunk = gc._split_glb(plain)
        self.assertNotIn("extensionsUsed", doc)
        self.assertNotIn("extensionsRequired", doc)
        self.assertEqual(len(doc["buffers"]), 1)
        self.assertFalse(any("extensions" in v for v in doc["bufferViews"]))
        prim = doc["meshes"][0]["primitives"][0]
        pos = doc["accessors"][prim["attributes"]["POSITION"]]
        self.assertEqual(pos["componentType"], gc.FLOAT)
        # The node transform carries the dequantization scale; apply it to compare in meters.
        positions = _accessor(doc, bin_chunk, prim["attributes"]["POSITION"]).astype(np.float64)
        node = next(n for n in doc["nodes"] if n.get("mesh") == 0)
        positions = positions * np.array(node.get("scale", [1, 1, 1])) + np.array(node.get("translation", [0, 0, 0]))
        np.testing.assert_allclose(positions.min(axis=0), BOX_MIN, atol=2e-3)
        np.testing.assert_allclose(positions.max(axis=0), BOX_MAX, atol=2e-3)
        normals = _accessor(doc, bin_chunk, prim["attributes"]["NORMAL"]).astype(np.float64)
        np.testing.assert_allclose(np.linalg.norm(normals, axis=1), 1.0, atol=1e-3)
        indices = _accessor(doc, bin_chunk, prim["indices"]).reshape(-1)
        self.assertEqual(len(indices), 36)
        self.assertLess(int(indices.max()), len(positions))

    async def test_webp_texture_becomes_an_identical_png(self):
        from PIL import Image

        doc, bin_chunk = gc._split_glb(gc.make_kit_compatible(self.web))
        image = doc["images"][doc["textures"][0]["source"]]
        self.assertEqual(image["mimeType"], "image/png")
        view = doc["bufferViews"][image["bufferView"]]
        data = bin_chunk[view["byteOffset"] : view["byteOffset"] + view["byteLength"]]
        with Image.open(io.BytesIO(data)) as img:
            rgb = img.convert("RGB")
            self.assertEqual(rgb.size, (8, 8))
            self.assertEqual(rgb.getpixel((0, 0)), (230, 120, 30))
            self.assertEqual(rgb.getpixel((1, 0)), (20, 40, 200))

    async def test_plain_glb_is_returned_unchanged(self):
        plain = box_glb()
        self.assertFalse(gc.needs_rewrite(plain))
        self.assertIs(gc.make_kit_compatible(plain), plain)

    async def test_truncated_stream_is_a_clear_error(self):
        doc, bin_chunk = gc._split_glb(self.web)
        broken_bin = bin_chunk[: len(bin_chunk) // 2] + bytes(len(bin_chunk) - len(bin_chunk) // 2)
        broken = self.web[: len(self.web) - len(bin_chunk)] + broken_bin
        with self.assertRaises(gc.GltfCompatError):
            gc.make_kit_compatible(broken)

    async def test_web_compressed_model_imports_upright_and_to_scale(self):
        tmp = tempfile.mkdtemp(prefix="threews-forge-compat-")
        path = os.path.join(tmp, "box_web.glb")
        with open(path, "wb") as fh:
            fh.write(self.web)
        await omni.usd.get_context().new_stage_async()
        stage = omni.usd.get_context().get_stage()
        UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
        UsdGeom.SetStageMetersPerUnit(stage, 0.01)
        stage.SetDefaultPrim(UsdGeom.Xform.Define(stage, "/World").GetPrim())
        result = await import_glb(path, name="web box")
        cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_, UsdGeom.Tokens.render], useExtentsHint=False)
        box = cache.ComputeWorldBound(stage.GetPrimAtPath(result.prim_path)).ComputeAlignedRange()
        size = box.GetSize()
        self.assertAlmostEqual(size[0], 100.0, delta=1.0)
        self.assertAlmostEqual(size[1], 50.0, delta=1.0)
        self.assertAlmostEqual(size[2], 200.0, delta=1.0)
        self.assertAlmostEqual(box.GetMin()[2], 0.0, delta=0.5)
        self.assertTrue(os.path.isfile(os.path.join(tmp, "box_web.kit.glb")))

    async def test_undecodable_model_names_the_problem(self):
        tmp = tempfile.mkdtemp(prefix="threews-forge-compat-")
        doc, bin_chunk = gc._split_glb(self.web)
        broken = self.web[: len(self.web) - len(bin_chunk)] + bytes(len(bin_chunk))
        path = os.path.join(tmp, "broken.glb")
        with open(path, "wb") as fh:
            fh.write(broken)
        await omni.usd.get_context().new_stage_async()
        with self.assertRaises(StageImportError) as ctx:
            await import_glb(path, name="broken")
        self.assertEqual(ctx.exception.code, "unsupported_glb")
