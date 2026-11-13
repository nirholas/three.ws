"""
GLB texture extraction and in-place replacement using pygltflib.

Strategy: images embedded in the binary blob are extracted cleanly; when
replacing we write new JPEG bytes back into the blob and patch every
affected bufferView byte-offset so the file stays structurally valid.
"""

from __future__ import annotations

import base64
import io
import struct
from typing import Optional

import numpy as np
from PIL import Image
import pygltflib


# ── helpers ───────────────────────────────────────────────────────────────────

def load_glb(data: bytes) -> pygltflib.GLTF2:
    return pygltflib.GLTF2().load_from_bytes(data)


def save_glb(glb: pygltflib.GLTF2) -> bytes:
    return b"".join(glb.save_to_bytes())


def _extract_image_bytes(glb: pygltflib.GLTF2, image_idx: int) -> bytes:
    img_obj = glb.images[image_idx]
    if img_obj.uri and img_obj.uri.startswith("data:"):
        _, b64 = img_obj.uri.split(",", 1)
        return base64.b64decode(b64)
    if img_obj.bufferView is not None:
        bv = glb.bufferViews[img_obj.bufferView]
        blob = glb.binary_blob()
        return bytes(blob[bv.byteOffset : bv.byteOffset + bv.byteLength])
    raise ValueError(f"cannot extract image {image_idx}: no uri and no bufferView")


def _replace_image_bytes_in_blob(
    glb: pygltflib.GLTF2, image_idx: int, new_bytes: bytes
) -> None:
    """
    Patch the binary blob in-place: replace the old image bytes with new ones,
    then fix all bufferView byte-offsets that sit after the patched region.
    Pads to 4-byte alignment as required by the glTF spec.
    """
    img_obj = glb.images[image_idx]

    if img_obj.bufferView is None:
        # Image was a data URI — convert to embedded.
        # Append to end of binary blob instead.
        old_blob = bytearray(glb.binary_blob() or b"")
        offset = len(old_blob)
        padded = bytearray(new_bytes)
        while len(padded) % 4:
            padded.append(0)
        old_blob.extend(padded)
        glb.set_binary_blob(bytes(old_blob))

        # Create a new bufferView for this image.
        bv = pygltflib.BufferView(
            buffer=0,
            byteOffset=offset,
            byteLength=len(new_bytes),
            target=None,
        )
        bv_idx = len(glb.bufferViews)
        glb.bufferViews.append(bv)
        img_obj.bufferView = bv_idx
        img_obj.uri = None
        if glb.buffers:
            glb.buffers[0].byteLength = len(old_blob)
        return

    bv_idx = img_obj.bufferView
    bv = glb.bufferViews[bv_idx]
    old_blob = bytearray(glb.binary_blob())
    offset = bv.byteOffset
    old_len = bv.byteLength

    # Compute padded lengths (4-byte alignment).
    old_padded = (old_len + 3) & ~3
    new_padded = (len(new_bytes) + 3) & ~3
    delta = new_padded - old_padded

    # Build new blob.
    padding = bytes(new_padded - len(new_bytes))
    new_blob = (
        bytes(old_blob[:offset])
        + new_bytes
        + padding
        + bytes(old_blob[offset + old_padded :])
    )
    glb.set_binary_blob(new_blob)

    # Update this bufferView.
    bv.byteLength = len(new_bytes)

    # Shift all bufferViews that start after the patched region.
    for other in glb.bufferViews:
        if other.byteOffset > offset:
            other.byteOffset += delta

    # Update buffer total length.
    if glb.buffers:
        glb.buffers[bv.buffer].byteLength += delta


# ── public API ────────────────────────────────────────────────────────────────

def find_material_image_idx(glb: pygltflib.GLTF2, material_name: str) -> Optional[int]:
    """Return the base-colour texture image index for a named material, or None."""
    mat = next((m for m in glb.materials if m.name == material_name), None)
    if mat is None:
        return None
    pbr = mat.pbrMetallicRoughness
    if pbr is None or pbr.baseColorTexture is None:
        return None
    tex = glb.textures[pbr.baseColorTexture.index]
    return tex.source


def get_material_texture(glb: pygltflib.GLTF2, material_name: str) -> Optional[Image.Image]:
    """Return the base-colour texture of a material as a PIL RGBA Image."""
    idx = find_material_image_idx(glb, material_name)
    if idx is None:
        return None
    data = _extract_image_bytes(glb, idx)
    return Image.open(io.BytesIO(data)).convert("RGBA")


def set_material_texture(
    glb: pygltflib.GLTF2,
    material_name: str,
    new_image: Image.Image,
    quality: int = 92,
) -> bool:
    """
    Replace the base-colour texture of a named material.
    Returns True on success, False if the material was not found.
    """
    idx = find_material_image_idx(glb, material_name)
    if idx is None:
        return False
    buf = io.BytesIO()
    new_image.convert("RGB").save(buf, format="JPEG", quality=quality)
    _replace_image_bytes_in_blob(glb, idx, buf.getvalue())
    return True


def get_material_base_color(glb: pygltflib.GLTF2, material_name: str) -> Optional[list]:
    """Return the baseColorFactor [r,g,b,a] of a named material, or None."""
    mat = next((m for m in glb.materials if m.name == material_name), None)
    if mat is None:
        return None
    pbr = mat.pbrMetallicRoughness
    if pbr is None:
        return None
    return pbr.baseColorFactor


def set_material_base_color(
    glb: pygltflib.GLTF2, material_name: str, rgba: list[float]
) -> bool:
    """Set the baseColorFactor of a named material. rgba values in [0,1]."""
    mat = next((m for m in glb.materials if m.name == material_name), None)
    if mat is None:
        return False
    if mat.pbrMetallicRoughness is None:
        mat.pbrMetallicRoughness = pygltflib.PbrMetallicRoughness()
    mat.pbrMetallicRoughness.baseColorFactor = list(rgba)
    return True


# ── geometry (stride-aware) ─────────────────────────────────────────────────────
#
# The Wolf3D_Head buffer is INTERLEAVED: POSITION / NORMAL / TEXCOORD_0 /
# JOINTS_0 / WEIGHTS_0 share one bufferView with a 52-byte stride, so each
# attribute's values sit every 52 bytes, not contiguously. A stride-unaware read
# (the previous implementation) returns jumbled bytes — POSITION[1] would land on
# NORMAL[0], etc. Every accessor read/write below honours bufferView.byteStride.

_COMPONENT_DTYPE = {
    5120: np.int8, 5121: np.uint8, 5122: np.int16,
    5123: np.uint16, 5125: np.uint32, 5126: np.float32,
}
_TYPE_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


def _read_view(blob: bytes, bv, byte_offset: int, count: int, dtype: np.dtype, ncomp: int) -> np.ndarray:
    item = dtype.itemsize * ncomp
    stride = bv.byteStride or item
    base = (bv.byteOffset or 0) + byte_offset
    if stride == item:
        # Tightly packed: a single vectorised read is correct and fast.
        flat = np.frombuffer(blob[base : base + count * item], dtype=dtype)
        return flat.reshape(count, ncomp)
    # Interleaved: gather one element at a time honouring the stride.
    out = np.empty((count, ncomp), dtype=dtype)
    for i in range(count):
        off = base + i * stride
        out[i] = np.frombuffer(blob[off : off + item], dtype=dtype)
    return out


def _read_accessor(glb: pygltflib.GLTF2, blob: bytes, acc_idx: int) -> np.ndarray:
    """
    Stride-aware read of accessor acc_idx into an (count, ncomp) array.

    Handles sparse accessors (glTF 2.0 section 3.6.2.3): a base view, or zeros
    when there is none, with the listed elements substituted. Morph targets that
    touch a small region (an ARKit shape, a nose slider) are stored that way.
    """
    acc = glb.accessors[acc_idx]
    dtype = np.dtype(_COMPONENT_DTYPE[acc.componentType])
    ncomp = _TYPE_NCOMP[acc.type]
    if acc.bufferView is not None:
        out = _read_view(blob, glb.bufferViews[acc.bufferView], acc.byteOffset or 0, acc.count, dtype, ncomp)
    else:
        out = np.zeros((acc.count, ncomp), dtype=dtype)
    sparse = acc.sparse
    if sparse is not None and sparse.count:
        out = np.array(out, copy=True)
        idx_view = glb.bufferViews[sparse.indices.bufferView]
        idx = _read_view(blob, idx_view, sparse.indices.byteOffset or 0, sparse.count,
                         np.dtype(_COMPONENT_DTYPE[sparse.indices.componentType]), 1).reshape(-1)
        val_view = glb.bufferViews[sparse.values.bufferView]
        out[idx.astype(np.int64)] = _read_view(blob, val_view, sparse.values.byteOffset or 0,
                                               sparse.count, dtype, ncomp)
    return out if ncomp > 1 else out.reshape(-1)


def _write_accessor(glb: pygltflib.GLTF2, blob: bytearray, acc_idx: int, data: np.ndarray) -> None:
    """
    Stride-aware in-place overwrite of accessor acc_idx. `data` must have the same
    count and component layout; only the value bytes are replaced, so an
    interleaved buffer's other attributes (normals, joints, weights) are
    untouched. Caller is responsible for updating accessor.min/max when relevant.
    """
    acc = glb.accessors[acc_idx]
    bv = glb.bufferViews[acc.bufferView]
    dtype = np.dtype(_COMPONENT_DTYPE[acc.componentType])
    ncomp = _TYPE_NCOMP[acc.type]
    item = dtype.itemsize * ncomp
    stride = bv.byteStride or item
    base = (bv.byteOffset or 0) + (acc.byteOffset or 0)
    d = np.ascontiguousarray(data.reshape(acc.count, ncomp), dtype=dtype)
    if stride == item:
        blob[base : base + acc.count * item] = d.tobytes()
    else:
        for i in range(acc.count):
            off = base + i * stride
            blob[off : off + item] = d[i].tobytes()


def template_info(glb: pygltflib.GLTF2) -> dict:
    """
    The `reconstruction` block a self-describing template carries in its root
    extras (head mesh, materials, face anchors, body-type presets), written by
    scripts/build-reconstruction-template.mjs. Empty for templates without one.
    """
    extras = glb.extras if isinstance(glb.extras, dict) else {}
    info = extras.get("reconstruction")
    return info if isinstance(info, dict) else {}


def head_mesh_name(glb: pygltflib.GLTF2) -> str:
    """The head mesh a template declares, else the Wolf3D head's name."""
    import recon_templates

    return template_info(glb).get("headMesh") or recon_templates.WOLF3D.head_mesh


def _find_head_prim(glb: pygltflib.GLTF2, head_mesh: Optional[str] = None):
    name = head_mesh or head_mesh_name(glb)
    mesh = next((m for m in glb.meshes if m.name == name), None)
    if mesh is None:
        raise ValueError(f"{name} mesh not found in GLB")
    return mesh.primitives[0]


def get_head_mesh_data(
    glb: pygltflib.GLTF2, head_mesh: Optional[str] = None
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Return (positions, uvs, face_indices) for the template's head mesh (the
    one its extras declare, or the Wolf3D head).
    positions: (N, 3) float32
    uvs:       (N, 2) float32  — TEXCOORD_0
    faces:     (F, 3) int32
    """
    prim = _find_head_prim(glb, head_mesh)
    blob = glb.binary_blob()
    positions = _read_accessor(glb, blob, prim.attributes.POSITION).astype(np.float32)
    uvs = _read_accessor(glb, blob, prim.attributes.TEXCOORD_0).astype(np.float32)
    faces = _read_accessor(glb, blob, prim.indices).reshape(-1, 3).astype(np.int32)
    return positions, uvs, faces


def recompute_vertex_normals(positions: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """Area-weighted vertex normals for a triangle mesh — (N, 3) float32, unit length."""
    normals = np.zeros_like(positions, dtype=np.float32)
    v0, v1, v2 = positions[faces[:, 0]], positions[faces[:, 1]], positions[faces[:, 2]]
    face_normals = np.cross(v1 - v0, v2 - v0)  # magnitude ∝ triangle area
    for k in range(3):
        np.add.at(normals, faces[:, k], face_normals)
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    lengths[lengths == 0] = 1.0
    return (normals / lengths).astype(np.float32)


def _position_keys(positions: np.ndarray) -> np.ndarray:
    """Quantise positions to 10 µm so coincident vertices across meshes match."""
    return np.round(np.asarray(positions, dtype=np.float64) * 1e5).astype(np.int64)


def welded_vertex_normals(meshes: list[tuple[np.ndarray, np.ndarray]]) -> list[np.ndarray]:
    """
    Area-weighted normals accumulated per POSITION, not per vertex index, over
    several triangle meshes at once: [(positions, faces), ...] → [normals, ...].

    A mesh split for material or editing reasons (UV seams, the parametric
    template's Head / Body split at the neck) duplicates vertices along the
    split. Per-index normals shade each copy from one side only and draw the
    split as a visible crease; welding by position shades it as one surface.
    """
    keys = np.concatenate([_position_keys(p) for p, _ in meshes])
    _, group = np.unique(keys, axis=0, return_inverse=True)
    group = group.reshape(-1)
    acc = np.zeros((int(group.max()) + 1, 3), dtype=np.float64)
    offset = 0
    for positions, faces in meshes:
        pos = np.asarray(positions, dtype=np.float64)
        f = np.asarray(faces, dtype=np.int64)
        fn = np.cross(pos[f[:, 1]] - pos[f[:, 0]], pos[f[:, 2]] - pos[f[:, 0]])
        for k in range(3):
            np.add.at(acc, group[offset + f[:, k]], fn)
        offset += pos.shape[0]
    lengths = np.linalg.norm(acc, axis=1, keepdims=True)
    lengths[lengths == 0] = 1.0
    acc /= lengths
    out, offset = [], 0
    for positions, _ in meshes:
        n = positions.shape[0]
        out.append(acc[group[offset : offset + n]].astype(np.float32))
        offset += n
    return out


def _mesh_prim(glb: pygltflib.GLTF2, name: str):
    mesh = next((m for m in glb.meshes if m.name == name), None)
    return mesh.primitives[0] if mesh is not None else None


def _prim_geometry(glb, blob, prim) -> tuple[np.ndarray, np.ndarray]:
    pos = _read_accessor(glb, blob, prim.attributes.POSITION).astype(np.float64)
    faces = _read_accessor(glb, blob, prim.indices).reshape(-1, 3).astype(np.int64)
    return pos, faces


def set_head_geometry(
    glb: pygltflib.GLTF2,
    positions: np.ndarray,
    faces: np.ndarray | None = None,
    recompute_normals: bool = True,
) -> None:
    """
    Overwrite the head mesh's base geometry with morphed `positions` (N, 3).

    Vertex count and order are unchanged, so JOINTS_0/WEIGHTS_0 skinning and all
    morph targets (the 52 ARKit blendshapes + visemes, stored as deltas relative
    to the base) remain valid and attached. Updates the POSITION accessor min/max
    and, unless disabled, recomputes and writes vertex normals. In-place on the
    binary blob — no bufferView offsets shift because the byte size is identical.

    When the template declares other meshes sharing the head's skin surface
    (`skinMeshes`, the parametric Body below the neck split), the head's seam
    with them stays exactly where it was: seam vertices keep their position and
    normal, and the rest of the head is shaded welded across UV seams. A face
    morph or dense fit therefore can never open a crack at the neck.
    """
    prim = _find_head_prim(glb)
    pos = np.ascontiguousarray(positions, dtype=np.float32)
    acc = glb.accessors[prim.attributes.POSITION]
    if pos.shape[0] != acc.count:
        raise ValueError(
            f"position count {pos.shape[0]} != head vertex count {acc.count}; "
            "fixed-topology morph requires an unchanged vertex count"
        )

    blob = bytearray(glb.binary_blob())
    info = template_info(glb)
    head_name = head_mesh_name(glb)
    others = [m for m in info.get("skinMeshes", []) if m != head_name]
    seam = None
    if others:
        old = _read_accessor(glb, blob, prim.attributes.POSITION).astype(np.float32)
        other_keys = set()
        for name in others:
            other = _mesh_prim(glb, name)
            if other is not None:
                other_pos = _read_accessor(glb, blob, other.attributes.POSITION)
                other_keys.update(map(tuple, _position_keys(other_pos)))
        seam = np.fromiter((tuple(k) in other_keys for k in _position_keys(old)), dtype=bool,
                           count=old.shape[0])
        pos = pos.copy()
        pos[seam] = old[seam]

    _write_accessor(glb, blob, prim.attributes.POSITION, pos)
    acc.min = pos.min(axis=0).tolist()
    acc.max = pos.max(axis=0).tolist()

    if recompute_normals and prim.attributes.NORMAL is not None:
        if faces is None:
            faces = _read_accessor(glb, blob, prim.indices).reshape(-1, 3).astype(np.int64)
        if seam is None:
            normals = recompute_vertex_normals(pos, faces.astype(np.int64))
        else:
            normals = welded_vertex_normals([(pos, faces.astype(np.int64))])[0]
            normals[seam] = _read_accessor(glb, blob, prim.attributes.NORMAL)[seam]
        _write_accessor(glb, blob, prim.attributes.NORMAL, normals)

    glb.set_binary_blob(bytes(blob))


def bake_body_type(glb: pygltflib.GLTF2, body_type: str) -> bool:
    """
    Bake a body-type preset the template declares into its rest pose.

    The preset (root extras `reconstruction.bodyTypes[body_type]`) is a set of
    slider weights over the template's own morph targets, the skeleton's world
    joint positions re-solved for that shape, and the floor offset that keeps
    the feet on the ground. Baking adds the weighted target deltas plus the
    offset to every mesh's POSITION, re-welds normals across the shared skin,
    moves each joint and rewrites the inverse bind matrices. Every morph target
    stays in the file, so sliders keep working from the new rest shape.

    Returns False (and changes nothing) when the template has no such preset.
    """
    info = template_info(glb)
    preset = (info.get("bodyTypes") or {}).get(body_type)
    if not preset:
        return False
    weights = {k: float(v) for k, v in (preset.get("morphs") or {}).items() if v}
    offset_y = float(preset.get("offsetY") or 0.0)
    joints_world = preset.get("joints") or []
    joint_names = info.get("skinJoints") or []

    blob = bytearray(glb.binary_blob())
    baked: dict[str, tuple[object, np.ndarray, np.ndarray]] = {}
    for mesh in glb.meshes:
        names = list((mesh.extras or {}).get("targetNames") or [])
        for prim in mesh.primitives:
            pos, faces = _prim_geometry(glb, blob, prim)
            for name, w in weights.items():
                if name in names and prim.targets and names.index(name) < len(prim.targets):
                    target = prim.targets[names.index(name)]
                    t_idx = target.get("POSITION") if isinstance(target, dict) else getattr(target, "POSITION", None)
                    if t_idx is not None:
                        pos += w * _read_accessor(glb, blob, t_idx).astype(np.float64)
            pos[:, 1] += offset_y
            pos32 = pos.astype(np.float32)
            _write_accessor(glb, blob, prim.attributes.POSITION, pos32)
            acc = glb.accessors[prim.attributes.POSITION]
            acc.min = pos32.min(axis=0).tolist()
            acc.max = pos32.max(axis=0).tolist()
            baked[mesh.name] = (prim, pos32, faces)

    skin_meshes = [m for m in info.get("skinMeshes", []) if m in baked]
    welded = welded_vertex_normals([(baked[m][1], baked[m][2]) for m in skin_meshes])
    for name, normals in zip(skin_meshes, welded):
        prim = baked[name][0]
        if prim.attributes.NORMAL is not None:
            _write_accessor(glb, blob, prim.attributes.NORMAL, normals)
    for name, (prim, pos32, faces) in baked.items():
        if name not in skin_meshes and prim.attributes.NORMAL is not None:
            _write_accessor(glb, blob, prim.attributes.NORMAL, welded_vertex_normals([(pos32, faces)])[0])

    if glb.skins and joints_world:
        skin = glb.skins[0]
        world_by_name = dict(zip(joint_names, joints_world))
        parent_of = {c: i for i, node in enumerate(glb.nodes) for c in (node.children or [])}
        world = {}
        for j in skin.joints:
            w = world_by_name.get(glb.nodes[j].name)
            if w is None:
                raise ValueError(f"body type {body_type!r} has no joint position for {glb.nodes[j].name}")
            world[j] = np.asarray(w, dtype=np.float64)
        for j in skin.joints:
            parent = parent_of.get(j)
            local = world[j] - world[parent] if parent in world else world[j]
            glb.nodes[j].translation = [float(x) for x in local]
        ibm = np.tile(np.eye(4, dtype=np.float32), (len(skin.joints), 1, 1))
        for k, j in enumerate(skin.joints):
            ibm[k, 3, :3] = -world[j]  # column-major: translation in the 4th column
        _write_accessor(glb, blob, skin.inverseBindMatrices, ibm.reshape(len(skin.joints), 16))

    glb.set_binary_blob(bytes(blob))
    return True
