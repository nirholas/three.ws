#!/usr/bin/env python3
"""
Transfer the ICT-FaceKit ARKit expression set onto the Anny (MakeHuman) head.

Input
  avatar-sources/ict-facekit/   neutral mesh + 53 sparse expression deltas (MIT),
                                written by scripts/vendor-ict-facekit.py
  avatar-sources/anny/          CC0 base mesh, vertex groups, Mixamo weights

Output
  avatar-sources/ict-facekit/anny-targets/<arkitName>.target.gz
      MakeHuman-format sparse targets ("<vertex> dx dy dz", decimetres) indexed
      by ORIGINAL base.obj vertex, the same space as avatar-sources/anny/targets,
      so scripts/build-reconstruction-template.mjs bakes them exactly like the
      identity morphs. 52 files, the ARKit set: ICT's 53 shapes with the L/R
      browInnerUp and cheekPuff pairs merged, plus a synthesized tongueOut
      (ICT has no tongue shape).
  avatar-sources/ict-facekit/anny-targets/report.json
      registration residuals and per-shape stats, so a re-run is auditable.

Method
  1. Similarity (Umeyama, with scale) from five anatomical anchors: both eye
     centres, the nose tip and both mouth corners.
  2. Non-rigid ICP: the ICT surface is pulled onto the Anny head by a Gaussian
     displacement field over closest-point correspondences, coarse to fine,
     with the anchors, the lip contact and the eyelid margins held as
     heavy-weight constraints so the features line up, not just the surfaces.
  3. Transfer: every Anny head vertex takes the barycentric ICT delta of its
     closest point on the registered ICT surface. Correspondence is restricted
     by class so an upper lip never reads a lower-lip delta (the lips touch at
     rest) and an upper eyelid never reads the lower lid. Deltas are rotated
     and scaled by the similarity, faded by registration distance, and faded
     to zero before the head/body split so the two meshes never crack.
  4. Rigid parts: each eyeball takes ICT's eyeball rotation (Kabsch) about its
     own centre; the teeth and tongue take ICT's teeth rigid transforms.

    python3 scripts/build-ict-expression-targets.py [--preview <dir>]

Needs numpy and scipy (the reconstruction worker's requirements).
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parent.parent
ANNY = ROOT / "avatar-sources" / "anny"
ICT = ROOT / "avatar-sources" / "ict-facekit"
OUT = ICT / "anny-targets"

# ICT-FaceKit vertex ranges (README "Vertex index ranges", generic_neutral_mesh).
ICT_FACE = (0, 9409)
ICT_HEAD_NECK = (9409, 11248)
ICT_MOUTH_SOCKET = (11248, 13294)
ICT_TEETH_UPPER = (17039, 19247)
ICT_TEETH_LOWER = (19247, 21451)
ICT_EYEBALL_L = (21451, 23021)  # ICT _L is the character's left, +X
ICT_EYEBALL_R = (23021, 24591)
# Multi-PIE 68-point landmark slots (ICT README) used as anchors.
LM_NOSE_TIP, LM_MOUTH_A, LM_MOUTH_B, LM_LIP_INNER_UP, LM_LIP_INNER_LO = 30, 48, 54, 62, 66

# Anny's head is the Head+Neck skin-weight region; the template builder splits
# the Head mesh off at weight 0.5. Expression deltas fade to zero between these
# two weights, so every vertex the head and body meshes share is still.
HEAD_SPLIT_WEIGHT = 0.5
FADE_START, FADE_FULL = 0.62, 0.85

# Registration fade (decimetres): an Anny vertex further than this from the
# registered ICT surface is not covered by the scan and gets no delta.
COVER_FULL, COVER_NONE = 0.05, 0.2

# Delta values below this (decimetres = 10 microns) are not written.
WRITE_EPSILON = 1e-4

UNKNOWN, UPPER_LIP, LOWER_LIP, UPPER_LID, LOWER_LID = 0, 1, 2, 3, 4
FORBIDDEN = {(UPPER_LIP, LOWER_LIP), (LOWER_LIP, UPPER_LIP), (UPPER_LID, LOWER_LID), (LOWER_LID, UPPER_LID)}


# ── loading ──────────────────────────────────────────────────────────────────


def triangulate(polys):
    tris = []
    for p in polys:
        for i in range(2, len(p)):
            tris.append((p[0], p[i - 1], p[i]))
    return np.asarray(tris, dtype=np.int64)


def load_anny():
    pos, faces = [], {}
    group = ""
    for line in (ANNY / "3dobjs" / "base.obj").read_text().splitlines():
        if line.startswith("v "):
            pos.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("g "):
            group = line[2:].strip()
        elif line.startswith("f "):
            faces.setdefault(group, []).append([int(c.split("/")[0]) - 1 for c in line.split()[1:]])
    groups = json.loads((ANNY / "mesh_metadata" / "basemesh_vertex_groups.json").read_text())
    weights = json.loads((ANNY / "rigs" / "weights.mixamo.json").read_text())["weights"]
    pos = np.asarray(pos)
    head_w = np.zeros(len(pos))
    for bone in ("mixamorig:Head", "mixamorig:Neck"):
        for v, w in weights[bone]:
            head_w[v] += w
    return {
        "pos": pos,
        "faces": {g: triangulate(f) for g, f in faces.items()},
        "groups": {g: np.concatenate([np.arange(a, b + 1) for a, b in r]) for g, r in groups.items()},
        "head_w": head_w,
    }


def load_anny_target(rel):
    out = {}
    with gzip.open(ANNY / "targets" / f"{rel}.target.gz", "rt") as fh:
        for line in fh:
            t = line.split()
            if len(t) == 4 and not line.startswith("#"):
                out[int(t[0])] = np.array([float(t[1]), float(t[2]), float(t[3])])
    return out


def load_ict():
    pos, polys = [], []
    with gzip.open(ICT / "neutral.obj.gz", "rt") as fh:
        for line in fh:
            if line.startswith("v "):
                pos.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("f "):
                polys.append([int(x) - 1 for x in line.split()[1:]])
    indices = json.loads((ICT / "vertex_indices.json").read_text())
    return {
        "pos": np.asarray(pos),
        "tris": triangulate(polys),
        "names": list(indices["expressions"]),
        "landmarks": indices["idx_to_landmark_verts"],
    }


def load_ict_delta(name, n):
    d = np.zeros((n, 3))
    with gzip.open(ICT / "expressions" / f"{name}.delta.gz", "rt") as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            i, x, y, z = line.split()
            d[int(i)] = (float(x), float(y), float(z))
    return d


# ── geometry helpers ─────────────────────────────────────────────────────────


def vertex_normals(pos, tris):
    fn = np.cross(pos[tris[:, 1]] - pos[tris[:, 0]], pos[tris[:, 2]] - pos[tris[:, 0]])
    n = np.zeros_like(pos)
    for k in range(3):
        np.add.at(n, tris[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def umeyama(src, dst):
    """Similarity (s, R, t) minimising |s R src + t - dst|^2."""
    mu_s, mu_d = src.mean(0), dst.mean(0)
    a, b = src - mu_s, dst - mu_d
    u, sig, vt = np.linalg.svd(b.T @ a / len(src))
    d = np.eye(3)
    if np.linalg.det(u) * np.linalg.det(vt) < 0:
        d[2, 2] = -1
    r = u @ d @ vt
    s = np.trace(np.diag(sig) @ d) / (a**2).sum(1).mean()
    return s, r, mu_d - s * r @ mu_s


def kabsch(src, dst):
    """Rigid (R, t) minimising |R src + t - dst|^2."""
    mu_s, mu_d = src.mean(0), dst.mean(0)
    u, _, vt = np.linalg.svd((dst - mu_d).T @ (src - mu_s))
    d = np.eye(3)
    if np.linalg.det(u) * np.linalg.det(vt) < 0:
        d[2, 2] = -1
    r = u @ d @ vt
    return r, mu_d - r @ mu_s


def lid_margin(pos, verts, centre, eye_radius, n=8):
    """n eyelid-margin points spread by angle around the eye, starting at +X
    and walking counter-clockwise. Both meshes model the socket folding in
    behind the eyeball (Anny is watertight), so the margin is defined the same
    way on each: per angular sector, the vertex closest to the eye axis among
    those sitting in front of the eyeball's equator."""
    rel = pos[verts] - centre
    front = rel[:, 2] > 0.5 * eye_radius
    verts, rel = verts[front], rel[front]
    ang = np.arctan2(rel[:, 1], rel[:, 0])
    rad = np.linalg.norm(rel[:, :2], axis=1)
    picks = []
    for k in range(n):
        target = 2 * np.pi * k / n
        sector = np.abs(np.angle(np.exp(1j * (ang - target)))) < np.pi / (2 * n)
        if not sector.any():
            raise RuntimeError(f"no eyelid vertices in sector {k} around {centre}")
        cand = np.flatnonzero(sector)
        picks.append(verts[cand[np.argmin(rad[cand])]])
    return np.asarray(picks)


def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


# ── Anny side ────────────────────────────────────────────────────────────────


def anny_features(anny):
    pos = anny["pos"]
    body_tris = anny["faces"]["body"]
    body_verts = np.unique(body_tris)
    head = body_verts[anny["head_w"][body_verts] >= HEAD_SPLIT_WEIGHT]
    eye_l = pos[anny["groups"]["helper-l-eye"]].mean(0)
    eye_r = pos[anny["groups"]["helper-r-eye"]].mean(0)

    mid = head[np.abs(pos[head, 0]) < 1e-3]
    nose = mid[np.argmax(pos[mid, 2])]

    # Mouth corners: MakeHuman's mouth-angles-up target lifts a tight cluster of
    # skin at each lip corner by the same amount. Its front-facing centroid per
    # side is the visible corner (the cavity corner sits ~5 cm further back).
    angles = load_anny_target("mouth/mouth-angles-up")
    ids = np.array(list(angles.keys()))
    mag = np.array([np.linalg.norm(angles[i]) for i in ids])
    top = ids[(mag >= 0.95 * mag.max()) & (pos[ids, 2] > pos[nose, 2] - 0.45)]
    corner_l = pos[top[pos[top, 0] > 0]].mean(0)
    corner_r = pos[top[pos[top, 0] < 0]].mean(0)

    # Lip classes. Away from the slit the side of the slit line decides; within
    # 2.5 mm of it, where upper and lower lip touch, MakeHuman's own lip targets
    # decide (a vertex belongs to the lip whose shape targets move it more).
    def score(prefix):
        sc = np.zeros(len(pos))
        for part in ("volume-incr", "height-incr", "middle-up", "ext-up", "width-incr"):
            for i, d in load_anny_target(f"mouth/mouth-{prefix}-{part}").items():
                sc[i] += np.linalg.norm(d)
        return sc

    up, lo = score("upperlip"), score("lowerlip")
    front_mid = mid[pos[mid, 2] > pos[nose, 2] - 0.3]
    near_slit = front_mid[np.abs(pos[front_mid, 1] - 0.5 * (corner_l[1] + corner_r[1])) < 0.05]
    up_mid = near_slit[up[near_slit] >= lo[near_slit]]
    lo_mid = near_slit[lo[near_slit] > up[near_slit]]
    contact = 0.5 * (pos[up_mid[np.argmin(pos[up_mid, 1])]] + pos[lo_mid[np.argmax(pos[lo_mid, 1])]])

    labels = np.zeros(len(pos), dtype=np.int8)
    half_w = abs(corner_l[0])
    t = np.clip(np.abs(pos[head, 0]) / half_w, 0, 1)
    slit_y = contact[1] + t * (0.5 * (corner_l[1] + corner_r[1]) - contact[1])
    rel_y = pos[head, 1] - slit_y
    zone = (pos[head, 0] / (half_w * 1.25)) ** 2 + (rel_y / 0.2) ** 2 < 1.0
    by_target = np.where(up[head] >= lo[head], UPPER_LIP, LOWER_LIP)
    by_side = np.where(rel_y >= 0, UPPER_LIP, LOWER_LIP)
    lab = np.where(np.abs(rel_y) < 0.025, by_target, by_side)
    labels[head[zone]] = lab[zone]

    # Eyelid classes: open eyes, so the lid gap splits upper from lower; label
    # by side of the eye centre within the orbit.
    for centre in (eye_l, eye_r):
        near = head[np.linalg.norm(pos[head, :2] - centre[:2], axis=1) < 0.22]
        near = near[pos[near, 2] > centre[2]]
        labels[near[pos[near, 1] >= centre[1]]] = UPPER_LID
        labels[near[pos[near, 1] < centre[1]]] = LOWER_LID

    eye_radius = float(np.median(np.linalg.norm(pos[anny["groups"]["helper-l-eye"]] - eye_l, axis=1)))
    return {
        "head": head,
        "eye_l": eye_l,
        "eye_r": eye_r,
        "nose": pos[nose],
        "corner_l": corner_l,
        "corner_r": corner_r,
        "contact": contact,
        "labels": labels,
        "lid_l": lid_margin(pos, head, eye_l, eye_radius),
        "lid_r": lid_margin(pos, head, eye_r, eye_radius),
    }


# ── ICT side ─────────────────────────────────────────────────────────────────


def ict_features(ict, deltas):
    pos, lm = ict["pos"], ict["landmarks"]
    eye_l = pos[slice(*ICT_EYEBALL_L)].mean(0)
    eye_r = pos[slice(*ICT_EYEBALL_R)].mean(0)
    a, b = pos[lm[LM_MOUTH_A]], pos[lm[LM_MOUTH_B]]
    corner_l, corner_r = (a, b) if a[0] > b[0] else (b, a)
    contact = 0.5 * (pos[lm[LM_LIP_INNER_UP]] + pos[lm[LM_LIP_INNER_LO]])

    labels = np.zeros(len(pos), dtype=np.int8)
    # Lips: jawOpen carries the lower lip with the jaw (~2.2 cm) and leaves the
    # upper lip nearly still, which separates the touching lips exactly.
    jaw = deltas["jawOpen"]
    mouth_c = 0.5 * (corner_l + corner_r)
    half_w = 0.5 * np.linalg.norm(corner_l - corner_r)
    rel = pos - mouth_c
    zone = ((rel[:, 0] / (half_w * 1.25)) ** 2 + (rel[:, 1] / 2.0) ** 2) < 1.0
    zone[ICT_MOUTH_SOCKET[1]:] = False
    labels[zone & (jaw[:, 1] > -1.0)] = UPPER_LIP
    labels[zone & (jaw[:, 1] <= -1.0)] = LOWER_LIP
    for centre in (eye_l, eye_r):
        near = np.linalg.norm(pos[:, :2] - centre[:2], axis=1) < 2.2
        near &= pos[:, 2] > centre[2]
        near[ICT_MOUTH_SOCKET[0]:] = False
        labels[near & (pos[:, 1] >= centre[1])] = UPPER_LID
        labels[near & (pos[:, 1] < centre[1])] = LOWER_LID

    face = np.arange(*ICT_FACE)
    eye_radius = float(np.median(np.linalg.norm(pos[slice(*ICT_EYEBALL_L)] - eye_l, axis=1)))
    return {
        "eye_l": eye_l,
        "eye_r": eye_r,
        "nose": pos[lm[LM_NOSE_TIP]],
        "corner_l": corner_l,
        "corner_r": corner_r,
        "contact": contact,
        "labels": labels,
        "lid_l": lid_margin(pos, face, eye_l, eye_radius),
        "lid_r": lid_margin(pos, face, eye_r, eye_radius),
    }


# ── registration ─────────────────────────────────────────────────────────────


def nearest_allowed(tree, pts_labels, pts_normals, queries, q_labels, q_normals, k=48, min_dot=0.2):
    """Index of the nearest tree point that is class-compatible and roughly
    co-oriented with each query, or -1."""
    dist, idx = tree.query(queries, k=k)
    out = np.full(len(queries), -1, dtype=np.int64)
    for qi in range(len(queries)):
        ql = q_labels[qi]
        for j in idx[qi]:
            if j >= len(pts_labels):
                break
            if (ql, pts_labels[j]) in FORBIDDEN:
                continue
            if pts_normals[j] @ q_normals[qi] < min_dot:
                continue
            out[qi] = j
            break
    return out


def register(anny, af, ict, xf):
    """Returns the ICT neutral positions registered into Anny space."""
    apos = anny["pos"]
    head = af["head"]
    a_norm = vertex_normals(apos, anny["faces"]["body"])

    # Anchor pairs: ICT vertex index (or None for derived points) -> Anny point.
    ipos = ict["pos"]
    anchor_src = [xf["eye_l"], xf["eye_r"], xf["nose"], xf["corner_l"], xf["corner_r"], xf["contact"]]
    anchor_dst = [af["eye_l"], af["eye_r"], af["nose"], af["corner_l"], af["corner_r"], af["contact"]]
    anchor_ict_vtx = [None, None, None, None, None, None]
    for side in ("lid_l", "lid_r"):
        for iv, av in zip(xf[side], af[side]):
            anchor_ict_vtx.append(int(iv))
            anchor_src.append(ipos[iv])
            anchor_dst.append(apos[av])
    anchor_src, anchor_dst = np.asarray(anchor_src), np.asarray(anchor_dst)

    s, r, t = umeyama(anchor_src[:5], anchor_dst[:5])
    warped = (s * (r @ ipos.T)).T + t
    anchor_now = (s * (r @ anchor_src.T)).T + t

    surf = np.arange(ICT_FACE[0], ICT_HEAD_NECK[1])
    surf_tris = ict["tris"][np.all(ict["tris"] < ICT_HEAD_NECK[1], axis=1)]
    movable = np.arange(0, ICT_MOUTH_SOCKET[1])  # face, head, mouth socket move with the warp
    a_tree = cKDTree(apos[head])
    a_labels = af["labels"][head]
    a_head_norm = a_norm[head]
    controls = surf[::3]

    for step, sigma in enumerate((0.5, 0.3, 0.18, 0.11, 0.07, 0.05)):
        n_now = vertex_normals(warped, ict["tris"])
        match = nearest_allowed(
            a_tree, a_labels, a_head_norm, warped[controls], xf["labels"][controls], n_now[controls]
        )
        ok = match >= 0
        src_pts = warped[controls][ok]
        tgt = apos[head][match[ok]]
        disp = tgt - src_pts
        if step >= 2:  # point-to-plane once coarse alignment is done, so the surface can slide
            nrm = a_head_norm[match[ok]]
            disp = (np.sum(disp * nrm, axis=1, keepdims=True)) * nrm
        far = np.linalg.norm(disp, axis=1) > 3 * sigma
        src_pts, disp = src_pts[~far], disp[~far]
        wts = np.ones(len(src_pts))
        # Anchors: current anchor positions follow the warp (derived anchors are
        # tracked through the same field), held with heavy weight.
        anchor_disp = anchor_dst - anchor_now
        src_pts = np.vstack([src_pts, anchor_now])
        disp = np.vstack([disp, anchor_disp])
        wts = np.concatenate([wts, np.full(len(anchor_now), 60.0)])

        def field(x):
            out = np.zeros_like(x)
            for c0 in range(0, len(x), 2048):
                d2 = ((x[c0:c0 + 2048, None, :] - src_pts[None, :, :]) ** 2).sum(-1)
                w = np.exp(-d2 / (2 * sigma * sigma)) * wts[None, :]
                out[c0:c0 + 2048] = (w @ disp) / np.maximum(w.sum(1, keepdims=True), 1e-9)
            return out

        warped[movable] += field(warped[movable])
        anchor_now += field(anchor_now)
        resid = np.linalg.norm(anchor_dst - anchor_now, axis=1)
        print(f"  icp sigma {sigma:.2f}: {ok.sum()} matches, anchor residual max {resid.max() * 100:.2f} mm")

    return warped, (s, r, t), surf_tris


# ── transfer ─────────────────────────────────────────────────────────────────


def surface_samples(pos, tris, labels, per_edge=4):
    """Dense barycentric samples over triangles: position, normal, bary, tri."""
    bary = []
    for i in range(per_edge + 1):
        for j in range(per_edge + 1 - i):
            bary.append((i, j, per_edge - i - j))
    bary = np.asarray(bary, dtype=float) / per_edge
    fn = np.cross(pos[tris[:, 1]] - pos[tris[:, 0]], pos[tris[:, 2]] - pos[tris[:, 0]])
    fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
    vn = vertex_normals(pos, tris)
    tri_idx = np.repeat(np.arange(len(tris)), len(bary))
    b = np.tile(bary, (len(tris), 1))
    corners = tris[tri_idx]
    p = (pos[corners] * b[:, :, None]).sum(1)
    n = (vn[corners] * b[:, :, None]).sum(1)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    lab = labels[corners[np.arange(len(b)), np.argmax(b, axis=1)]]
    return p, n, b, corners, lab


class HeadField:
    """Turns raw per-vertex transferred deltas into the final head deltas.

    Raw deltas are trusted where the registered ICT surface is within
    COVER_FULL of the Anny vertex. Everywhere else (the mouth cavity, which
    the scan models differently, and anything the scan does not reach) the
    delta is the harmonic fill of its trusted neighbours, so moving lips drag
    the cavity behind them instead of tearing away from it. The result gets
    two light Laplacian passes that never average across the lip or eyelid
    split, then fades to zero before the head/body seam."""

    def __init__(self, anny, af, cover):
        import scipy.sparse as sp
        from scipy.sparse.linalg import splu

        head = af["head"]
        n = len(head)
        local = np.full(len(anny["pos"]), -1)
        local[head] = np.arange(n)
        tris = anny["faces"]["body"]
        e = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
        e = np.unique(np.sort(e, axis=1), axis=0)
        li, lj = local[e[:, 0]], local[e[:, 1]]
        inner = (li >= 0) & (lj >= 0)
        # Head vertices touching the body are pinned at zero by the fill.
        on_seam = np.zeros(n, bool)
        on_seam[li[(li >= 0) & (lj < 0)]] = True
        on_seam[lj[(lj >= 0) & (li < 0)]] = True
        a, b = li[inner], lj[inner]
        adj = sp.coo_matrix((np.ones(len(a) * 2), (np.r_[a, b], np.r_[b, a])), shape=(n, n)).tocsr()
        deg = np.asarray(adj.sum(1)).ravel()
        lap = sp.diags(deg) - adj

        self.cover = cover
        known = (cover >= 1.0) | on_seam
        self.known, self.unknown = np.flatnonzero(known), np.flatnonzero(~known)
        self.seam_pin = on_seam
        self.lu = splu(lap[self.unknown][:, self.unknown].tocsc())
        self.l_uk = lap[self.unknown][:, self.known].tocsr()

        lab = af["labels"][head]
        ok = np.array([(int(x), int(y)) not in FORBIDDEN for x, y in zip(lab[a], lab[b])])
        sa, sb = a[ok], b[ok]
        sadj = sp.coo_matrix((np.ones(len(sa) * 2), (np.r_[sa, sb], np.r_[sb, sa])), shape=(n, n)).tocsr()
        sdeg = np.maximum(np.asarray(sadj.sum(1)).ravel(), 1)
        self.avg = sp.diags(1.0 / sdeg) @ sadj
        self.seam = smoothstep((anny["head_w"][head] - FADE_START) / (FADE_FULL - FADE_START))

    def apply(self, raw):
        known_vals = np.where(self.seam_pin[self.known, None], 0.0, raw[self.known])
        filled = np.zeros_like(raw)
        filled[self.known] = known_vals
        filled[self.unknown] = self.lu.solve(-(self.l_uk @ known_vals))
        c = self.cover[:, None]
        out = c * raw + (1 - c) * filled
        for _ in range(2):
            out = 0.5 * out + 0.5 * (self.avg @ out)
        return out * self.seam[:, None]


def build_correspondence(anny, af, warped, ict_labels, ict_tris):
    apos = anny["pos"]
    head = af["head"]
    a_norm = vertex_normals(apos, anny["faces"]["body"])
    tris = ict_tris[np.all(ict_tris < ICT_MOUTH_SOCKET[1], axis=1)]
    sp_, sn, sb, sc, sl = surface_samples(warped, tris, ict_labels)
    tree = cKDTree(sp_)
    match = nearest_allowed(tree, sl, sn, apos[head], af["labels"][head], a_norm[head], k=64, min_dot=0.0)
    ok = match >= 0
    dist = np.full(len(head), np.inf)
    dist[ok] = np.linalg.norm(sp_[match[ok]] - apos[head][ok], axis=1)
    cover = 1.0 - smoothstep((dist - COVER_FULL) / (COVER_NONE - COVER_FULL))
    cover[~ok] = 0.0
    m = np.where(ok, match, 0)
    return {
        "corners": sc[m],
        "bary": sb[m],
        "field": HeadField(anny, af, cover),
        "dist": dist,
    }


def rigid_delta(src_pts, dst_pts, apply_to, centre=None):
    """Delta field for `apply_to` under the rigid motion src->dst (all in Anny space)."""
    r, t = kabsch(src_pts, dst_pts)
    if centre is not None:  # pure rotation about the part's own centre (eyeballs)
        return (apply_to - centre) @ r.T + centre - apply_to, r
    return apply_to @ r.T + t - apply_to, r


def rotation_deg(r):
    return float(np.degrees(np.arccos(np.clip((np.trace(r) - 1) / 2, -1, 1))))


def arkit_name(ict_name):
    if ict_name.endswith("_L"):
        return ict_name[:-2] + "Left"
    if ict_name.endswith("_R"):
        return ict_name[:-2] + "Right"
    return ict_name


def to_anny(d, s, r):
    return (s * (r @ d.T)).T


def transfer_all(anny, af, ict, sim, corr):
    apos = anny["pos"]
    s, r, t = sim
    ipos = ict["pos"]
    to_space = lambda p: (s * (r @ p.T)).T + t  # noqa: E731
    head = af["head"]
    groups = anny["groups"]
    eye_l_v, eye_r_v = groups["helper-l-eye"], groups["helper-r-eye"]
    teeth_up_v, teeth_lo_v = groups["helper-upper-teeth"], groups["helper-lower-teeth"]
    tongue_v = groups["helper-tongue"]

    shapes = {}
    stats = {}
    for name in ict["names"]:
        d_ict = load_ict_delta(name, len(ipos))
        out = {}
        # Skin: barycentric delta of the matched ICT point, similarity-mapped.
        dk = (d_ict[corr["corners"]] * corr["bary"][:, :, None]).sum(1)
        dk = corr["field"].apply(to_anny(dk, s, r))
        for v, d in zip(head, dk):
            out[int(v)] = d
        # Eyeballs: ICT eyeball rotation about the Anny eye centre.
        for (a, b), verts, centre in (
            (ICT_EYEBALL_L, eye_l_v, af["eye_l"]),
            (ICT_EYEBALL_R, eye_r_v, af["eye_r"]),
        ):
            src = to_space(ipos[a:b])
            dst = to_space(ipos[a:b] + d_ict[a:b])
            if np.abs(d_ict[a:b]).max() < 1e-4:
                continue
            delta, rot = rigid_delta(src, dst, apos[verts], centre)
            if rotation_deg(rot) > 0.05:
                for v, d in zip(verts, delta):
                    out[int(v)] = d
        # Teeth and tongue: ICT teeth rigid transforms; the tongue rides the jaw.
        for (a, b), verts in ((ICT_TEETH_UPPER, teeth_up_v), (ICT_TEETH_LOWER, np.concatenate([teeth_lo_v, tongue_v]))):
            if np.abs(d_ict[a:b]).max() < 1e-4:
                continue
            delta, _ = rigid_delta(to_space(ipos[a:b]), to_space(ipos[a:b] + d_ict[a:b]), apos[verts])
            for v, d in zip(verts, delta):
                out[int(v)] = d
        shapes[name] = out
        mags = np.array([np.linalg.norm(d) for d in out.values()]) if out else np.zeros(1)
        stats[name] = {"max_mm": round(float(mags.max()) * 100, 2), "moving": int((mags > WRITE_EPSILON).sum())}

    merged = {}
    for name, deltas in shapes.items():
        if name in ("browInnerUp_R", "cheekPuff_R"):
            continue
        if name in ("browInnerUp_L", "cheekPuff_L"):
            pair = shapes[name[:-2] + "_R"]
            both = dict(deltas)
            for v, d in pair.items():
                both[v] = both.get(v, 0) + d
            merged[name[:-2]] = both
        else:
            merged[arkit_name(name)] = deltas
    merged["tongueOut"] = synth_tongue_out(apos, groups, merged["jawOpen"])
    return merged, stats


def synth_tongue_out(apos, groups, jaw_open):
    """ICT ships no tongue shape. tongueOut = a third of jawOpen (the jaw must
    part for the tongue to clear the teeth) plus the tongue extended forward:
    tip moves furthest, root stays, so the tongue stretches out between the
    lips instead of sliding as a block."""
    out = {v: d * 0.35 for v, d in jaw_open.items()}
    tongue = groups["helper-tongue"]
    z = apos[tongue, 2]
    root, tip = np.percentile(z, 5), z.max()
    lip_front = apos[groups["helper-upper-teeth"], 2].max()
    reach = (lip_front - tip) + 0.42  # tip clears the lower lip by ~2.5 cm
    for v in tongue:
        f = smoothstep((apos[v, 2] - root) / (tip - root))
        base = out.get(int(v), np.zeros(3))
        out[int(v)] = base + np.array([0.0, -0.06 * f, reach * f])
    return out


# ── output ───────────────────────────────────────────────────────────────────


def write_target(path, name, deltas):
    rows = [
        f"# {name}: ICT-FaceKit expression transferred onto the Anny base mesh",
        "# Source: avatar-sources/ict-facekit (MIT). Built by scripts/build-ict-expression-targets.py",
    ]
    for v in sorted(deltas):
        d = deltas[v]
        if np.abs(d).max() > WRITE_EPSILON:
            rows.append(f"{v} {d[0]:.5f} {d[1]:.5f} {d[2]:.5f}")
    with gzip.open(path, "wt", compresslevel=9) as fh:
        fh.write("\n".join(rows) + "\n")
    return len(rows) - 2


def render_preview(anny, af, shapes, out_dir):
    """Front and three-quarter software renders of the head under a few shapes."""
    from PIL import Image

    apos = anny["pos"]
    tris = anny["faces"]["body"]
    head_set = np.zeros(len(apos), bool)
    head_set[af["head"]] = True
    tris = tris[head_set[tris].all(1)]
    extra = [anny["faces"][g] for g in ("helper-l-eye", "helper-r-eye", "helper-upper-teeth", "helper-lower-teeth", "helper-tongue")]
    colors = [(0.85, 0.66, 0.55)] * 1 + [(0.95, 0.95, 0.95)] * 2 + [(0.98, 0.96, 0.9)] * 2 + [(0.8, 0.35, 0.35)]
    parts = [tris] + extra
    centre = apos[af["head"]].mean(0)
    names = [
        "neutral",
        "jawOpen",
        "eyeBlinkLeft",
        "mouthSmileLeft+mouthSmileRight",
        "mouthFunnel",
        "eyeLookUpLeft+eyeLookUpRight",
        "browInnerUp",
        "tongueOut",
        "mouthPucker",
        "jawOpen*0.9+mouthClose*0.9+mouthPressLeft*0.4+mouthPressRight*0.4",
    ]
    size = 360
    tiles = []
    for name in names:
        p = apos.copy()
        if name != "neutral":
            for term in name.split("+"):
                shape, _, w = term.partition("*")
                for v, d in shapes[shape].items():
                    p[v] = p[v] + d * float(w or 1)
        row = []
        for yaw in (0.0, 35.0):
            c, s_ = np.cos(np.radians(yaw)), np.sin(np.radians(yaw))
            rot = np.array([[c, 0, s_], [0, 1, 0], [-s_, 0, c]])
            q = (p - centre) @ rot.T
            img = np.full((size, size, 3), 0.12)
            zbuf = np.full((size, size), -np.inf)
            scale = size / 2.2
            for part, col in zip(parts, colors):
                tri = q[part]
                fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
                fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
                shade = np.clip(fn @ np.array([0.3, 0.4, 0.86]), 0, 1) * 0.8 + 0.2
                xy = np.stack([tri[:, :, 0] * scale + size / 2, -(tri[:, :, 1]) * scale + size / 2], -1)
                for k in range(len(tri)):
                    if fn[k, 2] <= 0:
                        continue
                    (x0, y0), (x1, y1), (x2, y2) = xy[k]
                    xmin, xmax = int(max(min(x0, x1, x2), 0)), int(min(max(x0, x1, x2), size - 1))
                    ymin, ymax = int(max(min(y0, y1, y2), 0)), int(min(max(y0, y1, y2), size - 1))
                    if xmax < xmin or ymax < ymin:
                        continue
                    gx, gy = np.meshgrid(np.arange(xmin, xmax + 1) + 0.5, np.arange(ymin, ymax + 1) + 0.5)
                    den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
                    if abs(den) < 1e-9:
                        continue
                    w0 = ((y1 - y2) * (gx - x2) + (x2 - x1) * (gy - y2)) / den
                    w1 = ((y2 - y0) * (gx - x2) + (x0 - x2) * (gy - y2)) / den
                    w2 = 1 - w0 - w1
                    inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
                    z = w0 * tri[k, 0, 2] + w1 * tri[k, 1, 2] + w2 * tri[k, 2, 2]
                    sub = zbuf[ymin:ymax + 1, xmin:xmax + 1]
                    upd = inside & (z > sub)
                    sub[upd] = z[upd]
                    img[ymin:ymax + 1, xmin:xmax + 1][upd] = np.array(col) * shade[k]
            row.append(img)
        tiles.append(np.concatenate(row, 1))
    grid = np.concatenate([np.concatenate(tiles[i:i + 2], 1) for i in range(0, len(tiles), 2)], 0)
    out_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray((grid * 255).astype(np.uint8)).save(out_dir / "expressions.png")
    print(f"  preview: {out_dir / 'expressions.png'}")
    for k, name in enumerate(names):
        print(f"    row {k // 2 + 1} {'left' if k % 2 == 0 else 'right'}: {name}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Transfer ICT-FaceKit ARKit shapes onto the Anny head.")
    ap.add_argument("--preview", type=Path, help="write a software-rendered expression sheet here")
    args = ap.parse_args()

    anny = load_anny()
    ict = load_ict()
    print(f"anny: {len(anny['pos'])} vertices; ict: {len(ict['pos'])} vertices, {len(ict['names'])} shapes")
    deltas = {n: load_ict_delta(n, len(ict["pos"])) for n in ("jawOpen",)}
    af = anny_features(anny)
    xf = ict_features(ict, deltas)
    warped, sim, _ = register(anny, af, ict, xf)
    corr = build_correspondence(anny, af, warped, xf["labels"], ict["tris"])
    front = anny["pos"][af["head"], 2] > af["eye_l"][2] - 0.1
    resid = corr["dist"][front & np.isfinite(corr["dist"])]
    print(f"  face residual: median {np.median(resid) * 100:.2f} mm, p95 {np.percentile(resid, 95) * 100:.2f} mm")

    shapes, stats = transfer_all(anny, af, ict, sim, corr)
    OUT.mkdir(parents=True, exist_ok=True)
    written = {}
    for name in sorted(shapes):
        written[name] = write_target(OUT / f"{name}.target.gz", name, shapes[name])
    if len(written) != 52:
        raise RuntimeError(f"expected the 52 ARKit shapes, built {len(written)}: {sorted(written)}")
    report = {
        "similarity_scale": float(sim[0]),
        "face_residual_mm": {
            "median": round(float(np.median(resid)) * 100, 3),
            "p95": round(float(np.percentile(resid, 95)) * 100, 3),
        },
        "head_vertices": int(len(af["head"])),
        "ict_shapes": stats,
        "written_vertices": written,
    }
    (OUT / "report.json").write_text(json.dumps(report, indent=1) + "\n")
    print(f"wrote {len(written)} targets to {OUT}")
    if args.preview:
        render_preview(anny, af, shapes, args.preview)
    return 0


if __name__ == "__main__":
    sys.exit(main())
