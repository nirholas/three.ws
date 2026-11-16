"""glTF 2.0 (GLB) -> OpenUSD stage: geometry, materials, skeletons, animation.

Coordinate contract: glTF is Y-up meters, the exported stage is Z-up meters
(upAxis Z, metersPerUnit 1), which is what NVIDIA Isaac Sim and Omniverse
default to. Every point is written as K * world * v, where

    K = translate(-bottom_center) * uniform_scale * C,   C: (x, y, z) -> (x, -z, y)

so the asset stands on Z=0, centred on the origin, at real-world size. Static
geometry is baked into world space (no node transforms survive, so a
downstream user never fights an inherited rotation). Skinned geometry keeps
its bind-space points and carries the same K through the skeleton's bind and
rest transforms, so the rest pose lands exactly where the static bake would.

Matrices in this module are numpy column-vector (M @ v). Gf matrices are
row-vector, hence `_gf()` transposes on the way out.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from pxr import Gf, Sdf, Usd, UsdGeom, UsdShade, UsdSkel, Vt

from gltf_reader import Gltf, InputFormatError, compose, sample_channel

C_YUP_TO_ZUP = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], dtype=np.float64)
ANIM_FPS = 30.0
MAX_ANIM_SECONDS = 120.0

# glTF material features with no UsdPreviewSurface equivalent. Recorded per
# asset so the loss is visible, never silent.
UNMAPPED_MATERIAL_EXTS = {
    "KHR_materials_sheen": "sheen has no UsdPreviewSurface input",
    "KHR_materials_specular": "specular color/strength not mapped (metallic workflow kept)",
    "KHR_materials_transmission": "transmission approximated as opacity is not applied",
    "KHR_materials_volume": "volume attenuation not mapped",
    "KHR_materials_iridescence": "iridescence not mapped",
    "KHR_materials_anisotropy": "anisotropy not mapped",
    "KHR_materials_unlit": "unlit shading rendered as lit UsdPreviewSurface",
}


def _gf(m: np.ndarray) -> Gf.Matrix4d:
    return Gf.Matrix4d(m.T.tolist())


def _apply(m: np.ndarray, pts: np.ndarray) -> np.ndarray:
    return pts @ m[:3, :3].T + m[:3, 3]


def _apply_normals(m: np.ndarray, nrm: np.ndarray) -> np.ndarray:
    lin = m[:3, :3]
    nm = np.linalg.inv(lin).T
    out = nrm @ nm.T
    ln = np.linalg.norm(out, axis=1, keepdims=True)
    return out / np.where(ln == 0, 1, ln)


class _Names:
    """Valid, sibling-unique USD prim names."""

    def __init__(self):
        self.used: dict[str, set] = {}

    def make(self, parent: str, raw: Optional[str], fallback: str) -> str:
        base = re.sub(r"[^A-Za-z0-9_]", "_", (raw or "").strip()) or fallback
        if base[0].isdigit():
            base = "_" + base
        base = base[:60]
        taken = self.used.setdefault(parent, set())
        name, n = base, 1
        while name in taken:
            n += 1
            name = f"{base}_{n}"
        taken.add(name)
        return name


@dataclass
class Primitive:
    """One triangle-list primitive resolved to final-space arrays."""

    name: str
    material: Optional[int]
    points: np.ndarray            # (V, 3) in final space (static) or K-space (skinned)
    normals: np.ndarray           # (V, 3)
    indices: np.ndarray           # (F, 3)
    uvs: dict                     # set index -> (V, 2), v already flipped
    colors: Optional[np.ndarray]  # (V, 3)
    opacity: Optional[np.ndarray]  # (V,)
    skin: Optional[int] = None
    joints: Optional[np.ndarray] = None   # (V, k) skin-joint indices (glTF order)
    weights: Optional[np.ndarray] = None  # (V, k)
    targets: list = field(default_factory=list)  # [(name, dpos (V,3), dnrm (V,3)|None)]
    mesh_index: int = -1


@dataclass
class ExportReport:
    warnings: list = field(default_factory=list)
    unmapped: dict = field(default_factory=dict)
    stats: dict = field(default_factory=dict)


def _triangles(mode: int, idx: np.ndarray) -> Optional[np.ndarray]:
    if mode == 4:
        return idx[: len(idx) - len(idx) % 3].reshape(-1, 3)
    if mode == 5:
        tris = []
        for i in range(len(idx) - 2):
            a, b, c = idx[i], idx[i + 1], idx[i + 2]
            tris.append((a, b, c) if i % 2 == 0 else (b, a, c))
        return np.array(tris, dtype=np.int64).reshape(-1, 3)
    if mode == 6:
        return np.array([(idx[0], idx[i], idx[i + 1]) for i in range(1, len(idx) - 1)], dtype=np.int64).reshape(-1, 3)
    return None


def _smooth_normals(points: np.ndarray, tris: np.ndarray) -> np.ndarray:
    a, b, c = points[tris[:, 0]], points[tris[:, 1]], points[tris[:, 2]]
    fn = np.cross(b - a, c - a)
    out = np.zeros_like(points)
    for k in range(3):
        np.add.at(out, tris[:, k], fn)
    ln = np.linalg.norm(out, axis=1, keepdims=True)
    out = out / np.where(ln == 0, 1, ln)
    out[ln[:, 0] == 0] = (0.0, 1.0, 0.0)
    return out


class Converter:
    def __init__(self, gltf: Gltf, report: ExportReport):
        self.g = gltf
        self.doc = gltf.doc
        self.report = report
        self.names = _Names()
        self.world = gltf.world_matrices()
        self.parents = gltf.parents()

    # ------------------------------------------------------------ geometry
    def mesh_nodes(self) -> list[int]:
        return [i for i in self.world if "mesh" in self.doc["nodes"][i]]

    def is_rigged(self) -> bool:
        return any("skin" in self.doc["nodes"][i] for i in self.mesh_nodes())

    def collect_primitives(self) -> list[Primitive]:
        """Every renderable primitive in glTF space (world for static, bind for skinned)."""
        prims: list[Primitive] = []
        for ni in sorted(self.mesh_nodes()):
            node = self.doc["nodes"][ni]
            mesh = self.doc["meshes"][node["mesh"]]
            skin = node.get("skin")
            target_names = (mesh.get("extras") or {}).get("targetNames") or []
            default_w = node.get("weights", mesh.get("weights"))
            for pi, prim in enumerate(mesh.get("primitives", [])):
                attrs = prim.get("attributes", {})
                if "POSITION" not in attrs:
                    continue
                mode = prim.get("mode", 4)
                pos = self.g.accessor(attrs["POSITION"])[:, :3].astype(np.float64)
                idx = (self.g.accessor(prim["indices"])[:, 0].astype(np.int64)
                       if "indices" in prim else np.arange(len(pos), dtype=np.int64))
                tris = _triangles(mode, idx)
                if tris is None or len(tris) == 0:
                    self.report.warnings.append(f"mesh {node['mesh']} primitive {pi}: mode {mode} (points/lines) skipped")
                    continue
                if tris.max(initial=0) >= len(pos):
                    raise InputFormatError(f"mesh {node['mesh']} primitive {pi} indexes past its vertex count")
                nrm = self.g.accessor(attrs["NORMAL"])[:, :3].astype(np.float64) if "NORMAL" in attrs else None
                targets = []
                if prim.get("targets"):
                    for ti, tgt in enumerate(prim["targets"]):
                        dpos = self.g.accessor(tgt["POSITION"])[:, :3] if "POSITION" in tgt else np.zeros_like(pos)
                        dnrm = self.g.accessor(tgt["NORMAL"])[:, :3] if "NORMAL" in tgt else None
                        tname = target_names[ti] if ti < len(target_names) else f"target_{ti}"
                        targets.append((tname, dpos.astype(np.float64), None if dnrm is None else dnrm.astype(np.float64)))
                if targets and skin is None and default_w is not None:
                    # Static mesh: bake the default morph weights into the shape.
                    for w, (_, dpos, dnrm) in zip(default_w, targets):
                        if w:
                            pos = pos + w * dpos
                            if nrm is not None and dnrm is not None:
                                nrm = nrm + w * dnrm
                    targets = []
                elif targets and skin is None:
                    targets = []
                if nrm is None:
                    nrm = _smooth_normals(pos, tris)
                uvs = {}
                for key, val in attrs.items():
                    if key.startswith("TEXCOORD_"):
                        uv = self.g.accessor(val)[:, :2].astype(np.float64).copy()
                        uv[:, 1] = 1.0 - uv[:, 1]
                        uvs[int(key.split("_")[1])] = uv
                colors = opacity = None
                if "COLOR_0" in attrs:
                    col = self.g.accessor(attrs["COLOR_0"]).astype(np.float64)
                    colors = col[:, :3]
                    if col.shape[1] == 4:
                        opacity = col[:, 3]
                joints = weights = None
                if skin is not None:
                    jl, wl = [], []
                    k = 0
                    while f"JOINTS_{k}" in attrs and f"WEIGHTS_{k}" in attrs:
                        jl.append(self.g.accessor(attrs[f"JOINTS_{k}"]).astype(np.int64))
                        wl.append(self.g.accessor(attrs[f"WEIGHTS_{k}"]).astype(np.float64))
                        k += 1
                    if not jl:
                        self.report.warnings.append(f"mesh {node['mesh']} primitive {pi}: skinned node without JOINTS/WEIGHTS, exported static")
                        skin = None
                    else:
                        joints = np.concatenate(jl, axis=1)
                        weights = np.concatenate(wl, axis=1)
                if skin is None:
                    w = self.world[ni]
                    pos_out = pos
                    if not np.allclose(w, np.eye(4)):
                        pos_out = _apply(w, pos)
                        nrm = _apply_normals(w, nrm)
                        if np.linalg.det(w[:3, :3]) < 0:
                            tris = tris[:, [0, 2, 1]]
                    pos = pos_out
                prims.append(Primitive(
                    name=mesh.get("name") or node.get("name") or f"mesh_{node['mesh']}",
                    material=prim.get("material"),
                    points=pos, normals=nrm, indices=tris, uvs=uvs,
                    colors=colors, opacity=opacity, skin=skin if joints is not None else None,
                    joints=joints, weights=weights, targets=targets if skin is not None else [],
                    mesh_index=node["mesh"],
                ))
        if not prims:
            raise InputFormatError("GLB has no triangle geometry to export")
        return prims

    def posed_points(self, p: Primitive) -> np.ndarray:
        """A primitive's points in glTF world space at the rest pose (skinned ones skinned)."""
        if p.skin is None:
            return p.points
        jm = self.joint_matrices(p.skin)
        w = p.weights / np.maximum(p.weights.sum(axis=1, keepdims=True), 1e-12)
        hom = np.c_[p.points, np.ones(len(p.points))]
        acc = np.zeros((len(p.points), 3))
        for k in range(p.joints.shape[1]):
            m = jm[np.clip(p.joints[:, k], 0, len(jm) - 1)]  # (V,4,4)
            acc += w[:, k:k + 1] * np.einsum("vij,vj->vi", m, hom)[:, :3]
        return acc

    def bind_to_world(self, p: Primitive) -> np.ndarray:
        """One matrix carrying a skinned primitive's bind-space points to the rest pose.

        It is the joint matrix (world x inverseBind) of the joint holding the most
        weight. When the file's rest pose is its bind pose (the normal case) every
        joint matrix is the same and this is exact; otherwise it only affects how
        the unskinned points look, because the geomBindTransform undoes it.
        """
        jm = self.joint_matrices(p.skin)
        totals = np.zeros(len(jm))
        np.add.at(totals, np.clip(p.joints, 0, len(jm) - 1).reshape(-1), p.weights.reshape(-1))
        return jm[int(np.argmax(totals))]

    def rest_world_points(self, prims: list[Primitive]) -> np.ndarray:
        return np.concatenate([self.posed_points(p) for p in prims], axis=0)

    def inverse_binds(self, skin_index: int) -> np.ndarray:
        skin = self.doc["skins"][skin_index]
        n = len(skin["joints"])
        if "inverseBindMatrices" in skin:
            ib = self.g.accessor(skin["inverseBindMatrices"]).reshape(n, 4, 4).transpose(0, 2, 1)
            return ib.astype(np.float64)
        return np.repeat(np.eye(4)[None], n, axis=0)

    def joint_matrices(self, skin_index: int) -> np.ndarray:
        skin = self.doc["skins"][skin_index]
        ib = self.inverse_binds(skin_index)
        return np.stack([self.world.get(j, np.eye(4)) @ ib[i] for i, j in enumerate(skin["joints"])])


# ------------------------------------------------------------------ stage
@dataclass
class StageResult:
    stage: Usd.Stage
    root_path: Sdf.Path
    prims: list
    collision_points: np.ndarray   # final-space points of every visual mesh
    collision_tris: np.ndarray
    rigged: bool
    animated: bool
    bounds: tuple                  # (min, max) final space
    textures: dict                 # relative path -> bytes


def placement(world_points: np.ndarray, scale: float) -> np.ndarray:
    """K: glTF world -> final Z-up space, scaled, standing on Z=0 at the origin."""
    zup = _apply(C_YUP_TO_ZUP, world_points) * scale
    lo, hi = zup.min(axis=0), zup.max(axis=0)
    center = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])
    t = np.eye(4)
    t[:3, 3] = -center
    s = np.diag([scale, scale, scale, 1.0])
    return t @ s @ C_YUP_TO_ZUP


class _MaterialWriter:
    def __init__(self, conv: Converter, stage: Usd.Stage, looks: Sdf.Path, names: _Names):
        self.c = conv
        self.stage = stage
        self.looks = looks
        self.names = names
        self.cache: dict = {}
        self.textures: dict[str, bytes] = {}
        self.tex_paths: dict[int, str] = {}

    def texture_path(self, tex_index: int) -> Optional[str]:
        doc = self.c.doc
        tex = doc["textures"][tex_index]
        src = tex.get("source")
        webp = (tex.get("extensions") or {}).get("EXT_texture_webp", {}).get("source")
        image_index = src if src is not None else webp
        if image_index is None:
            return None
        if image_index in self.tex_paths:
            return self.tex_paths[image_index]
        data, mime = self.c.g.image_bytes(image_index)
        if mime == "image/png":
            ext = "png"
        elif mime == "image/jpeg":
            ext = "jpg"
        else:
            # USDZ (and most USD renderers) only read PNG and JPEG: transcode.
            from PIL import Image
            img = Image.open(io.BytesIO(data))
            img.load()
            buf = io.BytesIO()
            img.save(buf, format="PNG", optimize=True)
            data, ext = buf.getvalue(), "png"
        rel = f"textures/image_{image_index}.{ext}"
        self.textures[rel] = data
        # Anchored ("./") so the path resolves relative to the layer, which is
        # what USDZ packaging and every resolver expect; a bare "textures/..."
        # is a search path and gets remapped when packaged.
        self.tex_paths[image_index] = "./" + rel
        return self.tex_paths[image_index]

    def material(self, mat_index: Optional[int], has_colors: bool) -> UsdShade.Material:
        key = (mat_index, has_colors)
        if key in self.cache:
            return self.cache[key]
        doc = self.c.doc
        mat = doc["materials"][mat_index] if mat_index is not None and doc.get("materials") else {}
        name = self.names.make(str(self.looks), mat.get("name"), f"Material_{mat_index if mat_index is not None else 'default'}")
        mpath = self.looks.AppendChild(name)
        material = UsdShade.Material.Define(self.stage, mpath)
        shader = UsdShade.Shader.Define(self.stage, mpath.AppendChild("PreviewSurface"))
        shader.CreateIdAttr("UsdPreviewSurface")
        material.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(), "surface")
        pbr = mat.get("pbrMetallicRoughness", {})
        exts = mat.get("extensions", {}) or {}
        for ext, why in UNMAPPED_MATERIAL_EXTS.items():
            if ext in exts:
                self.c.report.unmapped.setdefault(ext, why)

        readers: dict[int, UsdShade.Shader] = {}

        def st_reader(set_index: int) -> UsdShade.Shader:
            if set_index not in readers:
                r = UsdShade.Shader.Define(self.stage, mpath.AppendChild(f"TexCoordReader{set_index or ''}"))
                r.CreateIdAttr("UsdPrimvarReader_float2")
                r.CreateInput("varname", Sdf.ValueTypeNames.String).Set("st" if set_index == 0 else f"st{set_index}")
                r.CreateOutput("result", Sdf.ValueTypeNames.Float2)
                readers[set_index] = r
            return readers[set_index]

        def tex(info: dict, label: str, color_space: str, scale=None, bias=None, fallback=None):
            rel = self.texture_path(info["index"])
            if rel is None:
                return None
            t = UsdShade.Shader.Define(self.stage, mpath.AppendChild(label))
            t.CreateIdAttr("UsdUVTexture")
            t.CreateInput("file", Sdf.ValueTypeNames.Asset).Set(rel)
            t.CreateInput("sourceColorSpace", Sdf.ValueTypeNames.Token).Set(color_space)
            sampler = self._sampler(info["index"])
            t.CreateInput("wrapS", Sdf.ValueTypeNames.Token).Set(sampler[0])
            t.CreateInput("wrapT", Sdf.ValueTypeNames.Token).Set(sampler[1])
            if scale is not None:
                t.CreateInput("scale", Sdf.ValueTypeNames.Float4).Set(Gf.Vec4f(*scale))
            if bias is not None:
                t.CreateInput("bias", Sdf.ValueTypeNames.Float4).Set(Gf.Vec4f(*bias))
            if fallback is not None:
                t.CreateInput("fallback", Sdf.ValueTypeNames.Float4).Set(Gf.Vec4f(*fallback))
            tt = (info.get("extensions") or {}).get("KHR_texture_transform")
            set_index = (tt or {}).get("texCoord", info.get("texCoord", 0))
            st_out = st_reader(set_index).ConnectableAPI()
            st_name = "result"
            if tt:
                st_out, st_name = self._transform2d(mpath, label, tt, st_out), "result"
            t.CreateInput("st", Sdf.ValueTypeNames.Float2).ConnectToSource(st_out, st_name)
            return t

        base = pbr.get("baseColorFactor", [1, 1, 1, 1])
        alpha_mode = mat.get("alphaMode", "OPAQUE")
        surf = shader
        if "baseColorTexture" in pbr:
            t = tex(pbr["baseColorTexture"], "BaseColorTexture", "sRGB", scale=base, fallback=base)
            if t is not None:
                t.CreateOutput("rgb", Sdf.ValueTypeNames.Float3)
                surf.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).ConnectToSource(t.ConnectableAPI(), "rgb")
                if alpha_mode != "OPAQUE":
                    t.CreateOutput("a", Sdf.ValueTypeNames.Float)
                    surf.CreateInput("opacity", Sdf.ValueTypeNames.Float).ConnectToSource(t.ConnectableAPI(), "a")
        elif has_colors:
            reader = UsdShade.Shader.Define(self.stage, mpath.AppendChild("DisplayColorReader"))
            reader.CreateIdAttr("UsdPrimvarReader_float3")
            reader.CreateInput("varname", Sdf.ValueTypeNames.String).Set("displayColor")
            reader.CreateOutput("result", Sdf.ValueTypeNames.Float3)
            surf.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).ConnectToSource(reader.ConnectableAPI(), "result")
        else:
            surf.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*base[:3]))
        if alpha_mode != "OPAQUE" and not surf.GetInput("opacity"):
            surf.CreateInput("opacity", Sdf.ValueTypeNames.Float).Set(float(base[3]))
        if alpha_mode == "MASK":
            surf.CreateInput("opacityThreshold", Sdf.ValueTypeNames.Float).Set(float(mat.get("alphaCutoff", 0.5)))

        metal = float(pbr.get("metallicFactor", 1.0))
        rough = float(pbr.get("roughnessFactor", 1.0))
        if "metallicRoughnessTexture" in pbr:
            t = tex(pbr["metallicRoughnessTexture"], "MetallicRoughnessTexture", "raw",
                    scale=(1, rough, metal, 1), fallback=(1, rough, metal, 1))
            if t is not None:
                t.CreateOutput("g", Sdf.ValueTypeNames.Float)
                t.CreateOutput("b", Sdf.ValueTypeNames.Float)
                surf.CreateInput("roughness", Sdf.ValueTypeNames.Float).ConnectToSource(t.ConnectableAPI(), "g")
                surf.CreateInput("metallic", Sdf.ValueTypeNames.Float).ConnectToSource(t.ConnectableAPI(), "b")
        if not surf.GetInput("roughness"):
            surf.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(rough)
            surf.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(metal)

        if "normalTexture" in mat:
            ns = float(mat["normalTexture"].get("scale", 1.0))
            t = tex(mat["normalTexture"], "NormalTexture", "raw",
                    scale=(2 * ns, 2 * ns, 2, 1), bias=(-ns, -ns, -1, 0), fallback=(0.5, 0.5, 1, 1))
            if t is not None:
                t.CreateOutput("rgb", Sdf.ValueTypeNames.Float3)
                surf.CreateInput("normal", Sdf.ValueTypeNames.Normal3f).ConnectToSource(t.ConnectableAPI(), "rgb")
        if "occlusionTexture" in mat:
            st = float(mat["occlusionTexture"].get("strength", 1.0))
            t = tex(mat["occlusionTexture"], "OcclusionTexture", "raw",
                    scale=(st, st, st, 1), bias=(1 - st, 1 - st, 1 - st, 0), fallback=(1, 1, 1, 1))
            if t is not None:
                t.CreateOutput("r", Sdf.ValueTypeNames.Float)
                surf.CreateInput("occlusion", Sdf.ValueTypeNames.Float).ConnectToSource(t.ConnectableAPI(), "r")

        emissive = np.array(mat.get("emissiveFactor", [0, 0, 0]), dtype=np.float64)
        emissive *= float((exts.get("KHR_materials_emissive_strength") or {}).get("emissiveStrength", 1.0))
        if "emissiveTexture" in mat and emissive.any():
            t = tex(mat["emissiveTexture"], "EmissiveTexture", "sRGB", scale=(*emissive, 1), fallback=(*emissive, 1))
            if t is not None:
                t.CreateOutput("rgb", Sdf.ValueTypeNames.Float3)
                surf.CreateInput("emissiveColor", Sdf.ValueTypeNames.Color3f).ConnectToSource(t.ConnectableAPI(), "rgb")
        elif emissive.any():
            surf.CreateInput("emissiveColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*emissive.tolist()))

        if "KHR_materials_ior" in exts:
            surf.CreateInput("ior", Sdf.ValueTypeNames.Float).Set(float(exts["KHR_materials_ior"].get("ior", 1.5)))
        if "KHR_materials_clearcoat" in exts:
            cc = exts["KHR_materials_clearcoat"]
            surf.CreateInput("clearcoat", Sdf.ValueTypeNames.Float).Set(float(cc.get("clearcoatFactor", 0.0)))
            surf.CreateInput("clearcoatRoughness", Sdf.ValueTypeNames.Float).Set(float(cc.get("clearcoatRoughnessFactor", 0.0)))
            if any(k in cc for k in ("clearcoatTexture", "clearcoatRoughnessTexture", "clearcoatNormalTexture")):
                self.c.report.unmapped.setdefault("KHR_materials_clearcoat textures", "clearcoat factors mapped, clearcoat textures not")
        if mat.get("doubleSided"):
            self.c.report.stats["double_sided_materials"] = self.c.report.stats.get("double_sided_materials", 0) + 1
        self.cache[key] = material
        return material

    def _sampler(self, tex_index: int) -> tuple[str, str]:
        tex = self.c.doc["textures"][tex_index]
        samp = (self.c.doc.get("samplers") or [{}])[tex["sampler"]] if "sampler" in tex else {}
        wrap = {33071: "clamp", 33648: "mirror", 10497: "repeat"}
        return wrap.get(samp.get("wrapS", 10497), "repeat"), wrap.get(samp.get("wrapT", 10497), "repeat")

    def _transform2d(self, mpath: Sdf.Path, label: str, tt: dict, src) -> UsdShade.ConnectableAPI:
        """KHR_texture_transform in glTF uv space -> UsdTransform2d in USD st space (v flipped)."""
        ox, oy = tt.get("offset", [0, 0])
        rot = float(tt.get("rotation", 0.0))
        sx, sy = tt.get("scale", [1, 1])
        c, s = np.cos(rot), np.sin(rot)
        tm = np.array([[1, 0, ox], [0, 1, oy], [0, 0, 1]], dtype=np.float64)
        rm = np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]], dtype=np.float64)
        sm = np.diag([sx, sy, 1.0])
        flip = np.array([[1, 0, 0], [0, -1, 1], [0, 0, 1]], dtype=np.float64)
        n = flip @ tm @ rm @ sm @ flip
        lin = n[:2, :2]
        scale_x = float(np.linalg.norm(lin[:, 0]))
        theta = float(np.degrees(np.arctan2(lin[1, 0], lin[0, 0])))
        scale_y = float(np.linalg.det(lin) / scale_x) if scale_x else 0.0
        xf = UsdShade.Shader.Define(self.stage, mpath.AppendChild(f"{label}Transform"))
        xf.CreateIdAttr("UsdTransform2d")
        xf.CreateInput("in", Sdf.ValueTypeNames.Float2).ConnectToSource(src, "result")
        xf.CreateInput("scale", Sdf.ValueTypeNames.Float2).Set(Gf.Vec2f(scale_x, scale_y))
        xf.CreateInput("rotation", Sdf.ValueTypeNames.Float).Set(theta)
        xf.CreateInput("translation", Sdf.ValueTypeNames.Float2).Set(Gf.Vec2f(float(n[0, 2]), float(n[1, 2])))
        xf.CreateOutput("result", Sdf.ValueTypeNames.Float2)
        return xf.ConnectableAPI()


def _vt3(a: np.ndarray, kind=Vt.Vec3fArray):
    return kind.FromNumpy(np.ascontiguousarray(a, dtype=np.float32))


def build_stage(conv: Converter, *, root_name: str, scale_for, out_layer_path: str) -> StageResult:
    """Author the full visual stage. `scale_for(bounds_size_m)` returns the uniform scale."""
    prims = conv.collect_primitives()
    rigged = any(p.skin is not None for p in prims)
    world_pts = conv.rest_world_points(prims)
    zup = _apply(C_YUP_TO_ZUP, world_pts)
    native_size = zup.max(axis=0) - zup.min(axis=0)
    scale = float(scale_for(native_size))
    k = placement(world_pts, scale)

    stage = Usd.Stage.CreateNew(out_layer_path)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    root_path = Sdf.Path("/" + root_name)
    root = (UsdSkel.Root.Define(stage, root_path) if rigged else UsdGeom.Xform.Define(stage, root_path)).GetPrim()
    stage.SetDefaultPrim(root)
    names = conv.names
    looks = root_path.AppendChild("Looks")
    UsdGeom.Scope.Define(stage, looks)
    geom_path = root_path.AppendChild("Geometry")
    UsdGeom.Scope.Define(stage, geom_path) if rigged else UsdGeom.Xform.Define(stage, geom_path)
    mats = _MaterialWriter(conv, stage, looks, names)

    skeletons: dict[int, dict] = {}
    if rigged:
        for group in _skin_groups(conv, sorted({p.skin for p in prims if p.skin is not None})):
            sk = _author_skeleton(conv, stage, root_path, group, k, names)
            for si in group:
                skeletons[si] = sk
    unique_skeletons = list({id(v): v for v in skeletons.values()}.values())

    all_pts, all_tris, offset = [], [], 0
    for p in prims:
        mname = names.make(str(geom_path), p.name, "Mesh")
        mesh = UsdGeom.Mesh.Define(stage, geom_path.AppendChild(mname))
        # Static points are already world space; skinned points are carried
        # from bind space to the rest pose by bind_to_world, and the skin's
        # geomBindTransform undoes that exactly before skinning.
        to_final = k if p.skin is None else k @ conv.bind_to_world(p)
        pts = _apply(to_final, p.points)
        nrm = _apply_normals(to_final, p.normals)
        tris = p.indices
        if np.linalg.det(to_final[:3, :3]) < 0:
            tris = tris[:, [0, 2, 1]]
        mesh.CreatePointsAttr(_vt3(pts))
        mesh.CreateFaceVertexCountsAttr(Vt.IntArray.FromNumpy(np.full(len(tris), 3, dtype=np.int32)))
        mesh.CreateFaceVertexIndicesAttr(Vt.IntArray.FromNumpy(tris.reshape(-1).astype(np.int32)))
        mesh.CreateSubdivisionSchemeAttr(UsdGeom.Tokens.none)
        mesh.CreateOrientationAttr(UsdGeom.Tokens.rightHanded)
        mesh.CreateNormalsAttr(_vt3(nrm))
        mesh.SetNormalsInterpolation(UsdGeom.Tokens.vertex)
        # Validators check `extent` against the authored points; the collision
        # solid and the extents hint use the skinned rest pose.
        posed = pts if p.skin is None else _apply(k, conv.posed_points(p))
        mesh.CreateExtentAttr(Vt.Vec3fArray([Gf.Vec3f(*pts.min(axis=0).tolist()), Gf.Vec3f(*pts.max(axis=0).tolist())]))
        mesh.CreateDoubleSidedAttr(bool(_material_dict(conv, p.material).get("doubleSided", False)))
        pv = UsdGeom.PrimvarsAPI(mesh)
        for set_index, uv in sorted(p.uvs.items()):
            st = pv.CreatePrimvar("st" if set_index == 0 else f"st{set_index}", Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.vertex)
            st.Set(Vt.Vec2fArray.FromNumpy(np.ascontiguousarray(uv, dtype=np.float32)))
        if p.colors is not None:
            dc = mesh.CreateDisplayColorPrimvar(UsdGeom.Tokens.vertex)
            dc.Set(_vt3(np.clip(p.colors, 0, 1)))
        else:
            base = _material_dict(conv, p.material).get("pbrMetallicRoughness", {}).get("baseColorFactor", [0.8, 0.8, 0.8, 1])
            dc = mesh.CreateDisplayColorPrimvar(UsdGeom.Tokens.constant)
            dc.Set(Vt.Vec3fArray([Gf.Vec3f(*[float(x) for x in base[:3]])]))
        material = mats.material(p.material, p.colors is not None)
        UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(material)
        if p.skin is not None:
            _bind_skin(stage, mesh, p, skeletons[p.skin], k, to_final)
        all_pts.append(posed)
        all_tris.append(tris + offset)
        offset += len(pts)

    if unique_skeletons:
        _finish_animations(conv, stage, root_path, unique_skeletons, k, names)

    allp = np.concatenate(all_pts)
    bounds = (allp.min(axis=0), allp.max(axis=0))
    UsdGeom.ModelAPI(root).SetExtentsHint(Vt.Vec3fArray([Gf.Vec3f(*bounds[0].tolist()), Gf.Vec3f(*bounds[1].tolist())]))
    animated = any(sk.get("animated") for sk in unique_skeletons)
    conv.report.stats.update({
        "meshes": len(prims),
        "points": int(sum(len(p.points) for p in prims)),
        "triangles": int(sum(len(p.indices) for p in prims)),
        "materials": len(mats.cache),
        "textures": len(mats.textures),
        "skeletons": len(unique_skeletons),
        "joints": len({j for sk in unique_skeletons for j in sk["order"]}),
        "blend_shapes": len({n for sk in unique_skeletons for n in sk["blend_names"]}),
        "animations": int(sum(max(sk.get("animations", 0) for sk in unique_skeletons if tuple(sk["order"]) == topo)
                              for topo in {tuple(sk["order"]) for sk in unique_skeletons})),
        "native_size_m": [round(float(x), 4) for x in native_size],
        "scale": scale,
        "size_m": [round(float(x), 4) for x in (bounds[1] - bounds[0])],
    })
    return StageResult(stage, root_path, prims, allp, np.concatenate(all_tris), rigged, animated, bounds, mats.textures)


def _material_dict(conv: Converter, mi: Optional[int]) -> dict:
    mats = conv.doc.get("materials") or []
    return mats[mi] if mi is not None and mi < len(mats) else {}


# --------------------------------------------------------------- skeleton
def _skin_groups(conv: Converter, skins: list[int]) -> list[list[int]]:
    """Skins that agree on every shared joint's inverse bind share one Skeleton.

    Exporters often write one skin per mesh over the same joints (a typical
    avatar has ten); in USD those are one skeleton bound by every mesh.
    """
    groups: list[tuple[list[int], dict]] = []
    for si in skins:
        ib = conv.inverse_binds(si)
        mine = {j: ib[i] for i, j in enumerate(conv.doc["skins"][si]["joints"])}
        for members, binds in groups:
            shared = set(mine) & set(binds)
            if shared and all(np.allclose(mine[j], binds[j], atol=1e-4) for j in shared):
                members.append(si)
                binds.update(mine)
                break
        else:
            groups.append(([si], dict(mine)))
    return [members for members, _ in groups]


def _author_skeleton(conv: Converter, stage, root_path: Sdf.Path, group: list[int], k: np.ndarray, names: _Names) -> dict:
    doc = conv.doc
    skin = doc["skins"][group[0]]
    joints: list[int] = []
    ib_by_node: dict[int, np.ndarray] = {}
    for si in group:
        ib_s = conv.inverse_binds(si)
        for i, j in enumerate(doc["skins"][si]["joints"]):
            if j not in ib_by_node:
                joints.append(j)
                ib_by_node[j] = ib_s[i]
    jset = set(joints)

    def joint_parent(j):
        p = conv.parents.get(j)
        while p is not None and p not in jset:
            p = conv.parents.get(p)
        return p

    # Parent-before-child order (UsdSkel topology requirement).
    order, seen = [], set()

    def visit(j):
        if j in seen:
            return
        p = joint_parent(j)
        if p is not None:
            visit(p)
        seen.add(j)
        order.append(j)

    for j in joints:
        visit(j)
    gl_to_usd = {j: i for i, j in enumerate(order)}
    skin_to_usd = {si: np.array([gl_to_usd[j] for j in doc["skins"][si]["joints"]], dtype=np.int64) for si in group}

    tokens: dict[int, str] = {}
    sib = _Names()
    for j in order:
        p = joint_parent(j)
        parent_tok = tokens[p] if p is not None else ""
        nm = sib.make(parent_tok, doc["nodes"][j].get("name"), f"joint_{j}")
        tokens[j] = f"{parent_tok}/{nm}" if parent_tok else nm

    skel_name = names.make(str(root_path), skin.get("name"), "Skeleton")
    skel_path = root_path.AppendChild(skel_name)
    skel = UsdSkel.Skeleton.Define(stage, skel_path)
    skel.CreateJointsAttr([tokens[j] for j in order])
    skel.CreateJointNamesAttr([doc["nodes"][j].get("name") or f"joint_{j}" for j in order])

    bind_world = [k @ np.linalg.inv(ib_by_node[j]) for j in order]
    skel.CreateBindTransformsAttr(Vt.Matrix4dArray([_gf(m) for m in bind_world]))

    rest_world = {j: k @ conv.world.get(j, np.eye(4)) for j in order}
    rest_local = []
    for j in order:
        p = joint_parent(j)
        rest_local.append(rest_world[j] if p is None else np.linalg.inv(rest_world[p]) @ rest_world[j])
    skel.CreateRestTransformsAttr(Vt.Matrix4dArray([_gf(m) for m in rest_local]))
    UsdSkel.BindingAPI.Apply(skel.GetPrim())
    # Each skinned mesh binds its skeleton explicitly. Nothing is bound on the
    # SkelRoot itself: an inherited binding would make every unskinned
    # descendant a skinning target without joint influences.
    return {
        "path": skel_path, "skel": skel, "order": order, "skin_to_usd": skin_to_usd, "count": len(order),
        "joint_parent": joint_parent, "blend_names": [], "blend_map": {}, "meshes": [],
    }


def _finish_animations(conv: Converter, stage, root_path, skeletons: list[dict], k, names) -> None:
    """Author each animation once per joint topology and point every skeleton at it.

    An avatar exported as one skin per mesh becomes several Skeleton prims over
    the same joints (their bind matrices differ, so they cannot merge), but the
    motion is identical; one SkelAnimation carrying the union of their blend
    shape channels drives all of them.
    """
    by_topology: dict[tuple, list[dict]] = {}
    for sk in skeletons:
        by_topology.setdefault(tuple(sk["order"]), []).append(sk)
    for group in by_topology.values():
        merged = {"order": group[0]["order"], "blend_names": [], "blend_map": {}, "meshes": []}
        for sk in group:
            merged["meshes"].extend(sk["meshes"])
            for mesh_index, mapping in sk["blend_map"].items():
                merged["blend_map"].setdefault(mesh_index, {}).update(mapping)
            for nm in sk["blend_names"]:
                if nm not in merged["blend_names"]:
                    merged["blend_names"].append(nm)
        paths = _author_animations(conv, stage, root_path, group[0]["skel"], merged, k, group[0]["joint_parent"], names)
        for sk in group:
            sk["animations"] = len(paths)
            sk["animated"] = bool(paths)
            if paths:
                UsdSkel.BindingAPI(sk["skel"].GetPrim()).CreateAnimationSourceRel().SetTargets([paths[0]])


def _bind_skin(stage, mesh: UsdGeom.Mesh, p: Primitive, sk: dict, k: np.ndarray, to_final: np.ndarray):
    prim = mesh.GetPrim()
    binding = UsdSkel.BindingAPI.Apply(prim)
    binding.CreateSkeletonRel().SetTargets([sk["path"]])
    remap = sk["skin_to_usd"][p.skin]
    jidx = remap[np.clip(p.joints, 0, len(remap) - 1)]
    w = np.clip(p.weights, 0, None)
    sums = w.sum(axis=1, keepdims=True)
    zero = sums[:, 0] <= 1e-9
    w = w / np.where(sums == 0, 1, sums)
    w[zero] = 0
    w[zero, 0] = 1.0
    # Unused influence slots point at a valid joint with zero weight.
    jidx = np.where(w > 0, jidx, jidx[:, :1])
    n = p.joints.shape[1]
    binding.CreateJointIndicesPrimvar(False, n).Set(Vt.IntArray.FromNumpy(jidx.reshape(-1).astype(np.int32)))
    binding.CreateJointWeightsPrimvar(False, n).Set(Vt.FloatArray.FromNumpy(w.reshape(-1).astype(np.float32)))
    # Points were written as to_final * v; skinning needs K * v (the skeleton's
    # bind transforms are K * inverse(inverseBind)), so G = K * to_final^-1.
    binding.CreateGeomBindTransformAttr(_gf(k @ np.linalg.inv(to_final)))
    if p.targets:
        lin = to_final[:3, :3]
        nm = np.linalg.inv(lin).T
        names = []
        targets = []
        local = _Names()
        for tname, dpos, dnrm in p.targets:
            moved = np.linalg.norm(dpos, axis=1) > 1e-7
            if not moved.any():
                continue
            nm_name = local.make("", tname, "shape")
            bpath = prim.GetPath().AppendChild(nm_name)
            bs = UsdSkel.BlendShape.Define(stage, bpath)
            ids = np.nonzero(moved)[0]
            bs.CreateOffsetsAttr(_vt3(dpos[ids] @ lin.T))
            if dnrm is not None:
                nrm_off = dnrm[ids] @ nm.T
                bs.CreateNormalOffsetsAttr(_vt3(nrm_off))
            else:
                bs.CreateNormalOffsetsAttr(_vt3(np.zeros((len(ids), 3))))
            bs.CreatePointIndicesAttr(Vt.IntArray.FromNumpy(ids.astype(np.int32)))
            names.append(nm_name)
            targets.append(bpath)
            sk["blend_map"].setdefault(p.mesh_index, {})[tname] = nm_name
            if nm_name not in sk["blend_names"]:
                sk["blend_names"].append(nm_name)
        if names:
            binding.CreateBlendShapesAttr(names)
            binding.CreateBlendShapeTargetsRel().SetTargets(targets)
    sk["blend_shapes"] = len(sk["blend_names"])
    sk["meshes"].append(p.mesh_index)


def _author_animations(conv: Converter, stage, root_path, skel: UsdSkel.Skeleton, info: dict, k, joint_parent, names) -> list:
    doc = conv.doc
    anims = doc.get("animations") or []
    order = info["order"]
    jset = set(order)
    authored: list = []
    anim_scope = None
    for ai, anim in enumerate(anims):
        channels = []
        weight_channels = []
        for ch in anim.get("channels", []):
            tgt = ch.get("target", {})
            node = tgt.get("node")
            path = tgt.get("path")
            if node is None or path is None:
                continue
            smp = anim["samplers"][ch["sampler"]]
            times = conv.g.accessor(smp["input"])[:, 0]
            values = conv.g.accessor(smp["output"])
            interp = smp.get("interpolation", "LINEAR")
            if path == "weights":
                if doc["nodes"][node].get("mesh") in info["meshes"]:
                    weight_channels.append((node, times, values, interp))
            elif node in jset or _is_joint_ancestor(conv, node, jset):
                channels.append((node, path, times, values, interp))
        if not channels and not weight_channels:
            continue
        tmax = max(float(c[2][-1]) for c in channels) if channels else 0.0
        if weight_channels:
            tmax = max([tmax] + [float(w[1][-1]) for w in weight_channels])
        tmax = min(tmax, MAX_ANIM_SECONDS)
        frames = max(1, int(round(tmax * ANIM_FPS)) + 1)
        if anim_scope is None:
            anim_scope = root_path.AppendChild("Animations")
            UsdGeom.Scope.Define(stage, anim_scope)
        aname = names.make(str(anim_scope), anim.get("name"), f"Animation_{ai}")
        apath = anim_scope.AppendChild(aname)
        sa = UsdSkel.Animation.Define(stage, apath)
        sa.CreateJointsAttr(skel.GetJointsAttr().Get())
        t_attr = sa.CreateTranslationsAttr()
        r_attr = sa.CreateRotationsAttr()
        s_attr = sa.CreateScalesAttr()
        by_node: dict[int, list] = {}
        for node, path, times, values, interp in channels:
            by_node.setdefault(node, []).append((path, times, values, interp))
        animated_nodes = set(by_node)
        for f in range(frames):
            t = min(f / ANIM_FPS, tmax)
            world = _posed_world(conv, by_node, animated_nodes, t)
            mats = []
            for j in order:
                p = joint_parent(j)
                wj = k @ world[j]
                mats.append(wj if p is None else np.linalg.inv(k @ world[p]) @ wj)
            xf = Vt.Matrix4dArray([_gf(m) for m in mats])
            tr, rot, sc = UsdSkel.DecomposeTransforms(xf)
            t_attr.Set(tr, Usd.TimeCode(f))
            r_attr.Set(rot, Usd.TimeCode(f))
            s_attr.Set(sc, Usd.TimeCode(f))
        if weight_channels and info["blend_names"]:
            bnames = list(info["blend_names"])
            sa.CreateBlendShapesAttr(bnames)
            w_attr = sa.CreateBlendShapeWeightsAttr()
            for f in range(frames):
                t = min(f / ANIM_FPS, tmax)
                row = np.zeros(len(bnames), dtype=np.float32)
                for node, times, values, interp in weight_channels:
                    mesh_index = doc["nodes"][node]["mesh"]
                    tnames = (doc["meshes"][mesh_index].get("extras") or {}).get("targetNames") or []
                    ntargets = len(doc["meshes"][mesh_index]["primitives"][0].get("targets", []))
                    vals = sample_channel(times, values, interp, t, "weights")
                    mapping = info["blend_map"].get(mesh_index, {})
                    for ti in range(ntargets):
                        tname = tnames[ti] if ti < len(tnames) else f"target_{ti}"
                        if tname in mapping:
                            row[bnames.index(mapping[tname])] = float(vals[ti])
                w_attr.Set(Vt.FloatArray.FromNumpy(row), Usd.TimeCode(f))
        authored.append(apath)
        stage.SetEndTimeCode(max(stage.GetEndTimeCode(), float(frames - 1)))
    if authored:
        stage.SetStartTimeCode(0)
        stage.SetTimeCodesPerSecond(ANIM_FPS)
        stage.SetFramesPerSecond(ANIM_FPS)
    return authored


def _is_joint_ancestor(conv: Converter, node: int, jset: set) -> bool:
    stack = list(conv.doc["nodes"][node].get("children", []))
    while stack:
        c = stack.pop()
        if c in jset:
            return True
        stack.extend(conv.doc["nodes"][c].get("children", []))
    return False


def _posed_world(conv: Converter, by_node: dict, animated: set, t: float) -> dict[int, np.ndarray]:
    out: dict[int, np.ndarray] = {}
    stack = [(r, np.eye(4)) for r in conv.g.scene_roots()]
    while stack:
        idx, parent = stack.pop()
        if idx in animated:
            trs = {}
            for path, times, values, interp in by_node[idx]:
                trs[path] = sample_channel(times, values, interp, t, path)
            local = conv.g.local_matrix(idx, trs)
        else:
            local = conv.g.local_matrix(idx)
        world = parent @ local
        out[idx] = world
        for c in conv.doc["nodes"][idx].get("children", []):
            stack.append((c, world))
    return out
