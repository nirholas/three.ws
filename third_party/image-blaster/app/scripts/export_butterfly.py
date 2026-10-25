"""Headless Blender export: butterfly .blend -> .glb with embedded animation."""
import bpy
import sys
import os

argv = sys.argv
if "--" in argv:
    argv = argv[argv.index("--") + 1 :]
else:
    argv = []

if len(argv) < 2:
    print("usage: blender -b -P export_butterfly.py -- <input.blend> <output.glb>")
    sys.exit(1)

src, dst = argv[0], argv[1]

bpy.ops.wm.open_mainfile(filepath=src)

bpy.ops.object.select_all(action="SELECT")

os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)

bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_skins=True,
    export_apply=False,
    export_yup=True,
)

print(f"Wrote {dst}")
