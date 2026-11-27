"""Build-time gate for the OpenUSD exporter. No network, no GCS.

Fixtures are glTF files assembled in memory, so every number checked here is
known exactly: a 1 m textured box (watertight, so its mass is volume x density
with no approximation) and a skinned, animated, morph-targeted two-mesh column
whose two skins share joints but not bind matrices (the layout that splits
into two Skeleton prims driven by one SkelAnimation). Both must pass both
validators, and the skinned points UsdSkel computes must equal glTF linear
blend skinning of the same pose.

    python test_export.py
"""

from __future__ import annotations

import io
import json
import math
import os
import struct
import sys
import tempfile
import unittest

import numpy as np

os.environ.setdefault("API_KEY", "build-gate")
os.environ.setdefault("GCS_BUCKET", "build-gate")

import semantics  # noqa: E402
from export import ExportOptions, export_glb  # noqa: E402
from gltf_reader import InputFormatError, load_glb  # noqa: E402


# ------------------------------------------------------------ glb builder
class GlbBuilder:
    def __init__(self):
        self.bin = bytearray()
        self.doc = {"asset": {"version": "2.0"}, "buffers": [], "bufferViews": [], "accessors": [],
                    "nodes": [], "meshes": [], "scenes": [{"nodes": []}], "scene": 0}

    def view(self, data: bytes) -> int:
        while len(self.bin) % 4:
            self.bin.append(0)
        self.doc["bufferViews"].append({"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)})
        self.bin.extend(data)
        return len(self.doc["bufferViews"]) - 1

    def accessor(self, arr: np.ndarray, kind: str, ctype: int = 5126, minmax: bool = False) -> int:
        bv = self.view(arr.tobytes())
        acc = {"bufferView": bv, "componentType": ctype, "count": int(arr.shape[0]), "type": kind}
        if minmax:
            acc["min"] = arr.min(axis=0).tolist()
            acc["max"] = arr.max(axis=0).tolist()
        self.doc["accessors"].append(acc)
        return len(self.doc["accessors"]) - 1

    def node(self, **kw) -> int:
        self.doc["nodes"].append(kw)
        return len(self.doc["nodes"]) - 1

    def glb(self) -> bytes:
        while len(self.bin) % 4:
            self.bin.append(0)
        self.doc["buffers"] = [{"byteLength": len(self.bin)}]
        js = json.dumps(self.doc).encode()
        js += b" " * ((4 - len(js) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        return (struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js
                + struct.pack("<I4s", len(self.bin), b"BIN\x00") + bytes(self.bin))


def box_glb(size=1.0) -> bytes:
    """Unit cube (24 verts, per-face normals and UVs) with a PNG base color texture."""
    from PIL import Image

    h = size / 2
    faces = [((1, 0, 0), (0, 1, 0)), ((-1, 0, 0), (0, 1, 0)), ((0, 1, 0), (0, 0, 1)),
             ((0, -1, 0), (0, 0, 1)), ((0, 0, 1), (0, 1, 0)), ((0, 0, -1), (0, 1, 0))]
    pos, nrm, uv, idx = [], [], [], []
    for n, up in faces:
        n, up = np.array(n, float), np.array(up, float)
        right = np.cross(up, n)
        base = len(pos)
        for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            pos.append(n * h + right * su * h + up * sv * h)
            nrm.append(n)
            uv.append(((su + 1) / 2, (1 - sv) / 2))
        idx += [base, base + 1, base + 2, base, base + 2, base + 3]
    b = GlbBuilder()
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (180, 120, 60)).save(buf, format="PNG")
    img_view = b.view(buf.getvalue())
    b.doc["images"] = [{"bufferView": img_view, "mimeType": "image/png"}]
    b.doc["samplers"] = [{}]
    b.doc["textures"] = [{"source": 0, "sampler": 0}]
    b.doc["materials"] = [{"name": "Wood", "pbrMetallicRoughness": {
        "baseColorTexture": {"index": 0}, "metallicFactor": 0.0, "roughnessFactor": 0.7}}]
    prim = {"attributes": {
        "POSITION": b.accessor(np.array(pos, np.float32), "VEC3", minmax=True),
        "NORMAL": b.accessor(np.array(nrm, np.float32), "VEC3"),
        "TEXCOORD_0": b.accessor(np.array(uv, np.float32), "VEC2")},
        "indices": b.accessor(np.array(idx, np.uint16), "SCALAR", 5123), "material": 0}
    b.doc["meshes"].append({"name": "Box", "primitives": [prim]})
    b.doc["scenes"][0]["nodes"].append(b.node(name="Box", mesh=0))
    return b.glb()


RINGS, SEG, HEIGHT, RADIUS = 9, 12, 1.6, 0.15


def column_geometry(y0: float, y1: float):
    """Open-ended cylinder from y0 to y1 with smooth normals."""
    pos, nrm, idx = [], [], []
    for r in range(RINGS):
        y = y0 + (y1 - y0) * r / (RINGS - 1)
        for s in range(SEG):
            a = 2 * math.pi * s / SEG
            pos.append((RADIUS * math.cos(a), y, RADIUS * math.sin(a)))
            nrm.append((math.cos(a), 0, math.sin(a)))
    for r in range(RINGS - 1):
        for s in range(SEG):
            a, bb = r * SEG + s, r * SEG + (s + 1) % SEG
            c, d = a + SEG, bb + SEG
            idx += [a, c, bb, bb, c, d]
    return np.array(pos, np.float32), np.array(nrm, np.float32), np.array(idx, np.uint16)


def skinned_glb() -> tuple[bytes, dict]:
    """Two meshes (lower and upper column halves) skinned to a 2-joint chain.

    Skin 1 is authored with an offset mesh space: its points are shifted by
    +0.25 on X and its inverse binds absorb that shift, so the two skins agree
    on joints but not on bind matrices. The animation bends the upper joint
    and drives one morph target on the upper mesh.
    """
    b = GlbBuilder()
    root = b.node(name="Armature", children=[])
    j0 = b.node(name="Hips", translation=[0, 0, 0], children=[])
    j1 = b.node(name="Spine", translation=[0, HEIGHT / 2, 0])
    b.doc["nodes"][j0]["children"].append(j1)
    b.doc["nodes"][root]["children"].append(j0)
    joints = [j0, j1]
    world_bind = [np.eye(4), np.eye(4)]
    world_bind[1][1, 3] = HEIGHT / 2
    offsets = [np.zeros(3), np.array([0.25, 0, 0])]
    meshes = []
    for part, (y0, y1) in enumerate(((0, HEIGHT / 2), (HEIGHT / 2, HEIGHT))):
        pos, nrm, idx = column_geometry(y0, y1)
        pos = pos + offsets[part].astype(np.float32)
        t = np.clip((pos[:, 1] - offsets[part][1]) / HEIGHT, 0, 1)
        w1 = np.clip((t - 0.25) / 0.5, 0, 1).astype(np.float32)
        weights = np.stack([1 - w1, w1, np.zeros_like(w1), np.zeros_like(w1)], axis=1)
        jidx = np.tile(np.array([0, 1, 0, 0], np.uint8), (len(pos), 1))
        shift = np.eye(4)
        shift[:3, 3] = -offsets[part]
        ibs = np.stack([np.linalg.inv(world_bind[i]) @ shift for i in range(2)]).astype(np.float32)
        ib_acc = b.accessor(ibs.transpose(0, 2, 1).reshape(2, 16).copy(), "MAT4")
        b.doc.setdefault("skins", []).append({"joints": joints, "inverseBindMatrices": ib_acc, "name": f"Skin{part}"})
        attrs = {"POSITION": b.accessor(pos, "VEC3", minmax=True), "NORMAL": b.accessor(nrm, "VEC3"),
                 "JOINTS_0": b.accessor(jidx, "VEC4", 5121), "WEIGHTS_0": b.accessor(weights, "VEC4")}
        prim = {"attributes": attrs, "indices": b.accessor(idx, "SCALAR", 5123)}
        mesh = {"name": f"Column{part}", "primitives": [prim]}
        if part == 1:
            bulge = np.zeros_like(pos)
            bulge[:, [0, 2]] = pos[:, [0, 2]] - offsets[part][[0, 2]]
            bulge *= 0.5 * (np.abs(pos[:, 1] - 1.2) < 0.15)[:, None]
            prim["targets"] = [{"POSITION": b.accessor(bulge.astype(np.float32), "VEC3", minmax=True)}]
            mesh["extras"] = {"targetNames": ["Bulge"]}
            mesh["weights"] = [0.0]
        b.doc["meshes"].append(mesh)
        meshes.append(b.node(name=f"Column{part}", mesh=part, skin=part))
    b.doc["scenes"][0]["nodes"] += [root, *meshes]
    times = np.array([[0.0], [0.5], [1.0]], np.float32)
    ang = np.radians([0.0, 40.0, 0.0])
    rots = np.array([[0, 0, math.sin(a / 2), math.cos(a / 2)] for a in ang], np.float32)
    wts = np.array([[0.0], [1.0], [0.0]], np.float32)
    t_acc = b.accessor(times, "SCALAR", minmax=True)
    b.doc["animations"] = [{"name": "Bend", "samplers": [
        {"input": t_acc, "output": b.accessor(rots, "VEC4"), "interpolation": "LINEAR"},
        {"input": t_acc, "output": b.accessor(wts.reshape(-1, 1), "SCALAR"), "interpolation": "LINEAR"}],
        "channels": [{"sampler": 0, "target": {"node": j1, "path": "rotation"}},
                     {"sampler": 1, "target": {"node": meshes[1], "path": "weights"}}]}]
    return b.glb(), {"joints": joints, "spine": j1}


# ------------------------------------------------------------------ tests
class ExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="usd-export-test-")

    def out(self, name: str) -> str:
        return os.path.join(self.tmp, name)

    def assert_validated(self, rep: dict):
        v = rep["validation"]
        for kind in ("usd", "usdz"):
            for tool in ("usdchecker", "asset_validator"):
                self.assertEqual(v[kind][tool]["errors"], [], f"{kind} {tool} errors")
        self.assertTrue(v["passed"])

    def test_box_prop_is_simulation_ready(self):
        from pxr import Usd, UsdGeom, UsdPhysics, UsdSemantics

        stages = []
        rep = export_glb(box_glb(size=0.6), self.out("box"), ExportOptions(prompt="a wooden crate"), on_stage=stages.append)
        self.assertEqual(stages, ["converting", "physics", "packaging", "validating"])
        self.assert_validated(rep)
        self.assertEqual(rep["semantics"]["label"], "box")
        # 0.6 m is the box class size, so native size is kept and mass is exact.
        self.assertEqual(rep["scale"]["method"], "native")
        dens = rep["semantics"]["density"]
        self.assertAlmostEqual(rep["physics"]["mass_kg"], dens * 0.216, places=2)
        self.assertIn("watertight", rep["physics"]["mass_method"])
        self.assertEqual(rep["physics"]["collision"]["tool"], "CoACD")

        stage = Usd.Stage.Open(self.out("box/asset.usd"))
        self.assertEqual(UsdGeom.GetStageUpAxis(stage), UsdGeom.Tokens.z)
        self.assertEqual(UsdGeom.GetStageMetersPerUnit(stage), 1.0)
        root = stage.GetDefaultPrim()
        self.assertTrue(root.HasAPI(UsdPhysics.RigidBodyAPI))
        self.assertTrue(root.HasAPI(UsdPhysics.MassAPI))
        labels = UsdSemantics.LabelsAPI(root, "class").GetLabelsAttr().Get()
        self.assertEqual(list(labels), ["box"])
        hulls = [p for p in stage.Traverse() if p.HasAPI(UsdPhysics.CollisionAPI)]
        self.assertGreaterEqual(len(hulls), 1)
        bbox = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_]).ComputeWorldBound(root).ComputeAlignedRange()
        self.assertAlmostEqual(bbox.GetMin()[2], 0.0, places=4)  # stands on the ground plane
        self.assertAlmostEqual(bbox.GetMax()[2], 0.6, places=4)
        self.assertTrue(stage.GetRootLayer().customLayerData["threews"]["physics"]["mass_method"])

    def test_implausible_size_is_rescaled_to_class_size(self):
        # Generative lanes fit output to a ~1.87 unit box; a 1.87 m mug is not a mug.
        rep = export_glb(box_glb(size=1.87), self.out("mug"), ExportOptions(prompt="ceramic coffee mug", validate=False))
        cls = semantics.classify("ceramic coffee mug", None).cls
        self.assertEqual(rep["scale"]["method"], "category-typical-size")
        self.assertAlmostEqual(max(rep["stats"]["size_m"]), cls.size_m, places=3)
        self.assertAlmostEqual(rep["physics"]["mass_kg"], cls.density * cls.size_m ** 3, places=3)

    def test_caller_overrides_win(self):
        rep = export_glb(box_glb(), self.out("override"), ExportOptions(
            prompt="a wooden crate", label="pallet", size_m=2.0, density_kg_m3=500, validate=False))
        self.assertEqual(rep["semantics"]["label"], "pallet")
        self.assertEqual(rep["scale"]["method"], "caller-size")
        self.assertAlmostEqual(max(rep["stats"]["size_m"]), 2.0, places=3)
        self.assertAlmostEqual(rep["physics"]["mass_kg"], 500 * 8.0, places=1)

    def test_skinned_animated_export_matches_gltf_skinning(self):
        from pxr import Usd, UsdGeom, UsdSkel, Vt

        glb, info = skinned_glb()
        rep = export_glb(glb, self.out("skinned"), ExportOptions(prompt="character", category="avatar"))
        self.assert_validated(rep)
        self.assertTrue(rep["rigged"])
        self.assertTrue(rep["animated"])
        self.assertEqual(rep["stats"]["skeletons"], 2)   # bind matrices differ
        self.assertEqual(rep["stats"]["joints"], 2)
        self.assertEqual(rep["stats"]["animations"], 1)  # one SkelAnimation drives both
        self.assertEqual(rep["stats"]["blend_shapes"], 1)
        self.assertEqual(rep["physics"]["body"].split()[0], "kinematic")

        stage = Usd.Stage.Open(self.out("skinned/asset.usd"))
        root = UsdSkel.Root(stage.GetDefaultPrim())
        self.assertTrue(root)
        anims = [p for p in stage.Traverse() if p.IsA(UsdSkel.Animation)]
        self.assertEqual(len(anims), 1)

        from gltf_to_usd import Converter, ExportReport, _apply, _posed_world, placement
        from gltf_reader import load_glb as _load

        conv = Converter(_load(glb), ExportReport())
        prims = conv.collect_primitives()
        k = placement(conv.rest_world_points(prims), rep["stats"]["scale"])
        anim = conv.doc["animations"][0]
        by = {}
        for ch in anim["channels"]:
            if ch["target"]["path"] == "weights":
                continue
            smp = anim["samplers"][ch["sampler"]]
            by.setdefault(ch["target"]["node"], []).append(
                (ch["target"]["path"], conv.g.accessor(smp["input"])[:, 0], conv.g.accessor(smp["output"]), "LINEAR"))
        cache = UsdSkel.Cache()
        cache.Populate(root, Usd.PrimDefaultPredicate)
        bindings = cache.ComputeSkelBindings(root, Usd.PrimDefaultPredicate)
        self.assertEqual(len(bindings), 2)
        for frame in (0, 15, 30):
            world = _posed_world(conv, by, set(by), frame / 30.0)
            bulge_w = 1.0 - abs(frame / 30.0 - 0.5) * 2
            for binding in bindings:
                sq = cache.GetSkelQuery(binding.GetSkeleton())
                xf = sq.ComputeSkinningTransforms(Usd.TimeCode(frame))
                for target in binding.GetSkinningTargets():
                    prim = target.GetPrim()
                    part = int(prim.GetName()[-1])
                    p = prims[part]
                    pts = np.array(UsdGeom.Mesh(prim).GetPointsAttr().Get(), dtype=np.float64)
                    if part == 1:
                        # blend shapes apply before skinning, in the authored point space
                        bs = UsdSkel.BlendShape(stage.GetPrimAtPath(prim.GetPath().AppendChild("Bulge")))
                        ids = np.array(bs.GetPointIndicesAttr().Get())
                        pts[ids] += bulge_w * np.array(bs.GetOffsetsAttr().Get())
                    vp = Vt.Vec3fArray.FromNumpy(pts.astype(np.float32))
                    self.assertTrue(target.ComputeSkinnedPoints(xf, vp, Usd.TimeCode(frame)))
                    got = np.array(vp)
                    ib = conv.inverse_binds(p.skin)
                    skin = conv.doc["skins"][p.skin]
                    jm = np.stack([world[j] @ ib[i] for i, j in enumerate(skin["joints"])])
                    src = p.points.copy()
                    if part == 1:
                        src = src + bulge_w * p.targets[0][1]
                    w = p.weights / p.weights.sum(axis=1, keepdims=True)
                    hom = np.c_[src, np.ones(len(src))]
                    ref = sum(w[:, c:c + 1] * np.einsum("vij,vj->vi", jm[p.joints[:, c]], hom)[:, :3]
                              for c in range(p.joints.shape[1]))
                    err = np.abs(got - _apply(k, ref)).max()
                    self.assertLess(err, 1e-4, f"frame {frame} part {part} skinning error {err}")

    def test_draco_input_is_refused_with_a_reason(self):
        b = GlbBuilder()
        b.doc["extensionsRequired"] = ["KHR_draco_mesh_compression"]
        b.doc["extensionsUsed"] = ["KHR_draco_mesh_compression"]
        with self.assertRaises(InputFormatError) as ctx:
            load_glb(b.glb())
        self.assertIn("draco", str(ctx.exception).lower())


class SemanticsTests(unittest.TestCase):
    def test_prompt_classification(self):
        c = semantics.classify("a weathered wooden chair with armrests", None)
        self.assertEqual((c.cls.label, c.cls.group, c.source), ("chair", "furniture", "prompt"))
        self.assertEqual(semantics.classify("red sports car", None).cls.group, "vehicle")
        self.assertEqual(semantics.classify("ceramic coffee mug", None).cls.label, "cup")

    def test_head_noun_beats_a_modifier_noun(self):
        # "basketball" modifies "sneakers"; the object is footwear, not a ball.
        c = semantics.classify("a pair of retro chunky-sole basketball sneakers in black and gold", None)
        self.assertEqual(c.cls.label, "shoe")
        self.assertEqual(semantics.classify("a dining table with a chair", None).cls.label, "table")
        self.assertEqual(semantics.classify("upholstered dining chair, dark wood frame", None).cls.label, "chair")
        self.assertEqual(semantics.classify("Stylized flying squirrel standing on all four legs", None).cls.group, "animal")

    def test_small_vehicles_are_not_cars(self):
        # A go-kart is a vehicle, but scaled as a 4.5 m car it would be wrong
        # by a factor of 2.5 in every axis (and its mass by far more).
        for prompt in ("a go-kart with roll bar, weathered post-apocalyptic", "racing kart", "dune buggy", "an ATV quad bike"):
            c = semantics.classify(prompt, "vehicle")
            self.assertEqual((c.cls.group, c.source), ("vehicle", "prompt"), prompt)
            self.assertLess(c.cls.size_m, 3.0, prompt)
        self.assertEqual(semantics.classify("golf cart", None).cls.label, "kart")

    def test_rigged_falls_back_to_avatar(self):
        c = semantics.classify("auto-rig", "avatar", rigged=True)
        self.assertEqual(c.cls.group, "character")

    def test_unknown_prompt_uses_generic_class(self):
        c = semantics.classify("zxqv", None)
        self.assertEqual(c.cls.label, semantics.GENERIC.label)

    def test_asset_name_is_a_valid_identifier(self):
        from pxr import Sdf

        for prompt in ("a wooden chair!", "3d model of a car", "", None, "日本の城"):
            name = semantics.asset_name(prompt, "chair")
            self.assertTrue(Sdf.Path.IsValidIdentifier(name), name)


class ServiceTests(unittest.TestCase):
    def test_task_key_is_content_addressed(self):
        import main

        a = main.ExportRequest(glb_url="https://three.ws/a.glb", prompt="chair", creation_id="x")
        b = main.ExportRequest(glb_url="https://three.ws/a.glb", prompt="chair", creation_id="y")
        c = main.ExportRequest(glb_url="https://three.ws/a.glb", prompt="table")
        self.assertEqual(main.task_key(a), main.task_key(b))
        self.assertNotEqual(main.task_key(a), main.task_key(c))

    def test_request_requires_https(self):
        import main
        from pydantic import ValidationError

        with self.assertRaises(ValidationError):
            main.ExportRequest(glb_url="http://three.ws/a.glb")
        with self.assertRaises(ValidationError):
            main.ExportRequest(glb_url="https://three.ws/a.glb", size_m=-1)


if __name__ == "__main__":
    result = unittest.main(exit=False, verbosity=2).result
    sys.exit(0 if result.wasSuccessful() else 1)
