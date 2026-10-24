#!/usr/bin/env python3
"""Convert one NVIDIA SimReady OpenUSD asset into a web-ready GLB.

Usage: simready-to-glb.py <asset_root> <out.glb> [--max-tex 1024] [--meta out.json]

<asset_root> is the asset folder of the nvidia/simready-assets dataset (the one that
holds simready_usd/ and .metadata/). Needs `usd-core`, `numpy`, `Pillow`, `pygltflib`.

What it does: opens the root USD with instance proxies, bakes every mesh into world
space (Z-up to Y-up, meters), triangulates, splits face-varying normals/UVs into
glTF vertices, maps each GeomSubset's UsdPreviewSurface to a glTF PBR material
(albedo, ORM packed as occlusion + metallicRoughness, tangent-space normal), bakes the
UsdTransform2d tiling into the UVs, and downsizes textures to JPEG.
"""
import argparse
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from pxr import Gf, Usd, UsdGeom, UsdShade
import pygltflib as gl


def attr_or_primvar(mesh, name):
    """Return (values, indices_or_None, interpolation) for a primvar, else None."""
    pv = UsdGeom.PrimvarsAPI(mesh.GetPrim()).GetPrimvar(name)
    if pv and pv.HasValue():
        vals = pv.Get()
        idx = pv.GetIndices() if pv.IsIndexed() else None
        return np.asarray(vals, dtype=np.float32), (np.asarray(idx, dtype=np.int64) if idx is not None else None), pv.GetInterpolation()
    return None


def shader_input_source(shader, name):
    inp = shader.GetInput(name)
    if not inp:
        return None, None
    if inp.HasConnectedSource():
        src, out, _ = inp.GetConnectedSource()
        return src, out
    return inp.Get(), None


class TexCache:
    def __init__(self, max_tex):
        self.max_tex = max_tex
        self.images = {}

    def load(self, path):
        key = str(path)
        if key not in self.images:
            im = Image.open(path)
            im.load()
            self.images[key] = im
        return self.images[key]


def resolve_tex(shader_prim):
    """For a UsdUVTexture prim return (absolute path, tiling scale, offset)."""
    sh = UsdShade.Shader(shader_prim)
    f = sh.GetInput('file').Get()
    path = f.resolvedPath if f and f.resolvedPath else None
    scale, offset = (1.0, 1.0), (0.0, 0.0)
    st = sh.GetInput('st')
    if st and st.HasConnectedSource():
        t = st.GetConnectedSource()[0].GetPrim()
        if UsdShade.Shader(t).GetIdAttr().Get() == 'UsdTransform2d':
            tsh = UsdShade.Shader(t)
            s = tsh.GetInput('scale').Get() or Gf.Vec2f(1, 1)
            o = tsh.GetInput('translation').Get() or Gf.Vec2f(0, 0)
            scale, offset = (float(s[0]), float(s[1])), (float(o[0]), float(o[1]))
    return path, scale, offset


def to_jpeg(im, max_tex, channels=None, quality=86):
    im = im.copy()
    if channels is not None:
        im = im.convert('RGB') if len(channels) == 3 else im
    else:
        im = im.convert('RGB')
    im.thumbnail((max_tex, max_tex), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=quality, optimize=True)
    return buf.getvalue()


def extract_material(mat_prim, cache, max_tex):
    """Describe one USD material as plain data: factors plus texture paths."""
    mat = UsdShade.Material(mat_prim)
    surf = mat.ComputeSurfaceSource()[0]
    out = {'name': mat_prim.GetName(), 'base': (0.8, 0.8, 0.8), 'rough': 0.6, 'metal': 0.0,
           'albedo': None, 'orm': None, 'rough_tex': None, 'metal_tex': None, 'normal': None,
           'scale': (1.0, 1.0), 'offset': (0.0, 0.0), 'opacity': 1.0}
    if not surf:
        return out

    def tex_of(name):
        v, o = shader_input_source(surf, name)
        if o is None:
            return v, None, None
        prim = v.GetPrim()
        if UsdShade.Shader(prim).GetIdAttr().Get() != 'UsdUVTexture':
            return None, None, None
        path, scale, offset = resolve_tex(prim)
        if not path or not Path(path).exists():
            print(f'warning: texture missing for {mat_prim.GetName()}.{name}: {path}', file=sys.stderr)
            return None, None, None
        return None, (path, str(o)), (scale, offset)

    v, t, tr = tex_of('diffuseColor')
    if t:
        out['albedo'] = t[0]
        out['scale'], out['offset'] = tr
    elif v is not None:
        out['base'] = tuple(float(x) for x in v)
    v, t, tr = tex_of('roughness')
    if t:
        out['rough_tex'] = t
    elif v is not None:
        out['rough'] = float(v)
    v, t, tr = tex_of('metallic')
    if t:
        out['metal_tex'] = t
    elif v is not None:
        out['metal'] = float(v)
    v, t, tr = tex_of('normal')
    if t:
        out['normal'] = t[0]
    v, _ = shader_input_source(surf, 'opacity')
    if isinstance(v, (int, float)):
        out['opacity'] = float(v)
    return out


def triangulate(mesh):
    counts = np.asarray(mesh.GetFaceVertexCountsAttr().Get(), dtype=np.int64)
    idx = np.asarray(mesh.GetFaceVertexIndicesAttr().Get(), dtype=np.int64)
    starts = np.concatenate([[0], np.cumsum(counts)[:-1]])
    tri_face, tri_corner = [], []
    # fan triangulation, vectorised per polygon size
    for n in np.unique(counts):
        if n < 3:
            continue
        fs = np.nonzero(counts == n)[0]
        for k in range(1, n - 1):
            tri_face.append(np.stack([fs, fs, fs], 1))
            tri_corner.append(np.stack([starts[fs], starts[fs] + k, starts[fs] + k + 1], 1))
    if not tri_face:
        return None
    face = np.concatenate(tri_face)[:, 0]
    corners = np.concatenate(tri_corner)
    order = np.argsort(face, kind='stable')
    return face[order], corners[order], idx, counts, starts


def mesh_to_arrays(mesh, xf, normal_xf):
    tri = triangulate(mesh)
    if tri is None:
        return None
    face, corners, fv_idx, counts, starts = tri
    pts = np.asarray(mesh.GetPointsAttr().Get(), dtype=np.float64)
    if mesh.GetOrientationAttr().Get() == 'leftHanded':
        corners = corners[:, ::-1]
    corner_flat = corners.reshape(-1)
    p_idx = fv_idx[corner_flat]

    nrm = None
    nattr = mesh.GetNormalsAttr().Get()
    ninterp = mesh.GetNormalsInterpolation()
    pvn = attr_or_primvar(mesh, 'normals')
    if nattr is not None:
        arr = np.asarray(nattr, dtype=np.float32)
        if ninterp == 'faceVarying':
            nrm = arr[corner_flat]
        elif ninterp == 'vertex':
            nrm = arr[p_idx]
        elif ninterp == 'uniform':
            nrm = arr[np.repeat(face, 3)]
        elif ninterp == 'constant':
            nrm = np.broadcast_to(arr[0], (len(corner_flat), 3))
    elif pvn is not None:
        arr, ix, interp = pvn
        arr = arr[ix] if ix is not None else arr
        nrm = arr[corner_flat] if interp == 'faceVarying' else arr[p_idx]

    uv = None
    pv = attr_or_primvar(mesh, 'st')
    if pv is not None:
        arr, ix, interp = pv
        if interp == 'faceVarying':
            a = arr[ix] if ix is not None else arr
            uv = a[corner_flat]
        elif interp == 'vertex':
            a = arr[ix] if ix is not None else arr
            uv = a[p_idx]

    pts_w = (np.c_[pts, np.ones(len(pts))] @ np.array(xf, dtype=np.float64))[:, :3]
    pos = pts_w[p_idx].astype(np.float32)
    if nrm is not None:
        nm = np.array(normal_xf, dtype=np.float64)
        nn = (nrm.astype(np.float64) @ nm[:3, :3])
        ln = np.linalg.norm(nn, axis=1, keepdims=True)
        ln[ln == 0] = 1
        nrm = (nn / ln).astype(np.float32)
    return pos, nrm, uv, face


def weld(pos, nrm, uv):
    """Collapse identical corner vertices so the index buffer is shared."""
    cols = [pos]
    if nrm is not None:
        cols.append(nrm)
    if uv is not None:
        cols.append(uv)
    key = np.concatenate(cols, axis=1)
    key_r = np.round(key * 1e5).astype(np.int64)
    _, first, inv = np.unique(key_r, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    return first, inv.astype(np.uint32)


def build(asset_root, out_path, max_tex):
    root = Path(asset_root)
    usds = sorted((root / 'simready_usd').glob('sm_*.usd')) or sorted((root / 'simready_usd').glob('*.usd'))
    if not usds:
        raise SystemExit(f'no root usd in {root}/simready_usd')
    stage = Usd.Stage.Open(str(usds[0]))
    up = UsdGeom.GetStageUpAxis(stage)
    mpu = UsdGeom.GetStageMetersPerUnit(stage) or 1.0
    cache = UsdGeom.XformCache()
    zup = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], dtype=np.float64)  # Z-up to Y-up (row vectors)
    fix = zup if up == 'Z' else np.eye(4)
    scale = np.diag([mpu, mpu, mpu, 1.0])

    gltf = gl.GLTF2(asset=gl.Asset(version='2.0', generator='three.ws simready-to-glb'))
    gltf.scenes = [gl.Scene(nodes=[])]
    gltf.scene = 0
    blob = bytearray()

    def add_view(data, target=None):
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(data)
        gltf.bufferViews.append(gl.BufferView(buffer=0, byteOffset=off, byteLength=len(data), target=target))
        return len(gltf.bufferViews) - 1

    def add_accessor(arr, comp, typ, target, minmax=False):
        v = add_view(arr.tobytes(), target)
        a = gl.Accessor(bufferView=v, componentType=comp, count=len(arr), type=typ)
        if minmax:
            a.min = arr.min(0).tolist()
            a.max = arr.max(0).tolist()
        gltf.accessors.append(a)
        return len(gltf.accessors) - 1

    cache_tex = TexCache(max_tex)
    img_ids = {}
    mat_ids = {}

    def add_image(key, data):
        if key not in img_ids:
            v = add_view(data)
            gltf.images.append(gl.Image(bufferView=v, mimeType='image/jpeg'))
            gltf.textures.append(gl.Texture(source=len(gltf.images) - 1, sampler=0))
            img_ids[key] = len(gltf.textures) - 1
        return img_ids[key]

    gltf.samplers = [gl.Sampler(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)]

    def get_material(prim):
        key = str(prim.GetPath().name)
        if key in mat_ids:
            return mat_ids[key][0], mat_ids[key][1]
        d = extract_material(prim, cache_tex, max_tex)
        pbr = gl.PbrMetallicRoughness(baseColorFactor=[*d['base'], d['opacity']],
                                      roughnessFactor=d['rough'], metallicFactor=d['metal'])
        m = gl.Material(name=d['name'], pbrMetallicRoughness=pbr, doubleSided=False)
        if d['albedo'] and Path(d['albedo']).exists():
            im = cache_tex.load(d['albedo'])
            pbr.baseColorTexture = gl.TextureInfo(index=add_image(('a', d['albedo']), to_jpeg(im, max_tex)))
            pbr.baseColorFactor = [1, 1, 1, d['opacity']]
        rt, mt = d['rough_tex'], d['metal_tex']
        if rt and mt and rt[0] == mt[0] and Path(rt[0]).exists():
            im = cache_tex.load(rt[0]).convert('RGB')
            pbr.metallicRoughnessTexture = gl.TextureInfo(index=add_image(('o', rt[0]), to_jpeg(im, max_tex)))
            m.occlusionTexture = gl.OcclusionTextureInfo(index=pbr.metallicRoughnessTexture.index)
            pbr.roughnessFactor, pbr.metallicFactor = 1.0, 1.0
        elif rt and Path(rt[0]).exists():
            im = cache_tex.load(rt[0]).convert('RGB')
            ch = {'r': 0, 'g': 1, 'b': 2}.get(rt[1], 1)
            r = np.asarray(im)[..., ch]
            packed = np.zeros(r.shape + (3,), np.uint8)
            packed[..., 1] = r
            pbr.metallicRoughnessTexture = gl.TextureInfo(index=add_image(('r', rt[0], ch), to_jpeg(Image.fromarray(packed), max_tex)))
            pbr.roughnessFactor = 1.0
        if d['normal'] and Path(d['normal']).exists():
            im = cache_tex.load(d['normal'])
            m.normalTexture = gl.NormalMaterialTexture(index=add_image(('n', d['normal']), to_jpeg(im, max_tex, quality=90)))
        if d['opacity'] < 1.0:
            m.alphaMode = 'BLEND'
        gltf.materials.append(m)
        mat_ids[key] = (len(gltf.materials) - 1, d)
        return mat_ids[key]

    stats = {'meshes': 0, 'tris': 0, 'materials': 0}
    bounds_lo = np.full(3, np.inf)
    bounds_hi = np.full(3, -np.inf)

    for prim in Usd.PrimRange.Stage(stage, Usd.TraverseInstanceProxies()):
        if not prim.IsA(UsdGeom.Mesh):
            continue
        img = UsdGeom.Imageable(prim)
        if img.ComputeVisibility() == UsdGeom.Tokens.invisible or img.ComputePurpose() in (UsdGeom.Tokens.guide, UsdGeom.Tokens.proxy):
            continue
        if prim.GetAttribute('physics:collisionEnabled').IsValid() and not prim.GetAttribute('primvars:st').IsValid() \
                and not UsdGeom.PrimvarsAPI(prim).GetPrimvar('st'):
            if 'collision' in prim.GetName().lower():
                continue
        mesh = UsdGeom.Mesh(prim)
        world = cache.GetLocalToWorldTransform(prim)
        xf = np.array(world, dtype=np.float64) @ scale @ fix
        xf_n = np.linalg.inv(xf).T
        arrs = mesh_to_arrays(mesh, xf, xf_n)
        if arrs is None:
            continue
        pos, nrm, uv, face = arrs
        if np.linalg.det(xf[:3, :3]) < 0:
            pos = pos.reshape(-1, 3, 3)[:, ::-1].reshape(-1, 3)
            nrm = nrm.reshape(-1, 3, 3)[:, ::-1].reshape(-1, 3) if nrm is not None else None
            uv = uv.reshape(-1, 3, 2)[:, ::-1].reshape(-1, 2) if uv is not None else None
        subsets = UsdGeom.Subset.GetAllGeomSubsets(mesh)
        groups = []
        if subsets:
            covered = np.zeros(int(face.max()) + 1, bool)
            for ss in subsets:
                fi = np.asarray(ss.GetIndicesAttr().Get() or [], dtype=np.int64)
                covered[fi[fi < len(covered)]] = True
                mb = UsdShade.MaterialBindingAPI(ss.GetPrim()).ComputeBoundMaterial()[0]
                sel = np.isin(face, fi)
                if sel.any():
                    groups.append((mb.GetPrim() if mb else None, sel))
            rest = ~covered[face]
            if rest.any():
                mb = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]
                groups.append((mb.GetPrim() if mb else None, rest))
        else:
            mb = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]
            groups.append((mb.GetPrim() if mb else None, np.ones(len(face), bool)))

        prims_out = []
        for mprim, sel in groups:
            tri_sel = np.nonzero(sel)[0]
            c = (tri_sel[:, None] * 3 + np.arange(3)).reshape(-1)
            p_, n_, u_ = pos[c], (nrm[c] if nrm is not None else None), (uv[c] if uv is not None else None)
            mid = None
            if mprim is not None:
                mid, d = get_material(mprim)
                if u_ is not None:
                    u_ = u_ * np.array(d['scale'], np.float32) + np.array(d['offset'], np.float32)
            if u_ is not None:
                u_ = u_.copy()
                u_[:, 1] = 1.0 - u_[:, 1]  # USD v is up, glTF v is down
            first, inv = weld(p_, n_, u_)
            vp = np.ascontiguousarray(p_[first], np.float32)
            attrs = gl.Attributes(POSITION=add_accessor(vp, gl.FLOAT, 'VEC3', gl.ARRAY_BUFFER, True))
            if n_ is not None:
                attrs.NORMAL = add_accessor(np.ascontiguousarray(n_[first], np.float32), gl.FLOAT, 'VEC3', gl.ARRAY_BUFFER)
            if u_ is not None:
                attrs.TEXCOORD_0 = add_accessor(np.ascontiguousarray(u_[first], np.float32), gl.FLOAT, 'VEC2', gl.ARRAY_BUFFER)
            ia = add_accessor(inv.astype(np.uint32), gl.UNSIGNED_INT, 'SCALAR', gl.ELEMENT_ARRAY_BUFFER)
            prims_out.append(gl.Primitive(attributes=attrs, indices=ia, material=mid, mode=4))
            bounds_lo = np.minimum(bounds_lo, vp.min(0))
            bounds_hi = np.maximum(bounds_hi, vp.max(0))
            stats['tris'] += len(inv) // 3
        if not prims_out:
            continue
        gltf.meshes.append(gl.Mesh(name=prim.GetName(), primitives=prims_out))
        gltf.nodes.append(gl.Node(name=prim.GetName(), mesh=len(gltf.meshes) - 1))
        gltf.scenes[0].nodes.append(len(gltf.nodes) - 1)
        stats['meshes'] += 1

    if not stats['meshes']:
        raise SystemExit('no renderable meshes found')
    stats['materials'] = len(gltf.materials)
    stats['size_m'] = [round(float(x), 4) for x in (bounds_hi - bounds_lo)]
    gltf.buffers = [gl.Buffer(byteLength=len(blob))]
    gltf.set_binary_blob(bytes(blob))
    gltf.save_binary(out_path)
    stats['bytes'] = Path(out_path).stat().st_size
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('asset_root')
    ap.add_argument('out')
    ap.add_argument('--max-tex', type=int, default=1024)
    ap.add_argument('--meta')
    a = ap.parse_args()
    st = build(a.asset_root, a.out, a.max_tex)
    if a.meta:
        Path(a.meta).write_text(json.dumps(st))
    print(json.dumps(st))


if __name__ == '__main__':
    main()
