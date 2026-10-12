"""Model-agnostic motion decode math: joint positions to local rotations.

Both text-to-motion backends this worker supports (MDM, MoMask) are trained on
the HumanML3D dataset and therefore emit the same thing: a 22-joint skeleton's
global joint POSITIONS per frame, recovered via each project's own upstream
`recover_from_ric`. Neither project emits local joint ROTATIONS directly, which
is what a three.js AnimationClip needs, so both samplers decode through this
shared module. Everything here is pure NumPy: no torch, no GPU, no checkpoint,
so it is testable without either upstream repo checked out (see
test_mdm_decode.py, which exercises this module's functions through its
re-export from mdm_sampler.py, the existing import path its tests already use).
"""

from __future__ import annotations

import numpy as np


def _parents_from_kinematic_chain(kinematic_chain, n_joints: int) -> np.ndarray:
    """Flatten per-limb chains (each starting at the root, joint 0) into a
    single parent-index array, e.g. [-1, 2, 5, 8, ...] for a 22-joint
    skeleton. Every joint in the topology appears in exactly one chain."""
    parents = np.full(n_joints, -1, dtype=np.int64)
    for chain in kinematic_chain:
        for i in range(1, len(chain)):
            parents[chain[i]] = chain[i - 1]
    return parents


def _quat_conjugate(q: np.ndarray) -> np.ndarray:
    return np.concatenate([-q[..., :3], q[..., 3:4]], axis=-1)


def _quat_multiply(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    ax, ay, az, aw = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    bx, by, bz, bw = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack(
        [
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        ],
        axis=-1,
    )


def _quat_rotate(q: np.ndarray, v: np.ndarray) -> np.ndarray:
    qv = np.concatenate([v, np.zeros_like(v[..., :1])], axis=-1)
    return _quat_multiply(_quat_multiply(q, qv), _quat_conjugate(q))[..., :3]


def _rotation_matrix_to_quat(r: np.ndarray) -> np.ndarray:
    """(...,3,3) proper rotation matrices → (...,4) xyzw quaternions."""
    m00, m01, m02 = r[..., 0, 0], r[..., 0, 1], r[..., 0, 2]
    m10, m11, m12 = r[..., 1, 0], r[..., 1, 1], r[..., 1, 2]
    m20, m21, m22 = r[..., 2, 0], r[..., 2, 1], r[..., 2, 2]
    trace = m00 + m11 + m22
    w = 0.5 * np.sqrt(np.maximum(1.0 + trace, 1e-12))
    safe_w = np.where(w < 1e-6, 1.0, w)
    x = (m21 - m12) / (4.0 * safe_w)
    y = (m02 - m20) / (4.0 * safe_w)
    z = (m10 - m01) / (4.0 * safe_w)
    quat = np.stack([x, y, z, w], axis=-1)
    norm = np.linalg.norm(quat, axis=-1, keepdims=True)
    return quat / np.where(norm < 1e-8, 1.0, norm)


def _kabsch_quat(sources: np.ndarray, targets: np.ndarray) -> np.ndarray:
    """Best-fit rotation quaternion mapping unit-vector set `sources` onto
    `targets`, batched over frames. `sources`/`targets`: (T, K, 3). Minimizes
    sum_k |R @ sources[k] - targets[k]|^2 (Kabsch/Procrustes, reflection-
    corrected so R is always a proper rotation). K == 1 degenerates to a
    shortest-arc rotation with an unconstrained twist about that one axis,
    the same ambiguity single-child joints have regardless of method, since
    HumanML3D position data carries no twist signal for any joint."""
    h = np.einsum("tka,tkb->tab", sources, targets)  # (T,3,3)
    u, _, vt = np.linalg.svd(h)
    d = np.sign(np.linalg.det(np.einsum("tab,tbc->tac", vt.transpose(0, 2, 1), u.transpose(0, 2, 1))))
    diag = np.tile(np.eye(3), (h.shape[0], 1, 1))
    diag[:, 2, 2] = d
    r = np.einsum("tab,tbc,tcd->tad", vt.transpose(0, 2, 1), diag, u.transpose(0, 2, 1))
    return _rotation_matrix_to_quat(r)


def _positions_to_local_quats(
    positions: np.ndarray, parents: np.ndarray, rest_dirs: np.ndarray
) -> np.ndarray:
    """(T,J,3) global positions → (T,J,4) local xyzw quaternions per the
    `parents`/`rest_dirs` topology.

    A joint's local rotation `R_j` is NOT observable from its own position:
    under standard skeletal FK (global_j = global_parent(j) * R_j, and the
    *fixed* rest offset rotates with the PARENT's global orientation only:
    pos[j] - pos[parent(j)] = rotate(global_parent(j), rest_dirs[j])) that
    offset doesn't involve R_j at all. R_j only shows up in where j's OWN
    children end up. So this recovers R_j, per joint, from the directions to
    j's children: best-fit (Kabsch) rotation mapping each child's rest
    direction (in j's parent-relative frame) onto its measured direction,
    across however many children j has (root and the chest joint branch into
    3; most joints have exactly 1, where Kabsch degenerates to a shortest-arc
    solve). Leaf joints (hands, feet, head) have no children and no positional
    evidence for their own twist, so they get an identity local rotation.
    """
    n_frames, n_joints, _ = positions.shape
    local_quat = np.tile(np.array([0.0, 0.0, 0.0, 1.0]), (n_frames, n_joints, 1))
    global_quat = np.tile(np.array([0.0, 0.0, 0.0, 1.0]), (n_frames, n_joints, 1))

    children_of = [[] for _ in range(n_joints)]
    for j in range(1, n_joints):
        children_of[parents[j]].append(j)

    # Single top-down pass: `parents[j] < j` for this topology (verified: the
    # kinematic chains are built root-outward), so global_quat[parents[j]] is
    # always already resolved by the time joint j is processed.
    for j in range(n_joints):
        kids = children_of[j]
        if kids:
            rest = rest_dirs[np.array(kids)]  # (K,3)
            rest = rest / np.linalg.norm(rest, axis=-1, keepdims=True)
            rest = np.broadcast_to(rest, (n_frames,) + rest.shape).copy()  # (T,K,3)

            measured = positions[:, kids, :] - positions[:, j : j + 1, :]  # (T,K,3)
            measured = measured / np.linalg.norm(measured, axis=-1, keepdims=True)

            if j == 0:
                targets_in_parent_frame = measured  # root: parent frame == world
            else:
                p = parents[j]
                k = measured.shape[1]
                parent_conj = np.broadcast_to(_quat_conjugate(global_quat[:, p])[:, None, :], (n_frames, k, 4))
                targets_in_parent_frame = _quat_rotate(parent_conj, measured)

            local_quat[:, j] = _kabsch_quat(rest, targets_in_parent_frame)
        # else: leaf joint, no positional evidence for its own twist, so identity.

        global_quat[:, j] = (
            local_quat[:, j] if j == 0 else _quat_multiply(global_quat[:, parents[j]], local_quat[:, j])
        )

    return local_quat


def _quat_to_axis_angle(q: np.ndarray) -> np.ndarray:
    """(...,4) xyzw quaternion → (...,3) axis-angle."""
    q = q / np.where(np.linalg.norm(q, axis=-1, keepdims=True) < 1e-8, 1.0, np.linalg.norm(q, axis=-1, keepdims=True))
    w = np.clip(q[..., 3], -1.0, 1.0)
    angle = 2.0 * np.arccos(w)
    sin_half = np.sqrt(np.maximum(1.0 - w * w, 0.0))
    safe_sin = np.where(sin_half < 1e-8, 1.0, sin_half)
    axis = q[..., :3] / safe_sin[..., None]
    aa = axis * angle[..., None]
    return np.where(sin_half[..., None] < 1e-8, 0.0, aa)


def _resample(poses: np.ndarray, trans: np.ndarray, n_frames: int):
    """Linear-resample motion to exactly `n_frames` frames."""
    src = poses.shape[0]
    if src == n_frames:
        return poses, trans
    src_t = np.linspace(0.0, 1.0, src)
    dst_t = np.linspace(0.0, 1.0, n_frames)
    flat = poses.reshape(src, -1)
    out = np.empty((n_frames, flat.shape[1]), dtype=poses.dtype)
    for c in range(flat.shape[1]):
        out[:, c] = np.interp(dst_t, src_t, flat[:, c])
    out_poses = out.reshape((n_frames,) + poses.shape[1:])
    out_trans = np.empty((n_frames, 3), dtype=trans.dtype)
    for c in range(3):
        out_trans[:, c] = np.interp(dst_t, src_t, trans[:, c])
    return out_poses, out_trans
