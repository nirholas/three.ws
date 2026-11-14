"""Tests for skin_seed.seed_skin_weights. Plain python, numpy only, no GPU,
no Blender, no checkpoints: runs at image build time (Dockerfile) and
locally with `python3 test_skin_seed.py`.

The production failure this guards (2026-11-04 to 2026-11-14): UniRig's merge
output had every vertex on Blender's neutral_bone, SkinTokens' trim deleted
every unweighted joint, and every non-humanoid rig shipped with one joint.
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np

from glb_fixtures import QUADRUPED, unweighted_merge_glb
from skeleton_roots import SkeletonNormalizeError, read_glb, single_root_skeleton, write_glb
from skin_seed import read_accessor, seed_skin_weights, skin_joint_count

_FAILED = False


def _check(cond: bool, label: str) -> None:
    global _FAILED
    print(f"  [{'ok' if cond else 'FAIL'}] {label}")
    if not cond:
        _FAILED = True


def _per_joint_weight(path: Path) -> tuple[dict, np.ndarray, np.ndarray]:
    doc, binary = read_glb(path)
    attrs = doc["meshes"][0]["primitives"][0]["attributes"]
    j = read_accessor(doc, binary, attrs["JOINTS_0"]).astype(int)
    w = read_accessor(doc, binary, attrs["WEIGHTS_0"])
    total = np.zeros(len(doc["skins"][0]["joints"]))
    np.add.at(total, j.ravel(), w.ravel())
    return doc, total, w


def _tmp() -> Path:
    return Path(tempfile.mkdtemp())


def test_every_unirig_joint_gets_weight_and_neutral_bone_none():
    root = _tmp()
    try:
        glb = root / "merged.glb"
        unweighted_merge_glb(glb)
        single_root_skeleton(glb)
        seeded = seed_skin_weights(glb)
        doc, total, w = _per_joint_weight(glb)
        names = [doc["nodes"][n]["name"] for n in doc["skins"][0]["joints"]]
        neutral = names.index("neutral_bone")
        real = [k for k in range(len(names)) if k != neutral]
        _check(seeded == len(QUADRUPED), f"seeded {seeded} joints, the {len(QUADRUPED)} UniRig bones")
        _check(all(total[k] > 1e-6 for k in real), f"every UniRig joint carries weight: {total.round(2).tolist()}")
        _check(total[neutral] == 0.0, "neutral_bone carries no weight")
        _check(np.allclose(w.sum(1), 1.0), "every vertex's weights sum to 1")
        _check(int((w > 0).sum(1).max()) <= 4, "at most 4 influences per vertex")
    finally:
        shutil.rmtree(root)


def test_vertices_go_to_their_nearest_joint():
    root = _tmp()
    try:
        glb = root / "merged.glb"
        unweighted_merge_glb(glb, vertices_per_bone=10, neutral_bone=False)
        seed_skin_weights(glb)
        doc, binary = read_glb(glb)
        attrs = doc["meshes"][0]["primitives"][0]["attributes"]
        j = read_accessor(doc, binary, attrs["JOINTS_0"]).astype(int)[:, 0]
        expected = np.repeat(np.arange(len(QUADRUPED)), 10)
        _check(np.array_equal(j, expected), "each vertex cluster is weighted to the bone it surrounds")
    finally:
        shutil.rmtree(root)


def test_joint_no_vertex_chose_still_gets_a_slot():
    """A tiny tail-tip joint can be nearest to no vertex at all; SkinTokens'
    trim would then delete it as an unweighted leaf."""
    root = _tmp()
    try:
        bones = QUADRUPED + [("bone_9", 7, (0.0, 0.0, -0.01))]  # 1 cm past the tail joint
        glb = root / "merged.glb"
        unweighted_merge_glb(glb, bones=bones, vertices_per_bone=6)
        single_root_skeleton(glb)
        seed_skin_weights(glb)
        doc, total, w = _per_joint_weight(glb)
        names = [doc["nodes"][n]["name"] for n in doc["skins"][0]["joints"]]
        _check(total[names.index("bone_9")] > 1e-6, "the starved tail-tip joint carries weight")
        _check(np.allclose(w.sum(1), 1.0), "weights still sum to 1 after adding a slot")
    finally:
        shutil.rmtree(root)


def test_skeleton_and_existing_binary_are_untouched():
    root = _tmp()
    try:
        glb = root / "merged.glb"
        unweighted_merge_glb(glb)
        before_doc, before_bin = read_glb(glb)
        seed_skin_weights(glb)
        after_doc, after_bin = read_glb(glb)
        _check(after_doc["nodes"] == before_doc["nodes"], "joint nodes and hierarchy unchanged")
        _check(after_doc["skins"] == before_doc["skins"], "skin joints and bind matrices unchanged")
        _check(after_bin[:len(before_bin)] == before_bin, "original binary bytes kept, new data appended")
        _check(after_doc["buffers"][0]["byteLength"] == len(after_bin), "buffer length matches the binary chunk")
        _check(skin_joint_count(glb) == len(QUADRUPED) + 1, "skin_joint_count reads the joint list")
    finally:
        shutil.rmtree(root)


def test_interleaved_positions_are_read_by_stride():
    root = _tmp()
    try:
        glb = root / "merged.glb"
        doc = unweighted_merge_glb(glb, neutral_bone=False)
        doc, binary = read_glb(glb)
        pos = read_accessor(doc, binary, 0).astype(np.float32)
        inter = np.concatenate([pos, np.full((len(pos), 1), 9.0, np.float32)], 1)
        offset = len(binary)
        binary = binary + inter.tobytes()
        doc["bufferViews"].append({"buffer": 0, "byteOffset": offset, "byteLength": inter.nbytes, "byteStride": 16})
        doc["accessors"][0]["bufferView"] = len(doc["bufferViews"]) - 1
        doc["buffers"][0]["byteLength"] = len(binary)
        write_glb(glb, doc, binary)
        _check(np.allclose(read_accessor(doc, binary, 0), pos), "strided POSITION reads back exactly")
        seed_skin_weights(glb)
        _, total, _ = _per_joint_weight(glb)
        _check(bool(np.all(total > 1e-6)), "seeding works on an interleaved vertex buffer")
    finally:
        shutil.rmtree(root)


def test_neutral_bone_only_skeleton_is_rejected():
    root = _tmp()
    try:
        glb = root / "merged.glb"
        unweighted_merge_glb(glb, bones=[])
        try:
            seed_skin_weights(glb)
            _check(False, "expected SkeletonNormalizeError")
        except SkeletonNormalizeError as exc:
            _check("neutral_bone" in str(exc), f"error says the skeleton is empty: {exc}")
    finally:
        shutil.rmtree(root)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            print(name)
            fn()
    if _FAILED:
        print("\nFAILED")
        sys.exit(1)
    print("\nALL PASSED")
