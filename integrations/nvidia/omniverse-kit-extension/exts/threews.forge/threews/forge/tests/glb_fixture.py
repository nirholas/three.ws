"""Build small, exactly-known glTF 2.0 binaries for the import tests.

The box is deliberately not a cube and not centered, so a test can tell the
axes apart and prove grounding: 1 m wide (X), 2 m tall (Y, glTF up) and
0.5 m deep (Z), floating with its base 1 m above the origin.
"""

from __future__ import annotations

import json
import struct

BOX_MIN = (-0.5, 1.0, -0.25)
BOX_MAX = (0.5, 3.0, 0.25)

_FACES = (
    ((1, 0, 0), ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1))),
    ((-1, 0, 0), ((0, 0, 1), (0, 1, 1), (0, 1, 0), (0, 0, 0))),
    ((0, 1, 0), ((0, 1, 1), (1, 1, 1), (1, 1, 0), (0, 1, 0))),
    ((0, -1, 0), ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1))),
    ((0, 0, 1), ((1, 0, 1), (1, 1, 1), (0, 1, 1), (0, 0, 1))),
    ((0, 0, -1), ((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0))),
)


def _pad(data: bytes, fill: bytes) -> bytes:
    return data + fill * ((4 - len(data) % 4) % 4)


def box_glb(box_min=BOX_MIN, box_max=BOX_MAX, color=(0.8, 0.45, 0.1, 1.0)) -> bytes:
    positions, normals, indices = [], [], []
    for normal, corners in _FACES:
        base = len(positions)
        for cx, cy, cz in corners:
            positions.append(
                (
                    box_max[0] if cx else box_min[0],
                    box_max[1] if cy else box_min[1],
                    box_max[2] if cz else box_min[2],
                )
            )
            normals.append(normal)
        indices += [base, base + 1, base + 2, base, base + 2, base + 3]

    pos_bytes = b"".join(struct.pack("<3f", *p) for p in positions)
    nrm_bytes = b"".join(struct.pack("<3f", *n) for n in normals)
    idx_bytes = _pad(b"".join(struct.pack("<H", i) for i in indices), b"\x00")
    blob = pos_bytes + nrm_bytes + idx_bytes

    gltf = {
        "asset": {"version": "2.0", "generator": "threews.forge tests"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "box", "mesh": 0}],
        "meshes": [
            {
                "name": "box",
                "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}],
            }
        ],
        "materials": [
            {
                "name": "orange",
                "pbrMetallicRoughness": {"baseColorFactor": list(color), "metallicFactor": 0.0, "roughnessFactor": 0.6},
            }
        ],
        "buffers": [{"byteLength": len(blob)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos_bytes), "target": 34962},
            {"buffer": 0, "byteOffset": len(pos_bytes), "byteLength": len(nrm_bytes), "target": 34962},
            {"buffer": 0, "byteOffset": len(pos_bytes) + len(nrm_bytes), "byteLength": len(indices) * 2, "target": 34963},
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": len(positions),
                "type": "VEC3",
                "min": list(box_min),
                "max": list(box_max),
            },
            {"bufferView": 1, "componentType": 5126, "count": len(normals), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5123, "count": len(indices), "type": "SCALAR"},
        ],
    }
    json_chunk = _pad(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    total = 12 + 8 + len(json_chunk) + 8 + len(blob)
    return b"".join(
        (
            struct.pack("<4sII", b"glTF", 2, total),
            struct.pack("<I4s", len(json_chunk), b"JSON"),
            json_chunk,
            struct.pack("<I4s", len(blob), b"BIN\x00"),
            blob,
        )
    )
