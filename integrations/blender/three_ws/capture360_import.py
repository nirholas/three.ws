"""Bring three.ws 360 results into the Blender scene (main thread only).

* A splat ``scene.ply`` goes through the KIRI Engine "3DGS Render" add-on when it is
  enabled (``sna.dgs_render_import_ply_e0a3a``, which reads the standard 3DGS PLY
  layout), otherwise it becomes a coloured point-cloud mesh with a small Geometry
  Nodes view so it shows in the viewport and in renders.
* A depth-shell GLB goes through Blender's glTF importer, which already converts
  glTF +Y up to Blender +Z up and keeps metres.
* ``preview.mp4`` becomes a movie strip in the sequencer.

three.ws depth shells are +Y up, in metres (a splat's scale is whatever the reconstruction
recovered; a 360 camera has no metric reference, so treat splat units as relative).
"""

from __future__ import annotations

import math
import os

import bpy

from . import ply_reader

KIRI_IMPORT_OPERATOR = "dgs_render_import_ply_e0a3a"
KIRI_URL = "https://github.com/Kiri-Innovation/3dgs-render-blender-addon"
KIRI_HINT = "Install the KIRI 3DGS Render add-on to see the splat rendered."
POINT_LIMIT = 1_000_000
# Rotation about X (degrees) applied as an object transform, so the splat's own
# per-Gaussian quaternions stay valid. A three.ws capture scene.ply is a COLMAP-frame
# splat (Y down); the /splat viewer flips it 180 degrees about X for the same reason.
UP_AXES = {
    "y_down": ("Splat capture (Y down)", "A three.ws capture scene.ply: x right, y down, z forward", -90.0),
    "y_up": ("Y up (glTF)", "A file that is already Y up, like glTF", 90.0),
    "z_up": ("Z up (Blender)", "Already Z up, leave as is", 0.0),
}
DEFAULT_UP_AXIS = "y_down"
VIEW_GROUP = "ThreeWS Point View"


def kiri_available() -> bool:
    """True when the KIRI 3DGS Render add-on's PLY import operator is registered."""
    try:
        return bool(getattr(bpy.ops.sna, KIRI_IMPORT_OPERATOR).poll())
    except (AttributeError, RuntimeError):
        return False


def output_dir(job_id: str) -> tuple:
    """Where downloads go: next to the .blend, else a temp dir (with a save warning)."""
    safe = "".join(c for c in job_id if c.isalnum() or c in "-_")[:64] or "capture"
    if bpy.data.filepath:
        base = os.path.join(os.path.dirname(bpy.data.filepath), "three_ws_captures")
        saved = True
    else:
        base = os.path.join(bpy.app.tempdir or os.path.join(os.path.expanduser("~"), ".cache"), "three_ws_captures")
        saved = False
    path = os.path.join(base, safe)
    os.makedirs(path, exist_ok=True)
    return path, saved


def _select_only(context, objects):
    for obj in list(context.selected_objects):
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    if objects:
        context.view_layer.objects.active = objects[0]


def _point_material():
    mat = bpy.data.materials.get("ThreeWS Point Colour")
    if mat:
        return mat
    mat = bpy.data.materials.new("ThreeWS Point Colour")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    attr = nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "Col"
    emit = nodes.new("ShaderNodeEmission")
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(attr.outputs["Color"], emit.inputs["Color"])
    links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def _view_group():
    group = bpy.data.node_groups.get(VIEW_GROUP)
    if group:
        return group
    group = bpy.data.node_groups.new(VIEW_GROUP, "GeometryNodeTree")
    group.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    group.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    radius = group.interface.new_socket("Point radius", in_out="INPUT", socket_type="NodeSocketFloat")
    radius.default_value = 0.01
    radius.min_value = 0.0001
    nodes, links = group.nodes, group.links
    gin = nodes.new("NodeGroupInput")
    gout = nodes.new("NodeGroupOutput")
    to_points = nodes.new("GeometryNodeMeshToPoints")
    set_mat = nodes.new("GeometryNodeSetMaterial")
    set_mat.inputs["Material"].default_value = _point_material()
    links.new(gin.outputs["Geometry"], to_points.inputs["Mesh"])
    links.new(gin.outputs["Point radius"], to_points.inputs["Radius"])
    links.new(to_points.outputs["Points"], set_mat.inputs["Geometry"])
    links.new(set_mat.outputs["Geometry"], gout.inputs["Geometry"])
    return group


def import_point_cloud(context, path: str, up_axis: str = DEFAULT_UP_AXIS, name: str = "three.ws capture", points=None):
    """Import a PLY as a coloured point-cloud mesh. Returns ``(object, info)``.

    ``points`` is the result of ``ply_reader.read_points``; the panel reads the file on
    its worker thread and passes it in, so the main thread only fills the mesh.
    """
    positions, colors, info = points or ply_reader.read_points(path, POINT_LIMIT)
    mesh = bpy.data.meshes.new(name)
    n = len(positions)
    mesh.vertices.add(n)
    mesh.vertices.foreach_set("co", positions.reshape(-1))
    if colors is not None:
        import numpy as np

        rgba = np.concatenate([colors, np.ones((n, 1), dtype=np.float32)], axis=1)
        attr = mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        attr.data.foreach_set("color", rgba.reshape(-1))
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.rotation_euler[0] = math.radians(UP_AXES[up_axis][2])
    context.collection.objects.link(obj)
    mod = obj.modifiers.new("Point view", "NODES")
    mod.node_group = _view_group()
    _select_only(context, [obj])
    info["points"] = n
    return obj, info


def import_splat(context, path: str, up_axis: str = DEFAULT_UP_AXIS, name: str = "three.ws splat", points=None):
    """Import a splat PLY. Returns ``(object, message)``; the message is for the user."""
    if kiri_available():
        before = set(bpy.data.objects)
        try:
            result = getattr(bpy.ops.sna, KIRI_IMPORT_OPERATOR)(filepath=path)
        except Exception:
            result = set()
        new = [o for o in bpy.data.objects if o not in before]
        if "FINISHED" in result and new:
            obj = new[0]
            obj.name = name
            obj.rotation_euler[0] = math.radians(UP_AXES[up_axis][2])
            _select_only(context, [obj])
            return obj, "Imported with the KIRI 3DGS Render add-on."
        for partial in new:
            bpy.data.objects.remove(partial)
    obj, info = import_point_cloud(context, path, up_axis, name, points)
    kept = f"{info['kept']:,} of {info['total']:,}" if info["kept"] < info["total"] else f"{info['kept']:,}"
    return obj, f"Imported {kept} points as a point cloud. {KIRI_HINT}"


def import_glb(context, path: str):
    """Import a depth-shell GLB; returns the new objects."""
    before = set(context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in context.scene.objects if o not in before]
    _select_only(context, new)
    return new


def add_preview_strip(context, path: str):
    """Add ``preview.mp4`` as a movie strip on the first free channel of the sequencer."""
    scene = context.scene
    if scene.sequence_editor is None:
        scene.sequence_editor_create()
    seqs = scene.sequence_editor
    strips = getattr(seqs, "strips", None) or seqs.sequences
    channel = 1 + max([s.channel for s in strips], default=0)
    return strips.new_movie("three.ws preview", path, channel, scene.frame_current)
