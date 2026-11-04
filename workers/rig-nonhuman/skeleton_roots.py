"""Give the merged GLB's skeleton exactly one root joint before SkinTokens.

UniRig predicts a skeleton autoregressively and can open a new branch with no
parent, so the merged GLB it writes may carry two or more root joints.
SkinTokens' Asset.set_order (src/rig_package/info/asset.py) requires one root
and raises "multiple roots found"; the fox QA run on 2026-11-04 died exactly
there. Animation retargeting downstream also assumes one hip/root bone.

The fix is lossless: every extra root joint (with its subtree) is re-parented
under the nearest joint, by world position, of the largest tree, and its local
transform is rewritten as inverse(new_parent_world) @ old_world. No joint
moves in world space, so the skin's inverseBindMatrices stay valid and the
binary chunk is copied byte for byte; only the JSON chunk changes. Re-parented
nodes keep TRS form (never `matrix`) because glTF only animates TRS nodes.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

_MAGIC = b"glTF"
_JSON = 0x4E4F534A
_BIN = 0x004E4942


class SkeletonNormalizeError(RuntimeError):
    """The merged file is not a GLB this module can read or rewrite."""


def read_glb(path: Path) -> tuple[dict, bytes | None]:
    data = Path(path).read_bytes()
    if len(data) < 20 or data[:4] != _MAGIC:
        raise SkeletonNormalizeError(f"{Path(path).name} is not a binary glTF (GLB) file")
    version, length = struct.unpack_from("<II", data, 4)
    if version != 2 or length > len(data):
        raise SkeletonNormalizeError(f"{Path(path).name} is not a complete glTF 2.0 GLB")
    offset, document, binary = 12, None, None
    while offset + 8 <= length:
        size, kind = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8 : offset + 8 + size]
        if kind == _JSON and document is None:
            try:
                document = json.loads(chunk.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise SkeletonNormalizeError(f"{Path(path).name} has an unreadable GLB JSON chunk") from exc
        elif kind == _BIN and binary is None:
            binary = chunk
        offset += 8 + size
    if document is None:
        raise SkeletonNormalizeError(f"{Path(path).name} has no GLB JSON chunk")
    return document, binary


def write_glb(path: Path, document: dict, binary: bytes | None) -> None:
    body = json.dumps(document, separators=(",", ":")).encode("utf-8")
    body += b" " * (-len(body) % 4)
    chunks = struct.pack("<II", len(body), _JSON) + body
    if binary is not None:
        padded = binary + b"\x00" * (-len(binary) % 4)
        chunks += struct.pack("<II", len(padded), _BIN) + padded
    Path(path).write_bytes(_MAGIC + struct.pack("<II", 2, 12 + len(chunks)) + chunks)


def _quat_to_matrix(q) -> np.ndarray:
    x, y, z, w = (float(v) for v in q)
    n = x * x + y * y + z * z + w * w
    if n == 0.0:
        return np.eye(3)
    s = 2.0 / n
    return np.array([
        [1 - s * (y * y + z * z), s * (x * y - z * w), s * (x * z + y * w)],
        [s * (x * y + z * w), 1 - s * (x * x + z * z), s * (y * z - x * w)],
        [s * (x * z - y * w), s * (y * z + x * w), 1 - s * (x * x + y * y)],
    ])


def _matrix_to_quat(r: np.ndarray) -> list[float]:
    t = np.trace(r)
    if t > 0:
        s = np.sqrt(t + 1.0) * 2
        w, x, y, z = 0.25 * s, (r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s
    elif r[0, 0] > r[1, 1] and r[0, 0] > r[2, 2]:
        s = np.sqrt(1.0 + r[0, 0] - r[1, 1] - r[2, 2]) * 2
        w, x, y, z = (r[2, 1] - r[1, 2]) / s, 0.25 * s, (r[0, 1] + r[1, 0]) / s, (r[0, 2] + r[2, 0]) / s
    elif r[1, 1] > r[2, 2]:
        s = np.sqrt(1.0 + r[1, 1] - r[0, 0] - r[2, 2]) * 2
        w, x, y, z = (r[0, 2] - r[2, 0]) / s, (r[0, 1] + r[1, 0]) / s, 0.25 * s, (r[1, 2] + r[2, 1]) / s
    else:
        s = np.sqrt(1.0 + r[2, 2] - r[0, 0] - r[1, 1]) * 2
        w, x, y, z = (r[1, 0] - r[0, 1]) / s, (r[0, 2] + r[2, 0]) / s, (r[1, 2] + r[2, 1]) / s, 0.25 * s
    q = np.array([x, y, z, w], dtype=float)
    return (q / np.linalg.norm(q)).tolist()


def local_matrix(node: dict) -> np.ndarray:
    if "matrix" in node:
        return np.array(node["matrix"], dtype=float).reshape(4, 4).T
    m = np.eye(4)
    m[:3, :3] = _quat_to_matrix(node.get("rotation", [0, 0, 0, 1])) * np.array(node.get("scale", [1, 1, 1]), dtype=float)
    m[:3, 3] = node.get("translation", [0, 0, 0])
    return m


def _set_trs(node: dict, m: np.ndarray) -> None:
    a = m[:3, :3]
    scale = np.linalg.norm(a, axis=0)
    if np.linalg.det(a) < 0:
        scale[0] = -scale[0]
    scale[scale == 0] = 1.0
    node.pop("matrix", None)
    node["translation"] = [float(v) for v in m[:3, 3]]
    node["rotation"] = _matrix_to_quat(a / scale)
    node["scale"] = [float(v) for v in scale]


def _parents(document: dict) -> dict[int, int]:
    parent: dict[int, int] = {}
    for i, node in enumerate(document.get("nodes", [])):
        for c in node.get("children", []):
            parent[c] = i
    return parent


def world_matrices(document: dict) -> list[np.ndarray]:
    nodes = document.get("nodes", [])
    parent = _parents(document)
    cache: dict[int, np.ndarray] = {}

    def world(i: int) -> np.ndarray:
        if i not in cache:
            chain, j = [], i
            while j is not None and j not in cache:
                chain.append(j)
                j = parent.get(j)
            base = cache[j] if j is not None else np.eye(4)
            for k in reversed(chain):
                base = base @ local_matrix(nodes[k])
                cache[k] = base
        return cache[i]

    return [world(i) for i in range(len(nodes))]


def _subtree(document: dict, root: int) -> list[int]:
    nodes, out, stack = document["nodes"], [], [root]
    while stack:
        i = stack.pop()
        out.append(i)
        stack.extend(nodes[i].get("children", []))
    return out


def single_root_skeleton(path: Path) -> int:
    """Rewrite `path` in place so each skin has one root joint.

    Returns how many root joints were re-parented (0 leaves the file
    byte-identical)."""
    document, binary = read_glb(path)
    nodes = document.get("nodes", [])
    moved = 0
    for skin in document.get("skins", []):
        joints = [j for j in skin.get("joints", []) if 0 <= j < len(nodes)]
        joint_set = set(joints)
        parent = _parents(document)
        roots = [j for j in joints if parent.get(j) not in joint_set]
        if len(roots) <= 1:
            continue

        def joint_count(r: int) -> int:
            return sum(1 for i in _subtree(document, r) if i in joint_set)

        main = max(roots, key=lambda r: (joint_count(r), -joints.index(r)))
        worlds = world_matrices(document)
        for stray in (r for r in roots if r != main):
            parent = _parents(document)
            candidates = [i for i in _subtree(document, main) if i in joint_set]
            here = worlds[stray][:3, 3]
            target = min(candidates, key=lambda i: float(np.linalg.norm(worlds[i][:3, 3] - here)))

            old_parent = parent.get(stray)
            if old_parent is not None:
                kids = [c for c in nodes[old_parent].get("children", []) if c != stray]
                if kids:
                    nodes[old_parent]["children"] = kids
                else:
                    nodes[old_parent].pop("children", None)
            for scene in document.get("scenes", []):
                if stray in scene.get("nodes", []):
                    scene["nodes"] = [n for n in scene["nodes"] if n != stray]
            nodes[target].setdefault("children", []).append(stray)
            _set_trs(nodes[stray], np.linalg.inv(worlds[target]) @ worlds[stray])
            moved += 1
        if "skeleton" in skin:
            skin["skeleton"] = main
    if moved:
        write_glb(path, document, binary)
    return moved
