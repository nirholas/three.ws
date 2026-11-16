"""Side-by-side preview of a source GLB and the OpenUSD export made from it.

    python render_preview.py --glb model.glb --usd asset.usdz --out preview.png

Three panels, all drawn by the same software rasterizer so they compare fairly:

1. the source glTF (read with the worker's own glTF reader),
2. the visual meshes of the exported USD stage (UsdGeom, render purpose
   "default", colors from the bound UsdPreviewSurface: its diffuseColor or the
   UsdUVTexture it reads, sampled per face),
3. the same stage's UsdPhysics collision hulls (guide purpose) over a faint
   visual mesh, titled with the authored mass, hull count and class label.

usd-core ships no Hydra renderer, so the USD panels are drawn from the stage
data itself: every point, face, transform and texture here comes out of the
exported file through the USD API. The tool is used for the screenshots in
docs/openusd-export.md and as a quick visual check of a new export.
"""

from __future__ import annotations

import argparse
import io
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from mpl_toolkits.mplot3d.art3d import Poly3DCollection  # noqa: E402
from pxr import Usd, UsdGeom, UsdPhysics, UsdShade  # noqa: E402

from gltf_reader import load_glb  # noqa: E402
from gltf_to_usd import Converter, ExportReport  # noqa: E402

LIGHT = np.array([0.45, -0.6, 0.75])
LIGHT = LIGHT / np.linalg.norm(LIGHT)
HULL_COLORS = plt.get_cmap("tab20").colors
MAX_FACES = 120_000


def _shade(tris: np.ndarray, rgb: np.ndarray) -> np.ndarray:
    """Lambert plus ambient, two-sided, per face."""
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    k = 0.35 + 0.65 * np.abs(n @ LIGHT)
    return np.clip(rgb * k[:, None], 0, 1)


def _sample(img: np.ndarray, uv: np.ndarray) -> np.ndarray:
    """Nearest texel for each (u, v) in USD convention (v up), wrapped."""
    h, w = img.shape[:2]
    x = np.mod(uv[:, 0], 1.0) * (w - 1)
    y = (1.0 - np.mod(uv[:, 1], 1.0)) * (h - 1)
    return img[y.astype(int), x.astype(int), :3]


def _thin(tris: np.ndarray, rgb: np.ndarray):
    if len(tris) <= MAX_FACES:
        return tris, rgb
    keep = np.linspace(0, len(tris) - 1, MAX_FACES).astype(int)
    return tris[keep], rgb[keep]


# ------------------------------------------------------------------ glTF side
def gltf_faces(path: Path):
    g = load_glb(path.read_bytes())
    conv = Converter(g, ExportReport())
    textures: dict[int, np.ndarray] = {}
    all_tris, all_rgb = [], []
    for p in conv.collect_primitives():
        tris = p.points[p.indices]
        mat = (g.doc.get("materials") or [])[p.material] if p.material is not None else {}
        pbr = mat.get("pbrMetallicRoughness", {})
        base = np.array(pbr.get("baseColorFactor", [0.8, 0.8, 0.8, 1.0])[:3])
        tex = pbr.get("baseColorTexture")
        uv = p.uvs.get(tex.get("texCoord", 0)) if tex else None
        if tex is not None and uv is not None:
            src = g.doc["textures"][tex["index"]].get("source")
            if src is not None and src not in textures:
                data, _ = g.image_bytes(src)
                textures[src] = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"), dtype=np.float64) / 255.0
            # p.uvs already has v flipped to the USD convention.
            rgb = _sample(textures[src], uv[p.indices].mean(axis=1)) * base
        elif p.colors is not None:
            rgb = p.colors[p.indices].mean(axis=1)
        else:
            rgb = np.tile(base, (len(tris), 1))
        all_tris.append(tris)
        all_rgb.append(rgb)
    tris = np.concatenate(all_tris)
    # glTF is Y-up; show it Z-up like the USD stage.
    tris = tris[..., [0, 2, 1]] * np.array([1.0, -1.0, 1.0])
    return tris, np.concatenate(all_rgb)


# ------------------------------------------------------------------- USD side
def _read_asset(resolved: str) -> bytes:
    """Bytes of a resolved asset path, including paths inside a .usdz."""
    if "[" in resolved and resolved.endswith("]"):
        outer, inner = resolved[:-1].split("[", 1)
        with zipfile.ZipFile(outer) as z:
            return z.read(inner)
    return Path(resolved).read_bytes()


def _material_color(prim: Usd.Prim, cache: dict):
    """(constant rgb, texture array or None) of the bound UsdPreviewSurface."""
    mat, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
    if not mat:
        return np.array([0.7, 0.7, 0.7]), None
    key = str(mat.GetPath())
    if key in cache:
        return cache[key]
    color, tex = np.array([0.7, 0.7, 0.7]), None
    surface = mat.ComputeSurfaceSource()[0]
    if surface:
        inp = surface.GetInput("diffuseColor")
        if inp:
            src = inp.GetConnectedSources()[0]
            if src:
                shader = UsdShade.Shader(src[0].source.GetPrim())
                f = shader.GetInput("file")
                asset = f.Get() if f else None
                if asset is not None and asset.resolvedPath:
                    data = _read_asset(asset.resolvedPath)
                    tex = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"), dtype=np.float64) / 255.0
            elif inp.Get() is not None:
                color = np.array(inp.Get(), dtype=np.float64)
    cache[key] = (color, tex)
    return color, tex


def _mesh_faces(mesh: UsdGeom.Mesh, xf: np.ndarray):
    pts = np.asarray(mesh.GetPointsAttr().Get(), dtype=np.float64)
    counts = np.asarray(mesh.GetFaceVertexCountsAttr().Get(), dtype=np.int64)
    idx = np.asarray(mesh.GetFaceVertexIndicesAttr().Get(), dtype=np.int64)
    world = pts @ xf[:3, :3] + xf[3, :3]
    starts = np.concatenate([[0], np.cumsum(counts)[:-1]])
    corner = []  # (face corner indices into the faceVarying arrays) per triangle
    for s, c in zip(starts, counts):
        for k in range(1, c - 1):
            corner.append((s, s + k, s + k + 1))
    corner = np.asarray(corner, dtype=np.int64)
    return world[idx[corner]], corner, idx


def usd_faces(path: Path):
    stage = Usd.Stage.Open(str(path))
    cache: dict = {}
    vis_t, vis_c, hulls = [], [], []
    xf_cache = UsdGeom.XformCache()
    for prim in stage.Traverse():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        mesh = UsdGeom.Mesh(prim)
        xf = np.asarray(xf_cache.GetLocalToWorldTransform(prim), dtype=np.float64)
        tris, corner, idx = _mesh_faces(mesh, xf)
        if prim.HasAPI(UsdPhysics.CollisionAPI):
            hulls.append(tris)
            continue
        if UsdGeom.Imageable(prim).ComputePurpose() != UsdGeom.Tokens.default_:
            continue
        color, tex = _material_color(prim, cache)
        st = UsdGeom.PrimvarsAPI(prim).GetPrimvar("st")
        if tex is not None and st and st.HasValue():
            uv = np.asarray(st.ComputeFlattened(), dtype=np.float64)
            interp = st.GetInterpolation()
            per_corner = uv[corner] if interp == UsdGeom.Tokens.faceVarying else uv[idx[corner]]
            rgb = _sample(tex, per_corner.mean(axis=1))
        else:
            dc = UsdGeom.PrimvarsAPI(prim).GetPrimvar("displayColor")
            if dc and dc.HasValue() and dc.GetInterpolation() == UsdGeom.Tokens.vertex:
                rgb = np.asarray(dc.ComputeFlattened(), dtype=np.float64)[idx[corner]].mean(axis=1)
            else:
                rgb = np.tile(color, (len(tris), 1))
        vis_t.append(tris)
        vis_c.append(rgb)

    root = stage.GetDefaultPrim()
    mass_attr = UsdPhysics.MassAPI(root).GetMassAttr() if root else None
    mass = mass_attr.Get() if mass_attr and mass_attr.HasAuthoredValue() else None
    label = None
    if root:
        attr = root.GetAttribute("semantics:labels:class")
        if attr and attr.Get():
            label = list(attr.Get())[0]
    meta = {"mass_kg": mass, "label": label, "hulls": len(hulls), "kinematic": False}
    rb = UsdPhysics.RigidBodyAPI(root) if root else None
    if rb and rb.GetKinematicEnabledAttr().Get():
        meta["kinematic"] = True
    return np.concatenate(vis_t), np.concatenate(vis_c), hulls, meta


# ------------------------------------------------------------------- drawing
def _draw(ax, tris: np.ndarray, rgba: np.ndarray, bounds: np.ndarray, title: str):
    coll = Poly3DCollection(tris, facecolors=rgba, edgecolors="none", linewidths=0)
    ax.add_collection3d(coll)
    lo, hi = bounds
    c, r = (lo + hi) / 2, (hi - lo).max() / 2 * 1.05
    ax.set_xlim(c[0] - r, c[0] + r)
    ax.set_ylim(c[1] - r, c[1] + r)
    ax.set_zlim(c[2] - r, c[2] + r)
    ax.set_box_aspect((1, 1, 1))
    ax.view_init(elev=18, azim=-58)
    ax.set_axis_off()
    ax.set_title(title, fontsize=11, color="#e8e8ee", pad=2)


def render(glb: Path, usd: Path, out: Path, name: str | None = None) -> dict:
    g_t, g_c = _thin(*gltf_faces(glb))
    u_t, u_c, hulls, meta = usd_faces(usd)
    u_t, u_c = _thin(u_t, u_c)

    # Scale the glTF into the USD stage's frame (meters, on the ground at the
    # origin) so the two panels line up: the exporter rescales to a real size.
    g_lo, g_hi = g_t.reshape(-1, 3).min(0), g_t.reshape(-1, 3).max(0)
    u_lo, u_hi = u_t.reshape(-1, 3).min(0), u_t.reshape(-1, 3).max(0)
    s = (u_hi - u_lo).max() / max((g_hi - g_lo).max(), 1e-9)
    g_t = (g_t - (g_lo + g_hi) / 2 * np.array([1, 1, 0]) - np.array([0, 0, g_lo[2]])) * s
    g_t += np.array([(u_lo[0] + u_hi[0]) / 2, (u_lo[1] + u_hi[1]) / 2, u_lo[2]])
    bounds = np.array([u_lo, u_hi])

    fig = plt.figure(figsize=(15, 5.4), dpi=110, facecolor="#111116")
    panels = [fig.add_subplot(1, 3, i + 1, projection="3d", facecolor="#111116") for i in range(3)]

    ones = np.ones((len(g_t), 1))
    _draw(panels[0], g_t, np.hstack([_shade(g_t, g_c), ones]), bounds, "Source glTF")
    ones = np.ones((len(u_t), 1))
    _draw(panels[1], u_t, np.hstack([_shade(u_t, u_c), ones]), bounds, "OpenUSD stage: visual meshes")

    ghost = np.hstack([_shade(u_t, np.full_like(u_c, 0.75)), np.full((len(u_t), 1), 0.10)])
    hull_tris = [u_t]
    hull_rgba = [ghost]
    for i, h in enumerate(hulls):
        col = np.array(HULL_COLORS[i % len(HULL_COLORS)])
        hull_tris.append(h)
        hull_rgba.append(np.hstack([_shade(h, np.tile(col, (len(h), 1))), np.full((len(h), 1), 0.7)]))
    mass = f"{meta['mass_kg']:.2f} kg" if meta["mass_kg"] is not None else "mass unset"
    body = "kinematic" if meta["kinematic"] else "rigid body"
    _draw(
        panels[2],
        np.concatenate(hull_tris),
        np.concatenate(hull_rgba),
        bounds,
        f"UsdPhysics: {meta['hulls']} convex hulls, {mass}, {body}",
    )
    size = u_hi - u_lo
    caption = (
        f"{name or usd.stem}   class \"{meta['label'] or 'unlabeled'}\"   "
        f"{size[0]:.3f} x {size[1]:.3f} x {size[2]:.3f} m, Z-up"
    )
    fig.text(0.5, 0.03, caption, ha="center", color="#a8a8b8", fontsize=10)
    fig.subplots_adjust(left=0, right=1, top=0.93, bottom=0.07, wspace=0)
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, facecolor=fig.get_facecolor())
    plt.close(fig)
    return meta


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--glb", required=True, type=Path)
    ap.add_argument("--usd", required=True, type=Path, help=".usdz, .usd or .usda export")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--name", help="caption name (defaults to the USD file stem)")
    args = ap.parse_args()
    meta = render(args.glb, args.usd, args.out, args.name)
    print(f"wrote {args.out}: {meta}")


if __name__ == "__main__":
    main()
