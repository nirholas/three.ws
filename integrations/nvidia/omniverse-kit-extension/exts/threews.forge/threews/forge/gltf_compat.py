"""Rewrite a delivery-optimized GLB as plain glTF 2.0 for the Kit asset converter.

Models saved to a three.ws account can be stored the way they were uploaded,
which is often compressed for the web: ``EXT_meshopt_compression`` geometry,
``KHR_mesh_quantization`` integer attributes and ``EXT_texture_webp`` textures.
The Kit asset converter reads none of the three, and a meshopt file fails with
an "Invalid byteLength" error because its fallback buffer carries no bytes.

``make_kit_compatible`` decodes all three and returns an equivalent GLB with one
float vertex buffer and PNG textures. A GLB that uses none of them comes back
byte for byte unchanged. Pure Python plus numpy, both shipped with Kit; Pillow
(also shipped with Kit, through ``omni.kit.pip_archive``) handles WebP.

The meshopt bitstreams follow the EXT_meshopt_compression specification:
vertex codec version 0, index codec versions 0 and 1, index sequences, and the
OCTAHEDRAL, QUATERNION and EXPONENTIAL filters. Unfiltered output is byte
identical to the reference decoder; filtered output rounds half away from zero
like the reference's scalar path, so it can differ from its SIMD path by one
unit in the last place on a few components.
"""

from __future__ import annotations

import base64
import io
import json
import struct
from typing import Dict, List, Optional, Tuple

import numpy as np

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

MESHOPT = ("EXT_meshopt_compression", "KHR_meshopt_compression")
QUANTIZATION = "KHR_mesh_quantization"
WEBP = "EXT_texture_webp"
HANDLED = set(MESHOPT) | {QUANTIZATION, WEBP}

FLOAT = 5126
_DTYPES = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}
# Attributes the quantization extension widens beyond core glTF; these become float.
_FLOAT_ATTRIBUTES = ("POSITION", "NORMAL", "TANGENT", "TEXCOORD_")


class GltfCompatError(Exception):
    """The GLB is malformed or uses an encoding this decoder does not read."""


def needs_rewrite(glb: bytes) -> bool:
    try:
        doc, _ = _split_glb(glb)
    except GltfCompatError:
        return False
    return bool(HANDLED.intersection(doc.get("extensionsUsed") or []))


def make_kit_compatible(glb: bytes) -> bytes:
    doc, bin_chunk = _split_glb(glb)
    used = set(doc.get("extensionsUsed") or [])
    if not HANDLED.intersection(used):
        return glb

    buffers = [_buffer_bytes(i, buf, bin_chunk) for i, buf in enumerate(doc.get("buffers") or [])]
    views: List[bytes] = []
    for index, view in enumerate(doc.get("bufferViews") or []):
        ext = _meshopt_ext(view)
        if ext is not None:
            source = buffers[ext.get("buffer", 0)]
            if source is None:
                raise GltfCompatError(f"bufferView {index}: compressed data points at an empty buffer")
            start = ext.get("byteOffset", 0)
            data = source[start : start + ext["byteLength"]]
            views.append(decode_meshopt(data, ext["count"], ext["byteStride"], ext.get("mode", "ATTRIBUTES"), ext.get("filter", "NONE")))
            for name in MESHOPT:
                view["extensions"].pop(name, None)
            if not view["extensions"]:
                del view["extensions"]
        else:
            source = buffers[view.get("buffer", 0)]
            if source is None:
                raise GltfCompatError(f"bufferView {index} points at a fallback buffer with no data")
            start = view.get("byteOffset", 0)
            views.append(source[start : start + view["byteLength"]])

    if QUANTIZATION in used:
        _dequantize(doc, views)
    webp_left = _convert_webp(doc, views) if WEBP in used else False

    drop = set(MESHOPT) | {QUANTIZATION} | (set() if webp_left else {WEBP})
    for key in ("extensionsUsed", "extensionsRequired"):
        if key in doc:
            doc[key] = [name for name in doc[key] if name not in drop]
            if not doc[key]:
                del doc[key]
    return _pack(doc, views)


# -- container ---------------------------------------------------------------


def _split_glb(glb: bytes) -> Tuple[dict, bytes]:
    if len(glb) < 20:
        raise GltfCompatError("not a GLB: file too short")
    magic, version, length = struct.unpack_from("<III", glb, 0)
    if magic != GLB_MAGIC or version != 2:
        raise GltfCompatError("not a binary glTF 2.0 file")
    offset, doc, bin_chunk = 12, None, b""
    end = min(length, len(glb))
    while offset + 8 <= end:
        size, kind = struct.unpack_from("<II", glb, offset)
        body = glb[offset + 8 : offset + 8 + size]
        if kind == CHUNK_JSON and doc is None:
            doc = json.loads(body.decode("utf-8"))
        elif kind == CHUNK_BIN and not bin_chunk:
            bin_chunk = bytes(body)
        offset += 8 + size
    if doc is None:
        raise GltfCompatError("GLB has no JSON chunk")
    return doc, bin_chunk


def _buffer_bytes(index: int, buf: dict, bin_chunk: bytes) -> Optional[bytes]:
    uri = buf.get("uri")
    if uri is None:
        if index == 0:
            return bin_chunk
        extensions = buf.get("extensions") or {}
        if any((extensions.get(name) or {}).get("fallback") for name in MESHOPT):
            return None
        raise GltfCompatError(f"buffer {index} has no data")
    if uri.startswith("data:"):
        return base64.b64decode(uri.split(",", 1)[1])
    raise GltfCompatError(f"buffer {index} references an external file ({uri}); a GLB must be self-contained")


def _meshopt_ext(view: dict) -> Optional[dict]:
    ext = view.get("extensions") or {}
    for name in MESHOPT:
        if name in ext:
            return ext[name]
    return None


def _pack(doc: dict, views: List[bytes]) -> bytes:
    blob = bytearray()
    for index, data in enumerate(views):
        blob.extend(b"\0" * (-len(blob) % 4))
        view = doc["bufferViews"][index]
        view["buffer"] = 0
        view["byteOffset"] = len(blob)
        view["byteLength"] = len(data)
        blob.extend(data)
    blob.extend(b"\0" * (-len(blob) % 4))
    doc["buffers"] = [{"byteLength": len(blob)}]
    text = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    text += b" " * (-len(text) % 4)
    total = 12 + 8 + len(text) + 8 + len(blob)
    return b"".join(
        [
            struct.pack("<III", GLB_MAGIC, 2, total),
            struct.pack("<II", len(text), CHUNK_JSON),
            text,
            struct.pack("<II", len(blob), CHUNK_BIN),
            bytes(blob),
        ]
    )


# -- meshopt -----------------------------------------------------------------


def decode_meshopt(data: bytes, count: int, stride: int, mode: str, filt: str = "NONE") -> bytes:
    if mode == "ATTRIBUTES":
        out = decode_vertex_buffer(data, count, stride)
        return apply_filter(out, count, stride, filt)
    if mode == "TRIANGLES":
        return decode_index_buffer(data, count, stride)
    if mode == "INDICES":
        return decode_index_sequence(data, count, stride)
    raise GltfCompatError(f"unknown meshopt mode {mode!r}")


_BLOCK_BYTES = 8192
_BLOCK_MAX_VERTICES = 256
_GROUP = 16
_TAIL_MIN = 32


def _unpack_table(bits: int) -> List[Tuple[int, ...]]:
    per = 8 // bits
    mask = (1 << bits) - 1
    return [tuple((byte >> (8 - bits * (k + 1))) & mask for k in range(per)) for byte in range(256)]


_UNPACK2 = _unpack_table(2)
_UNPACK4 = _unpack_table(4)


def _decode_bytes(data: bytes, pos: int, aligned: int, out: bytearray, limit: int) -> int:
    groups = aligned // _GROUP
    header_size = (groups + 3) // 4
    if pos + header_size > limit:
        raise GltfCompatError("meshopt vertex stream is truncated")
    header = data[pos : pos + header_size]
    pos += header_size
    for g in range(groups):
        mode = (header[g >> 2] >> ((g & 3) << 1)) & 3
        base = g * _GROUP
        if mode == 0:
            out[base : base + _GROUP] = bytes(_GROUP)
            continue
        if mode == 3:
            out[base : base + _GROUP] = data[pos : pos + _GROUP]
            pos += _GROUP
            continue
        if mode == 1:
            table, packed, sentinel = _UNPACK2, 4, 3
        else:
            table, packed, sentinel = _UNPACK4, 8, 15
        extra = pos + packed
        i = base
        for byte in data[pos : pos + packed]:
            for value in table[byte]:
                if value == sentinel:
                    value = data[extra]
                    extra += 1
                out[i] = value
                i += 1
        pos = extra
        if pos > limit:
            raise GltfCompatError("meshopt vertex stream is truncated")
    return pos


def decode_vertex_buffer(data: bytes, count: int, stride: int) -> bytes:
    if stride <= 0 or stride > 256 or stride % 4:
        raise GltfCompatError(f"meshopt vertex stride {stride} is invalid")
    if not data or (data[0] & 0xF0) != 0xA0:
        raise GltfCompatError("meshopt vertex stream has a bad header")
    version = data[0] & 0x0F
    if version != 0:
        raise GltfCompatError(f"meshopt vertex codec version {version} is not supported (version 0 is)")
    tail = max(stride, _TAIL_MIN)
    if len(data) < 1 + tail:
        raise GltfCompatError("meshopt vertex stream is truncated")
    limit = len(data) - tail
    last = np.frombuffer(data[len(data) - stride :], dtype=np.uint8).astype(np.uint32)
    block = min((_BLOCK_BYTES // stride) & ~(_GROUP - 1), _BLOCK_MAX_VERTICES)
    result = np.empty((count, stride), dtype=np.uint8)
    scratch = bytearray(block)
    pos = 1
    for start in range(0, count, block):
        n = min(block, count - start)
        aligned = (n + _GROUP - 1) & ~(_GROUP - 1)
        for k in range(stride):
            pos = _decode_bytes(data, pos, aligned, scratch, limit)
            enc = np.frombuffer(bytes(scratch[:n]), dtype=np.uint8).astype(np.uint32)
            delta = (enc >> 1) ^ ((0 - (enc & 1)) & 0xFF)
            values = (np.cumsum(delta) + last[k]) & 0xFF
            result[start : start + n, k] = values
            last[k] = values[-1]
    if pos != limit:
        raise GltfCompatError("meshopt vertex stream has trailing data")
    return result.tobytes()


def _vbyte(data: bytes, pos: int) -> Tuple[int, int]:
    lead = data[pos]
    pos += 1
    if lead < 0x80:
        return lead, pos
    result, shift = lead & 0x7F, 7
    for _ in range(4):
        group = data[pos]
        pos += 1
        result |= (group & 0x7F) << shift
        shift += 7
        if group < 0x80:
            break
    return result, pos


def _write_indices(indices: List[int], size: int) -> bytes:
    if size == 2:
        return np.asarray(indices, dtype=np.uint32).astype(np.uint16).tobytes()
    if size == 4:
        return np.asarray(indices, dtype=np.uint32).tobytes()
    raise GltfCompatError(f"meshopt index size {size} is invalid")


def decode_index_buffer(data: bytes, count: int, size: int) -> bytes:
    if count % 3:
        raise GltfCompatError("meshopt triangle count is not a multiple of 3")
    if len(data) < 1 + count // 3 + 16 or (data[0] & 0xF0) != 0xE0:
        raise GltfCompatError("meshopt index stream has a bad header")
    version = data[0] & 0x0F
    if version > 1:
        raise GltfCompatError(f"meshopt index codec version {version} is not supported")
    mask = 0xFFFFFFFF
    edges = [(mask, mask)] * 16
    verts = [mask] * 16
    eo = vo = 0
    nxt = last = 0
    fecmax = 13 if version >= 1 else 15
    code = 1
    pos = 1 + count // 3
    aux = data[len(data) - 16 :]
    out: List[int] = []

    def index(pos, last):
        v, pos = _vbyte(data, pos)
        d = (v >> 1) ^ (-(v & 1) & mask)
        return (last + d) & mask, pos

    for _ in range(count // 3):
        tri = data[code]
        code += 1
        if tri < 0xF0:
            fe = tri >> 4
            a, b = edges[(eo - 1 - fe) & 15]
            fec = tri & 15
            if fec < fecmax:
                c = nxt if fec == 0 else verts[(vo - 1 - fec) & 15]
                nxt += fec == 0
                out += (a, b, c)
                verts[vo] = c
                vo = (vo + (fec == 0)) & 15
            else:
                if fec != 15:
                    last = c = (last + (fec - (fec ^ 3))) & mask
                else:
                    last, pos = index(pos, last)
                    c = last
                out += (a, b, c)
                verts[vo] = c
                vo = (vo + 1) & 15
            edges[eo] = (c, b)
            eo = (eo + 1) & 15
            edges[eo] = (a, c)
            eo = (eo + 1) & 15
        elif tri < 0xFE:
            codeaux = aux[tri & 15]
            feb, fec = codeaux >> 4, codeaux & 15
            a = nxt
            nxt += 1
            b = nxt if feb == 0 else verts[(vo - feb) & 15]
            nxt += feb == 0
            c = nxt if fec == 0 else verts[(vo - fec) & 15]
            nxt += fec == 0
            out += (a, b, c)
            verts[vo] = a
            vo = (vo + 1) & 15
            verts[vo] = b
            vo = (vo + (feb == 0)) & 15
            verts[vo] = c
            vo = (vo + (fec == 0)) & 15
            for edge in ((b, a), (c, b), (a, c)):
                edges[eo] = edge
                eo = (eo + 1) & 15
        else:
            codeaux = data[pos]
            pos += 1
            fea = 0 if tri == 0xFE else 15
            feb, fec = codeaux >> 4, codeaux & 15
            if codeaux == 0:
                nxt = 0
            a = 0
            if fea == 0:
                a = nxt
                nxt += 1
            b = verts[(vo - feb) & 15]
            if feb == 0:
                b = nxt
                nxt += 1
            c = verts[(vo - fec) & 15]
            if fec == 0:
                c = nxt
                nxt += 1
            if fea == 15:
                last, pos = index(pos, last)
                a = last
            if feb == 15:
                last, pos = index(pos, last)
                b = last
            if fec == 15:
                last, pos = index(pos, last)
                c = last
            out += (a, b, c)
            verts[vo] = a
            vo = (vo + 1) & 15
            verts[vo] = b
            vo = (vo + (feb == 0 or feb == 15)) & 15
            verts[vo] = c
            vo = (vo + (fec == 0 or fec == 15)) & 15
            for edge in ((b, a), (c, b), (a, c)):
                edges[eo] = edge
                eo = (eo + 1) & 15
        if pos > len(data) - 16:
            raise GltfCompatError("meshopt index stream is truncated")
    return _write_indices(out, size)


def decode_index_sequence(data: bytes, count: int, size: int) -> bytes:
    if len(data) < 1 + count + 4 or (data[0] & 0xF0) != 0xD0:
        raise GltfCompatError("meshopt index sequence has a bad header")
    if data[0] & 0x0F > 1:
        raise GltfCompatError(f"meshopt index sequence version {data[0] & 0x0F} is not supported")
    mask = 0xFFFFFFFF
    baseline = [0, 0]
    pos = 1
    out: List[int] = []
    for _ in range(count):
        v, pos = _vbyte(data, pos)
        current = v & 1
        v >>= 1
        d = (v >> 1) ^ (-(v & 1) & mask)
        baseline[current] = (baseline[current] + d) & mask
        out.append(baseline[current])
        if pos > len(data) - 4:
            raise GltfCompatError("meshopt index sequence is truncated")
    return _write_indices(out, size)


def _round_to_int(values: np.ndarray) -> np.ndarray:
    half = np.float32(0.5)
    return np.where(values >= 0, values + half, values - half).astype(np.int32)


def apply_filter(data: bytes, count: int, stride: int, filt: str) -> bytes:
    if filt in (None, "", "NONE"):
        return data
    if filt == "OCTAHEDRAL":
        if stride not in (4, 8):
            raise GltfCompatError("OCTAHEDRAL filter needs a stride of 4 or 8")
        dtype = np.int8 if stride == 4 else np.int16
        top = np.float32((1 << (8 * np.dtype(dtype).itemsize - 1)) - 1)
        v = np.frombuffer(data, dtype=dtype).reshape(count, 4).copy()
        x = v[:, 0].astype(np.float32)
        y = v[:, 1].astype(np.float32)
        z = v[:, 2].astype(np.float32) - np.abs(x) - np.abs(y)
        t = np.minimum(z, np.float32(0.0))
        x = x + np.where(x >= 0, t, -t)
        y = y + np.where(y >= 0, t, -t)
        length = np.sqrt(x * x + y * y + z * z)
        scale = np.divide(top, length, out=np.zeros_like(length), where=length > 0)
        v[:, 0] = _round_to_int(x * scale).astype(dtype)
        v[:, 1] = _round_to_int(y * scale).astype(dtype)
        v[:, 2] = _round_to_int(z * scale).astype(dtype)
        return v.tobytes()
    if filt == "QUATERNION":
        if stride != 8:
            raise GltfCompatError("QUATERNION filter needs a stride of 8")
        v = np.frombuffer(data, dtype=np.int16).reshape(count, 4).astype(np.int32)
        sf = v[:, 3] | 3
        ss = np.float32(1.0 / np.sqrt(2.0)) / sf.astype(np.float32)
        x = v[:, 0] * ss
        y = v[:, 1] * ss
        z = v[:, 2] * ss
        w = np.sqrt(np.maximum(np.float32(1.0) - x * x - y * y - z * z, np.float32(0.0)))
        qc = v[:, 3] & 3
        out = np.empty((count, 4), dtype=np.int16)
        rows = np.arange(count)
        q = np.float32(32767.0)
        out[rows, (qc + 1) & 3] = _round_to_int(x * q)
        out[rows, (qc + 2) & 3] = _round_to_int(y * q)
        out[rows, (qc + 3) & 3] = _round_to_int(z * q)
        out[rows, qc & 3] = (w * q + np.float32(0.5)).astype(np.int32)
        return out.tobytes()
    if filt == "EXPONENTIAL":
        if stride % 4:
            raise GltfCompatError("EXPONENTIAL filter needs a stride that is a multiple of 4")
        v = np.frombuffer(data, dtype=np.uint32)
        mantissa = (v.astype(np.int64) << 40 >> 40).astype(np.float64)
        exponent = (v.view(np.int32) >> 24).astype(np.int32)
        return np.ldexp(mantissa, exponent).astype(np.float32).tobytes()
    raise GltfCompatError(f"unknown meshopt filter {filt!r}")


# -- quantization ------------------------------------------------------------


def _read_accessor(doc: dict, views: List[bytes], accessor: dict) -> np.ndarray:
    dtype = np.dtype(_DTYPES[accessor["componentType"]])
    comps = _COMPONENTS[accessor["type"]]
    count = accessor["count"]
    if "bufferView" in accessor:
        view = doc["bufferViews"][accessor["bufferView"]]
        stride = view.get("byteStride") or comps * dtype.itemsize
        values = np.ndarray(
            shape=(count, comps),
            dtype=dtype,
            buffer=views[accessor["bufferView"]],
            offset=accessor.get("byteOffset", 0),
            strides=(stride, dtype.itemsize),
        ).copy()
    else:
        values = np.zeros((count, comps), dtype=dtype)
    sparse = accessor.get("sparse")
    if sparse:
        idx_dtype = np.dtype(_DTYPES[sparse["indices"]["componentType"]])
        idx = np.frombuffer(
            views[sparse["indices"]["bufferView"]], dtype=idx_dtype, count=sparse["count"], offset=sparse["indices"].get("byteOffset", 0)
        )
        vals = np.frombuffer(
            views[sparse["values"]["bufferView"]], dtype=dtype, count=sparse["count"] * comps, offset=sparse["values"].get("byteOffset", 0)
        ).reshape(sparse["count"], comps)
        values[idx.astype(np.int64)] = vals
    return values


def _to_float(values: np.ndarray, normalized: bool) -> np.ndarray:
    out = values.astype(np.float32)
    if normalized and values.dtype != np.float32:
        info = np.iinfo(values.dtype)
        out = out / float(info.max)
        if info.min < 0:
            out = np.maximum(out, -1.0)
    return out


def _dequantize(doc: dict, views: List[bytes]) -> None:
    targets = set()
    for mesh in doc.get("meshes") or []:
        for prim in mesh.get("primitives") or []:
            for attrs in [prim.get("attributes") or {}] + list(prim.get("targets") or []):
                for name, index in attrs.items():
                    if name.startswith(_FLOAT_ATTRIBUTES):
                        targets.add(index)
    for index in sorted(targets):
        accessor = doc["accessors"][index]
        if accessor["componentType"] == FLOAT and not accessor.get("normalized"):
            continue
        values = _to_float(_read_accessor(doc, views, accessor), bool(accessor.get("normalized")))
        doc["bufferViews"].append({"buffer": 0, "byteOffset": 0, "byteLength": values.nbytes, "target": 34962})
        views.append(np.ascontiguousarray(values).tobytes())
        accessor["bufferView"] = len(views) - 1
        accessor["byteOffset"] = 0
        accessor["componentType"] = FLOAT
        accessor.pop("normalized", None)
        accessor.pop("sparse", None)
        if len(values):
            # POSITION requires bounds, and the old ones were in quantized units.
            accessor["min"] = [float(v) for v in values.min(axis=0)]
            accessor["max"] = [float(v) for v in values.max(axis=0)]


# -- textures ----------------------------------------------------------------


def _convert_webp(doc: dict, views: List[bytes]) -> bool:
    """Re-encode WebP images as PNG. Returns True if any WebP texture is left."""
    try:
        from PIL import Image
    except ImportError:
        return True
    converted: Dict[int, bool] = {}
    left = False
    for texture in doc.get("textures") or []:
        ext = (texture.get("extensions") or {}).get(WEBP)
        if not ext:
            continue
        source = ext.get("source")
        image = (doc.get("images") or [])[source] if source is not None else None
        if image is None or "bufferView" not in image:
            left = True
            continue
        if source not in converted:
            with Image.open(io.BytesIO(views[image["bufferView"]])) as img:
                img.load()
                if img.mode not in ("RGB", "RGBA", "L", "LA"):
                    img = img.convert("RGBA")
                png = io.BytesIO()
                img.save(png, format="PNG", optimize=False)
            views[image["bufferView"]] = png.getvalue()
            image["mimeType"] = "image/png"
            converted[source] = True
        texture["source"] = source
        del texture["extensions"][WEBP]
        if not texture["extensions"]:
            del texture["extensions"]
    return left
