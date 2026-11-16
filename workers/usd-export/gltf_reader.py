"""Minimal, strict glTF 2.0 binary reader for the OpenUSD exporter.

Reads exactly what the exporter consumes: the JSON document, typed accessor
arrays (strided, normalized and sparse), node world matrices, animation
samplers and embedded images. Anything a GLB requires that this reader cannot
honour (Draco, an unknown required extension, external buffers) raises
InputFormatError so the caller gets a clear 400 instead of a wrong asset.

Meshopt-compressed GLBs are decoded before they reach this module
(gltf_meshopt.decode_if_meshopt), so EXT_meshopt_compression never shows up
here.
"""

from __future__ import annotations

import base64
import json
import struct
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

# Extensions whose absence changes geometry or images. Everything else is a
# material nicety the exporter maps or records as unmapped.
SUPPORTED_REQUIRED = {
    "KHR_mesh_quantization",
    "KHR_texture_transform",
    "EXT_texture_webp",
    "KHR_materials_emissive_strength",
}

_COMPONENT = {
    5120: np.int8,
    5121: np.uint8,
    5122: np.int16,
    5123: np.uint16,
    5125: np.uint32,
    5126: np.float32,
}
_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


class InputFormatError(ValueError):
    """The caller's file is not a GLB this exporter can convert faithfully."""


@dataclass
class Gltf:
    doc: dict
    bin: bytes
    _cache: dict = field(default_factory=dict)

    # ---------------------------------------------------------------- access
    def accessor(self, index: int) -> np.ndarray:
        """Accessor `index` as a float64 or integer array of shape (count, n)."""
        if index in self._cache:
            return self._cache[index]
        acc = self.doc["accessors"][index]
        ctype = _COMPONENT.get(acc["componentType"])
        if ctype is None:
            raise InputFormatError(f"accessor {index} has unknown componentType {acc['componentType']}")
        n = _NCOMP[acc["type"]]
        count = int(acc["count"])
        if "bufferView" in acc:
            out = self._read_view(acc["bufferView"], acc.get("byteOffset", 0), ctype, n, count)
        else:
            out = np.zeros((count, n), dtype=ctype)
        sparse = acc.get("sparse")
        if sparse:
            out = out.copy()
            sc = int(sparse["count"])
            idx_t = _COMPONENT[sparse["indices"]["componentType"]]
            idx = self._read_view(sparse["indices"]["bufferView"], sparse["indices"].get("byteOffset", 0), idx_t, 1, sc)[:, 0]
            vals = self._read_view(sparse["values"]["bufferView"], sparse["values"].get("byteOffset", 0), ctype, n, sc)
            out[idx.astype(np.int64)] = vals
        if acc.get("normalized"):
            out = _denormalize(out, ctype)
        elif ctype == np.float32:
            out = out.astype(np.float64)
        self._cache[index] = out
        return out

    def _read_view(self, view_index: int, extra_offset: int, ctype, n: int, count: int) -> np.ndarray:
        view = self.doc["bufferViews"][view_index]
        if view.get("buffer", 0) != 0:
            raise InputFormatError("GLB references an external buffer; only self-contained GLB files are supported")
        itemsize = np.dtype(ctype).itemsize
        elem = itemsize * n
        stride = view.get("byteStride") or elem
        start = view.get("byteOffset", 0) + extra_offset
        need = start + stride * (count - 1) + elem if count else start
        if need > len(self.bin):
            raise InputFormatError(f"bufferView {view_index} reads past the end of the binary chunk")
        if count == 0:
            return np.zeros((0, n), dtype=ctype)
        if stride == elem:
            arr = np.frombuffer(self.bin, dtype=ctype, count=count * n, offset=start)
            return arr.reshape(count, n)
        raw = np.frombuffer(self.bin, dtype=np.uint8, count=stride * (count - 1) + elem, offset=start)
        rows = np.lib.stride_tricks.as_strided(raw, shape=(count, elem), strides=(stride, 1))
        return np.ascontiguousarray(rows).view(ctype).reshape(count, n)

    def image_bytes(self, image_index: int) -> tuple[bytes, str]:
        """(bytes, mime) of image `image_index`; data URIs and bufferViews both work."""
        img = self.doc["images"][image_index]
        if "bufferView" in img:
            view = self.doc["bufferViews"][img["bufferView"]]
            start = view.get("byteOffset", 0)
            data = self.bin[start:start + view["byteLength"]]
            return data, img.get("mimeType") or _sniff_mime(data)
        uri = img.get("uri", "")
        if uri.startswith("data:"):
            head, _, payload = uri.partition(",")
            data = base64.b64decode(payload) if ";base64" in head else payload.encode()
            return data, head[5:].split(";")[0] or _sniff_mime(data)
        raise InputFormatError("GLB references an external image; only self-contained GLB files are supported")

    # ----------------------------------------------------------------- nodes
    def scene_roots(self) -> list[int]:
        scenes = self.doc.get("scenes") or []
        if scenes:
            si = self.doc.get("scene", 0)
            return list(scenes[si].get("nodes", []))
        children = {c for node in self.doc.get("nodes", []) for c in node.get("children", [])}
        return [i for i in range(len(self.doc.get("nodes", []))) if i not in children]

    def parents(self) -> dict[int, int]:
        out = {}
        for i, node in enumerate(self.doc.get("nodes", [])):
            for c in node.get("children", []):
                out[c] = i
        return out

    def local_matrix(self, node_index: int, trs: Optional[dict] = None) -> np.ndarray:
        node = self.doc["nodes"][node_index]
        if trs is None and "matrix" in node:
            return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
        t = (trs or {}).get("translation", node.get("translation", [0, 0, 0]))
        r = (trs or {}).get("rotation", node.get("rotation", [0, 0, 0, 1]))
        s = (trs or {}).get("scale", node.get("scale", [1, 1, 1]))
        if trs is not None and "matrix" in node:
            base_t, base_r, base_s = decompose(np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T)
            t = trs.get("translation", base_t)
            r = trs.get("rotation", base_r)
            s = trs.get("scale", base_s)
        return compose(t, r, s)

    def world_matrices(self) -> dict[int, np.ndarray]:
        """World matrix of every node reachable from the active scene."""
        out: dict[int, np.ndarray] = {}
        stack = [(r, np.eye(4)) for r in self.scene_roots()]
        while stack:
            idx, parent = stack.pop()
            world = parent @ self.local_matrix(idx)
            out[idx] = world
            for c in self.doc["nodes"][idx].get("children", []):
                stack.append((c, world))
        return out


def _denormalize(arr: np.ndarray, ctype) -> np.ndarray:
    a = arr.astype(np.float64)
    if ctype == np.uint8:
        return a / 255.0
    if ctype == np.uint16:
        return a / 65535.0
    if ctype == np.int8:
        return np.maximum(a / 127.0, -1.0)
    if ctype == np.int16:
        return np.maximum(a / 32767.0, -1.0)
    if ctype == np.uint32:
        return a / 4294967295.0
    return a


def _sniff_mime(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"


def compose(t, r, s) -> np.ndarray:
    """4x4 column-vector matrix from glTF translation, quaternion (x,y,z,w), scale."""
    x, y, z, w = (float(v) for v in r)
    norm = np.sqrt(x * x + y * y + z * z + w * w) or 1.0
    x, y, z, w = x / norm, y / norm, z / norm, w / norm
    rot = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    m = np.eye(4)
    m[:3, :3] = rot * np.asarray(s, dtype=np.float64)[None, :]
    m[:3, 3] = np.asarray(t, dtype=np.float64)
    return m


def decompose(m: np.ndarray):
    """Inverse of compose for a TRS matrix: (translation, quaternion xyzw, scale)."""
    t = m[:3, 3].copy()
    cols = m[:3, :3]
    s = np.linalg.norm(cols, axis=0)
    if np.linalg.det(cols) < 0:
        s[0] = -s[0]
    rot = cols / np.where(s == 0, 1, s)[None, :]
    return t, matrix_to_quat(rot), s


def matrix_to_quat(r: np.ndarray) -> np.ndarray:
    tr = r[0, 0] + r[1, 1] + r[2, 2]
    if tr > 0:
        s = np.sqrt(tr + 1.0) * 2
        q = [(r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s, 0.25 * s]
    elif r[0, 0] > r[1, 1] and r[0, 0] > r[2, 2]:
        s = np.sqrt(1.0 + r[0, 0] - r[1, 1] - r[2, 2]) * 2
        q = [0.25 * s, (r[0, 1] + r[1, 0]) / s, (r[0, 2] + r[2, 0]) / s, (r[2, 1] - r[1, 2]) / s]
    elif r[1, 1] > r[2, 2]:
        s = np.sqrt(1.0 + r[1, 1] - r[0, 0] - r[2, 2]) * 2
        q = [(r[0, 1] + r[1, 0]) / s, 0.25 * s, (r[1, 2] + r[2, 1]) / s, (r[0, 2] - r[2, 0]) / s]
    else:
        s = np.sqrt(1.0 + r[2, 2] - r[0, 0] - r[1, 1]) * 2
        q = [(r[0, 2] + r[2, 0]) / s, (r[1, 2] + r[2, 1]) / s, 0.25 * s, (r[1, 0] - r[0, 1]) / s]
    q = np.array(q)
    return q / (np.linalg.norm(q) or 1.0)


def slerp(a: np.ndarray, b: np.ndarray, t: float) -> np.ndarray:
    a = a / (np.linalg.norm(a) or 1.0)
    b = b / (np.linalg.norm(b) or 1.0)
    d = float(np.dot(a, b))
    if d < 0:
        b, d = -b, -d
    if d > 0.9995:
        out = a + t * (b - a)
        return out / (np.linalg.norm(out) or 1.0)
    th = np.arccos(min(1.0, d))
    return (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / np.sin(th)


def load_glb(data: bytes) -> Gltf:
    if len(data) < 20:
        raise InputFormatError("file is too small to be a GLB")
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC:
        raise InputFormatError("not a binary glTF (GLB) file")
    if version != 2:
        raise InputFormatError(f"glTF version {version} is not supported; export glTF 2.0")
    offset = 12
    doc, binary = None, b""
    while offset + 8 <= min(length, len(data)):
        clen, ctype = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8: offset + 8 + clen]
        if ctype == CHUNK_JSON and doc is None:
            doc = json.loads(chunk.decode("utf-8"))
        elif ctype == CHUNK_BIN and not binary:
            binary = bytes(chunk)
        offset += 8 + clen
    if doc is None:
        raise InputFormatError("GLB has no JSON chunk")
    for ext in doc.get("extensionsRequired", []) or []:
        if ext == "KHR_draco_mesh_compression":
            raise InputFormatError("Draco-compressed GLB is not supported; re-export without Draco")
        if ext not in SUPPORTED_REQUIRED:
            raise InputFormatError(f"GLB requires unsupported extension {ext}")
    buffers = doc.get("buffers") or []
    if buffers and "uri" in buffers[0]:
        uri = buffers[0]["uri"]
        if uri.startswith("data:"):
            binary = base64.b64decode(uri.partition(",")[2])
        else:
            raise InputFormatError("GLB references an external buffer; only self-contained GLB files are supported")
    if not doc.get("meshes"):
        raise InputFormatError("GLB contains no meshes")
    return Gltf(doc, binary)


def sample_channel(times: np.ndarray, values: np.ndarray, interp: str, t: float, path: str) -> np.ndarray:
    """Evaluate one animation sampler at time t (glTF semantics)."""
    n = len(times)
    if interp == "CUBICSPLINE":
        stride = 3
        keys = values.reshape(n, 3, -1)
    else:
        stride = 1
        keys = values.reshape(n, 1, -1)
    if t <= times[0]:
        return keys[0, 1 if stride == 3 else 0].copy()
    if t >= times[-1]:
        return keys[-1, 1 if stride == 3 else 0].copy()
    i = int(np.searchsorted(times, t, side="right") - 1)
    t0, t1 = times[i], times[i + 1]
    dt = t1 - t0
    u = (t - t0) / dt if dt > 0 else 0.0
    if interp == "STEP":
        return keys[i, 0].copy()
    if interp == "CUBICSPLINE":
        p0, m0 = keys[i, 1], keys[i, 2] * dt
        p1, m1 = keys[i + 1, 1], keys[i + 1, 0] * dt
        u2, u3 = u * u, u * u * u
        out = (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1
        if path == "rotation":
            out = out / (np.linalg.norm(out) or 1.0)
        return out
    a, b = keys[i, 0], keys[i + 1, 0]
    if path == "rotation":
        return slerp(a, b, u)
    return a + (b - a) * u
