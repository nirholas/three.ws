"""Pure geometry policy for the LATO.2 retopology worker.

Nothing here touches the GPU or the network, so every rule is unit tested without
the model. The model is a generative mesh sampler: it can emit holes, stray
fragments or a mesh that drifted from the input (its own README warns of this).
This module is the gate that decides whether a generated mesh is fit to hand back,
so the caller can fail over to QuadriFlow instead of shipping a broken asset.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np

# Upstream clamps the vertex condition to this range (e2e_inference.py
# --min_verts / --max_verts); a value outside it is out of distribution.
MIN_VERTICES = 200
MAX_VERTICES = 5000
DEFAULT_VERTICES = 2000

# A triangle mesh has about two faces per vertex (Euler characteristic, genus 0).
FACES_PER_VERTEX = 2.0

# Gate thresholds. Generated topology may legitimately keep a handful of open
# edges; a mesh with a few percent boundary is visibly torn.
MAX_BOUNDARY_EDGE_RATIO = 0.02
MAX_NON_MANIFOLD_EDGE_RATIO = 0.01
MIN_FACES = 100
# Mean distance from the generated surface to the input, as a fraction of the
# input's longest bounding-box side.
MAX_FIDELITY_ERROR = 0.02
# A fragment smaller than this share of the faces is debris, not a part.
DEBRIS_FACE_SHARE = 0.01


def clamp_vertex_budget(vert_num: int) -> int:
    return int(min(MAX_VERTICES, max(MIN_VERTICES, vert_num)))


def vertex_budget_from_faces(target_faces: int) -> int:
    """Translate a caller's triangle budget into the model's vertex condition."""
    return clamp_vertex_budget(round(target_faces / FACES_PER_VERTEX))


@dataclass(frozen=True)
class Frame:
    """The bbox normalisation upstream applies: centre at the origin, longest
    side 1. The model's output lives in this frame and is mapped back."""

    center: tuple[float, float, float]
    extent: float


def frame_of(vertices: np.ndarray) -> Frame:
    v = np.asarray(vertices, dtype=np.float64)
    if v.ndim != 2 or v.shape[1] != 3 or len(v) == 0:
        raise ValueError("mesh has no vertices")
    lo, hi = v.min(axis=0), v.max(axis=0)
    extent = float((hi - lo).max())
    if not np.isfinite(extent) or extent <= 1e-9:
        raise ValueError("mesh has no extent")
    return Frame(center=tuple(((lo + hi) / 2.0).tolist()), extent=extent)


def normalize(vertices: np.ndarray, frame: Frame) -> np.ndarray:
    return (np.asarray(vertices, dtype=np.float64) - np.asarray(frame.center)) / frame.extent


def denormalize(vertices: np.ndarray, frame: Frame) -> np.ndarray:
    return np.asarray(vertices, dtype=np.float64) * frame.extent + np.asarray(frame.center)


def _edge_counts(faces: np.ndarray) -> np.ndarray:
    """Occurrence count of every undirected edge, one entry per unique edge."""
    f = np.asarray(faces, dtype=np.int64)
    edges = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]], axis=0)
    edges.sort(axis=1)
    _, counts = np.unique(edges, axis=0, return_counts=True)
    return counts


def _component_face_counts(faces: np.ndarray) -> list[int]:
    """Faces per connected component, by union-find over shared vertices."""
    f = np.asarray(faces, dtype=np.int64)
    parent: dict[int, int] = {}

    def find(a: int) -> int:
        root = a
        while parent.setdefault(root, root) != root:
            root = parent[root]
        while parent[a] != root:
            parent[a], a = root, parent[a]
        return root

    for a, b, c in f:
        ra, rb, rc = find(int(a)), find(int(b)), find(int(c))
        parent[rb] = ra
        parent[rc] = ra
    tally: dict[int, int] = {}
    for a in f[:, 0]:
        root = find(int(a))
        tally[root] = tally.get(root, 0) + 1
    return sorted(tally.values(), reverse=True)


def topology_report(vertices: np.ndarray, faces: np.ndarray) -> dict:
    f = np.asarray(faces, dtype=np.int64)
    if f.ndim != 2 or f.shape[1] != 3 or len(f) == 0:
        return {
            "faces": 0, "vertices": int(len(vertices)), "boundary_edge_ratio": 1.0,
            "non_manifold_edge_ratio": 0.0, "components": 0, "debris_faces": 0,
            "watertight": False, "degenerate_faces": 0,
        }
    v = np.asarray(vertices, dtype=np.float64)
    counts = _edge_counts(f)
    total = max(len(counts), 1)
    comps = _component_face_counts(f)
    debris_cut = max(1, int(DEBRIS_FACE_SHARE * len(f)))
    tri = v[f]
    area2 = np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
    boundary = int((counts == 1).sum())
    non_manifold = int((counts > 2).sum())
    return {
        "faces": int(len(f)),
        "vertices": int(len(v)),
        "boundary_edge_ratio": boundary / total,
        "non_manifold_edge_ratio": non_manifold / total,
        "components": len(comps),
        "debris_faces": int(sum(c for c in comps[1:] if c < debris_cut)),
        "watertight": boundary == 0 and non_manifold == 0,
        "degenerate_faces": int((area2 < 1e-14).sum()),
    }


def drop_debris(vertices: np.ndarray, faces: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Remove tiny disconnected fragments and compact the vertex array."""
    f = np.asarray(faces, dtype=np.int64)
    if len(f) == 0:
        return np.asarray(vertices), f
    parent: dict[int, int] = {}

    def find(a: int) -> int:
        root = a
        while parent.setdefault(root, root) != root:
            root = parent[root]
        while parent[a] != root:
            parent[a], a = root, parent[a]
        return root

    for a, b, c in f:
        ra = find(int(a))
        parent[find(int(b))] = ra
        parent[find(int(c))] = ra
    roots = np.array([find(int(a)) for a in f[:, 0]])
    uniq, inverse, sizes = np.unique(roots, return_inverse=True, return_counts=True)
    cut = max(1, int(DEBRIS_FACE_SHARE * len(f)))
    keep_face = (sizes[inverse] >= cut) | (sizes[inverse] == sizes.max())
    kept = f[keep_face]
    used, remap = np.unique(kept, return_inverse=True)
    return np.asarray(vertices)[used], remap.reshape(kept.shape)


def fidelity_error(generated: np.ndarray, source: np.ndarray, extent: float) -> float:
    """Mean distance from generated vertices to the nearest source vertex,
    normalised by the source's longest side. Catches a mesh that is clean but
    is not the input any more."""
    from scipy.spatial import cKDTree

    g = np.asarray(generated, dtype=np.float64)
    s = np.asarray(source, dtype=np.float64)
    if len(g) == 0 or len(s) == 0:
        return float("inf")
    dist, _ = cKDTree(s).query(g, k=1)
    return float(dist.mean() / extent)


def gate_reason(report: dict, fidelity: Optional[float] = None) -> Optional[str]:
    """None when the mesh is fit to return, otherwise a short machine reason the
    caller maps to a QuadriFlow failover."""
    if report["faces"] < MIN_FACES:
        return "too_few_faces"
    if report["boundary_edge_ratio"] > MAX_BOUNDARY_EDGE_RATIO:
        return "holes"
    if report["non_manifold_edge_ratio"] > MAX_NON_MANIFOLD_EDGE_RATIO:
        return "non_manifold"
    if fidelity is not None and fidelity > MAX_FIDELITY_ERROR:
        return "drifted_from_input"
    return None
