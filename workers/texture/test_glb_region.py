"""Tests for glb_region.py, the Magic Brush region edit's GLB surgery.

A region edit must hand back the model the user had with only the base colour
pixels of one material changed: the same nodes, meshes, UVs, skeleton, skin
weights and animation clips, byte for byte. The previous path round-tripped
the GLB through trimesh, which keeps geometry but drops skins and clips, and
could write a non-power-of-two atlas and lose the alpha channel.

CPU only (numpy + Pillow); the diffusion step is the `paint` callback, which
these tests supply. Run as a Docker build gate beside the other suites:

    python3 test_glb_region.py
"""

from __future__ import annotations

import base64
import io
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import glb_region  # noqa: E402

PASS = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASS
    if not condition:
        print(f"FAIL  {name}  {detail}")
        sys.exit(1)
    PASS += 1
    print(f"ok    {name}")


def raises(fn, needle: str) -> bool:
    try:
        fn()
    except ValueError as exc:
        return needle.lower() in str(exc).lower()
    return False


def png_bytes(size, rgba) -> bytes:
    w, h = (size, size) if isinstance(size, int) else size
    mode = "RGBA" if len(rgba) == 4 else "RGB"
    img = Image.new(mode, (w, h), tuple(rgba))
    if mode == "RGBA":
        # A real cutout: the left half transparent, the right half opaque.
        a = np.full((h, w), 255, dtype=np.uint8)
        a[:, : w // 2] = 0
        img.putalpha(Image.fromarray(a, mode="L"))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class Builder:
    """Writes a minimal but real glTF 2.0 binary."""

    def __init__(self):
        self.bin = bytearray()
        self.gltf = {
            "asset": {"version": "2.0"},
            "scene": 0,
            "scenes": [{"nodes": []}],
            "nodes": [],
            "meshes": [],
            "materials": [],
            "accessors": [],
            "bufferViews": [],
            "buffers": [{"byteLength": 0}],
        }

    def view(self, data: bytes) -> int:
        while len(self.bin) % 4:
            self.bin.append(0)
        self.gltf["bufferViews"].append(
            {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        )
        self.bin.extend(data)
        return len(self.gltf["bufferViews"]) - 1

    def accessor(self, arr: np.ndarray, kind: str, comp: int) -> int:
        count = arr.shape[0]
        acc = {"bufferView": self.view(arr.tobytes()), "componentType": comp, "count": count, "type": kind}
        if kind == "VEC3" and comp == 5126:
            acc["min"] = arr.min(axis=0).tolist()
            acc["max"] = arr.max(axis=0).tolist()
        self.gltf["accessors"].append(acc)
        return len(self.gltf["accessors"]) - 1

    def image(self, data: bytes, as_data_uri: bool = False) -> int:
        imgs = self.gltf.setdefault("images", [])
        if as_data_uri:
            imgs.append({"uri": "data:image/png;base64," + base64.b64encode(data).decode()})
        else:
            imgs.append({"bufferView": self.view(data), "mimeType": "image/png"})
        return len(imgs) - 1

    def texture(self, image: int) -> int:
        self.gltf.setdefault("samplers", [{"magFilter": 9729, "minFilter": 9987}])
        texs = self.gltf.setdefault("textures", [])
        texs.append({"source": image, "sampler": 0})
        return len(texs) - 1

    def material(self, name: str, texture=None, factor=None) -> int:
        pbr = {"metallicFactor": 0.0, "roughnessFactor": 0.7}
        if texture is not None:
            pbr["baseColorTexture"] = {"index": texture}
        if factor is not None:
            pbr["baseColorFactor"] = factor
        self.gltf["materials"].append({"name": name, "pbrMetallicRoughness": pbr})
        return len(self.gltf["materials"]) - 1

    def quad(self, material: int, *, uv: bool = True, verts: int = 4, rigged: bool = False) -> int:
        n = verts
        pos = np.array([[i % 2, i // 2, 0] for i in range(n)], dtype=np.float32)
        attrs = {"POSITION": self.accessor(pos, "VEC3", 5126)}
        if uv:
            attrs["TEXCOORD_0"] = self.accessor(pos[:, :2].copy(), "VEC2", 5126)
        if rigged:
            attrs["JOINTS_0"] = self.accessor(np.zeros((n, 4), dtype=np.uint16), "VEC4", 5123)
            w = np.zeros((n, 4), dtype=np.float32)
            w[:, 0] = 1
            attrs["WEIGHTS_0"] = self.accessor(w, "VEC4", 5126)
        idx = np.array([0, 1, 2, 1, 3, 2], dtype=np.uint16)
        prim = {"attributes": attrs, "indices": self.accessor(idx, "SCALAR", 5123), "material": material}
        self.gltf["meshes"].append({"primitives": [prim]})
        mesh = len(self.gltf["meshes"]) - 1
        self.gltf["nodes"].append({"mesh": mesh, "name": f"mesh{mesh}"})
        node = len(self.gltf["nodes"]) - 1
        self.gltf["scenes"][0]["nodes"].append(node)
        if rigged:
            self.gltf["nodes"].append({"name": "hips", "translation": [0, 1, 0]})
            hips = len(self.gltf["nodes"]) - 1
            self.gltf["scenes"][0]["nodes"].append(hips)
            ibm = self.accessor(np.eye(4, dtype=np.float32).reshape(1, 16), "MAT4", 5126)
            self.gltf.setdefault("skins", []).append({"joints": [hips], "inverseBindMatrices": ibm})
            self.gltf["nodes"][node]["skin"] = len(self.gltf["skins"]) - 1
            t = self.accessor(np.array([0, 1], dtype=np.float32), "SCALAR", 5126)
            v = self.accessor(np.array([[0, 1, 0], [0, 1.2, 0]], dtype=np.float32), "VEC3", 5126)
            self.gltf.setdefault("animations", []).append({
                "name": "idle",
                "samplers": [{"input": t, "output": v}],
                "channels": [{"sampler": 0, "target": {"node": hips, "path": "translation"}}],
            })
        return mesh

    def glb(self) -> bytes:
        while len(self.bin) % 4:
            self.bin.append(0)
        self.gltf["buffers"][0]["byteLength"] = len(self.bin)
        js = json.dumps(self.gltf).encode()
        js += b" " * ((4 - len(js) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        return (
            struct.pack("<III", 0x46546C67, 2, total)
            + struct.pack("<II", len(js), 0x4E4F534A) + js
            + struct.pack("<II", len(self.bin), 0x004E4942) + bytes(self.bin)
        )


def red_paint(base: Image.Image, work: int) -> Image.Image:
    """Stands in for SDXL: paints the whole region pure red at the work size."""
    assert base.mode == "RGB" and base.size == (work, work), (base.mode, base.size, work)
    return Image.new("RGB", (work, work), (255, 0, 0))


def accessor_bytes(gltf: dict, binchunk: bytes, i: int) -> bytes:
    acc = gltf["accessors"][i]
    bv = gltf["bufferViews"][acc["bufferView"]]
    off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    return binchunk[off: off + bv["byteLength"] - acc.get("byteOffset", 0)]


def base_image(gltf: dict, binchunk: bytes, material: int) -> Image.Image:
    tex = gltf["materials"][material]["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    img = gltf["images"][gltf["textures"][tex]["source"]]
    bv = gltf["bufferViews"][img["bufferView"]]
    off = bv.get("byteOffset", 0)
    return Image.open(io.BytesIO(binchunk[off: off + bv["byteLength"]]))


def strip_images(gltf: dict) -> dict:
    out = json.loads(json.dumps(gltf))
    for k in ("images", "textures", "samplers", "bufferViews", "buffers", "materials"):
        out.pop(k, None)
    return out


# ── region_atlas_size mirrors api/_lib/texture-result-checks.js ───────────────
check("atlas: requested when source smaller", glb_region.region_atlas_size(1024, 700) == 1024)
check("atlas: keeps a larger pow2 source", glb_region.region_atlas_size(1024, 2048) == 2048)
check("atlas: rounds non-pow2 up", glb_region.region_atlas_size(512, 1500) == 2048)
check("atlas: caps at 2048", glb_region.region_atlas_size(1024, 8192) == 2048)
check("atlas: untextured uses requested", glb_region.region_atlas_size(512, 0) == 512)

# ── target choice mirrors src/editor/magic-brush.js _acquireTarget ────────────
b = Builder()
plain = b.material("plain", factor=[0.2, 0.3, 0.4, 1.0])
b.quad(plain, verts=8)                              # biggest, but untextured
skin_tex = b.texture(b.image(png_bytes(512, (90, 90, 90))))
skinned = b.material("skin", texture=skin_tex)
b.quad(skinned, verts=4)
b.quad(b.material("nouv", texture=b.texture(b.image(png_bytes(64, (1, 1, 1))))), uv=False, verts=12)
gltf, _ = glb_region.read_glb(b.glb())
check("target: a textured primitive wins over a larger untextured one",
      glb_region.pick_target(gltf)["material"] == skinned)

b2 = Builder()
b2.quad(b2.material("a", factor=[1, 1, 1, 1]), verts=4)
big = b2.material("b", factor=[1, 0, 0, 1])
b2.quad(big, verts=6)
gltf2, _ = glb_region.read_glb(b2.glb())
check("target: among untextured, the most vertices wins", glb_region.pick_target(gltf2)["material"] == big)

b3 = Builder()
b3.quad(b3.material("nouv", factor=[1, 1, 1, 1]), uv=False)
check("no UVs: refused with a reason, never unwrapped",
      raises(lambda: glb_region.repaint_base_color(b3.glb(), 1024, red_paint), "uv"))

# ── a rigged, animated model keeps everything but the pixels ──────────────────
rb = Builder()
body_tex = rb.texture(rb.image(png_bytes(1024, (120, 120, 120))))
body = rb.material("body", texture=body_tex)
rb.quad(body, rigged=True)
eye_tex = rb.texture(rb.image(png_bytes(256, (0, 0, 255))))
eye = rb.material("eye", texture=eye_tex)
rb.quad(eye, verts=4)
src_glb = rb.glb()
src_gltf, src_bin = glb_region.read_glb(src_glb)
out_glb, info = glb_region.repaint_base_color(src_glb, 1024, red_paint)
out_gltf, out_bin = glb_region.read_glb(out_glb)

check("rig: target is the rigged textured body", info["material"] == body)
check("rig: nodes, meshes, skins, animations, scenes identical",
      strip_images(out_gltf) == strip_images(src_gltf))
check("rig: every accessor (positions, UVs, joints, weights, clip keys) byte-identical",
      all(accessor_bytes(src_gltf, src_bin, i) == accessor_bytes(out_gltf, out_bin, i)
          for i in range(len(src_gltf["accessors"]))))
painted = base_image(out_gltf, out_bin, body)
check("rig: body atlas repainted at 1024 pow2", painted.size == (1024, 1024)
      and painted.convert("RGB").getpixel((10, 10)) == (255, 0, 0), str(painted.size))
check("rig: no gAMA/ICC tagging on the new atlas (stays sRGB colour data)",
      "gamma" not in painted.info and "icc_profile" not in painted.info, str(painted.info))
check("rig: the other material's atlas is untouched",
      base_image(out_gltf, out_bin, eye).convert("RGB").getpixel((0, 0)) == (0, 0, 255))
check("rig: output is a valid GLB whose buffer length matches", out_gltf["buffers"][0]["byteLength"] == len(out_bin))
check("rig: image replaced in place, no orphaned image bytes",
      len(out_gltf["images"]) == len(src_gltf["images"])
      and len(out_bin) < len(src_bin) + 64 * 1024)

# ── size: a non-pow2 source becomes the pow2 size the API expects ─────────────
nb = Builder()
nb.quad(nb.material("m", texture=nb.texture(nb.image(png_bytes((1500, 1500), (5, 5, 5))))))
out, info = glb_region.repaint_base_color(nb.glb(), 1024, red_paint)
g, bn = glb_region.read_glb(out)
check("size: 1500 source with 1024 requested writes 2048", base_image(g, bn, 0).size == (2048, 2048)
      and info["atlas"] == 2048)

# ── alpha: a cutout keeps its transparency ────────────────────────────────────
ab = Builder()
ab.quad(ab.material("hair", texture=ab.texture(ab.image(png_bytes(512, (50, 40, 30, 255))))))
out, _ = glb_region.repaint_base_color(ab.glb(), 512, red_paint)
g, bn = glb_region.read_glb(out)
img = base_image(g, bn, 0)
check("alpha: result keeps an alpha channel", img.mode == "RGBA", img.mode)
check("alpha: transparent texels stay transparent, opaque stay opaque",
      img.getpixel((10, 10))[3] == 0 and img.getpixel((500, 10))[3] == 255)

# ── a shared atlas: only the target material changes ──────────────────────────
sb = Builder()
shared = sb.texture(sb.image(png_bytes(512, (7, 7, 7))))
m_big = sb.material("big", texture=shared)
sb.quad(m_big, verts=8)
m_small = sb.material("small", texture=shared)
sb.quad(m_small, verts=4)
out, info = glb_region.repaint_base_color(sb.glb(), 512, red_paint)
g, bn = glb_region.read_glb(out)
check("shared: target is the larger primitive's material", info["material"] == m_big)
check("shared: target repainted", base_image(g, bn, m_big).convert("RGB").getpixel((1, 1)) == (255, 0, 0))
check("shared: the other user of the atlas keeps the original",
      base_image(g, bn, m_small).convert("RGB").getpixel((1, 1)) == (7, 7, 7))

# ── untextured target: a flat base from its factor, factor reset to white ─────
ub = Builder()
ub.quad(ub.material("flat", factor=[1.0, 0.5, 0.0, 0.8]))
seen = {}


def record_paint(base, work):
    seen["px"] = base.getpixel((0, 0))
    return red_paint(base, work)


out, info = glb_region.repaint_base_color(ub.glb(), 512, record_paint)
g, bn = glb_region.read_glb(out)
pbr = g["materials"][0]["pbrMetallicRoughness"]
check("flat: the paint sees the factor colour as its base", seen["px"] == (255, 128, 0), str(seen))
check("flat: a 512 atlas is added", base_image(g, bn, 0).size == (512, 512))
check("flat: colour factor reset so the texture is not tinted twice, alpha kept",
      pbr["baseColorFactor"] == [1.0, 1.0, 1.0, 0.8], str(pbr))

# ── a data-URI atlas is moved into the binary chunk ───────────────────────────
db = Builder()
db.quad(db.material("d", texture=db.texture(db.image(png_bytes(256, (9, 9, 9)), as_data_uri=True))))
out, _ = glb_region.repaint_base_color(db.glb(), 256, red_paint)
g, bn = glb_region.read_glb(out)
check("data uri: replaced by a bufferView image", "uri" not in g["images"][0]
      and base_image(g, bn, 0).convert("RGB").getpixel((0, 0)) == (255, 0, 0))

# ── refusals with reasons ─────────────────────────────────────────────────────
check("not a GLB is refused", raises(lambda: glb_region.read_glb(b"<html>502</html>"), "glb"))
kb = Builder()
kb.quad(kb.material("k", texture=0))
kb.gltf["images"] = [{"uri": "data:image/ktx2;base64,AAAA"}]
kb.gltf["textures"] = [{"extensions": {"KHR_texture_basisu": {"source": 0}}}]
check("GPU-compressed atlas is refused with a reason",
      raises(lambda: glb_region.repaint_base_color(kb.glb(), 512, red_paint), "compressed"))

print(f"\n{PASS} checks passed")
