"""
Texture-fidelity metrics for the synthesised-view track.

ISE (identity_eval.py) is texture-blind by design, so it cannot move when only the
texture changes. This module scores texture against HELD-OUT VIEWS: render the
avatar's skin on the head at a held-out yaw and compare it, inside the region both
the render and the held-out photograph actually show, with that photograph.

Metrics (all masked, so background and unpainted regions never count):
  • masked SSIM   (higher is better)
  • colour-histogram distance, Bhattacharyya on Lab (lower is better)
  • seam continuity: mean Lab step across UV island boundaries (lower is better)

LPIPS is deliberately not used. It needs a pretrained network, and the weight set
that is both commercially clean and vetted for this workspace has not been chosen;
shipping a number from an unvetted ImageNet backbone would be a licence question
dressed as a metric. Masked SSIM plus the histogram distance stand in, and every
report prints that substitution.

Held-out photographs
--------------------
Ground truth for "this identity at yaw N" does not exist for synthetic faces unless
it is generated. `--make-heldout` asks Vertex for each reference at the held-out
yaws (a different yaw set from the one used for synthesis, so the views the track
adds are not graded on themselves) and stores them as
`<dir>/<ref stem>__yaw<deg>.png`. Because the generator makes both the references
and the held-out views, the numbers measure agreement with the generator's idea of
the person at that angle, which is the same proxy the program used for its
same-pose divergence figure (0.0069). They say nothing about a real person's back
of head, and the report states that.

Usage (from workers/avatar-reconstruction):
    python -m eval.texture_eval --make-heldout --refs eval/refs --heldout eval/heldout
    python -m eval.texture_eval --refs eval/refs --heldout eval/heldout
    python -m eval.texture_eval --calibrate        # print gate-threshold evidence

Requires the worker's runtime deps (cv2, mediapipe, pygltflib, rembg), the template
GLBs, and, for synthesis, Vertex access (see README, "View synthesis").
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Optional

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import face_projection as fpr  # noqa: E402

HELDOUT_YAWS = (-50.0, 20.0, 50.0)
RENDER_SIZE = 384


def render_textured(
    positions: np.ndarray,
    normals: np.ndarray,
    uvs: np.ndarray,
    faces: np.ndarray,
    skin_rgb: np.ndarray,
    camera: fpr.WeakPerspectiveCamera,
    size: int = RENDER_SIZE,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Software-render the textured head. Returns (rgb (size,size,3) uint8, facing
    mask bool). Painter's z-buffer; texels are sampled nearest from the skin atlas
    with the same top-left UV convention the projection uses.
    """
    px, z = camera.project(positions)
    k = size / max(camera.img_w, camera.img_h)
    sx, sy = px[:, 0] * k, px[:, 1] * k
    depth = np.full((size, size), np.inf, dtype=np.float32)
    out = np.zeros((size, size, 3), dtype=np.uint8)
    th, tw = skin_rgb.shape[:2]
    facing = normals @ camera.view_direction()

    for tri in faces:
        i0, i1, i2 = tri
        x0, y0, x1, y1, x2, y2 = sx[i0], sy[i0], sx[i1], sy[i1], sx[i2], sy[i2]
        minx, maxx = max(0, int(np.floor(min(x0, x1, x2)))), min(size - 1, int(np.ceil(max(x0, x1, x2))))
        miny, maxy = max(0, int(np.floor(min(y0, y1, y2)))), min(size - 1, int(np.ceil(max(y0, y1, y2))))
        if minx > maxx or miny > maxy:
            continue
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(den) < 1e-12 or float(facing[[i0, i1, i2]].mean()) <= 0.0:
            continue
        gy, gx = np.mgrid[miny:maxy + 1, minx:maxx + 1]
        w0 = ((y1 - y2) * (gx - x2) + (x2 - x1) * (gy - y2)) / den
        w1 = ((y2 - y0) * (gx - x2) + (x0 - x2) * (gy - y2)) / den
        w2 = 1.0 - w0 - w1
        ins = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not ins.any():
            continue
        zz = w0 * z[i0] + w1 * z[i1] + w2 * z[i2]
        u = w0 * uvs[i0, 0] + w1 * uvs[i1, 0] + w2 * uvs[i2, 0]
        v = w0 * uvs[i0, 1] + w1 * uvs[i1, 1] + w2 * uvs[i2, 1]
        ys, xs = gy[ins], gx[ins]
        near = zz[ins] < depth[ys, xs]
        ys, xs = ys[near], xs[near]
        depth[ys, xs] = zz[ins][near]
        tx = np.clip(np.rint(u[ins][near] * (tw - 1)).astype(int), 0, tw - 1)
        ty = np.clip(np.rint(v[ins][near] * (th - 1)).astype(int), 0, th - 1)
        out[ys, xs] = skin_rgb[ty, tx]
    return out, np.isfinite(depth)


def masked_ssim(a: np.ndarray, b: np.ndarray, mask: np.ndarray) -> Optional[float]:
    """Mean SSIM (gaussian window, grayscale) over mask pixels; None if mask tiny."""
    if int(mask.sum()) < 64:
        return None
    x = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY).astype(np.float64)
    y = cv2.cvtColor(b, cv2.COLOR_RGB2GRAY).astype(np.float64)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    g = lambda im: cv2.GaussianBlur(im, (11, 11), 1.5)  # noqa: E731
    mx, my = g(x), g(y)
    sxx, syy, sxy = g(x * x) - mx * mx, g(y * y) - my * my, g(x * y) - mx * my
    ssim = ((2 * mx * my + c1) * (2 * sxy + c2)) / ((mx * mx + my * my + c1) * (sxx + syy + c2))
    inner = cv2.erode(mask.astype(np.uint8), np.ones((11, 11), np.uint8)).astype(bool)
    sel = inner if int(inner.sum()) >= 64 else mask
    return float(ssim[sel].mean())


def histogram_distance(a: np.ndarray, b: np.ndarray, mask: np.ndarray) -> Optional[float]:
    """Bhattacharyya distance between Lab histograms of the masked pixels (0 = same)."""
    if int(mask.sum()) < 64:
        return None
    la = cv2.cvtColor(a, cv2.COLOR_RGB2LAB)[mask]
    lb = cv2.cvtColor(b, cv2.COLOR_RGB2LAB)[mask]
    total = 0.0
    for c in range(3):
        ha = np.histogram(la[:, c], bins=32, range=(0, 256))[0].astype(np.float32)
        hb = np.histogram(lb[:, c], bins=32, range=(0, 256))[0].astype(np.float32)
        total += cv2.compareHist(ha / ha.sum(), hb / hb.sum(), cv2.HISTCMP_BHATTACHARYYA)
    return total / 3.0


def score_view(
    skin_rgb: np.ndarray,
    heldout_rgb: np.ndarray,
    heldout_mask: np.ndarray,
    camera: fpr.WeakPerspectiveCamera,
    positions, normals, uvs, faces,
) -> dict:
    """Score one skin atlas against one held-out photograph."""
    rendered, vis = render_textured(positions, normals, uvs, faces, skin_rgb, camera)
    held = cv2.resize(heldout_rgb, (RENDER_SIZE, RENDER_SIZE), interpolation=cv2.INTER_AREA)
    hm = cv2.resize((heldout_mask > 0.5).astype(np.uint8), (RENDER_SIZE, RENDER_SIZE), interpolation=cv2.INTER_NEAREST).astype(bool)
    mask = vis & hm
    return {"ssim": masked_ssim(rendered, held, mask), "hist": histogram_distance(rendered, held, mask),
            "pixels": int(mask.sum())}


def summarize(rows: list[dict]) -> dict:
    """Aggregate per-view before/after rows into the enable-by-default verdict."""
    def mean(key):
        v = [r[key] for r in rows if r.get(key) is not None]
        return float(np.mean(v)) if v else None

    out = {k: mean(k) for k in ("ssim_before", "ssim_after", "hist_before", "hist_after")}
    seam_ok = all(r.get("seam_ok", True) for r in rows)
    improved = (
        out["ssim_before"] is not None and out["ssim_after"] is not None
        and out["ssim_after"] > out["ssim_before"] and out["hist_after"] < out["hist_before"]
    )
    out.update(n=len(rows), seams_pass_all=seam_ok, enable_by_default=bool(improved and seam_ok))
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refs", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "refs"))
    ap.add_argument("--heldout", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "heldout"))
    ap.add_argument("--make-heldout", action="store_true", help="generate held-out views with Vertex")
    ap.add_argument("--calibrate", action="store_true", help="print gate metrics per synthesised view")
    args = ap.parse_args(argv[1:])

    from PIL import Image
    import face_geometry as fg
    import face_pipeline as pipe
    import glb_ops
    import recon_templates
    import view_synthesis as vs
    import view_texture as vt

    refs = sorted(f for f in os.listdir(args.refs) if f.lower().endswith((".png", ".jpg", ".jpeg"))) if os.path.isdir(args.refs) else []
    if not refs:
        print(f"no reference faces in {args.refs}; run: python -m eval.make_refs --out {args.refs}")
        return 1

    if args.make_heldout:
        os.makedirs(args.heldout, exist_ok=True)
        targets = tuple(vs.ViewTarget(f"yaw{int(y)}", y, 0.0) for y in HELDOUT_YAWS)
        for f in refs:
            rep = vs.synthesize_views(Image.open(os.path.join(args.refs, f)).convert("RGB"), targets=targets)
            for v in rep.views:
                v.image.save(os.path.join(args.heldout, f"{os.path.splitext(f)[0]}__yaw{int(v.target.yaw)}.png"))
            print(f"  {f}: {len(rep.views)}/{len(targets)} held-out views ({rep.summary()})")
        return 0

    rows: list[dict] = []
    for f in refs:
        stem = os.path.splitext(f)[0]
        img = Image.open(os.path.join(args.refs, f)).convert("RGB")
        lms = pipe._get_landmarks(img) or pipe._get_landmarks_small_face(img)
        if lms is None:
            print(f"  {f}: no face"); continue
        fg_img = pipe._remove_background(img)
        uv_map = pipe._get_uv_map()
        _, face_mask_uv = pipe._warp_face_to_uv(fg_img, lms, uv_map)
        glb = glb_ops.load_glb(pipe._load_template("neutral"))
        pos, uvs, faces = glb_ops.get_head_mesh_data(glb)
        nrm = glb_ops.recompute_vertex_normals(pos, faces)
        tex = glb_ops.get_material_texture(glb, recon_templates.active().skin_material)
        base = np.array(tex.convert("RGB"), dtype=np.uint8)
        lm_idx = np.asarray(uv_map["landmark_vtx"], dtype=np.int64)
        det = fg.landmarks_to_array(lms, *img.size)
        alpha = np.array(fg_img.convert("RGBA"))[:, :, 3].astype(np.float32) / 255.0
        cam = fpr.solve_camera(det, lm_idx, pos, *img.size)
        proj = fpr.project_photo_to_uv(np.array(fg_img.convert("RGB")), alpha, pos, nrm, uvs, faces, det, lm_idx, tex.width, tex.height)
        if cam is None or proj is None:
            print(f"  {f}: camera did not solve"); continue
        before = fpr.blend_projection(base, proj[0], proj[1], protect=face_mask_uv)
        report = vs.synthesize_views(img)
        res = vt.enrich_with_views(
            report=report, selfie_rgb=np.array(img), selfie_mask=alpha, selfie_landmarks_3d=det,
            primary_camera=cam, primary=proj, base_skin_rgb=base, protect=face_mask_uv,
            positions=pos, normals=nrm, uvs=uvs, faces=faces, landmark_vertex_indices=lm_idx,
            detect_landmarks=pipe._detect_landmarks_array, remove_background=pipe._remove_background)
        seam_ok = res.seam_after is None or res.seam_before is None or res.seam_after - res.seam_before <= vt.SEAM_DELTA_E_MAX
        print(f"  {f}: accepted {res.accepted} rejected {res.rejected} coverage {res.coverage_before:.1%} -> {res.coverage_after:.1%}")
        if args.calibrate:
            for v in report.views:
                print(f"      {v.target.name}: {res.rejected.get(v.target.name, 'accepted')}")
        for yaw in HELDOUT_YAWS:
            hp = os.path.join(args.heldout, f"{stem}__yaw{int(yaw)}.png")
            if not os.path.exists(hp):
                continue
            held = Image.open(hp).convert("RGB")
            hmask = np.array(pipe._remove_background(held).convert("RGBA"))[:, :, 3].astype(np.float32) / 255.0
            prior = fpr.camera_from_pose_prior(cam, held.width, held.height, yaw, 0.0, hmask, pos, faces)
            if prior is None:
                continue
            s_b = score_view(before, np.array(held), hmask, prior[0], pos, nrm, uvs, faces)
            s_a = score_view(res.skin_rgb, np.array(held), hmask, prior[0], pos, nrm, uvs, faces)
            rows.append({"ssim_before": s_b["ssim"], "ssim_after": s_a["ssim"], "hist_before": s_b["hist"],
                         "hist_after": s_a["hist"], "seam_ok": seam_ok})
    if not rows:
        print("\nno held-out comparisons; run with --make-heldout first")
        return 1
    s = summarize(rows)
    print(f"\n{s['n']} held-out views (masked SSIM + Lab histogram distance; LPIPS not used, see module docstring)")
    print(f"  SSIM  before {s['ssim_before']:.4f}  after {s['ssim_after']:.4f}")
    print(f"  hist  before {s['hist_before']:.4f}  after {s['hist_after']:.4f}")
    print(f"  seams pass on all references: {s['seams_pass_all']}")
    print(f"  enable RECON_VIEW_SYNTHESIS by default: {s['enable_by_default']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
