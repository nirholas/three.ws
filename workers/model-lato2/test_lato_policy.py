import numpy as np
import pytest
import trimesh

import lato_policy as lp


def icosphere(subdivisions=3, radius=1.0):
    m = trimesh.creation.icosphere(subdivisions=subdivisions, radius=radius)
    return np.asarray(m.vertices), np.asarray(m.faces)


def test_vertex_budget_is_clamped_to_the_range_the_model_was_trained_on():
    assert lp.clamp_vertex_budget(10) == lp.MIN_VERTICES
    assert lp.clamp_vertex_budget(10**6) == lp.MAX_VERTICES
    assert lp.clamp_vertex_budget(1234) == 1234


def test_triangle_budget_maps_to_roughly_half_as_many_vertices():
    assert lp.vertex_budget_from_faces(4000) == 2000
    assert lp.vertex_budget_from_faces(50) == lp.MIN_VERTICES
    assert lp.vertex_budget_from_faces(10**7) == lp.MAX_VERTICES


def test_frame_round_trips_through_normalize_and_denormalize():
    v = np.array([[10, 20, 30], [14, 22, 31], [12, 26, 33.0]])
    frame = lp.frame_of(v)
    n = lp.normalize(v, frame)
    assert np.abs(n).max() <= 0.5 + 1e-12
    assert np.allclose(lp.denormalize(n, frame), v)


def test_frame_rejects_empty_and_flat_meshes():
    with pytest.raises(ValueError):
        lp.frame_of(np.zeros((0, 3)))
    with pytest.raises(ValueError):
        lp.frame_of(np.ones((4, 3)))


def test_closed_sphere_is_watertight_and_passes_the_gate():
    v, f = icosphere()
    report = lp.topology_report(v, f)
    assert report["watertight"] and report["components"] == 1
    assert lp.gate_reason(report, fidelity=0.0) is None


def test_torn_mesh_fails_with_holes():
    v, f = icosphere()
    torn = f[: int(len(f) * 0.9)]
    report = lp.topology_report(v, torn)
    assert not report["watertight"]
    assert lp.gate_reason(report) == "holes"


def test_tiny_output_fails_with_too_few_faces():
    v, f = icosphere(subdivisions=0)
    assert lp.gate_reason(lp.topology_report(v, f)) == "too_few_faces"


def test_non_manifold_edges_are_flagged():
    v, f = icosphere()
    extra = np.array([[f[0][0], f[0][1], f[5][2]]] * 40)
    report = lp.topology_report(v, np.vstack([f, extra]))
    assert report["non_manifold_edge_ratio"] > 0
    assert lp.gate_reason({**report, "non_manifold_edge_ratio": 0.5}) == "non_manifold"


def test_empty_faces_report_is_unusable_not_a_crash():
    report = lp.topology_report(np.zeros((3, 3)), np.zeros((0, 3), dtype=int))
    assert lp.gate_reason(report) == "too_few_faces"


def test_debris_is_counted_and_removed():
    v, f = icosphere()
    shard_v = np.array([[5, 5, 5], [5.1, 5, 5], [5, 5.1, 5.0]])
    all_v = np.vstack([v, shard_v])
    all_f = np.vstack([f, [[len(v), len(v) + 1, len(v) + 2]]])
    assert lp.topology_report(all_v, all_f)["debris_faces"] == 1
    cv, cf = lp.drop_debris(all_v, all_f)
    assert len(cf) == len(f)
    assert cf.max() < len(cv)
    assert lp.topology_report(cv, cf)["components"] == 1


def test_fidelity_detects_a_mesh_that_is_not_the_input():
    v, _ = icosphere()
    assert lp.fidelity_error(v, v, 2.0) == 0.0
    far = v + np.array([0.5, 0, 0])
    assert lp.fidelity_error(far, v, 2.0) > lp.MAX_FIDELITY_ERROR
    report = lp.topology_report(*icosphere())
    assert lp.gate_reason(report, fidelity=0.5) == "drifted_from_input"
