"""GLB builders and a SkinTokens stand-in shared by this worker's tests.

`unweighted_merge_glb` writes the exact shape UniRig's merge.sh produces
when it grafts a skeleton-only FBX onto a mesh (verified against the fox QA
file gs://three-ws-avatar-reconstructions/qa/rig-nonhuman/fox-merged.glb on
2026-11-14): an Armature node holding the predicted bone_* chain, a second
root joint named "neutral_bone" that Blender's glTF exporter adds for
vertices with no vertex group, and every vertex weighted 1.0 to
neutral_bone. Geometry, inverse bind matrices and the skin attributes are
real accessors, so the code under test reads them exactly as it reads a
production file.

`SKINTOKENS_TRIM_SCRIPT` is a drop-in demo.py that applies SkinTokens' own
input rules (pinned commit 273b691d): Asset.set_order's single-root check,
then Asset.trim_skeleton, which deletes every joint whose subtree carries no
skin weight. It writes the surviving joints as the output skin, which is the
skeleton SkinTokens then predicts weights for.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

from skeleton_roots import write_glb

# (name, parent index into this list or -1, translation relative to parent)
QUADRUPED = [
    ("bone_1", -1, (0.0, 0.6, 0.0)),    # hips
    ("bone_2", 0, (0.0, 0.0, 0.4)),     # spine
    ("bone_3", 1, (0.0, 0.1, 0.3)),     # head
    ("bone_4", 0, (0.15, -0.3, 0.0)),   # hind leg L
    ("bone_5", 0, (-0.15, -0.3, 0.0)),  # hind leg R
    ("bone_6", 1, (0.15, -0.3, 0.0)),   # fore leg L
    ("bone_7", 1, (-0.15, -0.3, 0.0)),  # fore leg R
    ("bone_8", 0, (0.0, 0.05, -0.35)),  # tail
]


def _pad4(b: bytes) -> bytes:
    return b + b"\x00" * (-len(b) % 4)


def unweighted_merge_glb(
    path: Path,
    bones=QUADRUPED,
    vertices_per_bone: int = 12,
    neutral_bone: bool = True,
    neutral_as_second_root: bool = True,
) -> dict:
    """Write a UniRig-merge-shaped GLB to `path`; return its JSON document.

    Node layout: 0 = Armature, 1..B = bones, then neutral_bone (if any),
    then the skinned mesh node."""
    world = []
    for name, parent, t in bones:
        base = np.zeros(3) if parent < 0 else world[parent]
        world.append(base + np.array(t, dtype=float))
    world = np.array(world).reshape(-1, 3)

    rng = np.random.default_rng(7)
    centers = world if len(world) else np.zeros((1, 3))
    positions = np.concatenate([
        w + rng.normal(scale=0.03, size=(vertices_per_bone, 3)) for w in centers
    ]).astype(np.float32)
    n = len(positions)

    b = len(bones)
    neutral_idx = b if neutral_bone else None
    joint_count = b + (1 if neutral_bone else 0)
    joints = np.zeros((n, 4), dtype=np.uint16)
    weights = np.zeros((n, 4), dtype=np.float32)
    if neutral_bone:
        joints[:, 0] = neutral_idx
    weights[:, 0] = 1.0

    ibm = []
    for j in range(joint_count):
        m = np.eye(4, dtype=np.float32)
        if j < b:
            m[:3, 3] = -world[j]
        ibm.append(m.T.reshape(-1))  # glTF stores column-major
    ibm = np.array(ibm, dtype=np.float32)

    chunks = [positions.tobytes(), joints.tobytes(), weights.tobytes(), ibm.tobytes()]
    views, offset, binary = [], 0, b""
    for c in chunks:
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(c)})
        binary += _pad4(c)
        offset = len(binary)

    nodes = [{"name": "Armature", "children": []}]
    for name, parent, t in bones:
        nodes.append({"name": name, "translation": [float(v) for v in t]})
    for i, (name, parent, t) in enumerate(bones):
        if parent < 0:
            nodes[0]["children"].append(i + 1)
        else:
            nodes[parent + 1].setdefault("children", []).append(i + 1)
    joint_nodes = list(range(1, b + 1))
    if neutral_bone:
        nodes.append({"name": "neutral_bone"})
        nb = len(nodes) - 1
        joint_nodes.append(nb)
        if neutral_as_second_root:
            nodes[0]["children"].append(nb)
        else:
            nodes[1].setdefault("children", []).append(nb)
    nodes.append({"name": "creature", "mesh": 0, "skin": 0})
    mesh_node = len(nodes) - 1
    nodes[0]["children"].append(mesh_node)

    doc = {
        "asset": {"version": "2.0", "generator": "Khronos glTF Blender I/O"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": nodes,
        "meshes": [{"name": "creature", "primitives": [{
            "attributes": {"POSITION": 0, "JOINTS_0": 1, "WEIGHTS_0": 2},
        }]}],
        "skins": [{"joints": joint_nodes, "inverseBindMatrices": 3}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": n, "type": "VEC3",
             "min": positions.min(0).tolist(), "max": positions.max(0).tolist()},
            {"bufferView": 1, "componentType": 5123, "count": n, "type": "VEC4"},
            {"bufferView": 2, "componentType": 5126, "count": n, "type": "VEC4"},
            {"bufferView": 3, "componentType": 5126, "count": joint_count, "type": "MAT4"},
        ],
        "bufferViews": views,
        "buffers": [{"byteLength": len(binary)}],
    }
    write_glb(path, doc, binary)
    return doc


SKINTOKENS_TRIM_SCRIPT = r'''
import json, struct, sys
import numpy as np
args = sys.argv[1:]
src, dst = args[args.index('--input') + 1], args[args.index('--output') + 1]
data = open(src, 'rb').read()
jlen = struct.unpack_from('<I', data, 12)[0]
doc = json.loads(data[20:20 + jlen])
blen = struct.unpack_from('<I', data, 20 + jlen)[0]
binary = data[28 + jlen:28 + jlen + blen]
nodes = doc['nodes']
skin = doc['skins'][0]
joints = skin['joints']
J = len(joints)
parent_node = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
pos = {node: k for k, node in enumerate(joints)}
parents = [pos.get(parent_node.get(node), -1) for node in joints]
if sum(1 for p in parents if p == -1) != 1:
    print('ValueError: multiple roots found', file=sys.stderr)
    sys.exit(1)

def read(idx):
    a = doc['accessors'][idx]
    v = doc['bufferViews'][a['bufferView']]
    dt = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}[a['componentType']]
    comps = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    item = np.dtype(dt).itemsize * comps
    stride = v.get('byteStride', item)
    raw = np.frombuffer(binary, np.uint8, count=stride * (a['count'] - 1) + item, offset=off)
    rows = np.lib.stride_tricks.as_strided(raw, (a['count'], item), (stride, 1))
    out = np.ascontiguousarray(rows).view(dt).reshape(a['count'], comps).astype(np.float64)
    if a.get('normalized'):
        out /= np.iinfo(dt).max
    return out

skin_sum = np.zeros(J)
for ni, node in enumerate(nodes):
    if node.get('skin') != 0 or 'mesh' not in node:
        continue
    for prim in doc['meshes'][node['mesh']]['primitives']:
        jj = read(prim['attributes']['JOINTS_0']).astype(int)
        ww = read(prim['attributes']['WEIGHTS_0'])
        np.add.at(skin_sum, jj.ravel(), ww.ravel())

# Asset.trim_skeleton, src/rig_package/info/asset.py, verbatim logic.
has_skin = skin_sum > 1e-6
keep = [True] * J
if np.any(has_skin):
    sons = [[] for _ in range(J)]
    order, stack = [], [parents.index(-1)]
    while stack:
        u = stack.pop(); order.append(u)
        stack.extend(k for k in range(J) if parents[k] == u)
    for u in order:
        if parents[u] != -1:
            sons[parents[u]].append(u)
    sub = [False] * J
    for u in reversed(order):
        sub[u] = bool(has_skin[u]) or any(sub[v] for v in sons[u])
    good = [[v for v in sons[u] if sub[v]] for u in range(J)]
    keep = [False] * J
    for u in order:
        p = parents[u]
        if has_skin[u]:
            keep[u] = True
        elif len(good[u]) >= 2:
            keep[u] = True
        elif len(good[u]) == 1 and p != -1:
            if len(good[p]) >= 2:
                keep[u] = True
            elif len(good[p]) == 1 and good[p][0] != u:
                keep[u] = True
skin['joints'] = [joints[k] for k in range(J) if keep[k]]
skin.pop('inverseBindMatrices', None)
body = json.dumps(doc).encode()
body += b' ' * (-len(body) % 4)
chunks = struct.pack('<II', len(body), 0x4E4F534A) + body + struct.pack('<II', len(binary), 0x004E4942) + binary
open(dst, 'wb').write(b'glTF' + struct.pack('<II', 2, 12 + len(chunks)) + chunks)
'''


def skin_joint_count(path: Path) -> int:
    data = Path(path).read_bytes()
    size = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + size])
    return len(doc["skins"][0]["joints"])
