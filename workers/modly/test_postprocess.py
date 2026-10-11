"""Unit tests for postprocess.py (CPU only: xatlas, numpy, scipy, trimesh)."""

import numpy as np
import pytest
import trimesh
from PIL import Image

import postprocess
from postprocess import MeshError, bake, dilate, has_colour, load_mesh, pack_glb, rasterize_uv, uv_unwrap


def _sphere(subdivisions: int = 3) -> trimesh.Trimesh:
    return trimesh.creation.icosphere(subdivisions=subdivisions)


def _two_tone_sphere() -> trimesh.Trimesh:
    mesh = _sphere()
    colours = np.where(
        (mesh.vertices[:, 2] > 0)[:, None],
        np.array([255, 0, 0, 255]),
        np.array([0, 0, 255, 255]),
    ).astype(np.uint8)
    mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, vertex_colors=colours)
    return mesh


def _texel_at(mesh: trimesh.Trimesh, vertex: int) -> np.ndarray:
    image = np.asarray(mesh.visual.material.baseColorTexture.convert("RGBA"))
    size = image.shape[0]
    u, v = mesh.visual.uv[vertex]
    col = min(size - 1, int(u * size))
    row = min(size - 1, int((1.0 - v) * size))
    return image[row, col]


def test_load_mesh_round_trips_a_glb():
    glb = _sphere().export(file_type="glb")
    mesh = load_mesh(glb, ".glb")
    assert len(mesh.faces) == len(_sphere().faces)


def test_load_mesh_refuses_garbage():
    with pytest.raises(MeshError):
        load_mesh(b"not a mesh at all", ".glb")


def test_load_mesh_concatenates_a_multi_geometry_scene():
    scene = trimesh.Scene([trimesh.creation.box(), trimesh.creation.icosphere(subdivisions=1)])
    mesh = load_mesh(scene.export(file_type="glb"), ".glb")
    assert len(mesh.faces) == 12 + 80


def test_uv_unwrap_keeps_the_surface_and_bounds_the_uvs():
    source = _sphere()
    unwrapped, info = uv_unwrap(source, 512)
    assert len(unwrapped.faces) == len(source.faces)
    assert len(unwrapped.vertices) >= len(source.vertices)
    assert unwrapped.area == pytest.approx(source.area, rel=1e-5)
    uv = unwrapped.visual.uv
    assert uv.min() >= 0.0 and uv.max() <= 1.0
    assert info["charts"] >= 1
    assert info["vertices"] == len(unwrapped.vertices)


def test_rasterize_uv_covers_half_the_square_for_one_diagonal_triangle():
    uv = np.array([[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]])
    faces = np.array([[0, 1, 2]])
    rows, cols, face_ids, bary = rasterize_uv(uv, faces, 64)
    assert abs(len(rows) - 64 * 64 / 2) <= 64
    assert (face_ids == 0).all()
    assert np.allclose(bary.sum(axis=1), 1.0)
    assert (bary >= -1e-6).all()
    # Bottom-left origin in UV means the covered half sits at the bottom rows.
    assert rows.max() == 63 and rows.min() <= 1


def test_rasterize_uv_skips_degenerate_faces():
    uv = np.array([[0.1, 0.1], [0.1, 0.1], [0.1, 0.1]])
    rows, *_ = rasterize_uv(uv, np.array([[0, 1, 2]]), 32)
    assert len(rows) == 0


def test_dilate_grows_into_empty_neighbours():
    image = np.zeros((5, 5, 4))
    mask = np.zeros((5, 5), dtype=bool)
    image[2, 2] = [10, 20, 30, 255]
    mask[2, 2] = True
    grown, filled = dilate(image, mask, passes=1)
    assert filled[1:4, 1:4].all()
    assert not filled[0, 0]
    assert np.allclose(grown[1, 1], [10, 20, 30, 255])


def test_has_colour_detects_each_source():
    assert has_colour(_sphere()) is None
    assert has_colour(_two_tone_sphere()) == "vertex"
    faces = _sphere()
    faces.visual = trimesh.visual.ColorVisuals(mesh=faces, face_colors=[0, 255, 0, 255])
    assert has_colour(faces) == "face"


def test_bake_transfers_vertex_colour_onto_the_new_atlas():
    source = _two_tone_sphere()
    target, _ = uv_unwrap(source, 256)
    outcome = bake(source, target, texture_size=256)
    assert outcome.baked
    assert outcome.coverage > 0.2
    top = int(np.argmax(outcome.mesh.vertices[:, 2]))
    bottom = int(np.argmin(outcome.mesh.vertices[:, 2]))
    assert _texel_at(outcome.mesh, top)[:3].tolist() == [255, 0, 0]
    assert _texel_at(outcome.mesh, bottom)[:3].tolist() == [0, 0, 255]


def test_bake_transfers_a_texture_onto_a_decimated_target():
    textured, _ = uv_unwrap(_sphere(4), 256)
    green = Image.new("RGB", (64, 64), (0, 200, 0))
    textured.visual.material = trimesh.visual.material.PBRMaterial(baseColorTexture=green)
    assert has_colour(textured) == "texture"
    target, _ = uv_unwrap(_sphere(2), 256)
    outcome = bake(textured, target, texture_size=256)
    assert outcome.baked
    assert _texel_at(outcome.mesh, 0)[:3].tolist() == [0, 200, 0]


def test_bake_reports_a_colourless_source_instead_of_baking_grey():
    source = _sphere()
    target, _ = uv_unwrap(source, 256)
    outcome = bake(source, target, texture_size=256)
    assert not outcome.baked
    assert "no colour" in outcome.reason
    assert outcome.mesh is target


def test_bake_refuses_a_target_without_uvs():
    with pytest.raises(MeshError):
        bake(_two_tone_sphere(), _sphere(), texture_size=256)


def test_baked_mesh_exports_a_textured_glb():
    source = _two_tone_sphere()
    target, _ = uv_unwrap(source, 256)
    outcome = bake(source, target, texture_size=256)
    reloaded = load_mesh(postprocess.export_glb(outcome.mesh), ".glb")
    assert has_colour(reloaded) == "texture"


def test_pack_glb_serves_the_original_when_gltfpack_is_missing():
    glb = _sphere().export(file_type="glb")
    packed, ok = pack_glb(glb, gltfpack_bin="/nonexistent/gltfpack")
    assert packed == glb and ok is False
