"""Minimal PLY reader for splat and point-cloud files (numpy, no bpy).

Reads the ``vertex`` element of a binary little-endian PLY (the layout of a standard
3D Gaussian Splatting file: ``x y z``, ``f_dc_0..2``, ``opacity``, ``scale_0..2``,
``rot_0..3``, optional ``f_rest_*``) or of an ordinary coloured point cloud
(``red green blue`` as uchar). The data is memory-mapped, so a multi-million
Gaussian file is never loaded whole: only the columns and the rows asked for are read.

Blender ships numpy, so the extension needs nothing extra.
"""

from __future__ import annotations

import os

import numpy as np

SH_C0 = 0.28209479177387814

_TYPES = {
    "char": "i1", "int8": "i1",
    "uchar": "u1", "uint8": "u1",
    "short": "<i2", "int16": "<i2",
    "ushort": "<u2", "uint16": "<u2",
    "int": "<i4", "int32": "<i4",
    "uint": "<u4", "uint32": "<u4",
    "float": "<f4", "float32": "<f4",
    "double": "<f8", "float64": "<f8",
}


class PlyError(ValueError):
    """The file is not a PLY this reader can use. The message is safe to show."""


def read_header(path: str):
    """Return ``(fields, vertex_count, data_offset)`` for the vertex element."""
    fields = []
    count = None
    in_vertex = False
    with open(path, "rb") as fh:
        if fh.readline().strip() != b"ply":
            raise PlyError("This is not a PLY file.")
        fmt = None
        while True:
            line = fh.readline()
            if not line:
                raise PlyError("The PLY header is cut off. The download may be incomplete.")
            parts = line.decode("ascii", "replace").split()
            if not parts:
                continue
            if parts[0] == "format":
                fmt = parts[1]
            elif parts[0] == "element":
                in_vertex = parts[1] == "vertex"
                if in_vertex:
                    count = int(parts[2])
                elif count is not None:
                    in_vertex = False
            elif parts[0] == "property" and in_vertex:
                if parts[1] == "list":
                    raise PlyError("List properties on the vertex element are not supported.")
                if parts[1] not in _TYPES:
                    raise PlyError(f"Unknown PLY property type '{parts[1]}'.")
                fields.append((parts[2], _TYPES[parts[1]]))
            elif parts[0] == "end_header":
                offset = fh.tell()
                break
    if fmt != "binary_little_endian":
        raise PlyError(f"Only binary little-endian PLY files are supported (this one is {fmt}).")
    if not count or not fields:
        raise PlyError("The PLY file has no vertices.")
    return fields, count, offset


def read_points(path: str, max_points: int = 0):
    """Read positions and linear colours, evenly subsampled to ``max_points`` (0 = all).

    Returns ``(positions, colors, info)``: ``positions`` is float32 ``(n, 3)``, ``colors``
    is float32 ``(n, 3)`` in 0..1 (or ``None`` when the file has none) and ``info`` has
    ``total`` (vertices in the file), ``kept`` and ``is_splat``.
    """
    fields, count, offset = read_header(path)
    names = [name for name, _ in fields]
    for axis in ("x", "y", "z"):
        if axis not in names:
            raise PlyError("The PLY file has no x, y, z positions.")
    dtype = np.dtype(fields)
    expected = offset + dtype.itemsize * count

    if os.path.getsize(path) < expected:
        raise PlyError("The PLY file is shorter than its header says. The download may be incomplete.")
    data = np.memmap(path, dtype=dtype, mode="r", offset=offset, shape=(count,))
    if max_points and count > max_points:
        index = np.linspace(0, count - 1, max_points).astype(np.int64)
    else:
        index = slice(None)
    rows = data[index]
    positions = np.stack([rows["x"], rows["y"], rows["z"]], axis=1).astype(np.float32)
    is_splat = all(name in names for name in ("f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "rot_0"))
    colors = None
    if is_splat:
        dc = np.stack([rows["f_dc_0"], rows["f_dc_1"], rows["f_dc_2"]], axis=1).astype(np.float32)
        colors = np.clip(0.5 + SH_C0 * dc, 0.0, 1.0)
    elif all(name in names for name in ("red", "green", "blue")):
        raw = np.stack([rows["red"], rows["green"], rows["blue"]], axis=1).astype(np.float32)
        colors = raw / 255.0 if rows["red"].dtype.kind == "u" and rows["red"].dtype.itemsize == 1 else raw
    return positions, colors, {"total": count, "kept": len(positions), "is_splat": is_splat}
