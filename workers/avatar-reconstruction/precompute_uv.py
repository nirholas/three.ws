"""
Pre-computation: canonical MediaPipe face model → template skin UV coordinates.

Runs ONCE at Docker image build time, per template, and writes that template's
UV map (face_uv_map.json for wolf3d, face_uv_map.parametric.json for
parametric; see recon_templates.py).

    python precompute_uv.py                          # wolf3d → face_uv_map.json
    python precompute_uv.py --template parametric    # → face_uv_map.parametric.json
    python precompute_uv.py --template parametric --glb <path> --out <path>

Algorithm:
  1. Download MediaPipe canonical face model OBJ (468 vertices in face-space).
  2. Load the template's head mesh (named by its TemplateSpec).
  3. Bring both into one frame. `unit_cube` (wolf3d) normalises each to a unit
     cube; `anchors` (parametric, whose head mesh also carries the neck) fits a
     scale and translation on five facial anchors the template GLB declares.
  4. For each of the 468 canonical landmarks, find the nearest head vertex on
     the front of the face by Euclidean distance in 3D (KD-tree).
  5. Map that vertex's UV coordinates to pixel coordinates in the skin texture.
  6. Persist the mapping as JSON.

Output JSON schema:
  {
    "texture_width":  <int>,
    "texture_height": <int>,
    "landmarks": [            # 468 entries, one per MediaPipe landmark index
      {"u": <float>, "v": <float>, "px": <float>, "py": <float>},
      ...
    ],
    "face_oval_indices": [<int>, ...],   # subset used for the face-oval mask
    "skin_sample_indices": [<int>, ...]  # landmarks inside the cheek/forehead region
  }
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import requests
from scipy.spatial import cKDTree

# ── paths ──────────────────────────────────────────────────────────────────────

HERE = Path(__file__).parent

CANONICAL_OBJ_URL = (
    "https://raw.githubusercontent.com/google/mediapipe/master"
    "/mediapipe/modules/face_geometry/data/canonical_face_model.obj"
)

# MediaPipe face-oval landmark indices (silhouette of the face in the mesh).
# These 36 indices form the boundary used for the alpha mask.
FACE_OVAL_INDICES = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
    397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
    172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]

# Landmarks that sample the skin tone (cheeks + forehead, away from eyes/mouth).
SKIN_SAMPLE_INDICES = [
    116, 117, 118, 119, 120, 121, 50,   # left cheek
    345, 346, 347, 348, 349, 350, 280,  # right cheek
    10, 9, 8, 107, 336,                 # forehead
]


# ── canonical OBJ parser ───────────────────────────────────────────────────────

def _load_canonical_obj(url: str) -> np.ndarray:
    """Download and parse the MediaPipe canonical face model OBJ.
    Returns (468, 3) float32 array of vertex positions."""
    print(f"Downloading canonical face model from {url} …")
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    vertices = []
    for line in resp.text.splitlines():
        if line.startswith("v "):
            parts = line.split()
            vertices.append([float(parts[1]), float(parts[2]), float(parts[3])])
    arr = np.array(vertices, dtype=np.float32)
    print(f"  Loaded {len(arr)} canonical vertices")
    return arr


# ── GLB mesh loading ───────────────────────────────────────────────────────────

def _load_glb(glb_path: Path):
    import pygltflib

    return pygltflib.GLTF2().load_from_bytes(glb_path.read_bytes())


def _load_head(glb, head_mesh: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (positions (N,3), uvs (N,2), faces (F,3)) for the template's head mesh."""
    from glb_ops import get_head_mesh_data

    positions, uvs, faces = get_head_mesh_data(glb, head_mesh)
    print(f"  {head_mesh}: {len(positions)} vertices")
    return positions, uvs, faces


def _uv_island_of(faces: np.ndarray, n_vertices: int, seed: int) -> np.ndarray:
    """
    Boolean mask of the vertices on the same UV island as `seed`. A glTF vertex
    is one (position, UV) pair, so islands are the connected components of the
    index graph: a UV seam duplicates the vertex and cuts the graph there.
    """
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    f = np.asarray(faces, dtype=np.int64)
    rows = np.concatenate([f[:, 0], f[:, 1], f[:, 2]])
    cols = np.concatenate([f[:, 1], f[:, 2], f[:, 0]])
    graph = coo_matrix((np.ones(rows.shape[0]), (rows, cols)), shape=(n_vertices, n_vertices))
    _, label = connected_components(graph, directed=False)
    return label == label[seed]


# ── alignment ─────────────────────────────────────────────────────────────────

def _normalise(pts: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    """Translate to centroid, scale to unit cube. Returns (normalised, centroid, scale)."""
    centroid = pts.mean(axis=0)
    shifted = pts - centroid
    scale = np.abs(shifted).max()
    return shifted / scale, centroid, scale


def _filter_face_vertices(positions: np.ndarray) -> np.ndarray:
    """
    Heuristic: keep only head vertices that are on the visible face (front
    hemisphere, above the chin). The canonical model covers only the face, so
    restricting the KD-tree to face vertices gives better matches.
    """
    # Template heads are Y up and face +Z. Filter: z > median_z (front half)
    # AND y > 10th-percentile_y (above the chin, or the neck on a template whose
    # head mesh includes one).
    z_thresh = np.median(positions[:, 2])
    y_thresh = np.percentile(positions[:, 1], 10)
    mask = (positions[:, 2] > z_thresh) & (positions[:, 1] > y_thresh)
    return mask


# MediaPipe landmarks for the five anchors a template declares: nose tip, the two
# mouth corners, and the two eye openings (each the mean of its lid contour).
_MP_NOSE_TIP = 1
_MP_MOUTH_CORNERS = (61, 291)
_MP_EYE_RINGS = (
    (33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246),
    (263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466),
)


def _anchor_pairs(canon_norm: np.ndarray, anchors: dict) -> tuple[np.ndarray, np.ndarray]:
    """
    Matching (canonical, template) anchor points, sides paired by x so neither
    model's left/right naming convention matters.
    """
    def by_x(a, b):
        return (a, b) if a[0] < b[0] else (b, a)

    canon = [canon_norm[_MP_NOSE_TIP]]
    canon += by_x(canon_norm[_MP_MOUTH_CORNERS[0]], canon_norm[_MP_MOUTH_CORNERS[1]])
    canon += by_x(canon_norm[list(_MP_EYE_RINGS[0])].mean(0), canon_norm[list(_MP_EYE_RINGS[1])].mean(0))
    tmpl = [np.asarray(anchors["noseTip"], dtype=np.float64)]
    tmpl += by_x(np.asarray(anchors["mouthCornerLeft"]), np.asarray(anchors["mouthCornerRight"]))
    tmpl += by_x(np.asarray(anchors["eyeLeft"]), np.asarray(anchors["eyeRight"]))
    return np.asarray(canon, dtype=np.float64), np.asarray(tmpl, dtype=np.float64)


def _fit_scale_translation(src: np.ndarray, dst: np.ndarray) -> tuple[float, np.ndarray]:
    """
    Least-squares dst ≈ s * src + t with no rotation. Both faces are authored
    upright and facing +Z, and the morph carries canonical-frame residuals into
    the head by scale alone (face_geometry.morph_head_to_landmarks), so a fitted
    rotation would only absorb anchor-definition noise as a fake head tilt.
    """
    mu_s, mu_d = src.mean(0), dst.mean(0)
    sc, dc = src - mu_s, dst - mu_d
    s = float((sc * dc).sum() / (sc ** 2).sum())
    return s, mu_d - s * mu_s


# ── texture dimensions ─────────────────────────────────────────────────────────

def _get_skin_texture_size(glb, skin_material: str) -> tuple[int, int]:
    """Return (width, height) of the template's skin base-colour texture."""
    from glb_ops import get_material_texture

    img = get_material_texture(glb, skin_material)
    if img is None:
        raise ValueError(f"{skin_material} material or texture not found in the template GLB")
    return img.size  # (width, height)


# ── main ──────────────────────────────────────────────────────────────────────

def precompute(spec=None, glb_path: Path | None = None, out_path: Path | None = None) -> None:
    import recon_templates
    from glb_ops import template_info

    spec = spec or recon_templates.WOLF3D
    glb_path = glb_path or spec.glb_path
    out_path = out_path or spec.uv_map_path
    print(f"=== UV pre-computation: {spec.key} ({glb_path.name} → {out_path.name}) ===")

    canonical = _load_canonical_obj(CANONICAL_OBJ_URL)       # (468, 3)
    glb = _load_glb(glb_path)
    positions, uvs, faces = _load_head(glb, spec.head_mesh)   # (N, 3), (N, 2), (F, 3)
    tex_w, tex_h = _get_skin_texture_size(glb, spec.skin_material)
    print(f"  Skin texture: {tex_w}×{tex_h}")

    # The canonical face in unit-cube space: the reference every selfie's
    # landmarks are aligned against, whatever the template.
    canon_norm, _, _ = _normalise(canonical)

    face_mask = _filter_face_vertices(positions)
    anchors = template_info(glb).get("anchors") if spec.uv_alignment == "anchors" else None
    if spec.uv_alignment == "anchors":
        if not anchors:
            raise ValueError(f"{glb_path.name} declares no face anchors; rebuild it with "
                             "scripts/build-reconstruction-template.mjs")
        # The anchor fit already places the canonical face on the head, so the
        # above-the-chin height cut is unnecessary, and on a head mesh that
        # carries the neck it is wrong: its 10th-percentile height lands at the
        # lower lip and the chin landmark snaps onto the mouth. Keep the front half.
        face_mask = positions[:, 2] > np.median(positions[:, 2])
        # The TPS warp needs every landmark on ONE UV island, or it smears the
        # photo across the atlas. A full-head atlas puts the eyelid linings and
        # the mouth interior on islands of their own, right where the eye and
        # inner-lip landmarks fall, so restrict matches to the face's island
        # (the one holding the nose tip).
        nose = int(np.argmin(np.linalg.norm(positions - np.asarray(anchors["noseTip"]), axis=1)))
        island = _uv_island_of(faces, positions.shape[0], nose)
        print(f"  Face UV island: {int(island.sum())} of {positions.shape[0]} head vertices")
        face_mask &= island
    face_indices = np.where(face_mask)[0]          # subset idx → full head vertex idx
    face_positions = positions[face_mask]
    face_uvs = uvs[face_mask]

    if spec.uv_alignment == "anchors":
        canon_pts, tmpl_pts = _anchor_pairs(canon_norm, anchors)
        s, t = _fit_scale_translation(canon_pts, tmpl_pts)
        residual = np.linalg.norm(s * canon_pts + t - tmpl_pts, axis=1)
        print(f"  Anchor fit: {s * 100:.2f} cm per canonical unit, residual "
              f"mean {residual.mean() * 1000:.1f} mm, max {residual.max() * 1000:.1f} mm")
        # Query in head space: canonical landmarks carried onto the template.
        tree = cKDTree(face_positions)
        distances, nn_indices = tree.query(s * canon_norm + t, k=1)
        distances = distances / s
        head_face_scale = s
    elif spec.uv_alignment == "unit_cube":
        face_norm, _, head_face_scale = _normalise(face_positions)
        tree = cKDTree(face_norm)
        distances, nn_indices = tree.query(canon_norm, k=1)
    else:
        raise ValueError(f"unknown uv_alignment {spec.uv_alignment!r}")

    print(f"  Mean NN distance: {distances.mean():.4f}  Max: {distances.max():.4f} (canonical units)")

    # Convert UV coords → pixel coords, and record the FULL-mesh vertex index each
    # landmark maps to (nn_indices are into the filtered face subset).
    landmarks = []
    landmark_vtx = []
    for i, nn_idx in enumerate(nn_indices):
        u, v = float(face_uvs[nn_idx, 0]), float(face_uvs[nn_idx, 1])
        px = u * tex_w
        py = v * tex_h
        landmarks.append({"u": u, "v": v, "px": px, "py": py})
        landmark_vtx.append(int(face_indices[nn_idx]))

    result = {
        "template": spec.key,
        "uv_alignment": spec.uv_alignment,
        "texture_width": tex_w,
        "texture_height": tex_h,
        "landmarks": landmarks,
        "face_oval_indices": FACE_OVAL_INDICES,
        "skin_sample_indices": SKIN_SAMPLE_INDICES,
        # ── geometry morph (Phase 2) ────────────────────────────────────────────
        # canonical_norm: neutral MediaPipe face in unit-cube space (the reference
        #   the person's landmarks are aligned against).
        # landmark_vtx: full-mesh head vertex each landmark drives.
        # head_face_scale: metres-per-normalised-unit, to carry canonical-space
        #   identity displacements into head/metre space.
        "canonical_norm": [[round(float(c), 6) for c in v] for v in canon_norm],
        "landmark_vtx": landmark_vtx,
        "head_face_scale": round(float(head_face_scale), 8),
    }

    out_path.write_text(json.dumps(result, indent=2))
    print(f"  Written → {out_path}")
    print("=== done ===")


def main() -> None:
    import recon_templates

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("glb", nargs="?", type=Path,
                    help="template GLB (default: the selected template's shipped GLB)")
    ap.add_argument("--template", default=recon_templates.DEFAULT_TEMPLATE,
                    choices=sorted(recon_templates.TEMPLATES),
                    help="which TemplateSpec names the head mesh, skin material and alignment")
    ap.add_argument("--glb", dest="glb_flag", type=Path, help="template GLB (same as the positional)")
    ap.add_argument("--out", type=Path, help="output JSON (default: the template's UV map path)")
    args = ap.parse_args()
    precompute(recon_templates.get(args.template), args.glb_flag or args.glb, args.out)


if __name__ == "__main__":
    main()
