"""
Headless Blender FBX bridge for the remesh worker (GLB to FBX, and FBX to GLB).

trimesh and assimp cannot write FBX with a skeleton: trimesh has no FBX
exporter at all, and pyassimp/assimp's FBX writer does not round-trip armatures,
skin weights, or blendshapes. Blender's `io_scene_fbx` exporter is the
industry-standard path that Unity and Unreal users implicitly rely on — it reads
a GLB's armature, per-vertex skin weights, and shape keys, and writes them back
out as a proper FBX bone hierarchy with blendshapes.

We run this as a one-shot subprocess (never in-process in the FastAPI worker):
`bpy` keeps a single global Blender context, is not thread-safe, and accumulates
data across operations. A fresh process per conversion gives a clean scene,
thread safety under the worker's concurrency, and reclaimed memory on exit.

It also runs the other direction. trimesh has no FBX *reader* either ("File
type: fbx not supported"), so an FBX the caller hands in is imported here and
written back out as a GLB that the trimesh pipelines can read. An output path
ending in `.glb` selects that mode.

Usage:
    python blender_fbx.py <input> <output.fbx|output.glb> [--static]

`--static` skips animation baking — used when the upstream geometry op
(simplify/repair) has already discarded any rig, so the FBX is a plain mesh.

On success, prints `FACE_COUNT:<n>` to stdout (polygons across all mesh objects).
An input that imports no mesh polygons at all (an ASCII FBX, which Blender's
importer refuses, or a file holding only cameras, lights or bones) exits with
status 3 and an `IMPORT_EMPTY:` line on stderr, so the worker can tell the
caller what was wrong with the file instead of reporting an internal error.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import bpy


def _leave(code: int, message: str = "") -> None:
    """Exit without running interpreter finalization.

    Tearing down the `bpy` module segfaults in the Cloud Run container once a
    scene has been imported: the FBX is written, `export finished` is printed,
    and the process then dies with SIGSEGV in Blender's own shutdown. The worker
    read that exit code as a failed export and discarded a perfectly good file,
    so every `output_format: "fbx"` request failed. Nothing here needs
    finalization, so skip it and report the real result."""
    if message:
        print(message, file=sys.stderr)
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)


# Input extensions whose importers ship in the standalone `bpy` wheel. `.dae`
# (Collada) and `.off` are excluded — the wheel doesn't bundle the Collada
# importer and has no OFF importer, so the worker bridges those through a
# trimesh-written GLB before calling us.
_IMPORTERS = {".glb", ".gltf", ".fbx", ".obj", ".stl", ".ply"}

# Output suffixes this script writes. `.fbx` is the export the worker offers to
# callers; `.glb` is the bridge that lets trimesh read an FBX input.
_EXPORTERS = {".fbx", ".glb"}

# Exit status for an import that produced no mesh polygons. Distinct from the
# generic failure (1) and bad usage (2) so the worker can report it as a problem
# with the caller's file rather than with the service.
EXIT_IMPORT_EMPTY = 3


def _reset_scene() -> None:
    """Start from a truly empty file — no default cube, camera, or light."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _enable_addon(module: str) -> None:
    try:
        bpy.ops.preferences.addon_enable(module=module)
    except Exception:
        # Bundled importers/exporters are enabled by default in the bpy module;
        # a failure here is non-fatal because the operator is still registered.
        pass


def _import_source(path: Path) -> None:
    suffix = path.suffix.lower()
    if suffix in (".glb", ".gltf"):
        _enable_addon("io_scene_gltf2")
        # disable_bone_shape: the importer otherwise builds an 80-face
        # "Icosphere" to draw bones in the viewport. It parks it in a hidden
        # collection, but the FBX exporter writes hidden objects too, so every
        # rigged GLB came out of this script carrying a stray sphere mesh.
        bpy.ops.import_scene.gltf(
            filepath=str(path), import_pack_images=True, disable_bone_shape=True,
        )
    elif suffix == ".fbx":
        _enable_addon("io_scene_fbx")
        bpy.ops.import_scene.fbx(filepath=str(path))
    elif suffix == ".obj":
        bpy.ops.wm.obj_import(filepath=str(path))
    elif suffix == ".stl":
        bpy.ops.wm.stl_import(filepath=str(path))
    elif suffix == ".ply":
        bpy.ops.wm.ply_import(filepath=str(path))
    else:
        raise SystemExit(f"blender_fbx: unsupported input format '{suffix}'")


def _face_count() -> int:
    total = 0
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.data is not None:
            total += len(obj.data.polygons)
    return total


def _export_fbx(path: Path, static: bool) -> None:
    _enable_addon("io_scene_fbx")
    # path_mode='COPY' + embed_textures keeps the result a single self-contained
    # file. add_leaf_bones=False avoids the extra tip bones that make Unity warn.
    # use_armature_deform_only=False keeps every bone (control bones included).
    bpy.ops.export_scene.fbx(
        filepath=str(path),
        use_selection=False,
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_NONE",
        use_mesh_modifiers=True,
        mesh_smooth_type="FACE",
        add_leaf_bones=False,
        use_armature_deform_only=False,
        bake_anim=not static,
        bake_anim_use_all_actions=not static,
        path_mode="COPY",
        embed_textures=True,
    )


def _export_glb(path: Path) -> None:
    """Write the imported scene as a single binary glTF for trimesh to read.

    Modifiers are applied so what trimesh sees matches what Blender displays.
    Animation is skipped: every consumer of this bridge is a geometry pipeline
    that flattens the scene and drops any rig anyway."""
    _enable_addon("io_scene_gltf2")
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_animations=False,
    )


def main() -> None:
    args = sys.argv[1:]
    static = "--static" in args
    positional = [a for a in args if not a.startswith("--")]
    if len(positional) != 2:
        _leave(2, "usage: blender_fbx.py <input> <output.fbx|output.glb> [--static]")

    in_path = Path(positional[0])
    out_path = Path(positional[1])
    if in_path.suffix.lower() not in _IMPORTERS:
        _leave(2, f"blender_fbx: cannot import '{in_path.suffix}'")
    if out_path.suffix.lower() not in _EXPORTERS:
        _leave(2, f"blender_fbx: cannot export '{out_path.suffix}'")

    _reset_scene()
    try:
        _import_source(in_path)
    except Exception as exc:  # noqa: BLE001
        # Blender's importers raise RuntimeError for a file they report as
        # unreadable (an ASCII FBX, a pre-7.1 binary FBX) and whatever the parser
        # hit for a corrupt one (struct.error, ValueError on a truncated
        # download). Either way the problem is the input, not this process.
        reason = str(exc).strip().splitlines()
        _leave(EXIT_IMPORT_EMPTY, f"IMPORT_EMPTY: {reason[-1] if reason else 'import failed'}")
    faces = _face_count()
    if faces == 0:
        _leave(EXIT_IMPORT_EMPTY, "IMPORT_EMPTY: the file contains no mesh polygons")

    if out_path.suffix.lower() == ".glb":
        _export_glb(out_path)
    else:
        _export_fbx(out_path, static)

    if not out_path.exists() or out_path.stat().st_size == 0:
        _leave(1, "blender_fbx: exporter produced no output")

    # FACE_COUNT is the worker's completion marker: it is printed only after the
    # exporter returned and the file was confirmed non-empty.
    print(f"FACE_COUNT:{faces}")
    _leave(0)


if __name__ == "__main__":
    main()
