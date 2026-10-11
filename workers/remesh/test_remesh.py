"""
Core-path smoke test for the remesh worker. No network, no GCS, no FastAPI
server: it drives main.py's geometry, unwrap, bake, export, and validation
helpers directly against synthetic meshes whose expected results are known.

Run it locally or inside the built image:

    python3 test_remesh.py

The Dockerfile runs it as a build gate, so a regression in any of these paths
fails the image build instead of reaching Cloud Run.

Sections that need an optional dependency (the quadriflow binary, bpy) announce
a skip and keep going, so the file still runs outside the worker image. Inside
the image every dependency is present and nothing is skipped.
"""

from __future__ import annotations

import asyncio
import io
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# main.py reads these at import time.
os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("GCS_BUCKET", "test-bucket")

import numpy as np
from PIL import Image
import trimesh

import main as remesh

PASSED = 0
SKIPPED: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if not condition:
        print(f"FAIL  {name}  {detail}")
        sys.exit(1)
    PASSED += 1
    print(f"ok    {name}")


def skip(section: str, why: str) -> None:
    SKIPPED.append(section)
    print(f"skip  {section}: {why}")


def sphere(subdivisions: int = 4):
    return trimesh.creation.icosphere(subdivisions=subdivisions)


def textured_quad():
    """A unit square in XY carrying a left-red / right-blue 64px texture.

    Two triangles, four corner UVs, so a bake onto the same geometry must
    reproduce the two halves exactly."""
    verts = np.array(
        [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]]
    )
    faces = np.array([[0, 1, 2], [0, 2, 3]])
    uv = np.array([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]])
    px = np.zeros((64, 64, 3), dtype=np.uint8)
    px[:, :32] = (255, 0, 0)
    px[:, 32:] = (0, 0, 255)
    image = Image.fromarray(px, mode="RGB")
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    mesh.visual = trimesh.visual.TextureVisuals(
        uv=uv, image=image, material=trimesh.visual.material.SimpleMaterial(image=image)
    )
    return mesh, uv, image


# -- OBJ bridge to QuadriFlow ------------------------------------------------

with tempfile.TemporaryDirectory() as tmp:
    src = sphere(2)
    path = Path(tmp) / "geom.obj"
    remesh._write_obj_geometry(src, path)
    verts, polys = remesh._parse_obj(path)
    check(
        "obj round trip keeps vertex count",
        len(verts) == len(src.vertices),
        f"{len(verts)} != {len(src.vertices)}",
    )
    check(
        "obj round trip keeps face count",
        len(polys) == len(src.faces),
        f"{len(polys)} != {len(src.faces)}",
    )
    check(
        "obj round trip keeps vertex positions",
        np.allclose(verts, np.asarray(src.vertices), atol=1e-5),
    )

    mixed = Path(tmp) / "mixed.obj"
    mixed.write_text(
        "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nv 2 0 0\nv 2 1 0\n"
        "f 1 2 3\n"           # triangle
        "f 1/1 2/2 3/3 4/4\n" # quad with texture indices
        "f 1 2 5 6 4\n"       # pentagon, fan-triangulated into 3
    )
    _v, mixed_polys = remesh._parse_obj(mixed)
    arities = [len(p) for p in mixed_polys]
    check("parse_obj keeps quad arity", arities[:2] == [3, 4], str(arities))
    check("parse_obj fan-triangulates n-gons", arities[2:] == [3, 3, 3], str(arities))
    check(
        "parse_obj strips texture/normal indices",
        mixed_polys[1] == [0, 1, 2, 3],
        str(mixed_polys[1]),
    )

quad_mesh = remesh._triangulate_polys(
    np.array([[0.0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]),
    [[0, 1, 2, 3]],
)
check("triangulate_polys splits a quad into 2 tris", len(quad_mesh.faces) == 2)
check(
    "triangulate_polys keeps the quad's vertices",
    len(quad_mesh.vertices) == 4,
    str(len(quad_mesh.vertices)),
)


# -- repair ------------------------------------------------------------------

broken = trimesh.Trimesh(
    vertices=np.array(
        [[0.0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1.0, 0, 0]]
    ),
    faces=np.array([[0, 1, 2], [0, 2, 3], [0, 1, 4], [1, 1, 2]]),
    process=False,
)
repaired = remesh._repair_mesh(broken.copy())
check(
    "repair drops degenerate faces",
    not any(len(set(map(int, f))) < 3 for f in repaired.faces),
    str(repaired.faces.tolist()),
)
check(
    "repair merges duplicate vertices",
    len(repaired.vertices) < 5,
    f"{len(repaired.vertices)} vertices remain",
)


# -- decimation --------------------------------------------------------------

dense = sphere(4)
check("fixture sphere is dense enough", len(dense.faces) > 4000, str(len(dense.faces)))
low = remesh._decimate(dense, 500)
check(
    "decimate hits the face budget",
    len(low.faces) <= 500,
    f"{len(low.faces)} faces",
)
check(
    "decimate preserves the silhouette",
    np.allclose(low.bounds, dense.bounds, atol=0.06),
    f"{low.bounds.tolist()} vs {dense.bounds.tolist()}",
)
check(
    "decimate is a no-op under the budget",
    len(remesh._decimate(sphere(1), 100_000).faces) == len(sphere(1).faces),
)


# -- triangle pipeline operations --------------------------------------------

for operation, expect_reduced in (
    ("convert", False),
    ("repair", False),
    ("simplify", True),
    ("full", True),
):
    out, meta = remesh._process_triangle(sphere(4), operation, 500)
    reduced = len(out.faces) <= 500
    check(
        f"triangle operation={operation} {'decimates' if expect_reduced else 'keeps geometry'}",
        reduced == expect_reduced,
        f"{len(out.faces)} faces",
    )
    check(f"triangle operation={operation} reports no quads", meta["quad_ratio"] == 0.0)
    check(f"triangle operation={operation} reports untextured", meta["textured"] is False)


# -- UV unwrap + texture bake ------------------------------------------------

unwrapped = remesh._unwrap(sphere(3))
check("unwrap produced an atlas", unwrapped is not None)
u_verts, u_faces, u_uv = unwrapped
check("unwrap returns one uv per vertex", len(u_uv) == len(u_verts))
check(
    "unwrap uvs are normalized",
    float(u_uv.min()) >= -1e-6 and float(u_uv.max()) <= 1.0 + 1e-6,
    f"[{u_uv.min()}, {u_uv.max()}]",
)
check(
    "unwrap face indices stay in range",
    int(u_faces.max()) < len(u_verts),
    f"max index {u_faces.max()} for {len(u_verts)} vertices",
)

source, src_uv, src_img = textured_quad()
found_uv, found_img = remesh._source_texture(source)
check("source_texture finds the uvs", found_uv is not None and len(found_uv) == 4)
check("source_texture finds the image", found_img is not None)

baked_uv, baked_img = remesh._bake_texture(
    source, src_uv, src_img,
    np.asarray(source.vertices), np.asarray(source.faces), src_uv,
    64,
)
check("bake produced an atlas image", baked_img is not None)
check("bake returned the target uvs", baked_uv is not None and len(baked_uv) == 4)
atlas = np.asarray(baked_img)
check("bake atlas has the requested size", atlas.shape == (64, 64, 3), str(atlas.shape))
left = atlas[8:56, 4:24]
right = atlas[8:56, 40:60]
check(
    "bake transfers the left half of the source texture",
    int(left[..., 0].mean()) > 200 and int(left[..., 2].mean()) < 55,
    f"mean rgb {left.reshape(-1, 3).mean(axis=0).tolist()}",
)
check(
    "bake transfers the right half of the source texture",
    int(right[..., 2].mean()) > 200 and int(right[..., 0].mean()) < 55,
    f"mean rgb {right.reshape(-1, 3).mean(axis=0).tolist()}",
)

# Edge padding must fill the texels a bilinear sampler reads just outside an
# island, otherwise UV seams show background through the model.
img = np.zeros((8, 8, 3), dtype=np.uint8)
mask = np.zeros((8, 8), dtype=bool)
img[4, 4] = (10, 200, 30)
mask[4, 4] = True
dilated = remesh._dilate(img, mask, iters=2)
check(
    "dilate pads neighbouring texels",
    tuple(dilated[4, 5]) == (10, 200, 30) and tuple(dilated[3, 4]) == (10, 200, 30),
    str(dilated[3:6, 3:6].tolist()),
)


# -- export ------------------------------------------------------------------

textured_target = remesh._build_textured_trimesh(
    np.asarray(source.vertices), np.asarray(source.faces), src_uv, src_img
)
check(
    "build_textured_trimesh attaches the texture",
    remesh._source_texture(textured_target)[1] is not None,
)

for fmt, min_bytes in (("glb", 400), ("obj", 100), ("stl", 100), ("ply", 100), ("3mf", 100)):
    artifacts = remesh._export_simple(sphere(2), fmt, "smoke")
    check(f"export {fmt} yields one model artifact", len(artifacts) == 1)
    art = artifacts[0]
    check(f"export {fmt} names the artifact", art.name == f"smoke.{fmt}", art.name)
    check(f"export {fmt} produced bytes", len(art.data) > min_bytes, str(len(art.data)))
    check(f"export {fmt} tags the role", art.role == "model", art.role)
    reloaded = trimesh.load(
        io.BytesIO(art.data), file_type=fmt, force="mesh", process=False
    )
    check(
        f"export {fmt} round-trips the face count",
        len(reloaded.faces) == len(sphere(2).faces),
        f"{len(reloaded.faces)} != {len(sphere(2).faces)}",
    )

# USDZ has no trimesh writer, so it is authored with pxr and has to be read back
# through pxr to prove the package is more than a well-formed zip.
usdz_artifacts = remesh._export_simple(textured_target, "usdz", "smoke")
check("export usdz yields one artifact", len(usdz_artifacts) == 1)
usdz_bytes = usdz_artifacts[0].data
check("export usdz produced bytes", len(usdz_bytes) > 500, str(len(usdz_bytes)))
check(
    "export usdz uses the usdz content type",
    usdz_artifacts[0].content_type == "model/vnd.usdz+zip",
    usdz_artifacts[0].content_type,
)
with tempfile.TemporaryDirectory() as tmp:
    usdz_path = Path(tmp) / "smoke.usdz"
    usdz_path.write_bytes(usdz_bytes)

    import zipfile

    names = zipfile.ZipFile(usdz_path).namelist()
    check("usdz package carries the usd layer", "smoke.usdc" in names, str(names))
    # UsdUtils rewrites referenced assets into numbered subdirectories inside
    # the archive, so match on the file name rather than the authored path.
    check(
        "usdz package carries the baked texture",
        any(name.endswith("smoke.png") for name in names),
        str(names),
    )

    from pxr import Usd, UsdGeom

    stage = Usd.Stage.Open(str(usdz_path))
    check("usdz opens as a usd stage", stage is not None)
    check(
        "usdz declares a default prim",
        stage.GetDefaultPrim().IsValid(),
        str(stage.GetDefaultPrim()),
    )
    usd_mesh = UsdGeom.Mesh(stage.GetPrimAtPath("/Root/Mesh"))
    check("usdz holds a mesh prim", bool(usd_mesh))
    check(
        "usdz keeps every vertex",
        len(usd_mesh.GetPointsAttr().Get()) == len(source.vertices),
        str(len(usd_mesh.GetPointsAttr().Get())),
    )
    check(
        "usdz keeps every face",
        len(usd_mesh.GetFaceVertexCountsAttr().Get()) == len(source.faces),
        str(len(usd_mesh.GetFaceVertexCountsAttr().Get())),
    )
    check(
        "usdz faces are triangles",
        set(usd_mesh.GetFaceVertexCountsAttr().Get()) == {3},
    )
    check("usdz is Y-up for AR viewers", UsdGeom.GetStageUpAxis(stage) == "Y")
    check(
        "usdz carries st uvs",
        UsdGeom.PrimvarsAPI(usd_mesh.GetPrim()).HasPrimvar("st"),
    )

untextured_usdz = remesh._export_simple(sphere(2), "usdz", "smoke")
check("untextured usdz still exports", len(untextured_usdz[0].data) > 500)

obj_artifacts = remesh._write_textured_quad_obj(
    np.asarray(source.vertices), [[0, 1, 2, 3]], src_uv, src_img, "smoke"
)
roles = sorted(a.role for a in obj_artifacts)
check("textured quad obj emits model + material + texture", roles == ["material", "model", "texture"], str(roles))
obj_text = next(a for a in obj_artifacts if a.role == "model").data.decode()
check("textured quad obj keeps the quad face", "f 1/1 2/2 3/3 4/4" in obj_text, obj_text)
check("textured quad obj references its mtl", "mtllib smoke.mtl" in obj_text)
mtl_text = next(a for a in obj_artifacts if a.role == "material").data.decode()
check("mtl points at the baked png", "map_Kd smoke.png" in mtl_text, mtl_text)

untextured = remesh._write_textured_quad_obj(
    np.asarray(source.vertices), [[0, 1, 2, 3]], None, None, "smoke"
)
check("untextured quad obj emits only the model", len(untextured) == 1)


# -- request validation ------------------------------------------------------

req = remesh.ProcessRequest(mesh="https://example.com/a.glb")
check("request defaults to triangle/full/glb",
      (req.remesh_mode, req.operation, req.output_format) == ("triangle", "full", "glb"))
check("request defaults to 50k faces and a 1024 atlas",
      (req.target_faces, req.texture_size) == (50_000, 1024))
check("request normalizes a dotted output format",
      remesh.ProcessRequest(mesh="https://e.com/a.glb", output_format=".FBX").output_format == "fbx")

for label, kwargs in (
    ("output_format", {"output_format": "blend"}),
    ("remesh_mode", {"remesh_mode": "voxel"}),
    ("operation", {"operation": "explode"}),
    ("texture_size", {"texture_size": 4096}),
    ("target_faces too low", {"target_faces": 10}),
    ("target_faces too high", {"target_faces": 900_000}),
):
    try:
        remesh.ProcessRequest(mesh="https://example.com/a.glb", **kwargs)
        check(f"request rejects bad {label}", False, "accepted an invalid value")
    except Exception:
        check(f"request rejects bad {label}", True)


# -- input format detection ----------------------------------------------------
# trimesh 4.x reads DAE (through pycollada) but has no FBX reader at all, so FBX
# input is routed through Blender. The bytes decide, not just the URL: an
# extensionless URL used to fall back to the glTF parser and fail opaquely.

FBX_MAGIC_HEAD = remesh.FBX_BINARY_MAGIC + b"\x00" * 16
check("binary FBX magic routes to the FBX bridge whatever the URL says",
      remesh._sniff_suffix(FBX_MAGIC_HEAD, ".bin") == ".fbx")
check("binary FBX behind an extensionless URL routes to the FBX bridge",
      remesh._sniff_suffix(FBX_MAGIC_HEAD, "") == ".fbx")
check("a GLB keeps its URL suffix", remesh._sniff_suffix(b"glTF\x02\x00\x00\x00", ".glb") == ".glb")
check("a DAE keeps its URL suffix", remesh._sniff_suffix(b"<?xml version", ".dae") == ".dae")
check("an unknown suffix falls back to glb", remesh._sniff_suffix(b"glTF", ".bin") == ".glb")
for label, head in (
    ("ASCII FBX", b"; FBX 7.4.0 project file\n"),
    ("ASCII FBX with a BOM and leading blank line", b"\xef\xbb\xbf\n; FBX 7.3.0 project file\n"),
):
    try:
        remesh._sniff_suffix(head, ".fbx")
        check(f"{label} is refused with a fix", False, "accepted")
    except remesh.InputFormatError as exc:
        check(f"{label} is refused with a fix", "binary FBX" in str(exc) and "GLB" in str(exc), str(exc))

_dae_bytes = trimesh.exchange.dae.export_collada(trimesh.creation.box())
_dae_mesh = remesh._load_concatenated(_dae_bytes, ".dae")
check("DAE input loads through pycollada", len(_dae_mesh.faces) == 12, str(len(_dae_mesh.faces)))
check("DAE input loads in the textured loader", len(remesh._load_textured(_dae_bytes, ".dae").faces) == 12)


def run_with_bytes(data: bytes, url: str, **overrides):
    """Drive the real _run_processing (sniff, meshopt decode, FBX bridge,
    pipelines, export) on in-memory bytes, standing in only for the network."""
    params = {"remesh_mode": "triangle", "operation": "convert", "target_faces": 50_000,
              "output_format": "glb", "texture_size": 1024, "task_id": "smoke"}
    params.update(overrides)
    real_fetch = remesh.fetch_remote_bytes
    remesh.fetch_remote_bytes = lambda *_a, **_k: data
    try:
        return remesh._run_processing(
            url, params["remesh_mode"], params["operation"], params["target_faces"],
            params["output_format"], params["texture_size"], params["task_id"],
        )
    finally:
        remesh.fetch_remote_bytes = real_fetch


_dae_artifacts, _dae_meta = run_with_bytes(_dae_bytes, "https://example.com/model.dae")
_dae_out = trimesh.load(io.BytesIO(_dae_artifacts[0].data), file_type="glb", force="mesh")
check("a DAE converts end to end to GLB", _dae_meta["face_count"] == 12 and len(_dae_out.faces) == 12,
      str(_dae_meta))

try:
    run_with_bytes(b"; FBX 7.4.0 project file\n", "https://example.com/model")
    check("an ASCII FBX job fails as an input error", False, "accepted")
except remesh.InputFormatError:
    check("an ASCII FBX job fails as an input error", True)


async def _run_task_on(data: bytes, url: str) -> dict:
    remesh._sem = asyncio.Semaphore(1)
    remesh._tasks["input-error"] = {"task_id": "input-error", "status": "queued"}
    real_fetch = remesh.fetch_remote_bytes
    remesh.fetch_remote_bytes = lambda *_a, **_k: data
    try:
        await remesh._process("input-error", url, "triangle", "full", 50_000, "glb", 1024)
    finally:
        remesh.fetch_remote_bytes = real_fetch
    return remesh._tasks.pop("input-error")


_task = asyncio.run(_run_task_on(b"; FBX 7.4.0 project file\n", "https://example.com/model.fbx"))
check("an input error reaches the caller verbatim, not as an opaque ref",
      _task["status"] == "failed" and _task.get("error_kind") == "input"
      and "ASCII FBX" in _task["error"] and "internal error" not in _task["error"], str(_task))


# -- quad remesh (needs the quadriflow binary) -------------------------------

if shutil.which(remesh.QUADRIFLOW_BIN) or os.path.isfile(remesh.QUADRIFLOW_BIN):
    qverts, qpolys, quad_ratio = remesh._quad_remesh(sphere(3), 1000)
    check("quad remesh produced geometry", len(qverts) > 0 and len(qpolys) > 0)
    check(
        "quad remesh is quad-dominant",
        quad_ratio > 0.5,
        f"quad_ratio={quad_ratio}",
    )
    check(
        "quad remesh indices stay in range",
        max(max(p) for p in qpolys) < len(qverts),
    )
    qtri = remesh._triangulate_polys(qverts, qpolys)
    check("quad output triangulates for glb", len(qtri.faces) > 0)

    # An open-boundary mesh is where QuadriFlow's minimum-cost-flow solver aborts
    # ("wrong init"), so this is the case the solver ladder exists for: a mesh
    # with a hole must still come back quad-dominant, via a later rung.
    open_sphere = sphere(3)
    keep = np.asarray(open_sphere.vertices)[open_sphere.faces].mean(axis=1)[:, 1] < 0.85
    open_sphere.update_faces(keep)
    open_sphere.remove_unreferenced_vertices()
    check(
        "open-boundary fixture really has a boundary",
        len(trimesh.grouping.group_rows(open_sphere.edges_sorted, require_count=1)) > 0,
    )
    overts, opolys, oratio = remesh._quad_remesh(open_sphere, 1000)
    check(
        "quad remesh survives an open boundary",
        len(opolys) > 0 and oratio > 0.5,
        f"{len(opolys)} polys, quad_ratio={oratio}",
    )
    check(
        "open-boundary quad indices stay in range",
        max(max(p) for p in opolys) < len(overts),
    )

    # A bow-tie edge shared by three faces is exactly the topology QuadriFlow
    # aborts on, and exactly what a character assembled from overlapping parts
    # carries.
    nonmanifold = trimesh.Trimesh(
        vertices=np.array(
            [[0.0, 0, 0], [1, 0, 0], [0.5, 1, 0], [0.5, -1, 0], [0.5, 0, 1]]
        ),
        faces=np.array([[0, 1, 2], [0, 1, 3], [0, 1, 4]]),
        process=False,
    )
    cleaned = remesh._make_manifold(nonmanifold)
    check(
        "manifold cleanup drops the non-manifold edge",
        len(cleaned.faces) < 3,
        f"{len(cleaned.faces)} faces remain",
    )
    check(
        "manifold cleanup keeps a sound mesh intact",
        len(remesh._make_manifold(sphere(2)).faces) == len(sphere(2).faces),
    )
    check(
        "manifold cleanup never returns an empty mesh",
        len(remesh._make_manifold(
            trimesh.Trimesh(
                vertices=np.zeros((3, 3)), faces=np.array([[0, 1, 2]]), process=False
            )
        ).faces) > 0,
    )

    # QuadriFlow needs watertight input; the rebuild is what makes an open
    # character mesh usable at all, so prove it closes one.
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "open.obj"
        healed = Path(tmp) / "healed.obj"
        remesh._write_obj_geometry(open_sphere, raw)
        check("fixture for the rebuild is not watertight", not open_sphere.is_watertight)
        if remesh._watertight_obj(raw, healed):
            rebuilt = trimesh.load(str(healed), force="mesh", process=False)
            check(
                "manifold rebuild closes an open mesh",
                rebuilt.is_watertight,
                f"{len(rebuilt.faces)} faces, watertight={rebuilt.is_watertight}",
            )
            check("manifold rebuild keeps geometry", len(rebuilt.faces) > 0)
        else:
            skip("manifold rebuild", f"binary not found ({remesh.MANIFOLD_BIN})")

    check(
        "the solver ladder starts with minimum-cost flow and ends bare",
        remesh.QUADRIFLOW_ATTEMPTS[0] == ("-mcf", "-sharp")
        and remesh.QUADRIFLOW_ATTEMPTS[-1] == (),
        str(remesh.QUADRIFLOW_ATTEMPTS),
    )
else:
    skip("quad remesh", f"quadriflow binary not found ({remesh.QUADRIFLOW_BIN})")


# -- rigged FBX export (needs bpy) -------------------------------------------

# Authors a one-bone skinned cube carrying a shape key and exports it to GLB,
# so the FBX round trip below has a real armature, skin weights, and a
# blendshape to lose. Run in its own process because bpy keeps global state,
# exactly the way the worker shells out to blender_fbx.py.
BUILD_RIGGED_GLB = """
import sys
import bpy

out = sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)

bpy.ops.object.armature_add(enter_editmode=False, location=(0, 0, 0))
armature = bpy.context.object
armature.name = "TestRig"

bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.5))
cube = bpy.context.object
cube.name = "TestMesh"

group = cube.vertex_groups.new(name=armature.data.bones[0].name)
group.add([v.index for v in cube.data.vertices], 1.0, "REPLACE")
modifier = cube.modifiers.new(name="Armature", type="ARMATURE")
modifier.object = armature
cube.parent = armature

cube.shape_key_add(name="Basis", from_mix=False)
stretch = cube.shape_key_add(name="stretch", from_mix=False)
for point in stretch.data:
    point.co.z += 0.25

bpy.ops.export_scene.gltf(filepath=out, export_format="GLB")
"""

# Probed in a subprocess, and every bpy call below stays in one too: importing
# bpy here would leave this process to die in Blender's teardown and report a
# passing run as a crash.
_probe = subprocess.run(
    [sys.executable, "-c", "import bpy; print(bpy.app.version_string)"],
    capture_output=True, text=True,
)
has_bpy = _probe.returncode == 0 or bool(_probe.stdout.strip())
if not has_bpy:
    skip("rigged FBX export", f"bpy unavailable ({_probe.stderr.strip()[-200:]})")

if has_bpy:
    with tempfile.TemporaryDirectory() as tmp:
        glb_path = Path(tmp) / "rigged.glb"
        author = subprocess.run(
            [sys.executable, "-c", BUILD_RIGGED_GLB, str(glb_path)],
            capture_output=True, text=True,
        )
        check(
            "authored a rigged GLB fixture",
            glb_path.exists() and glb_path.stat().st_size > 0,
            (author.stderr or author.stdout)[-600:],
        )

        fbx_path = Path(tmp) / "rigged.fbx"
        faces = remesh._blender_convert(glb_path, fbx_path, static=False)
        check("blender_fbx exported an FBX", fbx_path.exists() and fbx_path.stat().st_size > 0)
        check("blender_fbx reported a face count", faces > 0, str(faces))
        source_faces = len(trimesh.load(str(glb_path), force="mesh").faces)
        check("rigged FBX carries only the source mesh, no bone-display sphere",
              faces == source_faces, f"{faces} faces exported, source has {source_faces}")

        verify = subprocess.run(
            [sys.executable, str(Path(__file__).parent / "verify_fbx.py"), str(fbx_path)],
            capture_output=True, text=True,
        )
        check(
            "exported FBX keeps its skeleton and skin weights",
            verify.returncode == 0,
            (verify.stdout + verify.stderr)[-600:],
        )

        static_path = Path(tmp) / "static.fbx"
        remesh._blender_convert(glb_path, static_path, static=True)
        check("blender_fbx --static exported an FBX", static_path.stat().st_size > 0)

        artifacts, meta = remesh._convert_to_fbx_preserving_rig(
            glb_path.read_bytes(), ".glb", "smoke"
        )
        check("fbx convert emits one artifact", len(artifacts) == 1 and artifacts[0].name == "smoke.fbx")
        check("fbx convert reports a face count", meta["face_count"] > 0, str(meta))
        check("fbx convert reports no quads and no bake", meta["quad_ratio"] == 0.0 and meta["textured"] is False)

        # FBX *input*. trimesh has no FBX reader, so every path except the
        # rig-preserving FBX-to-FBX convert used to fail with "File type: fbx
        # not supported". Blender now bridges it to a GLB first.
        fbx_bytes = fbx_path.read_bytes()
        bridged = remesh._fbx_to_glb(fbx_bytes)
        bridged_mesh = trimesh.load(io.BytesIO(bridged), file_type="glb", force="mesh")
        check("an FBX bridges to a GLB trimesh can read", len(bridged_mesh.faces) == source_faces,
              f"{len(bridged_mesh.faces)} faces, source has {source_faces}")

        for label, url, overrides, fmt in (
            ("FBX to GLB convert", "https://example.com/rigged.fbx", {}, "glb"),
            ("FBX repair to OBJ", "https://example.com/rigged.fbx",
             {"operation": "repair", "output_format": "obj"}, "obj"),
            ("FBX behind an extensionless URL", "https://example.com/download?sig=abc", {}, "glb"),
        ):
            arts, info = run_with_bytes(fbx_bytes, url, **overrides)
            out = trimesh.load(io.BytesIO(arts[0].data), file_type=fmt, force="mesh")
            check(f"{label} produces real geometry", len(out.faces) > 0 and info["face_count"] > 0,
                  f"{len(out.faces)} faces, {info}")

        arts, info = run_with_bytes(fbx_bytes, "https://example.com/rigged.fbx", output_format="fbx")
        refbx_path = Path(tmp) / "refbx.fbx"
        refbx_path.write_bytes(arts[0].data)
        reverify = subprocess.run(
            [sys.executable, str(Path(__file__).parent / "verify_fbx.py"), str(refbx_path)],
            capture_output=True, text=True,
        )
        check("FBX to FBX convert keeps the skeleton", reverify.returncode == 0,
              (reverify.stdout + reverify.stderr)[-600:])

        corrupt = Path(tmp) / "corrupt.fbx"
        corrupt.write_bytes(remesh.FBX_BINARY_MAGIC + b"\x1a\x00" + os.urandom(256))
        try:
            remesh._blender_convert(corrupt, Path(tmp) / "corrupt.glb", static=True)
            check("a corrupt FBX fails as an input error", False, "converted")
        except remesh.InputFormatError as exc:
            check("a corrupt FBX fails as an input error", "FBX" in str(exc), str(exc))
            check("the input error does not leak container paths", "/tmp" not in str(exc) and tmp not in str(exc),
                  str(exc))


# ── meshopt-compressed input ─────────────────────────────────────────────────
# Callers hand this worker avatar URLs, and most three.ws avatars are saved with
# EXT_meshopt_compression, which trimesh cannot read: every remesh of one failed
# until _fetch_mesh started transcoding. gltf_meshopt.py owns the decode (and
# has its own suite); this pins that the worker's own loaders accept the result.

import gltf_meshopt  # noqa: E402

_source = trimesh.creation.icosphere(subdivisions=2)
_plain_glb = trimesh.Scene({"a": _source}).export(file_type="glb")

if shutil.which(gltf_meshopt.GLTFPACK_BIN):
    with tempfile.TemporaryDirectory() as _packdir:
        _raw = Path(_packdir) / "raw.glb"
        _packed = Path(_packdir) / "packed.glb"
        _raw.write_bytes(_plain_glb)
        subprocess.run(
            [gltf_meshopt.GLTFPACK_BIN, "-i", str(_raw), "-o", str(_packed), "-cc"],
            capture_output=True,
            check=True,
            timeout=gltf_meshopt.GLTFPACK_TIMEOUT_S,
        )
        _packed_bytes = _packed.read_bytes()

    try:
        remesh._load_concatenated(_packed_bytes, ".glb")
        _raw_failed = False
    except Exception:  # noqa: BLE001: the exact trimesh error is not the contract
        _raw_failed = True
    check("a compressed glb is unreadable without the decode", _raw_failed)

    _decoded, _suffix = gltf_meshopt.decode_if_meshopt(_packed_bytes, ".glb")
    _mesh = remesh._load_concatenated(_decoded, _suffix)
    check(
        "the triangle loader accepts a decoded meshopt glb",
        len(_mesh.faces) == len(_source.faces),
        f"{len(_mesh.faces)} vs {len(_source.faces)}",
    )
    _textured = remesh._load_textured(_decoded, _suffix)
    check("the textured loader accepts a decoded meshopt glb", len(_textured.faces) > 0)
else:
    SKIPPED.append("meshopt decode (no gltfpack binary)")

print(f"\n{PASSED} checks passed" + (f", {len(SKIPPED)} sections skipped: {', '.join(SKIPPED)}" if SKIPPED else ""))
