"""GLB surgery for the Magic Brush region edit: swap one material's base colour
pixels and leave every other byte of the model alone.

The region edit promises to repaint part of a surface and nothing else. Loading
the GLB into a mesh library and exporting it again breaks that promise (trimesh
keeps the triangles but drops the skeleton, skin weights and animation clips),
so this module edits the glTF directly:

  - read the JSON and binary chunks,
  - choose the primitive the editor painted on, by the same rule as
    src/editor/magic-brush.js _acquireTarget (has TEXCOORD_0; a base colour
    texture wins; then the most vertices),
  - decode that material's base colour atlas (or build a flat one from its
    colour factor), resize it to region_atlas_size, hand it to `paint`,
  - write the painted pixels back as a PNG, keeping the source alpha channel,
    and touch only the image (or, for an atlas another material also uses, a
    new image and texture for this material alone).

Nodes, meshes, accessors, skins and animations come out identical. Needs only
numpy and Pillow, so test_glb_region.py runs on any machine.
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import struct
from typing import Callable, Optional

import numpy as np
from PIL import Image

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942
MAX_ATLAS = 2048
# Extensions whose data addresses raw byte offsets inside the buffer, so the
# binary chunk must not be repacked when they are present (new bytes are only
# appended).
OFFSET_BOUND_EXTENSIONS = {"EXT_meshopt_compression"}
COMPRESSED_TEXTURE_EXTENSIONS = {"KHR_texture_basisu"}
DECODABLE_SOURCE_EXTENSIONS = ("EXT_texture_webp", "EXT_texture_avif")

PaintFn = Callable[[Image.Image, int], Image.Image]


def region_atlas_size(requested: int, source_size: int) -> int:
    """The atlas a region edit writes. Mirrors expectedAtlasSize (mode
    'region') in api/_lib/texture-result-checks.js, which checks the result:
    the larger of the requested size and the source atlas rounded up to a power
    of two, capped at MAX_ATLAS, so the edit never throws away detail the rest
    of the surface already has."""
    if not source_size:
        return requested
    p = 1
    while p < source_size:
        p *= 2
    return max(requested, min(p, MAX_ATLAS))


def read_glb(data: bytes) -> tuple[dict, bytes]:
    if len(data) < 20 or struct.unpack_from("<I", data, 0)[0] != GLB_MAGIC:
        raise ValueError("the model is not a GLB file")
    _, version, total = struct.unpack_from("<III", data, 0)
    if version != 2:
        raise ValueError(f"GLB version {version} is not supported (need glTF 2.0)")
    off = 12
    gltf: Optional[dict] = None
    binchunk = b""
    end = min(total, len(data))
    while off + 8 <= end:
        length, kind = struct.unpack_from("<II", data, off)
        body = data[off + 8: off + 8 + length]
        if kind == CHUNK_JSON:
            gltf = json.loads(body.decode("utf-8"))
        elif kind == CHUNK_BIN and not binchunk:
            binchunk = bytes(body)
        off += 8 + length
    if gltf is None:
        raise ValueError("the GLB has no JSON chunk")
    return gltf, binchunk


def write_glb(gltf: dict, binchunk: bytes) -> bytes:
    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    binchunk = bytes(binchunk) + b"\0" * ((4 - len(binchunk) % 4) % 4)
    parts = [struct.pack("<II", len(js), CHUNK_JSON), js]
    if binchunk:
        parts += [struct.pack("<II", len(binchunk), CHUNK_BIN), binchunk]
    body = b"".join(parts)
    return struct.pack("<III", GLB_MAGIC, 2, 12 + len(body)) + body


def triangle_count(gltf: dict) -> int:
    accessors = gltf.get("accessors", [])
    total = 0
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            if prim.get("mode", 4) != 4:
                continue
            idx = prim.get("indices")
            src = idx if idx is not None else prim.get("attributes", {}).get("POSITION")
            if src is not None and src < len(accessors):
                total += accessors[src].get("count", 0) // 3
    return total


def _base_texture_ref(gltf: dict, material: Optional[int]) -> Optional[dict]:
    if material is None:
        return None
    mats = gltf.get("materials", [])
    if material >= len(mats):
        return None
    return mats[material].get("pbrMetallicRoughness", {}).get("baseColorTexture")


def pick_target(gltf: dict) -> dict:
    """The primitive the editor paints on, chosen like _acquireTarget in
    src/editor/magic-brush.js. three.js gives each glTF primitive its own
    mesh, walked in scene order, and keeps the first of equal candidates."""
    accessors = gltf.get("accessors", [])
    meshes = gltf.get("meshes", [])
    nodes = gltf.get("nodes", [])
    order: list[int] = []
    seen: set[int] = set()

    def walk(n: int) -> None:
        if n in seen or n >= len(nodes):
            return
        seen.add(n)
        node = nodes[n]
        if "mesh" in node and node["mesh"] not in order:
            order.append(node["mesh"])
        for c in node.get("children", []):
            walk(c)

    scenes = gltf.get("scenes", [])
    scene = scenes[gltf.get("scene", 0)] if scenes else {"nodes": list(range(len(nodes)))}
    for n in scene.get("nodes", []):
        walk(n)

    candidates = []
    for mi in order:
        for pi, prim in enumerate(meshes[mi].get("primitives", [])):
            attrs = prim.get("attributes", {})
            if "TEXCOORD_0" not in attrs:
                continue
            pos = attrs.get("POSITION")
            verts = accessors[pos].get("count", 0) if pos is not None and pos < len(accessors) else 0
            material = prim.get("material")
            has_map = 1 if _base_texture_ref(gltf, material) is not None else 0
            candidates.append((has_map, verts, -len(candidates), {"mesh": mi, "primitive": pi, "material": material}))
    if not candidates:
        raise ValueError(
            "this model has no UV map, so a painted region cannot be placed on it; "
            "run a full retexture first"
        )
    return max(candidates, key=lambda c: c[:3])[3]


def _image_index(gltf: dict, texture: int) -> int:
    tex = gltf.get("textures", [])[texture]
    ext = tex.get("extensions", {})
    if "source" in tex:
        return tex["source"]
    for name in DECODABLE_SOURCE_EXTENSIONS:
        if name in ext:
            return ext[name]["source"]
    if any(name in ext for name in COMPRESSED_TEXTURE_EXTENSIONS):
        raise ValueError(
            "this model's colour texture is GPU-compressed (KTX2), which Magic Brush cannot repaint"
        )
    raise ValueError("the colour texture has no image")


def _image_bytes(gltf: dict, binchunk: bytes, image: int) -> bytes:
    img = gltf["images"][image]
    if "bufferView" in img:
        bv = gltf["bufferViews"][img["bufferView"]]
        if bv.get("buffer", 0) != 0:
            raise ValueError("the colour texture lives in an external buffer")
        off = bv.get("byteOffset", 0)
        return binchunk[off: off + bv["byteLength"]]
    uri = img.get("uri", "")
    if uri.startswith("data:"):
        head, _, payload = uri.partition(",")
        if "ktx2" in head:
            raise ValueError(
                "this model's colour texture is GPU-compressed (KTX2), which Magic Brush cannot repaint"
            )
        try:
            return base64.b64decode(payload) if ";base64" in head else payload.encode()
        except binascii.Error as exc:
            raise ValueError("the colour texture's embedded data is corrupt") from exc
    raise ValueError("the colour texture is an external file, not embedded in the GLB")


def _flat_base(gltf: dict, material: Optional[int], size: int) -> Image.Image:
    factor = [0.7, 0.7, 0.7, 1.0]
    if material is not None and material < len(gltf.get("materials", [])):
        factor = gltf["materials"][material].get("pbrMetallicRoughness", {}).get("baseColorFactor", factor)
    rgb = tuple(int(round(max(0.0, min(1.0, float(c))) * 255)) for c in factor[:3])
    return Image.new("RGB", (size, size), rgb)


def _texture_users(gltf: dict) -> list[tuple[int, str, int]]:
    """Every (material, slot path, texture) reference, including extension slots."""
    out = []

    def walk(obj, path, mi):
        if isinstance(obj, dict):
            for k, v in obj.items():
                p = f"{path}.{k}" if path else k
                if k.endswith("Texture") and isinstance(v, dict) and isinstance(v.get("index"), int):
                    out.append((mi, p, v["index"]))
                walk(v, p, mi)
        elif isinstance(obj, list):
            for v in obj:
                walk(v, path, mi)

    for mi, mat in enumerate(gltf.get("materials", [])):
        walk(mat, "", mi)
    return out


def _repack(gltf: dict, binchunk: bytes, replace: dict[int, bytes]) -> bytes:
    """Rewrite buffer 0 view by view, substituting `replace[view]` bytes and
    dropping gaps. Offsets stay 4-byte aligned, which every accessor
    component type accepts."""
    out = bytearray()
    for i, bv in enumerate(gltf.get("bufferViews", [])):
        if bv.get("buffer", 0) != 0:
            continue
        if i in replace:
            data = replace[i]
        else:
            off = bv.get("byteOffset", 0)
            data = binchunk[off: off + bv["byteLength"]]
        while len(out) % 4:
            out.append(0)
        bv["byteOffset"] = len(out)
        bv["byteLength"] = len(data)
        out.extend(data)
    return bytes(out)


def _encode_png(rgb: Image.Image, alpha: Optional[Image.Image]) -> bytes:
    # A fresh image from the pixel array: no gAMA, iCCP or other tag from the
    # source can come along and make a viewer treat colour data as linear.
    arr = np.asarray(rgb.convert("RGB"), dtype=np.uint8)
    if alpha is not None:
        a = np.asarray(alpha.convert("L"), dtype=np.uint8)[..., None]
        img = Image.fromarray(np.concatenate([arr, a], axis=2), mode="RGBA")
    else:
        img = Image.fromarray(arr, mode="RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG", compress_level=6)
    return buf.getvalue()


def _has_alpha(img: Image.Image) -> bool:
    return img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)


def repaint_base_color(
    glb: bytes,
    texture_size: int,
    paint: PaintFn,
    open_image: Callable[[bytes], Image.Image] = lambda b: Image.open(io.BytesIO(b)),
) -> tuple[bytes, dict]:
    """Repaint the target material's base colour atlas and return
    (new GLB bytes, {"material", "atlas", "source_size"}).

    `paint(base_rgb, work)` receives the RGB atlas at work x work and returns
    the edited RGB atlas at the same size. `open_image` lets the caller apply
    its decode budget (texture_projection.open_bounded_image)."""
    gltf, binchunk = read_glb(glb)
    target = pick_target(gltf)
    material = target["material"]
    ref = _base_texture_ref(gltf, material)
    if ref is not None and ref.get("texCoord", 0) != 0:
        raise ValueError("the colour texture uses a second UV set, which Magic Brush cannot paint on")

    source = None
    image_index = None
    if ref is not None:
        image_index = _image_index(gltf, ref["index"])
        source = open_image(_image_bytes(gltf, binchunk, image_index))
        source.load()

    work = region_atlas_size(texture_size, max(source.size) if source is not None else 0)
    if source is not None:
        base = source.convert("RGB").resize((work, work), Image.LANCZOS)
        alpha = source.convert("RGBA").getchannel("A").resize((work, work), Image.LANCZOS) if _has_alpha(source) else None
    else:
        base = _flat_base(gltf, material, work)
        alpha = None

    painted = paint(base, work)
    if painted.size != (work, work):
        painted = painted.resize((work, work), Image.LANCZOS)
    png = _encode_png(painted, alpha)

    offset_bound = bool(OFFSET_BOUND_EXTENSIONS & set(gltf.get("extensionsUsed", [])))
    views = gltf.setdefault("bufferViews", [])
    images = gltf.setdefault("images", [])
    replace: dict[int, bytes] = {}

    def append_view(data: bytes) -> int:
        nonlocal binchunk
        pad = (4 - len(binchunk) % 4) % 4
        binchunk = binchunk + b"\0" * pad
        views.append({"buffer": 0, "byteOffset": len(binchunk), "byteLength": len(data)})
        binchunk = binchunk + data
        return len(views) - 1

    exclusive = False
    if ref is not None:
        textures_on_image = {
            ti for ti, t in enumerate(gltf.get("textures", []))
            if ti == ref["index"] or t.get("source") == image_index
            or any(e.get("source") == image_index for e in t.get("extensions", {}).values() if isinstance(e, dict))
        }
        users = [(mi, p) for mi, p, ti in _texture_users(gltf) if ti in textures_on_image]
        exclusive = all(u == (material, "pbrMetallicRoughness.baseColorTexture") for u in users)

    if ref is not None and exclusive:
        img = images[image_index]
        if "bufferView" in img and not offset_bound:
            replace[img["bufferView"]] = png
        else:
            img.pop("uri", None)
            img["bufferView"] = append_view(png)
        img["mimeType"] = "image/png"
        tex = gltf["textures"][ref["index"]]
        tex["source"] = image_index
        for name in DECODABLE_SOURCE_EXTENSIONS:
            tex.get("extensions", {}).pop(name, None)
        if "extensions" in tex and not tex["extensions"]:
            del tex["extensions"]
    else:
        images.append({"bufferView": append_view(png), "mimeType": "image/png"})
        new_tex: dict = {"source": len(images) - 1}
        if ref is not None and "sampler" in gltf["textures"][ref["index"]]:
            new_tex["sampler"] = gltf["textures"][ref["index"]]["sampler"]
        gltf.setdefault("textures", []).append(new_tex)
        tex_index = len(gltf["textures"]) - 1
        if material is None:
            gltf.setdefault("materials", []).append({"pbrMetallicRoughness": {}})
            material = len(gltf["materials"]) - 1
            gltf["meshes"][target["mesh"]]["primitives"][target["primitive"]]["material"] = material
        pbr = gltf["materials"][material].setdefault("pbrMetallicRoughness", {})
        if ref is None:
            # The flat base already holds the factor's colour; keep only its
            # alpha so the new texture is not tinted a second time.
            a = pbr.get("baseColorFactor", [1.0, 1.0, 1.0, 1.0])
            pbr["baseColorFactor"] = [1.0, 1.0, 1.0, float(a[3]) if len(a) > 3 else 1.0]
            pbr["baseColorTexture"] = {"index": tex_index}
        else:
            pbr["baseColorTexture"] = {**ref, "index": tex_index}

    if replace:
        binchunk = _repack(gltf, binchunk, replace)
    if gltf.get("buffers"):
        gltf["buffers"][0]["byteLength"] = len(binchunk)
    else:
        gltf["buffers"] = [{"byteLength": len(binchunk)}]
    return write_glb(gltf, binchunk), {
        "material": material,
        "atlas": work,
        "source_size": max(source.size) if source is not None else 0,
    }
