import io

import numpy as np
import pytest
import trimesh
from PIL import Image

import scene_layout as sl


def test_identity_quaternion_is_identity():
    assert np.allclose(sl.quat_wxyz_to_matrix([1, 0, 0, 0]), np.eye(3))


def test_quaternion_is_normalized_and_rotates_correctly():
    # 90 degrees about +Z, real part first, deliberately not unit length
    q = [2 * np.cos(np.pi / 4), 0, 0, 2 * np.sin(np.pi / 4)]
    m = sl.quat_wxyz_to_matrix(q)
    assert np.allclose(m @ [1, 0, 0], [0, 1, 0], atol=1e-9)
    assert np.allclose(m @ m.T, np.eye(3), atol=1e-9)


def test_zero_quaternion_rejected():
    with pytest.raises(ValueError):
        sl.quat_wxyz_to_matrix([0, 0, 0, 0])


def test_decoder_axis_change_round_trips():
    v = np.random.default_rng(0).normal(size=(50, 3))
    glb = v @ sl._DECODER_TO_GLB
    assert np.allclose(sl.glb_to_decoder_vertices(glb), v)


def test_pose_puts_object_in_front_of_the_camera():
    # An object centred in the decoder frame, pushed 3 units away from the camera
    # (+Z in the model's camera frame) must end up at -Z in a glTF viewer.
    box = trimesh.creation.box(extents=(1, 1, 1))
    glb_vertices = np.asarray(box.vertices) @ sl._DECODER_TO_GLB
    posed = sl.pose_vertices(glb_vertices, [1, 0, 0, 0], [0, 0, 3], 1.0)
    centre = posed.mean(axis=0)
    assert np.allclose(centre, [0, 0, -3], atol=1e-9)


def test_pose_flips_left_right_into_gltf_x():
    box = trimesh.creation.box(extents=(1, 1, 1))
    glb_vertices = np.asarray(box.vertices) @ sl._DECODER_TO_GLB
    # +X in the PyTorch3D camera frame is LEFT; in glTF +X is right.
    posed = sl.pose_vertices(glb_vertices, [1, 0, 0, 0], [2, 0, 5], 1.0)
    assert posed.mean(axis=0)[0] == pytest.approx(-2.0)


def test_pose_scale_is_uniform_or_per_axis():
    v = np.array([[1.0, 1.0, 1.0], [-1.0, -1.0, -1.0]]) @ sl._DECODER_TO_GLB
    a = sl.pose_vertices(v, [1, 0, 0, 0], [0, 0, 0], 2.0)
    b = sl.pose_vertices(v, [1, 0, 0, 0], [0, 0, 0], [2.0, 2.0, 2.0])
    assert np.allclose(a, b)
    assert np.abs(a).max() == pytest.approx(2.0)


def test_standalone_rests_on_the_floor_and_is_centred():
    box = trimesh.creation.box(extents=(2, 4, 6))
    glb_vertices = np.asarray(box.vertices) @ sl._DECODER_TO_GLB
    solo = sl.standalone_vertices(glb_vertices, 0.5)
    assert solo[:, 1].min() == pytest.approx(0.0)
    assert (solo[:, 0].min() + solo[:, 0].max()) / 2 == pytest.approx(0.0)
    assert (solo[:, 2].min() + solo[:, 2].max()) / 2 == pytest.approx(0.0)
    assert solo.max(axis=0)[1] - solo.min(axis=0)[1] == pytest.approx(3.0)  # 6 * 0.5 along decoder Z = glb Y


def test_box_to_pixels_clamps_and_keeps_area():
    assert sl.box_to_pixels((0.0, 0.0, 1.0, 1.0), 200, 100) == (0, 0, 200, 100)
    x0, y0, x1, y1 = sl.box_to_pixels((0.999, 0.999, 1.0, 1.0), 200, 100)
    assert x1 > x0 and y1 > y0 and x1 <= 200 and y1 <= 100


def _png(array, mode):
    buf = io.BytesIO()
    Image.fromarray(array, mode).save(buf, format="PNG")
    return buf.getvalue()


def test_mask_decodes_luminance_and_resizes_to_the_photo():
    arr = np.zeros((10, 10), np.uint8)
    arr[2:8, 2:8] = 255
    mask = sl.mask_from_png_bytes(_png(arr, "L"), 20, 20)
    assert mask.shape == (20, 20)
    assert mask[10, 10] and not mask[0, 0]


def test_mask_prefers_alpha_when_it_varies():
    rgba = np.zeros((8, 8, 4), np.uint8)
    rgba[..., :3] = 255  # all-white colour, so luminance alone would select everything
    rgba[2:4, 2:4, 3] = 255
    mask = sl.mask_from_png_bytes(_png(rgba, "RGBA"), 8, 8)
    assert mask.sum() == 4


def test_empty_and_corrupt_masks_are_rejected():
    with pytest.raises(ValueError, match="empty"):
        sl.mask_from_png_bytes(_png(np.zeros((4, 4), np.uint8), "L"), 4, 4)
    with pytest.raises(ValueError, match="readable"):
        sl.mask_from_png_bytes(b"not an image", 4, 4)


def test_scene_has_one_named_node_per_object_and_round_trips():
    items = []
    for i in range(3):
        box = trimesh.creation.box(extents=(1, 1, 1))
        items.append({"vertices": box.vertices + [i * 2, 0, -3], "faces": box.faces,
                      "vertex_colors": np.tile([200, 40, 40, 255], (len(box.vertices), 1)).astype(np.uint8)})
    glb = sl.export_glb(sl.build_scene(items))
    loaded = trimesh.load(io.BytesIO(glb), file_type="glb")
    assert set(loaded.graph.nodes_geometry) == {"object_01", "object_02", "object_03"}
    assert len(loaded.geometry) == 3


def test_manifest_entry_reports_position_and_size():
    box = trimesh.creation.box(extents=(1, 2, 3))
    posed = box.vertices + [4, 0, -5]
    solo = sl.standalone_vertices(np.asarray(box.vertices), 1.0)
    entry = sl.manifest_entry(1, posed, box.faces, solo, [1, 0, 0, 0], [0, 0, 5], [1, 1, 1], "box")
    assert entry["id"] == "object_02"
    assert entry["source"] == "box"
    assert entry["centroid"] == pytest.approx([4, 0, -5])
    assert entry["face_count"] == len(box.faces)
    assert entry["pose"]["rotation_wxyz"] == [1.0, 0.0, 0.0, 0.0]
