"""Seed starting skin weights on UniRig's skeleton before SkinTokens.

UniRig's merge.sh grafts a skeleton-only FBX onto the mesh, so no vertex has
a vertex group, and Blender's glTF exporter answers that by adding a joint
named "neutral_bone" and weighting every vertex 1.0 to it (fox QA file,
2026-11-04: all 1728 vertices on neutral_bone, the 23 UniRig bones at zero).
SkinTokens' --use_skeleton loader then runs Asset.trim_skeleton, which drops
every joint whose subtree carries no skin weight. Only neutral_bone's branch
survived, so every production rig from 2026-11-04 to 2026-11-14 came back with
one joint (bone_0) and could not move.

SkinTokens predicts the final weights itself; the merged file's weights only
decide which joints survive its trim. So this module writes a starting skin
that keeps every predicted joint: each vertex goes to its nearest joint (bind
positions from the inverse bind matrices), any joint no vertex chose is added
to its nearest vertex that has a free influence slot, and neutral_bone ends at
zero, so the trim removes it. Joint nodes, the skeleton hierarchy and all
existing binary data are untouched; new JOINTS_0/WEIGHTS_0 accessors are
appended to the binary chunk.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from skeleton_roots import SkeletonNormalizeError, read_glb, world_matrices, write_glb

# The name Blender's glTF exporter gives the joint it adds for vertices that
# belong to no vertex group (io_scene_gltf2, gltf2_blender_gather_skins).
PLACEHOLDER_JOINTS = frozenset({"neutral_bone"})

INFLUENCES = 4
_CHUNK = 8192

_COMPONENT = {
    5120: np.int8, 5121: np.uint8, 5122: np.int16,
    5123: np.uint16, 5125: np.uint32, 5126: np.float32,
}
_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_accessor(document: dict, binary: bytes | None, index: int) -> np.ndarray:
    """Return accessor `index` as a float64 array of shape (count, width)."""
    try:
        acc = document["accessors"][index]
        dtype = _COMPONENT[acc["componentType"]]
        width = _WIDTH[acc["type"]]
    except (KeyError, IndexError, TypeError) as exc:
        raise SkeletonNormalizeError(f"accessor {index} is missing or has an unsupported type") from exc
    count = int(acc.get("count", 0))
    if "bufferView" not in acc or binary is None:
        raise SkeletonNormalizeError(f"accessor {index} has no buffer data")
    view = document["bufferViews"][acc["bufferView"]]
    item = np.dtype(dtype).itemsize * width
    stride = int(view.get("byteStride") or item)
    offset = int(view.get("byteOffset", 0)) + int(acc.get("byteOffset", 0))
    if count == 0:
        return np.zeros((0, width))
    need = offset + stride * (count - 1) + item
    if need > len(binary):
        raise SkeletonNormalizeError(f"accessor {index} reads past the end of the binary chunk")
    raw = np.frombuffer(binary, dtype=np.uint8, count=need - offset, offset=offset)
    rows = np.lib.stride_tricks.as_strided(raw, shape=(count, item), strides=(stride, 1))
    out = np.ascontiguousarray(rows).view(dtype).reshape(count, width).astype(np.float64)
    if acc.get("normalized") and np.issubdtype(dtype, np.integer):
        out /= float(np.iinfo(dtype).max)
    return out


def _joint_bind_positions(document: dict, binary: bytes | None, skin: dict) -> np.ndarray:
    """Each joint's position in the skinned mesh's bind space."""
    joints = skin["joints"]
    if "inverseBindMatrices" in skin:
        ibm = read_accessor(document, binary, skin["inverseBindMatrices"])
        if len(ibm) != len(joints):
            raise SkeletonNormalizeError("inverseBindMatrices count does not match the skin's joints")
        out = []
        for row in ibm:
            m = row.reshape(4, 4).T  # column-major on disk
            try:
                out.append(np.linalg.inv(m)[:3, 3])
            except np.linalg.LinAlgError as exc:
                raise SkeletonNormalizeError("a joint has a singular inverse bind matrix") from exc
        return np.array(out)
    worlds = world_matrices(document)
    return np.array([worlds[j][:3, 3] for j in joints])


def _nearest(points: np.ndarray, targets: np.ndarray) -> np.ndarray:
    out = np.empty(len(points), dtype=np.int64)
    for start in range(0, len(points), _CHUNK):
        block = points[start:start + _CHUNK]
        d = ((block[:, None, :] - targets[None, :, :]) ** 2).sum(-1)
        out[start:start + _CHUNK] = d.argmin(1)
    return out


def _append(document: dict, binary: bytearray, array: np.ndarray, component: int, kind: str) -> int:
    binary.extend(b"\x00" * (-len(binary) % 4))
    data = array.tobytes()
    document.setdefault("bufferViews", []).append(
        {"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)}
    )
    binary.extend(data)
    document.setdefault("accessors", []).append({
        "bufferView": len(document["bufferViews"]) - 1,
        "componentType": component,
        "count": int(len(array)),
        "type": kind,
    })
    return len(document["accessors"]) - 1


def seed_skin_weights(path: Path) -> int:
    """Rewrite `path` in place so every non-placeholder joint of each skin
    carries skin weight. Returns how many joints the seeded skin covers."""
    document, binary = read_glb(path)
    nodes = document.get("nodes", [])
    skins = document.get("skins", [])
    if not skins:
        raise SkeletonNormalizeError(f"{Path(path).name} has no skin to seed")
    if binary is None:
        raise SkeletonNormalizeError(f"{Path(path).name} has no binary chunk")
    out = bytearray(binary)
    seeded = 0

    for skin_index, skin in enumerate(skins):
        joints = skin.get("joints", [])
        real = [k for k, n in enumerate(joints)
                if 0 <= n < len(nodes) and nodes[n].get("name") not in PLACEHOLDER_JOINTS]
        if not real:
            raise SkeletonNormalizeError("the skeleton has no joints besides Blender's neutral_bone")
        bind = _joint_bind_positions(document, binary, skin)[real]
        real_arr = np.array(real, dtype=np.int64)

        prims = []
        for node in nodes:
            if node.get("skin") != skin_index or "mesh" not in node:
                continue
            for prim in document["meshes"][node["mesh"]].get("primitives", []):
                attrs = prim.get("attributes", {})
                if "POSITION" not in attrs:
                    continue
                if any(p is prim for p, _ in prims):
                    continue
                prims.append((prim, read_accessor(document, binary, attrs["POSITION"])))
        if not prims:
            raise SkeletonNormalizeError("no mesh primitive is bound to the skin")

        positions = np.concatenate([pos for _, pos in prims])
        slot_joint = np.zeros((len(positions), INFLUENCES), dtype=np.int64)
        slot_count = np.ones(len(positions), dtype=np.int64)
        slot_joint[:, 0] = _nearest(positions, bind)

        chosen = np.bincount(slot_joint[:, 0], minlength=len(real))
        for j in np.flatnonzero(chosen == 0):
            order = np.argsort(((positions - bind[j]) ** 2).sum(1), kind="stable")
            free = order[slot_count[order] < INFLUENCES]
            if len(free) == 0:
                raise SkeletonNormalizeError("more joints than the mesh has free influence slots")
            v = free[0]
            slot_joint[v, slot_count[v]] = j
            slot_count[v] += 1

        weights = np.zeros((len(positions), INFLUENCES), dtype=np.float32)
        for s in range(INFLUENCES):
            weights[:, s] = np.where(s < slot_count, 1.0 / slot_count, 0.0)
        joint_index = np.where(weights > 0, real_arr[slot_joint], 0).astype(np.uint16)

        start = 0
        for prim, pos in prims:
            end = start + len(pos)
            attrs = prim["attributes"]
            for extra in [k for k in attrs if k.startswith(("JOINTS_", "WEIGHTS_"))]:
                del attrs[extra]
            attrs["JOINTS_0"] = _append(document, out, joint_index[start:end], 5123, "VEC4")
            attrs["WEIGHTS_0"] = _append(document, out, weights[start:end], 5126, "VEC4")
            start = end
        seeded += len(real)

    out.extend(b"\x00" * (-len(out) % 4))
    document.setdefault("buffers", [{}])[0]["byteLength"] = len(out)
    write_glb(path, document, bytes(out))
    return seeded


def skin_joint_count(path: Path) -> int:
    """Joints in the largest skin of the GLB at `path` (0 if it has none)."""
    document, _ = read_glb(path)
    return max((len(s.get("joints", [])) for s in document.get("skins", [])), default=0)
