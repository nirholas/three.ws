"""
Engine-convention gate for blender_fbx.py: an FBX a game engine opens without
complaint.

Measured on 2026-11-27 from a live Game-Ready export: the FBX the worker wrote
put a -90 degree X rotation and a 100x scale on its root node (Blender's
default FBX settings, the classic "my model imports rotated and huge" Unity
complaint), and it carried no texture at all although the bake succeeded,
because the glTF importer keeps images packed and Blender's FBX exporter only
embeds images that live on disk.

This test authors a textured mesh GLB in headless Blender, converts it through
blender_fbx.py for each engine preset, and reads the binary FBX back with a
small parser so it checks what the file actually says:

  - no rotation or scale on any node (the axis and unit conversion is baked
    into the vertices),
  - the up axis each preset promises (Unity: +Y, Unreal: +Z),
  - real-world size: a 1 m cube is 100 file units in a centimetre file,
  - an embedded texture.

Run with any Python that has bpy (the worker image does):

    python test_fbx_engine.py

Without bpy it announces a skip and exits 0, like test_remesh.py.
"""

from __future__ import annotations

import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

HERE = Path(__file__).parent
BLENDER_FBX = HERE / "blender_fbx.py"
PASSED = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if not condition:
        print(f"FAIL  {name}  {detail}")
        sys.exit(1)
    PASSED += 1
    print(f"ok    {name}")


# -- a minimal binary FBX reader ------------------------------------------------

def _props(buf: bytes, o: int, count: int):
    out = []
    for _ in range(count):
        t = chr(buf[o])
        o += 1
        if t in "fdlib":
            length, enc, comp = struct.unpack_from("<III", buf, o)
            data = buf[o + 12:o + 12 + comp]
            o += 12 + comp
            if enc:
                data = zlib.decompress(data)
            fmt = {"f": "f", "d": "d", "l": "q", "i": "i", "b": "?"}[t]
            out.append(list(struct.unpack_from(f"<{length}{fmt}", data)))
        elif t in "SR":
            (length,) = struct.unpack_from("<I", buf, o)
            raw = buf[o + 4:o + 4 + length]
            o += 4 + length
            out.append(raw.decode("utf8", "replace") if t == "S" else raw)
        else:
            fmt = {"Y": "h", "C": "?", "I": "i", "F": "f", "D": "d", "L": "q"}[t]
            (value,) = struct.unpack_from(f"<{fmt}", buf, o)
            o += struct.calcsize(fmt)
            out.append(value)
    return out


def read_fbx(path: Path) -> list:
    """Flatten a binary FBX into (path, props) records."""
    buf = path.read_bytes()
    assert buf.startswith(b"Kaydara FBX Binary  \x00"), "not a binary FBX"
    (version,) = struct.unpack_from("<I", buf, 23)
    wide = version >= 7500
    head = 25 if wide else 13
    records = []

    def walk(start: int, end: int, trail: tuple) -> None:
        o = start
        while o + head <= end:
            if wide:
                end_off, nprops, plen = struct.unpack_from("<QQQ", buf, o)
            else:
                end_off, nprops, plen = struct.unpack_from("<III", buf, o)
            if end_off == 0:
                return
            name_len = buf[o + head - 1]
            name = buf[o + head:o + head + name_len].decode("latin1")
            p0 = o + head + name_len
            here = trail + (name,)
            records.append((here, _props(buf, p0, nprops)))
            if p0 + plen < end_off:
                walk(p0 + plen, end_off, here)
            o = end_off

    walk(27, len(buf), ())
    return records


def global_setting(records: list, key: str):
    for trail, props in records:
        if trail == ("GlobalSettings", "Properties70", "P") and props[0] == key:
            return props[-1]
    return None


def model_transforms(records: list) -> list:
    """Every Lcl Rotation / Lcl Scaling a Model node sets, with its values."""
    found = []
    for trail, props in records:
        if trail[:3] == ("Objects", "Model", "Properties70") and trail[-1] == "P":
            if props[0] in ("Lcl Rotation", "Lcl Scaling", "PreRotation"):
                found.append((props[0], tuple(round(v, 4) for v in props[-3:])))
    return found


def vertex_extent(records: list) -> list:
    for trail, props in records:
        if trail == ("Objects", "Geometry", "Vertices"):
            v = props[0]
            return [max(v[i::3]) - min(v[i::3]) for i in range(3)]
    return []


def embedded_textures(records: list) -> int:
    count = 0
    for trail, props in records:
        if trail == ("Objects", "Video", "Content") and props and isinstance(props[0], (bytes, bytearray)) and len(props[0]) > 0:
            count += 1
    return count


# -- fixture -----------------------------------------------------------------

# A 1 m cube standing on the ground (glTF +Y up after export), with a baked
# image texture, exported the way generators deliver models: one GLB with the
# image inside it.
BUILD_TEXTURED_GLB = """
import sys
import bpy

out = sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.5))
cube = bpy.context.object
cube.name = "Crate"

img = bpy.data.images.new("crate_basecolor", width=8, height=8)
img.pixels = [0.8, 0.4, 0.1, 1.0] * 64
img.pack()

mat = bpy.data.materials.new("CrateMat")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = img
mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
cube.data.materials.append(mat)

bpy.ops.export_scene.gltf(filepath=out, export_format="GLB")
"""


def worker_pipeline(tmp: Path) -> None:
    """The /process request field reaches the FBX: a baked low-poly export asked
    for with fbx_engine="unreal" comes back Z-up, textured, with no root
    transform, and an unknown preset is refused at the request boundary."""
    import os
    os.environ.setdefault("API_KEY", "test-key")
    os.environ.setdefault("GCS_BUCKET", "test-bucket")
    sys.path.insert(0, str(HERE))
    import numpy as np
    import trimesh
    from PIL import Image
    import main as remesh

    try:
        remesh.ProcessRequest(mesh="https://example.test/a.glb", fbx_engine="maya")
        refused = False
    except Exception:
        refused = True
    check("worker: an unknown fbx_engine is refused", refused)
    check("worker: fbx_engine defaults to unity",
          remesh.ProcessRequest(mesh="https://example.test/a.glb").fbx_engine == "unity")

    sphere = trimesh.creation.icosphere(subdivisions=4)
    uv = np.stack([
        0.5 + np.arctan2(sphere.vertices[:, 2], sphere.vertices[:, 0]) / (2 * np.pi),
        0.5 + np.arcsin(np.clip(sphere.vertices[:, 1], -1, 1)) / np.pi,
    ], axis=1)
    sphere.visual = trimesh.visual.TextureVisuals(uv=uv, image=Image.new("RGB", (64, 64), (200, 120, 40)))

    artifacts, meta = remesh._process_lowpoly(sphere, 1000, "fbx", 512, "eng", "unreal")
    fbx = tmp / "pipeline-unreal.fbx"
    fbx.write_bytes(artifacts[0].data)
    records = read_fbx(fbx)
    check("worker: fbx_engine=unreal writes a Z-up FBX", global_setting(records, "UpAxis") == 2,
          f"UpAxis={global_setting(records, 'UpAxis')}")
    check("worker: the baked texture is embedded in the FBX", meta["textured"] and embedded_textures(records) >= 1)
    check("worker: no root rotation or scale", not [
        t for t in model_transforms(records)
        if (t[0] == "Lcl Scaling" and t[1] != (1.0, 1.0, 1.0))
        or (t[0] != "Lcl Scaling" and any(abs(v) > 1e-3 for v in t[1]))
    ])


def main() -> None:
    probe = subprocess.run([sys.executable, "-c", "import bpy"], capture_output=True, text=True)
    if probe.returncode != 0 and "No module named" in probe.stderr:
        print("skip  FBX engine conventions: bpy unavailable")
        return

    with tempfile.TemporaryDirectory() as tmp:
        glb = Path(tmp) / "crate.glb"
        author = subprocess.run(
            [sys.executable, "-c", BUILD_TEXTURED_GLB, str(glb)], capture_output=True, text=True,
        )
        check("authored a textured GLB fixture", glb.exists() and glb.stat().st_size > 0,
              (author.stderr or author.stdout)[-600:])

        expectations = {"unity": 1, "unreal": 2}  # FBX UpAxis index: 1 = Y, 2 = Z
        for preset, up_index in expectations.items():
            fbx = Path(tmp) / f"crate-{preset}.fbx"
            run = subprocess.run(
                [sys.executable, str(BLENDER_FBX), str(glb), str(fbx), "--static", f"--engine={preset}"],
                capture_output=True, text=True,
            )
            check(f"{preset}: blender_fbx wrote an FBX", fbx.exists() and "FACE_COUNT:" in run.stdout,
                  (run.stderr or run.stdout)[-600:])
            records = read_fbx(fbx)

            transforms = model_transforms(records)
            bad = [t for t in transforms
                   if (t[0] == "Lcl Scaling" and t[1] != (1.0, 1.0, 1.0))
                   or (t[0] != "Lcl Scaling" and any(abs(v) > 1e-3 for v in t[1]))]
            check(f"{preset}: no node carries a rotation or scale", not bad, str(bad))

            up = global_setting(records, "UpAxis")
            check(f"{preset}: declares the engine's up axis", up == up_index, f"UpAxis={up}")
            check(f"{preset}: up axis is positive", global_setting(records, "UpAxisSign") == 1)

            unit = global_setting(records, "UnitScaleFactor")
            extent = vertex_extent(records)
            metres = [round(e * unit / 100, 3) for e in extent]
            check(f"{preset}: a 1 m cube measures 1 m in the file's own units", metres == [1.0, 1.0, 1.0],
                  f"UnitScaleFactor={unit} extent={extent}")

            check(f"{preset}: embeds the baked texture", embedded_textures(records) >= 1,
                  "no Video/Content record with image bytes")

        worker_pipeline(Path(tmp))

    print(f"\n{PASSED} checks passed")


if __name__ == "__main__":
    main()
