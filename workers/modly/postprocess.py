"""Local mesh post-process for the Modly worker: UV unwrap, texture bake, packing.

Modly's own repair, decimate and smooth operations run inside Modly (see
main.py). The two steps here are deliberately NOT Modly's:

  * Modly's `api/uv_unwrapper` and `api/texture_baker` are vendored from
    Stability AI's stable-fast-3d, which ships under the Stability AI Community
    License rather than MIT. Shipping them in a commercial worker would take on
    those terms, so this module re-implements both on MIT/BSD code: xatlas
    (MIT) for the atlas, numpy and scipy (BSD) for the bake.
  * Both run on the CPU in the front's own process, so they need no GPU and are
    exercised by the build-time unit tests.

The bake transfers colour from a SOURCE mesh (the mesh as it was before
repair/decimate/smooth, which drop materials) onto the TARGET mesh's new atlas:
each texel's 3D position is found by rasterizing the target in UV space, and its
colour is the source surface colour nearest to that position. Sources with no
colour (vertex, face or texture) are reported, never baked as a flat grey.
"""

from __future__ import annotations

import io
import logging
import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import trimesh
from PIL import Image
from scipy.spatial import cKDTree

log = logging.getLogger("modly.postprocess")

GLTFPACK_BIN = os.environ.get("GLTFPACK_BIN", "gltfpack")
GLTFPACK_TIMEOUT_S = int(os.environ.get("GLTFPACK_TIMEOUT_S", "120"))
# Texels rasterized per chunk: bounds peak memory on large atlases.
_RASTER_CHUNK_TEXELS = 4_000_000
# Seam dilation: texels grown outward from every chart so bilinear filtering
# and mip levels never sample the empty gutter.
DILATE_PASSES = 8
# Source surface samples for the nearest-colour lookup.
MIN_SOURCE_SAMPLES = 200_000
MAX_SOURCE_SAMPLES = 2_000_000


class MeshError(ValueError):
    """The mesh itself cannot be processed. Safe to report to the caller."""


@dataclass
class BakeOutcome:
    mesh: trimesh.Trimesh
    baked: bool
    reason: Optional[str] = None
    coverage: float = 0.0


# ── Load / export ─────────────────────────────────────────────────────────────

def load_mesh(data: bytes, suffix: str = ".glb") -> trimesh.Trimesh:
    """Load a GLB/glTF/OBJ/PLY into one Trimesh with scene transforms applied.

    Visuals survive when the scene holds a single geometry. A multi-geometry
    scene is concatenated, which keeps per-geometry vertex colours and textures
    only when trimesh can merge them; geometry is never lost either way.
    """
    file_type = suffix.lstrip(".").lower() or "glb"
    try:
        loaded = trimesh.load(io.BytesIO(data), file_type=file_type, process=False)
    except Exception as exc:  # noqa: BLE001 - undecodable caller/model output
        raise MeshError(f"mesh is not a readable {file_type} file ({type(exc).__name__})") from exc
    if isinstance(loaded, trimesh.Scene):
        meshes = [g for g in loaded.dump() if isinstance(g, trimesh.Trimesh)]
        if not meshes:
            raise MeshError("mesh file contains no triangle geometry")
        mesh = meshes[0] if len(meshes) == 1 else trimesh.util.concatenate(meshes)
    elif isinstance(loaded, trimesh.Trimesh):
        mesh = loaded
    else:
        raise MeshError("mesh file contains no triangle geometry")
    if len(mesh.faces) == 0:
        raise MeshError("mesh has no faces")
    return mesh


def export_glb(mesh: trimesh.Trimesh) -> bytes:
    return mesh.export(file_type="glb")


def pack_glb(glb: bytes, gltfpack_bin: Optional[str] = None) -> tuple[bytes, bool]:
    """Meshopt-compress a GLB with gltfpack. Returns (bytes, packed).

    A missing or failing gltfpack serves the uncompressed GLB rather than
    failing a finished job: the platform viewers read both.
    """
    binary = gltfpack_bin or GLTFPACK_BIN
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in.glb"
        dst = Path(tmp) / "out.glb"
        src.write_bytes(glb)
        try:
            subprocess.run(
                [binary, "-i", str(src), "-o", str(dst), "-cc"],
                check=True,
                capture_output=True,
                timeout=GLTFPACK_TIMEOUT_S,
            )
            packed = dst.read_bytes()
        except FileNotFoundError:
            log.warning("gltfpack not found at %s; serving the uncompressed GLB", binary)
            return glb, False
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            detail = getattr(exc, "stderr", b"") or b""
            log.warning("gltfpack failed (%s %s); serving the uncompressed GLB", type(exc).__name__, detail[-300:])
            return glb, False
    if packed[:4] != b"glTF":
        log.warning("gltfpack produced a non-GLB output; serving the uncompressed GLB")
        return glb, False
    return packed, True


# ── UV unwrap ─────────────────────────────────────────────────────────────────

def uv_unwrap(mesh: trimesh.Trimesh, texture_size: int = 1024) -> tuple[trimesh.Trimesh, dict]:
    """Return a copy of `mesh` re-parameterized onto a fresh xatlas atlas.

    Vertices along chart seams are split (xatlas's vmapping), so the vertex count
    grows while the surface is unchanged. The result carries the new UVs and an
    untextured PBR material; `bake` fills the texture.
    """
    import xatlas

    vertices = np.asarray(mesh.vertices, dtype=np.float32)
    faces = np.asarray(mesh.faces, dtype=np.uint32)
    atlas = xatlas.Atlas()
    atlas.add_mesh(vertices, faces)
    pack = xatlas.PackOptions()
    pack.resolution = int(texture_size)
    pack.padding = 2
    pack.bilinear = True
    atlas.generate(pack_options=pack)
    vmapping, indices, uvs = atlas[0]
    material = trimesh.visual.material.PBRMaterial(
        baseColorFactor=[255, 255, 255, 255], metallicFactor=0.0, roughnessFactor=0.9
    )
    unwrapped = trimesh.Trimesh(
        vertices=np.asarray(mesh.vertices)[vmapping],
        faces=np.asarray(indices, dtype=np.int64),
        visual=trimesh.visual.TextureVisuals(uv=np.asarray(uvs, dtype=np.float64), material=material),
        process=False,
    )
    info = {
        "charts": int(atlas.chart_count),
        "utilization": round(float(atlas.utilization), 4),
        "vertices": int(len(unwrapped.vertices)),
    }
    return unwrapped, info


# ── Colour sources ────────────────────────────────────────────────────────────

def _rgba_float(colors: np.ndarray) -> np.ndarray:
    arr = np.asarray(colors, dtype=np.float64)
    if arr.shape[-1] == 3:
        arr = np.concatenate([arr, np.full(arr.shape[:-1] + (1,), 255.0)], axis=-1)
    return arr[..., :4]


def _material_image_and_factor(material) -> tuple[Optional[Image.Image], np.ndarray]:
    factor = np.array([255.0, 255.0, 255.0, 255.0])
    image = None
    base_factor = getattr(material, "baseColorFactor", None)
    if base_factor is not None:
        factor = _rgba_float(np.asarray(base_factor, dtype=np.float64).reshape(-1)[:4])
        if factor.max() <= 1.0:
            factor = factor * 255.0
    image = getattr(material, "baseColorTexture", None)
    if image is None:
        image = getattr(material, "image", None)
    return image, factor


def has_colour(mesh: trimesh.Trimesh) -> Optional[str]:
    """Which colour source `mesh` carries: "texture", "vertex", "face", "material" or None."""
    visual = mesh.visual
    kind = getattr(visual, "kind", None)
    if kind == "texture":
        image, factor = _material_image_and_factor(visual.material)
        if image is not None and getattr(visual, "uv", None) is not None and len(visual.uv) == len(mesh.vertices):
            return "texture"
        if not np.allclose(factor[:3], 255.0):
            return "material"
        return None
    if kind == "vertex":
        return "vertex"
    if kind == "face":
        return "face"
    return None


def _sample_colours(mesh: trimesh.Trimesh, points: np.ndarray, face_index: np.ndarray, source: str) -> np.ndarray:
    """RGBA (0..255 float) of `mesh` at surface `points` lying on `face_index`."""
    faces = np.asarray(mesh.faces)[face_index]
    if source == "face":
        return _rgba_float(np.asarray(mesh.visual.face_colors)[face_index])
    if source == "material":
        _, factor = _material_image_and_factor(mesh.visual.material)
        return np.tile(factor, (len(points), 1))
    triangles = np.asarray(mesh.vertices)[faces]
    bary = trimesh.triangles.points_to_barycentric(triangles, points)
    bary = np.clip(np.nan_to_num(bary, nan=1.0 / 3.0), 0.0, 1.0)
    bary = bary / np.maximum(bary.sum(axis=1, keepdims=True), 1e-12)
    if source == "vertex":
        colors = _rgba_float(np.asarray(mesh.visual.vertex_colors))
        return np.einsum("ij,ijk->ik", bary, colors[faces])
    image, factor = _material_image_and_factor(mesh.visual.material)
    uv = np.einsum("ij,ijk->ik", bary, np.asarray(mesh.visual.uv, dtype=np.float64)[faces])
    texel = _rgba_float(trimesh.visual.color.uv_to_color(uv % 1.0, image.convert("RGBA")))
    return texel * (factor / 255.0)


# ── Rasterization in UV space ─────────────────────────────────────────────────

def rasterize_uv(uv: np.ndarray, faces: np.ndarray, size: int):
    """Every texel centre covered by a face of the UV layout.

    `uv` follows trimesh's convention (origin bottom-left), so image row is
    (1 - v) * size. Returns (rows, cols, face_ids, barycentrics). A texel on a
    shared edge belongs to whichever face is rasterized last, which is harmless:
    both faces map it to the same surface point.
    """
    px = np.empty((len(faces), 3, 2), dtype=np.float64)
    corners = np.asarray(uv, dtype=np.float64)[faces]
    px[..., 0] = corners[..., 0] * size
    px[..., 1] = (1.0 - corners[..., 1]) * size

    a, b, c = px[:, 0], px[:, 1], px[:, 2]
    area = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
    usable = np.abs(area) > 1e-12

    lo = np.floor(px.min(axis=1) - 0.5).astype(np.int64)
    hi = np.ceil(px.max(axis=1) - 0.5).astype(np.int64)
    lo = np.clip(lo, 0, size - 1)
    hi = np.clip(hi, 0, size - 1)
    widths = hi[:, 0] - lo[:, 0] + 1
    heights = hi[:, 1] - lo[:, 1] + 1
    counts = np.where(usable, widths * heights, 0)

    rows_out, cols_out, faces_out, bary_out = [], [], [], []
    order = np.flatnonzero(counts)
    start = 0
    cumulative = np.cumsum(counts[order])
    while start < len(order):
        base = cumulative[start - 1] if start else 0
        end = int(np.searchsorted(cumulative, base + _RASTER_CHUNK_TEXELS, side="right"))
        end = max(end, start + 1)
        chunk = order[start:end]
        start = end

        n = counts[chunk]
        face_rep = np.repeat(chunk, n)
        offsets = np.repeat(np.cumsum(n) - n, n)
        local = np.arange(int(n.sum())) - offsets
        w = widths[face_rep]
        col = lo[face_rep, 0] + local % w
        row = lo[face_rep, 1] + local // w
        cx = col + 0.5
        cy = row + 0.5

        fa, fb, fc = a[face_rep], b[face_rep], c[face_rep]
        ar = area[face_rep]
        w0 = ((fb[:, 0] - cx) * (fc[:, 1] - cy) - (fb[:, 1] - cy) * (fc[:, 0] - cx)) / ar
        w1 = ((fc[:, 0] - cx) * (fa[:, 1] - cy) - (fc[:, 1] - cy) * (fa[:, 0] - cx)) / ar
        w2 = 1.0 - w0 - w1
        inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        rows_out.append(row[inside])
        cols_out.append(col[inside])
        faces_out.append(face_rep[inside])
        bary_out.append(np.stack([w0[inside], w1[inside], w2[inside]], axis=1))

    if not rows_out:
        empty = np.empty(0, dtype=np.int64)
        return empty, empty, empty, np.empty((0, 3))
    return (
        np.concatenate(rows_out),
        np.concatenate(cols_out),
        np.concatenate(faces_out),
        np.concatenate(bary_out),
    )


def dilate(image: np.ndarray, mask: np.ndarray, passes: int = DILATE_PASSES) -> tuple[np.ndarray, np.ndarray]:
    """Grow covered texels into the empty gutter by averaging covered neighbours.

    Returns the grown image and the mask of texels that now hold a colour.
    """
    img = image.astype(np.float64).copy()
    filled = mask.copy()
    for _ in range(passes):
        if filled.all():
            break
        padded = np.pad(img, ((1, 1), (1, 1), (0, 0)))
        padded_mask = np.pad(filled, 1)
        total = np.zeros_like(img)
        weight = np.zeros(filled.shape, dtype=np.float64)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                m = padded_mask[1 + dy : 1 + dy + filled.shape[0], 1 + dx : 1 + dx + filled.shape[1]]
                total += padded[1 + dy : 1 + dy + img.shape[0], 1 + dx : 1 + dx + img.shape[1]] * m[..., None]
                weight += m
        grow = (~filled) & (weight > 0)
        if not grow.any():
            break
        img[grow] = total[grow] / weight[grow][:, None]
        filled = filled | grow
    return img, filled


# ── Bake ──────────────────────────────────────────────────────────────────────

def bake(
    source: trimesh.Trimesh,
    target: trimesh.Trimesh,
    texture_size: int = 1024,
    rng_seed: int = 0,
) -> BakeOutcome:
    """Bake `source`'s surface colour into a baseColor texture on `target`'s UVs.

    `target` must already carry UVs (run `uv_unwrap` first). Returns the target
    with the baked texture attached, or the unchanged target with a reason when
    the source has no colour to transfer.
    """
    source_kind = has_colour(source)
    if source_kind is None:
        return BakeOutcome(mesh=target, baked=False, reason="source mesh carries no colour to bake")
    uv = getattr(target.visual, "uv", None)
    if uv is None or len(uv) != len(target.vertices):
        raise MeshError("bake needs a UV-unwrapped target mesh")

    size = int(texture_size)
    count = int(np.clip(size * size // 4, MIN_SOURCE_SAMPLES, MAX_SOURCE_SAMPLES))
    points, face_index = trimesh.sample.sample_surface(source, count, seed=rng_seed)
    colours = _sample_colours(source, points, face_index, source_kind)
    tree = cKDTree(points)

    rows, cols, face_ids, bary = rasterize_uv(np.asarray(uv), np.asarray(target.faces), size)
    if len(rows) == 0:
        return BakeOutcome(mesh=target, baked=False, reason="target UV layout covers no texels")
    tri = np.asarray(target.vertices, dtype=np.float64)[np.asarray(target.faces)[face_ids]]
    positions = np.einsum("ij,ijk->ik", bary, tri)
    _, nearest = tree.query(positions, k=1, workers=-1)

    image = np.zeros((size, size, 4), dtype=np.float64)
    mask = np.zeros((size, size), dtype=bool)
    image[rows, cols] = colours[nearest]
    mask[rows, cols] = True
    coverage = float(mask.mean())
    image, filled = dilate(image, mask)
    # Gutter texels beyond the dilation reach get the mean colour, so a mip level
    # that averages across the gutter never pulls black into a chart edge.
    if not filled.all():
        image[~filled] = image[mask].mean(axis=0)
    rgba = np.clip(np.rint(image), 0, 255).astype(np.uint8)
    opaque = bool((rgba[..., 3][mask] >= 255).all())
    texture = Image.fromarray(rgba if not opaque else rgba[..., :3], mode="RGBA" if not opaque else "RGB")

    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=texture,
        baseColorFactor=[255, 255, 255, 255],
        metallicFactor=0.0,
        roughnessFactor=0.9,
        alphaMode=None if opaque else "BLEND",
    )
    baked = trimesh.Trimesh(
        vertices=np.asarray(target.vertices),
        faces=np.asarray(target.faces),
        visual=trimesh.visual.TextureVisuals(uv=np.asarray(uv), material=material),
        process=False,
    )
    return BakeOutcome(mesh=baked, baked=True, coverage=round(coverage, 4))
