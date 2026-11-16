"""GLB bytes -> validated, simulation-ready OpenUSD package on disk.

    python export.py model.glb out_dir --prompt "wooden chair" [--category item]

writes into out_dir:

    asset.usda        human-readable root layer
    asset.usd         the same stage as binary crate (what Omniverse opens fastest)
    asset.usdz        single self-contained package (crate + textures)
    textures/*.png|jpg
    asset.zip         asset.usd + asset.usda + textures/ for desktop tools
    report.json       classification, physics record, stats, both validator reports
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
import zipfile
from dataclasses import dataclass
from typing import Callable, Optional

from pxr import Kind, Sdf, Usd, UsdSemantics, UsdUtils, Vt

import physics
import semantics
from gltf_reader import InputFormatError, load_glb
from gltf_to_usd import Converter, ExportReport, build_stage
from validate import validate_files

EXPORTER_VERSION = "threews.usd.export.v1"
# Generative lanes fit output into a one or two unit box (TripoSG lands near
# 1.87, TRELLIS and Hunyuan3D near 1.0), so a native size says nothing about
# the real object. A prop keeps its native size only when it is already within
# this factor of its class's typical size; otherwise it is rescaled to it.
PLAUSIBLE_SIZE_FACTOR = 1.5
RIGGED_NATIVE_RANGE = (0.3, 3.0)


@dataclass
class ExportOptions:
    prompt: Optional[str] = None
    category: Optional[str] = None       # forge model_category
    label: Optional[str] = None          # caller override of the semantic class label
    size_m: Optional[float] = None       # caller override of the longest dimension
    density_kg_m3: Optional[float] = None
    source_url: Optional[str] = None
    creation_id: Optional[str] = None
    physics: bool = True
    validate: bool = True


def _scale_policy(cls, rigged: bool, opts: ExportOptions, record: dict):
    def scale_for(native_size):
        longest = float(max(native_size)) or 1.0
        if opts.size_m:
            record.update(method="caller-size", target_longest_m=opts.size_m)
            return opts.size_m / longest
        if rigged and RIGGED_NATIVE_RANGE[0] <= longest <= RIGGED_NATIVE_RANGE[1]:
            record.update(method="native", reason="rigged character already at a plausible human scale")
            return 1.0
        if cls.size_m and not (cls.size_m / PLAUSIBLE_SIZE_FACTOR <= longest <= cls.size_m * PLAUSIBLE_SIZE_FACTOR):
            record.update(method="category-typical-size", target_longest_m=cls.size_m,
                          reason=f"native longest side {round(longest, 3)} m is implausible for a {cls.label}")
            return cls.size_m / longest
        record.update(method="native", reason="native size is plausible for the class" if cls.size_m
                      else "no typical size for the class, native size kept")
        return 1.0
    return scale_for


STAGES = ("converting", "physics", "packaging", "validating")


def export_glb(glb: bytes, out_dir: str, opts: ExportOptions,
               on_stage: Optional[Callable[[str], None]] = None) -> dict:
    """Run the whole export. `on_stage(name)` is called as each of STAGES begins."""
    t0 = time.monotonic()
    stage_cb = on_stage or (lambda _name: None)
    stage_cb("converting")
    os.makedirs(out_dir, exist_ok=True)
    gltf = load_glb(glb)
    report = ExportReport()
    conv = Converter(gltf, report)
    rigged = conv.is_rigged()
    cls_info = semantics.classify(opts.prompt, opts.category, rigged=rigged)
    cls = cls_info.cls
    if opts.label:
        cls = semantics.ObjectClass(**{**cls.to_dict(), "label": opts.label.strip()[:64]})
    if opts.density_kg_m3:
        cls = semantics.ObjectClass(**{**cls.to_dict(), "density": float(opts.density_kg_m3)})
    scale_record: dict = {}
    usda = os.path.join(out_dir, "asset.usda")
    if os.path.exists(usda):
        os.remove(usda)
    root_name = semantics.asset_name(opts.prompt, cls.label)
    result = build_stage(conv, root_name=root_name, scale_for=_scale_policy(cls, rigged, opts, scale_record),
                         out_layer_path=usda)
    stage = result.stage
    root = stage.GetPrimAtPath(result.root_path)

    # identity: kind, asset info, semantics
    Usd.ModelAPI(root).SetKind(Kind.Tokens.component)
    Usd.ModelAPI(root).SetAssetName(root_name)
    Usd.ModelAPI(root).SetAssetIdentifier(Sdf.AssetPath("./asset.usd"))
    Usd.ModelAPI(root).SetAssetVersion(EXPORTER_VERSION)
    for instance, value in (("class", cls.label), ("category", cls.group)):
        labels = UsdSemantics.LabelsAPI.Apply(root, instance)
        labels.CreateLabelsAttr([value])

    phys_record = None
    if opts.physics:
        stage_cb("physics")
        phys_record = physics.author_physics(stage, result.root_path, result.collision_points,
                                             result.collision_tris, cls, kinematic=result.rigged)

    for rel, data in result.textures.items():
        path = os.path.join(out_dir, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(data)

    meta = {
        "exporter": EXPORTER_VERSION,
        "source": {k: v for k, v in {"url": opts.source_url, "creation_id": opts.creation_id,
                                     "sha256": hashlib.sha256(glb).hexdigest()}.items() if v},
        "prompt": opts.prompt,
        "semantics": {**cls_info.to_dict(), "label": cls.label, "density": cls.density},
        "scale": scale_record,
        "physics": phys_record,
        "coordinate_system": {"upAxis": "Z", "metersPerUnit": 1.0, "from": "glTF Y-up meters"},
        "unmapped_material_features": report.unmapped,
    }
    root.SetCustomDataByKey("threews", _vt_safe(meta))
    layer = stage.GetRootLayer()
    layer.customLayerData = {"threews": _vt_safe(meta)}
    layer.documentation = (f"three.ws Forge model exported to simulation-ready OpenUSD by {EXPORTER_VERSION}: "
                           f"{cls.label} ({cls.group}), Z-up meters, UsdPhysics collision and mass, "
                           "UsdSemantics labels" + (", UsdSkel skeleton" if result.rigged else "") + ".")
    layer.Save()

    stage_cb("packaging")
    crate = os.path.join(out_dir, "asset.usd")
    layer.Export(crate, args={"format": "usdc"})
    usdz = os.path.join(out_dir, "asset.usdz")
    if os.path.exists(usdz):
        os.remove(usdz)
    if not UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath(crate), usdz):
        raise RuntimeError("USDZ packaging failed")
    zpath = os.path.join(out_dir, "asset.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(crate, "asset.usd")
        zf.write(usda, "asset.usda")
        for rel in sorted(result.textures):
            zf.write(os.path.join(out_dir, rel), rel)

    out = {
        **meta,
        "stats": report.stats,
        "warnings": report.warnings,
        "rigged": result.rigged,
        "animated": result.animated,
        "files": {name: os.path.getsize(os.path.join(out_dir, name))
                  for name in ("asset.usda", "asset.usd", "asset.usdz", "asset.zip")},
        "textures": sorted(result.textures),
    }
    if opts.validate:
        stage_cb("validating")
        out["validation"] = validate_files({"usd": crate, "usdz": usdz})
    out["seconds"] = round(time.monotonic() - t0, 2)
    with open(os.path.join(out_dir, "report.json"), "w") as fh:
        json.dump(out, fh, indent=2, default=str)
    return out


def _vt_safe(value):
    """Drop None and coerce to types Sdf dictionaries accept."""
    if isinstance(value, dict):
        return {str(k): _vt_safe(v) for k, v in value.items() if v is not None}
    if isinstance(value, (list, tuple)):
        items = [_vt_safe(v) for v in value if v is not None]
        if items and all(isinstance(v, str) for v in items):
            return Vt.StringArray(items)
        if items and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in items):
            return Vt.DoubleArray([float(v) for v in items])
        return json.dumps(items)
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return float(value)
    return str(value)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Export a GLB as simulation-ready OpenUSD")
    ap.add_argument("glb")
    ap.add_argument("out_dir")
    ap.add_argument("--prompt")
    ap.add_argument("--category")
    ap.add_argument("--label")
    ap.add_argument("--size-m", type=float)
    ap.add_argument("--density", type=float)
    ap.add_argument("--no-validate", action="store_true")
    args = ap.parse_args(argv)
    with open(args.glb, "rb") as fh:
        glb = fh.read()
    from gltf_meshopt import decode_if_meshopt
    glb, _ = decode_if_meshopt(glb, ".glb")
    if os.path.isdir(args.out_dir):
        shutil.rmtree(args.out_dir)
    try:
        out = export_glb(glb, args.out_dir, ExportOptions(
            prompt=args.prompt, category=args.category, label=args.label, size_m=args.size_m,
            density_kg_m3=args.density, source_url=os.path.abspath(args.glb), validate=not args.no_validate))
    except InputFormatError as exc:
        print(f"input error: {exc}", file=sys.stderr)
        return 2
    v = out.get("validation", {})
    summary = {
        "label": out["semantics"]["label"], "size_m": out["stats"]["size_m"],
        "mass_kg": (out["physics"] or {}).get("mass_kg"), "hulls": ((out["physics"] or {}).get("collision") or {}).get("hulls"),
        "passed": v.get("passed"), "seconds": out["seconds"],
    }
    for kind in ("usd", "usdz"):
        if kind in v:
            summary[kind] = {t: (len(v[kind][t]["errors"]), len(v[kind][t]["warnings"])) for t in ("usdchecker", "asset_validator")}
    print(json.dumps(summary))
    return 0 if v.get("passed", True) else 1


if __name__ == "__main__":
    sys.exit(main())
