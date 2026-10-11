"""
Humanoid vs. non-humanoid mesh classification: a deterministic geometric
heuristic, not a learned model, so it needs no weights and runs on CPU
before any GPU engine is touched.

A standing humanoid mesh is tall relative to its footprint (height clearly
exceeds width and depth) and left-right symmetric about its vertical
mid-plane (arms and legs mirror). A quadruped, prop, or creature mesh
typically fails one or both: a wolf's footprint (length) exceeds its height,
and a chair is often asymmetric. Neither trait alone is reliable, so both
are required for the humanoid verdict.

Kept dependency-light (numpy / scipy only) so it is unit-tested with
synthetic point sets; see test_mesh_classify.py. The caller loads the mesh
(see rig_glb.load_mesh_vertices) and passes only the vertex array in.
"""

from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree

HUMANOID = "humanoid"
OTHER = "other"

# bbox height / max(width, depth): a standing human clears this easily;
# a quadruped's footprint (length) typically exceeds its shoulder height.
_HEIGHT_TO_FOOTPRINT_MIN = 1.3
# Mean nearest-neighbor distance between the mesh and its own mirror image,
# normalized by the bbox diagonal. Below this, the mesh mirrors itself
# closely enough to call it bilaterally symmetric.
_SYMMETRY_TOLERANCE = 0.06
# Mirror-distance query is O(V log V); this many vertices is plenty to
# estimate symmetry and keeps classification well under a second.
_SAMPLE_CAP = 4000


def classify_mesh(vertices: np.ndarray) -> str:
    """Classify a mesh's vertex positions (V,3), Y-up, as HUMANOID or OTHER.

    Degenerate input (too few vertices, wrong shape) is classified OTHER:
    the caller's existing humanoid path is the one with more to lose from a
    false positive (a non-humanoid mesh misrouted through Make-It-Animatable
    just produces a bad rig the pipeline already handles), so an uncertain
    classification prefers the branch that cannot misroute a real human.
    """
    v = np.asarray(vertices, dtype=np.float64)
    if v.ndim != 2 or v.shape[1] != 3 or v.shape[0] < 4:
        return OTHER

    mins, maxs = v.min(axis=0), v.max(axis=0)
    extent = maxs - mins
    height, width, depth = float(extent[1]), float(extent[0]), float(extent[2])
    footprint = max(width, depth, 1e-6)

    if height / footprint < _HEIGHT_TO_FOOTPRINT_MIN:
        return OTHER

    rng = np.random.default_rng(0)
    if v.shape[0] > _SAMPLE_CAP:
        idx = rng.choice(v.shape[0], _SAMPLE_CAP, replace=False)
        sample = v[idx]
    else:
        sample = v

    center_x = (mins[0] + maxs[0]) / 2.0
    mirrored = sample.copy()
    mirrored[:, 0] = 2 * center_x - mirrored[:, 0]

    tree = cKDTree(sample)
    dist, _ = tree.query(mirrored, k=1)
    diag = float(np.linalg.norm(extent)) or 1.0
    symmetry_error = float(np.mean(dist)) / diag

    if symmetry_error > _SYMMETRY_TOLERANCE:
        return OTHER
    return HUMANOID
