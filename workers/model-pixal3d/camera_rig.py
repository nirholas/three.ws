"""Synthetic camera rig for Pixal3D multi-view requests.

Pixal3D's multi-view pipeline (`inference_mv.py`) wants a `transforms.json`-style
record per input image: a 4x4 camera-to-world transform matrix, a horizontal FOV
and a camera distance, with frame 0 required to be the canonical front view
(camera at world position (0, -distance, 0)).

Forge callers send plain labels ("front", "back", "left", "right") instead of
real camera data, so this module turns a label (or a slot index when no label
was given) into the matrix Pixal3D expects. The front-view matrix constant and
the "rotate about world +Z" rule both come from Pixal3D's own
`pixal3d/trainers/flow_matching/mixins/image_conditioned_proj.py`
(`ProjGrid.front_view_transform_matrix`, with `[1, 3]` overwritten to
`-distance` at runtime). Pixal3D itself never defines a left/right handedness
beyond "frame 0 is front"; the azimuth convention below (front=0, right=90,
back=180, left=270, counter-clockwise about +Z) is this worker's own and is
applied consistently to every request.
"""

from __future__ import annotations

import math
from typing import Optional, Sequence

VIEW_AZIMUTH_DEGREES = {
    "front": 0.0,
    "right": 90.0,
    "back": 180.0,
    "left": 270.0,
}

# Even-spacing fallback azimuths for requests that attach images without view
# labels, keyed by how many images were sent. Index 0 is always 0 degrees
# (front) so an unlabeled first image still satisfies Pixal3D's frame-0 rule.
_EVEN_SPACING = {
    1: (0.0,),
    2: (0.0, 180.0),
    3: (0.0, 120.0, 240.0),
    4: (0.0, 90.0, 180.0, 270.0),
}


def resolve_azimuths(view_labels: Sequence[Optional[str]]) -> list[float]:
    """The azimuth in degrees for each slot, honoring labels where given.

    Labeled slots use `VIEW_AZIMUTH_DEGREES`; unlabeled slots fall back to the
    even spacing for the total count, matched to their position among the
    *unlabeled* slots only, so a partially-labeled request (e.g. front labeled,
    the rest blank) still spreads the blanks evenly instead of clustering them
    at the labeled azimuths. An unrecognized label is treated as unlabeled.
    """
    n = len(view_labels)
    if n == 0:
        return []
    result: list[Optional[float]] = [None] * n
    unlabeled_positions = []
    for i, label in enumerate(view_labels):
        key = (label or "").strip().lower()
        if key in VIEW_AZIMUTH_DEGREES:
            result[i] = VIEW_AZIMUTH_DEGREES[key]
        else:
            unlabeled_positions.append(i)
    if unlabeled_positions:
        spacing = _EVEN_SPACING.get(n, tuple(360.0 * i / n for i in range(n)))
        used = {v for v in result if v is not None}
        # Skip spacing slots an explicit label already claimed, so a labeled
        # front doesn't also get handed to the first unlabeled slot.
        available = [v for v in spacing if v not in used]
        if len(available) < len(unlabeled_positions):
            available = list(spacing)
        for slot_index, position in enumerate(unlabeled_positions):
            result[position] = available[slot_index % len(available)]
    return [float(v) for v in result]


def transform_matrix_for_azimuth(azimuth_degrees: float, distance: float) -> list[list[float]]:
    """The 4x4 camera-to-world matrix for a camera orbiting at `azimuth_degrees`.

    Built as `Rz(theta) @ F` where `F` is Pixal3D's front-view matrix with its
    distance slot filled in, and `Rz` is a right-handed rotation about world
    +Z. At theta=0 this is exactly Pixal3D's own front-view matrix (camera at
    (0, -distance, 0)); at 90/180/270 the camera orbits to
    (distance, 0, 0) / (0, distance, 0) / (-distance, 0, 0) respectively.
    """
    theta = math.radians(azimuth_degrees)
    cos_t, sin_t = math.cos(theta), math.sin(theta)

    front = [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, -1.0, -float(distance)],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]
    rotate_z = [
        [cos_t, -sin_t, 0.0, 0.0],
        [sin_t, cos_t, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]

    result = [[0.0] * 4 for _ in range(4)]
    for i in range(4):
        for j in range(4):
            result[i][j] = sum(rotate_z[i][k] * front[k][j] for k in range(4))
    return result


def camera_position(matrix: Sequence[Sequence[float]]) -> tuple[float, float, float]:
    """The world-space camera position encoded in a camera-to-world matrix."""
    return (matrix[0][3], matrix[1][3], matrix[2][3])


def build_view_rig(
    view_labels: Sequence[Optional[str]], distance: float, camera_angle_x: float
) -> list[dict]:
    """One Pixal3D-ready view record per input slot, in input order.

    Each record carries the fields `inference_mv.py`'s `load_views()` needs per
    view: `transform_matrix`, `camera_angle_x` and `camera_distance` (the same
    FOV and distance are reused for every view, matching Pixal3D's own
    same-camera assumption for synthetic multi-view input).
    """
    azimuths = resolve_azimuths(view_labels)
    return [
        {
            "azimuth_degrees": azimuth,
            "transform_matrix": transform_matrix_for_azimuth(azimuth, distance),
            "camera_angle_x": float(camera_angle_x),
            "camera_distance": float(distance),
        }
        for azimuth in azimuths
    ]
