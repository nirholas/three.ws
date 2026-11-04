"""
Fold gated, synthesised views into the head texture.

Orchestrates view_synthesis (what to ask Vertex for, and whether the answer is the
same person) and face_projection (where each pixel lands on the head). The
selfie's projection stays authoritative; a synthesised view only fills what it
has not claimed, at a lower blend ceiling.

Texture only. Nothing here receives a writable handle on geometry, and the tests
assert the arrays come out untouched, so identity geometry is byte-identical with
the feature on or off.

A view is dropped, silently and individually, when it fails any of:
  1. the identity gate (skin colour, and landmark proportions when a face is found);
  2. camera consistency: the camera solved from its landmarks must agree with the
     requested turn, or (no landmarks, as with scalp and profile views) the
     pose-prior silhouette must overlap the person mask well enough;
  3. seam continuity: painting it must not raise the mean colour step across UV
     island boundaries by more than SEAM_DELTA_E_MAX.
Zero surviving views returns the selfie-only result.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np
from PIL import Image

import face_projection as fpr
from view_synthesis import (
    GateThresholds,
    SynthesisReport,
    identity_gate,
)

log = logging.getLogger("view_texture")

# Largest increase, in Lab units, of the mean colour step across UV island
# boundaries that one view may cause. Provisional until the 40-face calibration.
SEAM_DELTA_E_MAX = 4.0


@dataclass
class EnrichResult:
    skin_rgb: np.ndarray
    accepted: list[str] = field(default_factory=list)
    rejected: dict = field(default_factory=dict)
    coverage_before: float = 0.0
    coverage_after: float = 0.0
    seam_before: Optional[float] = None
    seam_after: Optional[float] = None


def _requested_angle_deg(yaw: float, pitch: float) -> float:
    R = fpr._rot_x(pitch) @ fpr._rot_y(yaw)
    return float(np.degrees(np.arccos(np.clip((np.trace(R) - 1.0) / 2.0, -1.0, 1.0))))


def enrich_with_views(
    *,
    report: SynthesisReport,
    selfie_rgb: np.ndarray,
    selfie_mask: Optional[np.ndarray],
    selfie_landmarks_3d: Optional[np.ndarray],
    primary_camera: fpr.WeakPerspectiveCamera,
    primary: tuple[np.ndarray, np.ndarray, np.ndarray],
    base_skin_rgb: np.ndarray,
    protect: Optional[np.ndarray],
    positions: np.ndarray,
    normals: np.ndarray,
    uvs: np.ndarray,
    faces: np.ndarray,
    landmark_vertex_indices: np.ndarray,
    detect_landmarks: Callable[[Image.Image], Optional[np.ndarray]],
    remove_background: Callable[[Image.Image], Image.Image],
    thresholds: GateThresholds = GateThresholds(),
) -> EnrichResult:
    """
    `primary` is project_photo_to_uv's (rgb_uv, weight_uv, covered) for the selfie.
    `base_skin_rgb` is the skin BEFORE the selfie projection was blended in, so the
    result is one blend of base + composite rather than a blend of a blend.
    """
    prim_rgb, prim_w, covered = primary
    tex_h, tex_w = prim_w.shape
    seams = fpr.uv_seams(positions, uvs, faces)

    def render(rgb, w):
        return fpr.blend_projection(base_skin_rgb, rgb, w, protect=protect)

    cur_rgb, cur_w = prim_rgb, prim_w
    result = EnrichResult(
        skin_rgb=render(cur_rgb, cur_w),
        coverage_before=fpr.coverage_fraction(prim_w, covered),
    )
    result.seam_before = fpr.seam_discontinuity(result.skin_rgb, cur_w, seams)

    for view in report.views:
        name = view.target.name
        try:
            img = view.image.convert("RGB")
            w, h = img.size
            rgba = remove_background(img)
            alpha = np.array(rgba.convert("RGBA"), dtype=np.uint8)[:, :, 3].astype(np.float32) / 255.0
            rgb = np.array(img, dtype=np.uint8)
            lm = detect_landmarks(img)

            gate = identity_gate(selfie_rgb, selfie_mask, selfie_landmarks_3d, rgb, alpha, lm, thresholds)
            if not gate.accepted:
                result.rejected[name] = "; ".join(gate.reasons)
                continue

            want = _requested_angle_deg(view.target.yaw, view.target.pitch)
            cam = None
            if lm is not None:
                solved = fpr.solve_camera(lm, landmark_vertex_indices, positions, w, h)
                if solved is not None and abs(fpr.view_angle_deg(primary_camera, solved) - want) <= thresholds.max_yaw_error_deg:
                    cam = solved
            if cam is None:
                prior = fpr.camera_from_pose_prior(
                    primary_camera, w, h, view.target.yaw, view.target.pitch, alpha, positions, faces)
                if prior is None or prior[1] < thresholds.min_silhouette_iou:
                    result.rejected[name] = (
                        "pose not confirmed" if prior is None
                        else f"silhouette IoU {prior[1]:.2f} < {thresholds.min_silhouette_iou}")
                    continue
                cam = prior[0]

            out = fpr.project_photo_to_uv(
                rgb, alpha, positions, normals, uvs, faces, np.zeros((0, 3)), landmark_vertex_indices,
                tex_w, tex_h, camera=cam, max_blend=fpr.SYNTH_MAX_BLEND)
            if out is None:
                result.rejected[name] = "projection produced nothing"
                continue
            v_rgb, v_w, _ = out
            if not (v_w > 0.01).any():
                result.rejected[name] = "no texels visible from the solved camera"
                continue
            v_rgb = fpr.match_skin_statistics(v_rgb, v_w, cur_rgb, cur_w)

            trial_rgb, trial_w = fpr.composite_views(cur_rgb, cur_w, [(v_rgb, v_w)])
            trial_skin = render(trial_rgb, trial_w)
            before = fpr.seam_discontinuity(result.skin_rgb, cur_w, seams)
            after = fpr.seam_discontinuity(trial_skin, trial_w, seams)
            if before is not None and after is not None and after - before > SEAM_DELTA_E_MAX:
                result.rejected[name] = f"seam step +{after - before:.1f} dE > {SEAM_DELTA_E_MAX}"
                continue

            cur_rgb, cur_w = trial_rgb, trial_w
            result.skin_rgb = trial_skin
            result.accepted.append(name)
        except Exception as exc:  # noqa: BLE001 - one view never fails the others
            result.rejected[name] = f"error: {type(exc).__name__}"
            log.warning("view %s dropped: %s", name, exc)

    result.coverage_after = fpr.coverage_fraction(cur_w, covered)
    result.seam_after = fpr.seam_discontinuity(result.skin_rgb, cur_w, seams)
    return result
