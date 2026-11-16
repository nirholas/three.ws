"""Bring a three.ws model into the open USD stage.

A Forge GLB is glTF: Y-up, one unit per meter. Kit stages are commonly Z-up in
centimeters, so a raw reference lands lying on its back at 1/100 scale. This
module converts the GLB with the Kit asset converter, reads the converted
layer's own ``upAxis`` and ``metersPerUnit``, and authors the correction on an
inner prim so the outer prim stays a clean handle for the user:

    /World/threews/<name>          Xform, placed (translate only, user-editable)
        asset                      reference + unit scale + up-axis rotate + grounding

The model is grounded (lowest point on the floor) and centered on the
placement point. Every stage edit goes through ``omni.kit.commands`` inside one
undo group, so a single Ctrl+Z removes the whole import.
"""

from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass
from typing import Optional, Tuple

import carb
import omni.kit.commands
import omni.kit.undo
import omni.usd
from pxr import Gf, Sdf, Usd, UsdGeom

PARENT_NAME = "threews"


class StageImportError(Exception):
    def __init__(self, message: str, *, code: str = "import_failed", hint: str = ""):
        super().__init__(message)
        self.message = message
        self.code = code
        self.hint = hint
        self.url = ""

    def __str__(self) -> str:
        return f"{self.message} {self.hint}".strip()


@dataclass
class ImportResult:
    prim_path: str
    asset_path: str
    usd_path: str
    placement: str
    up_axis_source: str
    up_axis_stage: str
    meters_per_unit_source: float
    meters_per_unit_stage: float
    size_meters: Tuple[float, float, float]
    convert_seconds: float


def _identifier(name: str) -> str:
    ident = re.sub(r"[^A-Za-z0-9_]", "_", (name or "").strip())[:48].strip("_") or "model"
    if ident[0].isdigit():
        ident = f"m_{ident}"
    return ident


async def convert_glb_to_usd(glb_path: str, usd_path: Optional[str] = None) -> Tuple[str, float]:
    """Convert a GLB to USD with ``omni.kit.asset_converter``; return (path, seconds).

    A conversion already on disk that is newer than the GLB is reused.
    """
    import time

    import omni.kit.asset_converter as converter

    if not os.path.isfile(glb_path):
        raise StageImportError(f"Model file not found: {glb_path}", code="missing_file")
    out = usd_path or os.path.splitext(glb_path)[0] + ".usd"
    if os.path.isfile(out) and os.path.getmtime(out) >= os.path.getmtime(glb_path):
        return out, 0.0
    started = time.monotonic()
    source = _converter_input(glb_path)
    ctx = converter.AssetConverterContext()
    ctx.use_meter_as_world_unit = True
    ctx.create_world_as_default_root_prim = True
    ctx.embed_textures = True
    ctx.export_preview_surface = True
    ctx.keep_all_materials = False
    ctx.smooth_normals = True
    task = converter.get_instance().create_converter_task(source, out, None, ctx)
    ok = await task.wait_until_finished()
    if not ok or not os.path.isfile(out):
        raise StageImportError(
            f"The Kit asset converter could not convert the model: {task.get_error_message() or 'unknown error'}",
            code="convert_failed",
            hint="The GLB is kept in the cache; try the import again or open it with File > Import.",
        )
    return out, round(time.monotonic() - started, 2)


def _converter_input(glb_path: str) -> str:
    """The GLB the converter should read: a plain-glTF rewrite when the original
    uses web compression the converter cannot decode (see gltf_compat)."""
    from .gltf_compat import GltfCompatError, make_kit_compatible, needs_rewrite

    with open(glb_path, "rb") as fh:
        data = fh.read()
    if not needs_rewrite(data):
        return glb_path
    try:
        plain = make_kit_compatible(data)
    except GltfCompatError as exc:
        raise StageImportError(
            f"This model uses a GLB encoding the importer cannot read: {exc}.",
            code="unsupported_glb",
            hint="Download it from three.ws and re-export it as a plain GLB, then use File > Import.",
        ) from exc
    rewritten = os.path.splitext(glb_path)[0] + ".kit.glb"
    with open(rewritten, "wb") as fh:
        fh.write(plain)
    return rewritten


def _layer_units(usd_path: str) -> Tuple[str, float]:
    stage = Usd.Stage.Open(usd_path, Usd.Stage.LoadNone)
    if stage is None:
        raise StageImportError(f"Could not open the converted USD: {usd_path}", code="convert_failed")
    up = UsdGeom.GetStageUpAxis(stage)
    mpu = UsdGeom.GetStageMetersPerUnit(stage) if stage.HasAuthoredMetadata("metersPerUnit") else 1.0
    return up, float(mpu or 1.0)


def up_axis_rotation(source_up: str, stage_up: str) -> Gf.Vec3d:
    """Euler XYZ degrees that turn a ``source_up`` asset upright in a ``stage_up`` stage."""
    if source_up == stage_up:
        return Gf.Vec3d(0.0, 0.0, 0.0)
    if source_up == UsdGeom.Tokens.y and stage_up == UsdGeom.Tokens.z:
        return Gf.Vec3d(90.0, 0.0, 0.0)
    return Gf.Vec3d(-90.0, 0.0, 0.0)


def _root_path(stage: Usd.Stage) -> Sdf.Path:
    default = stage.GetDefaultPrim()
    if default and default.IsValid():
        return default.GetPath()
    return Sdf.Path("/World")


def _ensure_xform(path: Sdf.Path, stage: Usd.Stage) -> None:
    prim = stage.GetPrimAtPath(path)
    if prim and prim.IsValid():
        return
    omni.kit.commands.execute(
        "CreatePrimWithDefaultXform", prim_type="Xform", prim_path=str(path), select_new_prim=False, stage=stage
    )


def placement_point(stage: Usd.Stage, mode: str, distance: float) -> Tuple[Gf.Vec3d, str]:
    """Where to put the model, in stage units, and which mode was actually used."""
    up = UsdGeom.GetStageUpAxis(stage)
    up_index = 2 if up == UsdGeom.Tokens.z else 1
    if mode == "selection":
        ctx = omni.usd.get_context()
        for path in ctx.get_selection().get_selected_prim_paths():
            prim = stage.GetPrimAtPath(path)
            if prim and prim.IsA(UsdGeom.Xformable):
                xf = omni.usd.get_world_transform_matrix(prim)
                return Gf.Vec3d(xf.ExtractTranslation()), "selection"
    if mode == "camera":
        cam_path = _active_camera_path()
        prim = stage.GetPrimAtPath(cam_path) if cam_path else None
        if prim and prim.IsValid():
            xf = omni.usd.get_world_transform_matrix(prim)
            pos = Gf.Vec3d(xf.ExtractTranslation())
            forward = xf.TransformDir(Gf.Vec3d(0.0, 0.0, -1.0))
            # Look straight ahead along the floor, never into it or the sky.
            forward[up_index] = 0.0
            if forward.GetLength() < 1e-6:
                forward = Gf.Vec3d(0.0, 1.0, 0.0) if up_index == 2 else Gf.Vec3d(0.0, 0.0, -1.0)
            forward = forward.GetNormalized()
            point = pos + forward * distance
            point[up_index] = 0.0
            return point, "camera"
    return Gf.Vec3d(0.0, 0.0, 0.0), "origin"


def _active_camera_path() -> str:
    try:
        from omni.kit.viewport.utility import get_active_viewport
    except ImportError:
        return ""
    viewport = get_active_viewport()
    return str(viewport.camera_path) if viewport else ""


async def import_glb(
    glb_path: str,
    *,
    name: str,
    placement: str = "origin",
    metadata: Optional[dict] = None,
    select: bool = True,
) -> ImportResult:
    """Convert a GLB and reference it into the current stage."""
    usd_path, seconds = await convert_glb_to_usd(glb_path)
    return import_usd(usd_path, name=name, placement=placement, metadata=metadata, select=select, source_path=glb_path, convert_seconds=seconds)


def import_usd(
    usd_path: str,
    *,
    name: str,
    placement: str = "origin",
    metadata: Optional[dict] = None,
    select: bool = True,
    source_path: str = "",
    convert_seconds: float = 0.0,
) -> ImportResult:
    """Reference a USD, USDA, USDC or USDZ file into the current stage, upright and to scale."""
    ctx = omni.usd.get_context()
    stage = ctx.get_stage()
    if stage is None:
        raise StageImportError("There is no open stage to import into.", code="no_stage", hint="Create or open a stage first.")

    source_up, source_mpu = _layer_units(usd_path)
    stage_up = UsdGeom.GetStageUpAxis(stage)
    stage_mpu = float(UsdGeom.GetStageMetersPerUnit(stage) or 0.01)
    scale = source_mpu / stage_mpu
    rotation = up_axis_rotation(source_up, stage_up)
    up_index = 2 if stage_up == UsdGeom.Tokens.z else 1

    root = _root_path(stage)
    parent = root.AppendChild(PARENT_NAME)
    with omni.kit.undo.group():
        _ensure_xform(root, stage)
        _ensure_xform(parent, stage)
        outer = Sdf.Path(omni.usd.get_stage_next_free_path(stage, str(parent.AppendChild(_identifier(name))), False))
        omni.kit.commands.execute(
            "CreatePrimWithDefaultXform", prim_type="Xform", prim_path=str(outer), select_new_prim=False, stage=stage
        )
        inner = outer.AppendChild("asset")
        omni.kit.commands.execute(
            "CreateReference",
            usd_context=ctx,
            path_to=inner,
            asset_path=usd_path,
            instanceable=False,
            select_prim=False,
        )
        omni.kit.commands.execute(
            "TransformPrimSRT",
            path=str(inner),
            new_translation=Gf.Vec3d(0.0, 0.0, 0.0),
            new_rotation_euler=rotation,
            new_rotation_order=Gf.Vec3i(0, 1, 2),
            new_scale=Gf.Vec3d(scale, scale, scale),
        )
        box = _relative_box(stage, inner, outer)
        size = box.GetSize()
        center = box.GetMidpoint()
        grounding = Gf.Vec3d(-center[0], -center[1], -center[2])
        grounding[up_index] = -box.GetMin()[up_index]
        omni.kit.commands.execute("TransformPrimSRT", path=str(inner), new_translation=grounding)

        distance = max(2.0 / stage_mpu, 3.0 * max(size[0], size[1], size[2]))
        point, used = placement_point(stage, placement, distance)
        omni.kit.commands.execute("TransformPrimSRT", path=str(outer), new_translation=point)

        prim = stage.GetPrimAtPath(outer)
        prim.SetCustomDataByKey("threews:source", source_path or usd_path)
        for key, value in (metadata or {}).items():
            if isinstance(value, (str, int, float, bool)) and value != "":
                prim.SetCustomDataByKey(f"threews:{key}", value)
        if select:
            ctx.get_selection().set_selected_prim_paths([str(outer)], True)

    carb.log_info(f"[threews.forge] imported {os.path.basename(usd_path)} at {outer} ({used})")
    return ImportResult(
        prim_path=str(outer),
        asset_path=source_path or usd_path,
        usd_path=usd_path,
        placement=used,
        up_axis_source=str(source_up),
        up_axis_stage=str(stage_up),
        meters_per_unit_source=source_mpu,
        meters_per_unit_stage=stage_mpu,
        size_meters=tuple(round(float(s) * stage_mpu, 4) for s in size),
        convert_seconds=convert_seconds,
    )


def _relative_box(stage: Usd.Stage, prim_path: Sdf.Path, relative_to: Sdf.Path) -> Gf.Range3d:
    cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_, UsdGeom.Tokens.render], useExtentsHint=False)
    prim = stage.GetPrimAtPath(prim_path)
    base = stage.GetPrimAtPath(relative_to)
    bound = cache.ComputeRelativeBound(prim, base)
    box = bound.ComputeAlignedRange()
    if box.IsEmpty() or any(math.isnan(v) for v in (*box.GetMin(), *box.GetMax())):
        raise StageImportError(
            "The converted model has no visible geometry.",
            code="empty_geometry",
            hint="Try generating again; the source file may be damaged.",
        )
    return box


def world_size(prim_path: str) -> Tuple[float, float, float]:
    """World-space bounding box size of a prim, in stage units."""
    stage = omni.usd.get_context().get_stage()
    cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_, UsdGeom.Tokens.render], useExtentsHint=False)
    box = cache.ComputeWorldBound(stage.GetPrimAtPath(prim_path)).ComputeAlignedRange()
    size = box.GetSize()
    return float(size[0]), float(size[1]), float(size[2])
