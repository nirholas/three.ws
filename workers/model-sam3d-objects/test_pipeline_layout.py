"""run_objects with a stand-in for upstream's Inference: proves the wiring
between the model's per-object output and the levelled scene GLB, without a
GPU or the gated weights. The stand-in returns the same keys upstream's
notebook Inference returns (glb, rotation, translation, scale)."""

import io

import numpy as np
import pytest
import trimesh

import pipeline
import scene_layout as sl
from test_scene_layout import _pitch_quat, _upright_box_quat


class _StubInference:
    """Upright boxes on a desk, seen by a camera pitched down 30 degrees."""

    def __init__(self, fail_index=None):
        self.calls = 0
        self.fail_index = fail_index

    def __call__(self, image, mask, seed=42):
        i = self.calls
        self.calls += 1
        if i == self.fail_index:
            raise RuntimeError("decoder produced NaNs")
        box = trimesh.creation.box(extents=(1.0, 1.0, 1.0 + 0.5 * i))
        mesh = trimesh.Trimesh(vertices=np.asarray(box.vertices) @ sl._DECODER_TO_GLB, faces=box.faces, process=False)
        tilt = sl.quat_wxyz_to_matrix(_pitch_quat(30))
        centre = tilt @ np.array([1.5 * i, -1.0 + (1.0 + 0.5 * i) / 2.0, 4.0])
        return {"glb": mesh, "rotation": np.array(_upright_box_quat(30)), "translation": centre, "scale": np.array([1.0])}


@pytest.fixture
def stub(monkeypatch):
    def install(**kw):
        inf = _StubInference(**kw)
        monkeypatch.setattr(pipeline, "_inference", inf)
        return inf
    return install


def _masks(n):
    return [np.ones((8, 8), bool) for _ in range(n)], ["box"] * n


def test_run_objects_levels_grounds_and_names_every_object(stub):
    stub()
    masks, sources = _masks(3)
    out = pipeline.run_objects(np.zeros((8, 8, 3), np.uint8), masks, sources, seed=7)
    assert out["leveling"]["applied"] is True
    assert out["leveling"]["tilt_deg"] == pytest.approx(30, abs=0.5)
    assert [o["name"] for o in out["objects"]] == ["object_01", "object_02", "object_03"]
    scene = trimesh.load(io.BytesIO(out["scene_glb"]), file_type="glb")
    assert set(scene.graph.nodes_geometry) == {"object_01", "object_02", "object_03"}
    lo, hi = scene.bounds
    assert lo[1] == pytest.approx(0.0, abs=1e-5)
    # Every box stands on the floor, upright: height equals its real height.
    for i, name in enumerate(["object_01", "object_02", "object_03"]):
        entry = out["objects"][i]
        assert entry["bbox"]["min"][1] == pytest.approx(0.0, abs=1e-3)
        assert entry["bbox"]["max"][1] - entry["bbox"]["min"][1] == pytest.approx(1.0 + 0.5 * i, abs=1e-3)


def test_one_failed_object_is_skipped_not_fatal(stub):
    stub(fail_index=1)
    masks, sources = _masks(3)
    out = pipeline.run_objects(np.zeros((8, 8, 3), np.uint8), masks, sources, seed=7)
    assert len(out["objects"]) == 2
    assert out["skipped"] == [{"index": 1, "reason": "decoder produced NaNs"}]
    # Names stay compact (object_01, object_02) but each entry says which input
    # mask or box it came from, so the client can title it with that box's label.
    assert [(o["name"], o["input_index"]) for o in out["objects"]] == [("object_01", 0), ("object_02", 2)]
