"""Tests for skeleton_roots.single_root_skeleton. Plain python, numpy only,
no GPU, no Blender, no checkpoints: runs at image build time (Dockerfile)
and locally with `python3 test_skeleton_roots.py`.

The production failure this guards (fox QA run, 2026-11-04): UniRig's
autoregressive skeleton started a second branch with no parent, the merged
GLB carried two root joints, and SkinTokens' Asset.set_order refused it with
"multiple roots found". Every synthetic GLB below is built the same way the
Blender glTF exporter writes UniRig's merge output: one skin whose joints are
nodes, a mesh node, and a binary chunk the normalizer must not touch.
"""

from __future__ import annotations

import json
import shutil
import struct
import sys
import tempfile
from pathlib import Path

import numpy as np

from skeleton_roots import (
    SkeletonNormalizeError,
    read_glb,
    single_root_skeleton,
    world_matrices,
    write_glb,
)

_FAILED = False


def _check(cond: bool, label: str) -> None:
    global _FAILED
    print(f"  [{'ok' if cond else 'FAIL'}] {label}")
    if not cond:
        _FAILED = True


def _glb(document: dict, binary: bytes = b"\x01\x02\x03\x04BINPAYLOAD\x00\x00") -> bytes:
    path = Path(tempfile.mkdtemp()) / "x.glb"
    try:
        write_glb(path, document, binary)
        return path.read_bytes()
    finally:
        shutil.rmtree(path.parent)


def _rot_z(deg: float) -> list[float]:
    h = np.radians(deg) / 2.0
    return [0.0, 0.0, float(np.sin(h)), float(np.cos(h))]


def _two_root_document() -> dict:
    """Armature node 0 holds the main chain 1 -> 2 -> 3 and, separately, a
    stray root joint 4 that sits right next to joint 3 in world space. The
    armature itself is rotated and scaled so a re-parent that forgot to
    compensate the local transform would visibly move joint 4."""
    return {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0, 5]}],
        "nodes": [
            {"name": "Armature", "children": [1, 4], "rotation": _rot_z(30), "scale": [2.0, 2.0, 2.0]},
            {"name": "bone_1", "children": [2], "translation": [0.0, 1.0, 0.0]},
            {"name": "bone_2", "children": [3], "translation": [0.0, 1.0, 0.0], "rotation": _rot_z(45)},
            {"name": "bone_3", "translation": [0.0, 1.0, 0.0]},
            {"name": "bone_24", "translation": [-0.6, 2.8, 0.1], "rotation": _rot_z(-10)},
            {"name": "character", "mesh": 0, "skin": 0},
        ],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "skins": [{"joints": [1, 2, 3, 4], "inverseBindMatrices": 1}],
    }


def _joint_parents(document: dict, skin: int = 0) -> dict[int, int | None]:
    parent: dict[int, int] = {}
    for i, node in enumerate(document["nodes"]):
        for c in node.get("children", []):
            parent[c] = i
    joints = set(document["skins"][skin]["joints"])
    return {j: (parent.get(j) if parent.get(j) in joints else None) for j in joints}


def test_two_roots_become_one_without_moving_any_joint():
    root = Path(tempfile.mkdtemp())
    try:
        doc = _two_root_document()
        path = root / "merged.glb"
        path.write_bytes(_glb(doc))
        before_doc, before_bin = read_glb(path)
        before = world_matrices(before_doc)

        moved = single_root_skeleton(path)
        after_doc, after_bin = read_glb(path)
        after = world_matrices(after_doc)

        _check(moved == 1, f"one stray root re-parented (got {moved})")
        roots = [j for j, p in _joint_parents(after_doc).items() if p is None]
        _check(roots == [1], f"bone_1 is the only root joint (got {roots})")
        _check(_joint_parents(after_doc)[4] == 3, "stray joint hangs off its nearest joint, bone_3")
        _check(4 not in after_doc["nodes"][0].get("children", []), "removed from its old parent")
        for i in range(len(before)):
            _check(np.allclose(before[i], after[i], atol=1e-5), f"world transform of node {i} unchanged")
        _check(after_bin == before_bin, "binary chunk is byte-identical")
        _check("matrix" not in after_doc["nodes"][4], "re-parented joint keeps TRS form (animatable)")
    finally:
        shutil.rmtree(root)


def test_single_root_file_is_left_byte_identical():
    root = Path(tempfile.mkdtemp())
    try:
        doc = _two_root_document()
        doc["nodes"][0]["children"] = [1]
        doc["nodes"][3]["children"] = [4]
        path = root / "merged.glb"
        data = _glb(doc)
        path.write_bytes(data)
        _check(single_root_skeleton(path) == 0, "nothing to re-parent")
        _check(path.read_bytes() == data, "file untouched")
    finally:
        shutil.rmtree(root)


def test_stray_root_at_scene_level_is_removed_from_the_scene_list():
    root = Path(tempfile.mkdtemp())
    try:
        doc = _two_root_document()
        doc["nodes"][0]["children"] = [1]
        doc["scenes"][0]["nodes"] = [0, 4, 5]
        path = root / "merged.glb"
        path.write_bytes(_glb(doc))
        before = world_matrices(read_glb(path)[0])
        _check(single_root_skeleton(path) == 1, "scene-level stray root re-parented")
        after_doc, _ = read_glb(path)
        _check(4 not in after_doc["scenes"][0]["nodes"], "no longer a scene root")
        _check(np.allclose(before[4], world_matrices(after_doc)[4], atol=1e-5), "joint did not move")
    finally:
        shutil.rmtree(root)


def test_the_larger_tree_wins_and_a_matrix_node_is_handled():
    """The main root is the one with the most joints under it, whatever the
    order in skin.joints; a stray subtree comes along whole; a node stored as
    `matrix` is read correctly."""
    root = Path(tempfile.mkdtemp())
    try:
        doc = _two_root_document()
        doc["nodes"][4]["children"] = [6]
        doc["nodes"].append({"name": "bone_25", "translation": [0.0, 0.5, 0.0]})
        doc["skins"][0]["joints"] = [4, 6, 1, 2, 3]
        m = np.eye(4)
        m[:3, 3] = [0.0, 1.0, 0.0]
        doc["nodes"][1].pop("translation")
        doc["nodes"][1]["matrix"] = m.T.reshape(-1).tolist()
        path = root / "merged.glb"
        path.write_bytes(_glb(doc))
        before = world_matrices(read_glb(path)[0])
        single_root_skeleton(path)
        after_doc, _ = read_glb(path)
        roots = [j for j, p in _joint_parents(after_doc).items() if p is None]
        _check(roots == [1], f"the 3-joint tree is the main one (got {roots})")
        _check(_joint_parents(after_doc)[6] == 4, "the stray subtree keeps its own child")
        after = world_matrices(after_doc)
        _check(all(np.allclose(before[i], after[i], atol=1e-5) for i in range(len(before))), "no node moved")
    finally:
        shutil.rmtree(root)


def test_not_a_glb_raises_a_named_error():
    root = Path(tempfile.mkdtemp())
    try:
        path = root / "merged.glb"
        path.write_bytes(b"not a glb at all")
        try:
            single_root_skeleton(path)
            _check(False, "expected SkeletonNormalizeError")
        except SkeletonNormalizeError as exc:
            _check("glb" in str(exc).lower(), f"error names the format: {exc}")
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
