"""Part-quality tests for the segmenter: are the parts whole, textured, sane?

    python3 workers/segment/test_segment_parts_quality.py

Pins the 2026-11-27 fixes found by splitting a real Forge model (a TRELLIS
go-kart, 25 710 faces, one textured geometry):

  * UV seams are not part seams. A textured GLB duplicates every vertex that
    sits on a UV chart border, so the face-adjacency graph fell apart into one
    "connected component" per UV chart: 1 056 of them on the go-kart, against
    5 real shells once welded by position. The returned "parts" were UV
    islands plus one 22 325-face lump of everything the cap folded together.
  * A part keeps its texture. Every part's visual was overwritten with a flat
    tint, so a downloaded part had lost its UVs and its material.
  * Fragments merge into the part they touch or sit beside, never into a
    catch-all lump of unrelated pieces.
  * A model with nothing to split says so (`single_part`) instead of handing
    back one giant "part".

Pure geometry: no GCS, no FastAPI, no network.
"""

from __future__ import annotations

import io
import os
import sys

import numpy as np
import trimesh
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import segment_core as seg

PASS = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASS
    if not condition:
        print(f"FAIL  {name}  {detail}")
        sys.exit(1)
    PASS += 1


def _texture() -> Image.Image:
    rng = np.random.default_rng(3)
    return Image.fromarray(rng.integers(0, 255, (16, 16, 3), dtype=np.uint8), "RGB")


def textured_box(extents=(1.0, 1.0, 1.0), offset=(0.0, 0.0, 0.0), subdivide: int = 0):
    """A box whose vertices are split at UV seams, exactly like an atlas-mapped
    generator output: every face owns its corners, so no two faces share a
    vertex index even where they share a position."""
    box = trimesh.creation.box(extents=extents)
    for _ in range(subdivide):
        box = box.subdivide()
    box.apply_translation(offset)
    box.unmerge_vertices()
    rng = np.random.default_rng(int(abs(offset[0]) * 10 + subdivide))
    uv = rng.random((len(box.vertices), 2))
    box.visual = trimesh.visual.TextureVisuals(
        uv=uv, material=trimesh.visual.material.SimpleMaterial(image=_texture())
    )
    return box


def via_glb(*meshes) -> "trimesh.Trimesh":
    """Round-trip through a real GLB and the worker's own loader, so the test
    sees the vertex layout production sees."""
    scene = trimesh.Scene()
    for i, m in enumerate(meshes):
        scene.add_geometry(m, geom_name=f"g{i}", node_name=f"g{i}")
    data = scene.export(file_type="glb")
    return seg.load_concatenated(data, ".glb")


def face_signature(mesh: "trimesh.Trimesh") -> list[tuple]:
    """Each face as its three corner positions, rounded and order-normalised,
    so two meshes can be compared as multisets of triangles regardless of how
    their vertices are indexed."""
    tri = np.round(mesh.triangles, 5)
    return sorted(tuple(sorted(map(tuple, t))) for t in tri)


def assert_partition(name: str, source: "trimesh.Trimesh", result) -> None:
    total = sum(len(p.mesh.faces) for p in result.parts)
    check(f"{name}: part faces add up to the source", total == len(source.faces), f"{total} vs {len(source.faces)}")
    check(f"{name}: source_faces matches the input", result.source_faces == len(source.faces))
    joined = []
    for p in result.parts:
        joined.extend(face_signature(p.mesh))
    check(
        f"{name}: every source face appears exactly once across the parts",
        sorted(joined) == face_signature(source),
    )


def has_texture(mesh: "trimesh.Trimesh") -> bool:
    vis = mesh.visual
    if not isinstance(vis, trimesh.visual.TextureVisuals) or vis.uv is None:
        return False
    if len(vis.uv) != len(mesh.vertices):
        return False
    mat = vis.material
    img = getattr(mat, "image", None) or getattr(mat, "baseColorTexture", None)
    return img is not None


# ── UV seams are not part seams ─────────────────────────────────────────────

cube = via_glb(textured_box(subdivide=1))
r = seg.segment(cube, method="auto", max_parts=16, min_part_faces=4)
check("a seam-split single cube is one part, not one per UV chart", len(r.parts) == 1, f"{len(r.parts)} parts")
check("a single smooth object is flagged single_part", r.single_part is True)
assert_partition("single cube", cube, r)

r = seg.segment(cube, method="connected", max_parts=16, min_part_faces=4)
check("connected mode also ignores UV seams", len(r.parts) == 1, f"{len(r.parts)} parts")

two = via_glb(textured_box(subdivide=1), textured_box(subdivide=1, offset=(4.0, 0, 0)))
r = seg.segment(two, method="auto", max_parts=16, min_part_faces=4)
check("two textured shells give exactly two parts", len(r.parts) == 2, f"{len(r.parts)} parts")
check("two parts are not flagged single_part", r.single_part is False)
assert_partition("two shells", two, r)

# ── each part keeps its texture ─────────────────────────────────────────────

check("the source carries a texture", has_texture(two))
for p in r.parts:
    check(f"{p.name} keeps its UVs and material", has_texture(p.mesh), type(p.mesh.visual).__name__)

glb = seg.build_scene(r.parts).export(file_type="glb")
back = trimesh.load(io.BytesIO(glb), file_type="glb", process=False)
names = sorted(back.graph.nodes_geometry)
check("exported GLB keeps one addressable node per part", names == ["part_01", "part_02"], str(names))
for name in names:
    geom = back.geometry[back.graph[name][1]]
    check(f"exported {name} still has a texture", has_texture(geom), type(geom.visual).__name__)

# An untextured mesh still gets a per-part tint so the split is visible.
plain = trimesh.util.concatenate(
    [trimesh.creation.box(), trimesh.creation.box().apply_translation([4.0, 0, 0])]
)
r = seg.segment(plain, method="auto", max_parts=16, min_part_faces=4)
check(
    "an untextured mesh is tinted per part",
    all(isinstance(p.mesh.visual, trimesh.visual.ColorVisuals) for p in r.parts),
)
check("tint matches the manifest colour", r.parts[0].manifest()["color"] == "#%02x%02x%02x" % r.parts[0].color)

# ── fragments merge into the part beside them ───────────────────────────────

big_a = textured_box(subdivide=3)                      # 768 faces at x=0
big_b = textured_box(subdivide=3, offset=(10.0, 0, 0))  # 768 faces at x=10
# Two loose triangles floating next to box B, far from box A.
frag = trimesh.Trimesh(
    vertices=[[10.7, 0, 0], [10.8, 0, 0], [10.7, 0.1, 0], [10.7, 0, 0.2], [10.8, 0, 0.2], [10.7, 0.1, 0.2]],
    faces=[[0, 1, 2], [3, 4, 5]],
    process=False,
)
frag.visual = trimesh.visual.TextureVisuals(
    uv=np.zeros((6, 2)), material=trimesh.visual.material.SimpleMaterial(image=_texture())
)
scene_mesh = via_glb(big_a, big_b, frag)
r = seg.segment(scene_mesh, method="connected", max_parts=16, min_part_faces=64)
check("loose fragments do not become their own parts", len(r.parts) == 2, f"{len(r.parts)} parts")
check("no part is below the face floor", min(len(p.mesh.faces) for p in r.parts) >= 64)
right = max(r.parts, key=lambda p: p.mesh.centroid[0])
left = min(r.parts, key=lambda p: p.mesh.centroid[0])
check("fragments joined the part they sit beside", len(right.mesh.faces) == 770 and len(left.mesh.faces) == 768,
      f"left {len(left.mesh.faces)} right {len(right.mesh.faces)}")
assert_partition("fragments", scene_mesh, r)

# ── the cap folds neighbours, never a catch-all lump ────────────────────────

row = [textured_box(offset=(3.0 * i, 0, 0), subdivide=1) for i in range(6)]
row_mesh = via_glb(*row)
r = seg.segment(row_mesh, method="connected", max_parts=3, min_part_faces=4)
check("the cap is honoured", len(r.parts) == 3, f"{len(r.parts)} parts")
for p in r.parts:
    span = p.mesh.bounds[1][0] - p.mesh.bounds[0][0]
    # Six unit boxes 3 apart: folding by proximity keeps each part to adjacent
    # boxes. A catch-all lump of every leftover would span far more.
    check(f"{p.name} is a run of adjacent boxes, not scattered pieces", span <= 7.01, f"span {span:.2f}")
assert_partition("capped row", row_mesh, r)

# ── manifest reports single_part honestly ───────────────────────────────────

man = seg.manifest(seg.segment(cube, method="auto", max_parts=16, min_part_faces=4))
check("manifest carries single_part", man.get("single_part") is True)
check("manifest explains why there is only one part", isinstance(man.get("note"), str) and len(man["note"]) > 20)

print(f"\nOK  {PASS} checks passed")
