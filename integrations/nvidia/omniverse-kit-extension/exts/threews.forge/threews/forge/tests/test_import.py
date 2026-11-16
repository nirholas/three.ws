"""The import lands upright, to scale, grounded and undoable, whatever the
stage's up axis and units are."""

from __future__ import annotations

import os
import tempfile

import omni.kit.commands
import omni.kit.test
import omni.kit.undo
import omni.usd
from pxr import Gf, Sdf, Usd, UsdGeom

from ..stage_import import StageImportError, import_glb, import_usd, up_axis_rotation, world_size
from .glb_fixture import box_glb

# The fixture box: 1 m wide (X), 2 m tall (glTF Y up), 0.5 m deep (Z), floating 1 m up.
WIDTH, HEIGHT, DEPTH = 1.0, 2.0, 0.5


def _world_box(prim_path: str) -> Gf.Range3d:
    stage = omni.usd.get_context().get_stage()
    cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_, UsdGeom.Tokens.render], useExtentsHint=False)
    return cache.ComputeWorldBound(stage.GetPrimAtPath(prim_path)).ComputeAlignedRange()


class TestStageImport(omni.kit.test.AsyncTestCase):
    async def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="threews-forge-import-")
        self.glb = os.path.join(self.tmp, "box.glb")
        with open(self.glb, "wb") as fh:
            fh.write(box_glb())

    async def _new_stage(self, up: str, meters_per_unit: float) -> Usd.Stage:
        await omni.usd.get_context().new_stage_async()
        stage = omni.usd.get_context().get_stage()
        UsdGeom.SetStageUpAxis(stage, up)
        UsdGeom.SetStageMetersPerUnit(stage, meters_per_unit)
        world = UsdGeom.Xform.Define(stage, "/World")
        stage.SetDefaultPrim(world.GetPrim())
        return stage

    def _assert_close(self, actual, expected, tol, label):
        self.assertAlmostEqual(float(actual), float(expected), delta=tol, msg=f"{label}: {actual} vs {expected}")

    async def test_z_up_centimeter_stage(self):
        await self._new_stage(UsdGeom.Tokens.z, 0.01)
        result = await import_glb(self.glb, name="box z-up cm")
        box = _world_box(result.prim_path)
        size = box.GetSize()
        self._assert_close(size[0], WIDTH * 100, 0.5, "X width in cm")
        self._assert_close(size[1], DEPTH * 100, 0.5, "Y depth in cm")
        self._assert_close(size[2], HEIGHT * 100, 0.5, "Z height in cm (upright)")
        self._assert_close(box.GetMin()[2], 0.0, 0.5, "grounded on Z=0")
        self._assert_close(box.GetMidpoint()[0], 0.0, 0.5, "centered on X")
        self._assert_close(box.GetMidpoint()[1], 0.0, 0.5, "centered on Y")
        self.assertEqual(result.up_axis_stage, "Z")
        self.assertEqual(result.placement, "origin")
        for got, want in zip(result.size_meters, (WIDTH, DEPTH, HEIGHT)):
            self._assert_close(got, want, 0.01, "reported size in meters")
        self.assertTrue(result.prim_path.startswith("/World/threews/box_z_up_cm"))

    async def test_y_up_meter_stage(self):
        await self._new_stage(UsdGeom.Tokens.y, 1.0)
        result = await import_glb(self.glb, name="box y-up m")
        box = _world_box(result.prim_path)
        size = box.GetSize()
        self._assert_close(size[0], WIDTH, 0.01, "X width in m")
        self._assert_close(size[1], HEIGHT, 0.01, "Y height in m (upright)")
        self._assert_close(size[2], DEPTH, 0.01, "Z depth in m")
        self._assert_close(box.GetMin()[1], 0.0, 0.01, "grounded on Y=0")

    async def test_outer_prim_is_a_clean_translate_only_handle(self):
        stage = await self._new_stage(UsdGeom.Tokens.z, 0.01)
        result = await import_glb(self.glb, name="handle")
        outer = UsdGeom.Xformable(stage.GetPrimAtPath(result.prim_path))
        local = outer.GetLocalTransformation()
        self.assertTrue(Gf.IsClose(local.ExtractRotationMatrix(), Gf.Matrix3d(1.0), 1e-9))
        inner = stage.GetPrimAtPath(f"{result.prim_path}/asset")
        self.assertTrue(inner.HasAuthoredReferences())
        self.assertEqual(stage.GetPrimAtPath(result.prim_path).GetCustomDataByKey("threews:source"), self.glb)

    async def test_selection_placement_lands_at_the_selected_prim(self):
        stage = await self._new_stage(UsdGeom.Tokens.z, 0.01)
        target = UsdGeom.Xform.Define(stage, "/World/target")
        target.AddTranslateOp().Set(Gf.Vec3d(300.0, -150.0, 0.0))
        omni.usd.get_context().get_selection().set_selected_prim_paths(["/World/target"], True)
        result = await import_glb(self.glb, name="near target", placement="selection")
        self.assertEqual(result.placement, "selection")
        mid = _world_box(result.prim_path).GetMidpoint()
        self._assert_close(mid[0], 300.0, 0.5, "X at target")
        self._assert_close(mid[1], -150.0, 0.5, "Y at target")

    async def test_selection_placement_without_selection_falls_back_to_origin(self):
        await self._new_stage(UsdGeom.Tokens.z, 0.01)
        omni.usd.get_context().get_selection().clear_selected_prim_paths()
        result = await import_glb(self.glb, name="fallback", placement="selection")
        self.assertEqual(result.placement, "origin")

    async def test_two_imports_get_unique_paths(self):
        await self._new_stage(UsdGeom.Tokens.z, 0.01)
        first = await import_glb(self.glb, name="twin", select=False)
        second = await import_glb(self.glb, name="twin", select=False)
        self.assertNotEqual(first.prim_path, second.prim_path)

    async def test_one_undo_removes_the_whole_import(self):
        stage = await self._new_stage(UsdGeom.Tokens.z, 0.01)
        result = await import_glb(self.glb, name="undo me")
        self.assertTrue(stage.GetPrimAtPath(result.prim_path).IsValid())
        omni.kit.undo.undo()
        self.assertFalse(stage.GetPrimAtPath(result.prim_path).IsValid())

    async def test_converter_output_is_cached(self):
        await self._new_stage(UsdGeom.Tokens.z, 0.01)
        first = await import_glb(self.glb, name="cache a", select=False)
        second = await import_glb(self.glb, name="cache b", select=False)
        self.assertEqual(first.usd_path, second.usd_path)
        self.assertEqual(second.convert_seconds, 0.0)

    async def test_usd_without_geometry_is_rejected(self):
        await self._new_stage(UsdGeom.Tokens.z, 0.01)
        empty = os.path.join(self.tmp, "empty.usda")
        layer = Usd.Stage.CreateNew(empty)
        layer.SetDefaultPrim(UsdGeom.Xform.Define(layer, "/Root").GetPrim())
        layer.GetRootLayer().Save()
        with self.assertRaises(StageImportError) as ctx:
            import_usd(empty, name="empty")
        self.assertEqual(ctx.exception.code, "empty_geometry")

    async def test_missing_file_is_named(self):
        await self._new_stage(UsdGeom.Tokens.z, 0.01)
        with self.assertRaises(StageImportError) as ctx:
            await import_glb(os.path.join(self.tmp, "nope.glb"), name="nope")
        self.assertEqual(ctx.exception.code, "missing_file")

    async def test_up_axis_rotation_table(self):
        self.assertEqual(up_axis_rotation("Y", "Y"), Gf.Vec3d(0, 0, 0))
        self.assertEqual(up_axis_rotation("Y", "Z"), Gf.Vec3d(90, 0, 0))
        self.assertEqual(up_axis_rotation("Z", "Y"), Gf.Vec3d(-90, 0, 0))

    async def test_world_size_matches_reported_size(self):
        await self._new_stage(UsdGeom.Tokens.z, 0.01)
        result = await import_glb(self.glb, name="sized")
        size = world_size(result.prim_path)
        self._assert_close(size[2], HEIGHT * 100, 0.5, "world_size Z")
