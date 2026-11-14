"""Unit tests for unirig_patches.py.

Production bug (model-rig-nonhuman, 2026-11-14): UniRig's merge.py
make_armature does `argsorted[index[v], ii] for ii in range(group_per_vertex)`
with group_per_vertex hard-coded to 4 by merge(). When the predicted skeleton
has fewer than 4 joints, `skin` has fewer than 4 columns and the lookup raises
"IndexError: index 3 is out of bounds for axis 1 with size 3", which merge.sh
swallows (it backgrounds python and exits 0), so the pipeline only reported
"unirig-merge reported success but wrote no output file".

UPSTREAM_SKIN_BLOCK is the verbatim skin-weight section of make_armature at the
pinned UniRig commit 6793c664, wrapped in a function so it can run without
bpy. No GPU, no bpy: `python3 test_unirig_patches.py`.
"""

from __future__ import annotations

import sys
import textwrap

import numpy as np

_FAILED = False


def _check(cond: bool, label: str) -> None:
    global _FAILED
    print(f"  [{'ok' if cond else 'FAIL'}] {label}")
    if not cond:
        _FAILED = True


UPSTREAM_SKIN_BLOCK = textwrap.dedent('''\
    def skin_assignments(skin, index, n_vertices, names, group_per_vertex=4):
        out = []
        argsorted = np.argsort(-skin, axis=1)
        vertex_group_reweight = skin[np.arange(skin.shape[0])[..., None], argsorted]
        vertex_group_reweight = vertex_group_reweight / vertex_group_reweight[..., :group_per_vertex].sum(axis=1)[...,None]
        vertex_group_reweight = np.nan_to_num(vertex_group_reweight)
        for v in range(n_vertices):
            for ii in range(group_per_vertex):
                i = argsorted[index[v], ii]
                if i >= len(names):
                    continue
                out.append((v, names[i], float(vertex_group_reweight[index[v], ii])))
        return out
''')


def _load(source: str):
    ns = {"np": np}
    exec(compile(source, "merge_fixture.py", "exec"), ns)
    return ns["skin_assignments"]


def _three_joint_skin():
    return np.array([[0.7, 0.2, 0.1], [0.1, 0.8, 0.1], [0.0, 0.3, 0.7]])


def test_unpatched_upstream_reproduces_the_index_error():
    fn = _load(UPSTREAM_SKIN_BLOCK)
    try:
        fn(_three_joint_skin(), [0, 1, 2], 3, ["a", "b", "c"])
        _check(False, "upstream should raise on a 3-joint skeleton")
    except IndexError as exc:
        _check("out of bounds for axis 1 with size 3" in str(exc), f"reproduces the prod error: {exc}")


def test_patched_source_rigs_a_three_joint_skeleton():
    from unirig_patches import patch_merge_source

    fn = _load(patch_merge_source(UPSTREAM_SKIN_BLOCK))
    out = fn(_three_joint_skin(), [0, 1, 2], 3, ["a", "b", "c"])
    _check(len(out) == 9, f"every vertex gets all 3 influences: {len(out)}")
    sums = {}
    for v, _, w in out:
        sums[v] = sums.get(v, 0.0) + w
    _check(all(abs(s - 1.0) < 1e-9 for s in sums.values()), "weights per vertex renormalise to 1")


def test_patch_leaves_four_plus_joint_skeletons_unchanged():
    from unirig_patches import patch_merge_source

    skin = np.array([[0.4, 0.3, 0.2, 0.05, 0.05], [0.1, 0.1, 0.1, 0.6, 0.1]])
    names = list("abcde")
    base = _load(UPSTREAM_SKIN_BLOCK)(skin, [0, 1], 2, names)
    patched = _load(patch_merge_source(UPSTREAM_SKIN_BLOCK))(skin, [0, 1], 2, names)
    _check(base == patched, "5-joint output is identical to upstream")


def test_patch_is_idempotent_and_fails_loudly_when_anchor_moves():
    from unirig_patches import PatchError, patch_merge_source

    once = patch_merge_source(UPSTREAM_SKIN_BLOCK)
    _check(patch_merge_source(once) == once, "second application is a no-op")
    try:
        patch_merge_source("def other():\n    pass\n")
        _check(False, "must raise when upstream changed")
    except PatchError:
        _check(True, "raises PatchError when the anchor line is gone (build fails, not prod)")


if __name__ == "__main__":
    test_unpatched_upstream_reproduces_the_index_error()
    test_patched_source_rigs_a_three_joint_skeleton()
    test_patch_leaves_four_plus_joint_skeletons_unchanged()
    test_patch_is_idempotent_and_fails_loudly_when_anchor_moves()
    if _FAILED:
        print("\nFAILED")
        sys.exit(1)
    print("\nALL PASSED")
