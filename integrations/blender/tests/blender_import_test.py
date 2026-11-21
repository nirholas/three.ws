"""Headless Blender test: the installed extension imports real 360 results.

Run inside Blender by ``run_blender_tests.sh`` (it builds and installs the extension
into an isolated user directory first)::

    blender -b --offline-mode --python-exit-code 1 --python blender_import_test.py -- \
        --luigi luigi.ply --bonsai bonsai.ply --glb pumpkin.glb --movie preview.mp4

Every expected number is computed here from the raw files with code that shares
nothing with the extension (its own PLY header parse and its own glTF JSON read),
so a wrong axis swap, a dropped row or a lost node fails the assertion.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import struct
import sys
import tempfile
import traceback

import addon_utils
import bpy
import numpy as np

TOL = 1e-4
FAILURES = []
PASSES = []


def check(name, ok, detail=""):
    (PASSES if ok else FAILURES).append(name)
    print(f"{'PASS' if ok else 'FAIL'} {name}{': ' + detail if detail else ''}")


def close(a, b, tol=TOL):
    return bool(np.allclose(np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64), atol=tol, rtol=0))


# -- independent reference readers ---------------------------------------------

_PLY_TYPES = {"char": "i1", "uchar": "u1", "short": "<i2", "ushort": "<u2", "int": "<i4",
              "uint": "<u4", "float": "<f4", "double": "<f8"}


def raw_xyz(path):
    """x, y, z columns of a binary little-endian PLY vertex element, as float64 (n, 3)."""
    with open(path, "rb") as fh:
        header = b""
        while not header.endswith(b"end_header\n"):
            header += fh.read(1)
        offset = len(header)
    fields, count = [], 0
    for line in header.decode("ascii").splitlines():
        parts = line.split()
        if parts[:2] == ["element", "vertex"]:
            count = int(parts[2])
        elif parts and parts[0] == "property":
            fields.append((parts[2], _PLY_TYPES[parts[1]]))
    data = np.memmap(path, dtype=np.dtype(fields), mode="r", offset=offset, shape=(count,))
    return np.stack([data["x"], data["y"], data["z"]], axis=1).astype(np.float64), count


def to_blender(xyz, up_axis):
    x, y, z = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    return {
        "y_up": np.stack([x, -z, y], axis=1),
        "y_down": np.stack([x, z, -y], axis=1),
        "z_up": xyz,
    }[up_axis]


def bounds(xyz):
    return xyz.min(axis=0), xyz.max(axis=0)


def gltf_json(path):
    with open(path, "rb") as fh:
        magic, _version, _length = struct.unpack("<4sII", fh.read(12))
        assert magic == b"glTF", "not a GLB"
        chunk_len, chunk_type = struct.unpack("<II", fh.read(8))
        assert chunk_type == 0x4E4F534A, "first chunk is not JSON"
        return json.loads(fh.read(chunk_len))


def _quat_matrix(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def _node_matrix(node):
    if "matrix" in node:
        return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
    m = np.eye(4)
    m[:3, :3] = _quat_matrix(node.get("rotation", [0, 0, 0, 1])) @ np.diag(node.get("scale", [1, 1, 1]))
    m[:3, 3] = node.get("translation", [0, 0, 0])
    return m


def gltf_expected(path):
    """Mesh-node count and the world AABB in Blender axes, from accessor min/max."""
    doc = gltf_json(path)
    nodes = doc.get("nodes", [])
    scene = doc["scenes"][doc.get("scene", 0)]
    corners_all = []
    mesh_nodes = 0

    def walk(index, parent):
        nonlocal mesh_nodes
        node = nodes[index]
        world = parent @ _node_matrix(node)
        if "mesh" in node:
            mesh_nodes += 1
            for prim in doc["meshes"][node["mesh"]]["primitives"]:
                acc = doc["accessors"][prim["attributes"]["POSITION"]]
                lo, hi = acc["min"], acc["max"]
                for cx in (lo[0], hi[0]):
                    for cy in (lo[1], hi[1]):
                        for cz in (lo[2], hi[2]):
                            corners_all.append((world @ np.array([cx, cy, cz, 1.0]))[:3])
        for child in node.get("children", []):
            walk(child, world)

    for root in scene["nodes"]:
        walk(root, np.eye(4))
    corners = to_blender(np.array(corners_all), "y_up")
    return mesh_nodes, bounds(corners)


# -- helpers on the Blender side -------------------------------------------------

def world_vertices(obj):
    # A newly linked object's matrix_world is identity until the depsgraph evaluates.
    bpy.context.view_layer.update()
    mesh = obj.data
    co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3).astype(np.float64)
    mw = np.array(obj.matrix_world, dtype=np.float64)
    return co @ mw[:3, :3].T + mw[:3, 3]


def world_bounds(objects):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    pts = []
    for obj in objects:
        ev = obj.evaluated_get(deps)
        if ev.type != "MESH":
            continue
        mesh = ev.to_mesh()
        co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", co)
        mw = np.array(ev.matrix_world, dtype=np.float64)
        pts.append(co.reshape(-1, 3).astype(np.float64) @ mw[:3, :3].T + mw[:3, 3])
        ev.to_mesh_clear()
    return bounds(np.concatenate(pts))


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)


def find_package():
    for mod in addon_utils.modules():
        name = mod.__name__
        if name.startswith("bl_ext.") and name.endswith(".three_ws"):
            loaded, enabled = addon_utils.check(name)
            if enabled:
                return name
    raise RuntimeError("The three_ws extension is not installed and enabled in this Blender profile.")


# -- tests -----------------------------------------------------------------------

def test_registration(pkg):
    check("extension enabled", True, pkg)
    check("360 Capture panel registered", hasattr(bpy.types, "THREEWS_PT_capture"))
    for op in ("capture_send", "capture_cancel", "capture_refresh", "capture_import", "capture_preview"):
        check(f"operator threews.{op} registered", hasattr(bpy.ops.threews, op)
              and bpy.ops.threews.__getattr__(op).idname() == f"THREEWS_OT_{op}")
    check("scene capture properties", hasattr(bpy.context.scene, "three_ws_capture"))


def test_offline(pkg):
    core = sys.modules[pkg]
    ui = sys.modules[pkg + ".capture360_ui"]
    client_mod = sys.modules[pkg + ".capture360_client"]
    check("online access is off under --offline-mode", not bpy.app.online_access)
    reason = core._offline_reason()
    check("offline reason names the cause", bool(reason) and "offline" in reason.lower(), repr(reason))
    check("Send is disabled while offline", not bpy.ops.threews.capture_send.poll())
    check("Refresh is disabled while offline", not bpy.ops.threews.capture_refresh.poll())
    # The guard must fire before any socket opens: point at a port nothing listens on
    # and expect the offline error, not a connection error.
    client = client_mod.Capture360Client("http://127.0.0.1:9", api_key="k", online_guard=core._offline_reason)
    for label, call in (("list", client.list_captures),
                        ("download", lambda: client.download("http://127.0.0.1:9/x", os.path.join(tempfile.gettempdir(), "x")))):
        try:
            call()
            check(f"offline {label} refused", False, "the call went through")
        except Exception as exc:
            check(f"offline {label} refused before connecting", getattr(exc, "code", "") == "offline", repr(exc))
    check("no capture task started", not ui.task_running())


def test_splat(pkg, path, up_axis, expect_kept=None):
    importer = sys.modules[pkg + ".capture360_import"]
    clear_scene()
    xyz, total = raw_xyz(path)
    obj, message = importer.import_splat(bpy.context, path, up_axis, name=f"splat {up_axis}")
    label = f"{os.path.basename(path)} [{up_axis}]"
    check(f"{label}: one object", len(bpy.context.scene.objects) == 1 and obj.name in bpy.context.scene.objects)
    kept = len(obj.data.vertices)
    if expect_kept is None:
        expect_kept = total
        ref = xyz
    else:
        ref = xyz[np.linspace(0, total - 1, expect_kept).astype(np.int64)]
    check(f"{label}: point count", kept == expect_kept, f"{kept:,} of {total:,}")
    got = bounds(world_vertices(obj))
    want = bounds(to_blender(ref, up_axis))
    check(f"{label}: bounding box", close(got[0], want[0]) and close(got[1], want[1]),
          f"got {np.round(got, 4).tolist()} want {np.round(want, 4).tolist()}")
    if expect_kept < total:
        full = bounds(to_blender(xyz, up_axis))
        check(f"{label}: subsample stays inside the full bounds",
              bool(np.all(got[0] >= full[0] - TOL) and np.all(got[1] <= full[1] + TOL)))
    check(f"{label}: colour attribute", "Col" in obj.data.color_attributes)
    col = obj.data.color_attributes["Col"]
    rgba = np.empty(len(col.data) * 4, dtype=np.float32)
    col.data.foreach_get("color", rgba)
    check(f"{label}: colours in range and not flat", float(rgba.min()) >= 0 and float(rgba.max()) <= 1
          and float(rgba.reshape(-1, 4)[:, :3].std()) > 0.01)
    check(f"{label}: point view modifier", any(m.type == "NODES" and m.node_group for m in obj.modifiers))
    check(f"{label}: KIRI hint shown when KIRI is absent",
          importer.kiri_available() or importer.KIRI_HINT in message, message)
    return obj


def test_upright(pkg, path):
    """A capture in the default orientation must stand on the ground, not hang under it."""
    importer = sys.modules[pkg + ".capture360_import"]
    clear_scene()
    xyz, _ = raw_xyz(path)
    obj, _ = importer.import_splat(bpy.context, path, importer.DEFAULT_UP_AXIS, name="upright")
    got = world_vertices(obj)
    # COLMAP / 3DGS frames are y-down: the file's smallest y is the top of the scene,
    # so after import that point has to be the highest z.
    top_index = int(np.argmin(xyz[:, 1]))
    check("default orientation puts the file's -y on top (+Z)",
          math.isclose(got[top_index, 2], got[:, 2].max(), abs_tol=TOL),
          f"default {importer.DEFAULT_UP_AXIS}")


def test_glb(pkg, path):
    importer = sys.modules[pkg + ".capture360_import"]
    clear_scene()
    mesh_nodes, want = gltf_expected(path)
    new = importer.import_glb(bpy.context, path)
    meshes = [o for o in new if o.type == "MESH"]
    check("GLB: mesh object count matches the file's mesh nodes", len(meshes) == mesh_nodes,
          f"{len(meshes)} vs {mesh_nodes}")
    got = world_bounds(meshes)
    check("GLB: bounding box in metres, +Z up", close(got[0], want[0], 1e-3) and close(got[1], want[1], 1e-3),
          f"got {np.round(got, 4).tolist()} want {np.round(want, 4).tolist()}")


def test_movie(pkg, path):
    importer = sys.modules[pkg + ".capture360_import"]
    scene = bpy.context.scene
    strip = importer.add_preview_strip(bpy.context, path)
    check("preview.mp4 becomes a movie strip", strip is not None and strip.type == "MOVIE")
    check("movie strip has frames", strip.frame_final_duration > 1, str(strip.frame_final_duration))
    again = importer.add_preview_strip(bpy.context, path)
    check("a second strip goes to a free channel", again.channel != strip.channel)
    editor = scene.sequence_editor
    strips = getattr(editor, "strips", None) or editor.sequences
    check("sequencer holds both strips", len(strips) == 2)


def test_output_dir(pkg):
    importer = sys.modules[pkg + ".capture360_import"]
    folder, saved = importer.output_dir("job-abc")
    check("unsaved file: downloads go to a temp folder with a save warning", not saved and os.path.isdir(folder))
    blend_dir = tempfile.mkdtemp(prefix="threews-blend-")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(blend_dir, "scene.blend"))
    folder, saved = importer.output_dir("job-abc")
    check("saved file: downloads go next to the .blend",
          saved and os.path.commonpath([folder, blend_dir]) == blend_dir, folder)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--luigi", required=True)
    ap.add_argument("--bonsai", required=True)
    ap.add_argument("--glb", required=True)
    ap.add_argument("--movie", required=True)
    args = ap.parse_args(argv)
    pkg = find_package()
    steps = [
        lambda: test_registration(pkg),
        lambda: test_offline(pkg),
        lambda: test_splat(pkg, args.luigi, "y_down"),
        lambda: test_splat(pkg, args.luigi, "y_up"),
        lambda: test_splat(pkg, args.luigi, "z_up"),
        lambda: test_upright(pkg, args.luigi),
        lambda: test_splat(pkg, args.bonsai, "y_down",
                           expect_kept=min(sys.modules[pkg + ".capture360_import"].POINT_LIMIT, raw_xyz(args.bonsai)[1])),
        lambda: test_glb(pkg, args.glb),
        lambda: test_movie(pkg, args.movie),
        lambda: test_output_dir(pkg),
    ]
    for step in steps:
        try:
            step()
        except Exception:
            traceback.print_exc()
            check("step raised", False)
    print(f"\n{len(PASSES)} passed, {len(FAILURES)} failed")
    if FAILURES:
        print("FAILED: " + "; ".join(FAILURES))
        sys.exit(1)


main()
