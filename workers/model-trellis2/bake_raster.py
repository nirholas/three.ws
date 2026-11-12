"""One bake-rasteriser interface with two backends: nvdiffrast and pure PyTorch.

Vendored byte-identical into every worker whose GLB bake rasterises
(scripts/check-vendored-workers.mjs enforces it). Why it exists: the TRELLIS.2
bake (`o_voxel.postprocess.to_glb`) rasterises the mesh in UV space with
nvdiffrast, whose licence (NVlabs/nvdiffrast LICENSE.txt, "Nvidia Source Code
License (1-Way Commercial)", section 3.3) limits use to "research or evaluation
purposes only and not for any direct or indirect monetary gain". The monetized
Forge lanes cannot rely on that, and the CUDA extension build is fragile.

Backends, chosen by BAKE_RASTER_BACKEND:

  nvdiffrast (default)  the installed nvdiffrast.torch module, unchanged.
  torch                 TORCH_BACKEND below, written for three.ws from the
                        standard homogeneous rasterisation maths (Olano and
                        Greer, 1997). It shares no code with nvdiffrast. It runs
                        on CPU and CUDA with no compiled extension, and needs
                        only torch (BSD-3).

The torch backend reproduces the nvdiffrast surface the bake uses, with the
same output layout, so callers swap without edits:

  rasterize(ctx, pos, tri, resolution, ranges=None, grad_db=True)
      -> (rast [B,H,W,4] = (b0, b1, z/w, triangle_id + 1), rast_db [B,H,W,4])
  interpolate(attr, rast, tri, rast_db=None, diff_attrs=None)
      -> (out [B,H,W,C], derivatives)

Semantics: pixel centres sit at NDC ((x + 0.5) * 2 / W - 1, (y + 0.5) * 2 / H - 1)
with row 0 at NDC y = -1. Barycentrics are perspective-correct and clamped to
the triangle like nvdiffrast's, and interpolation is b0*a0 + b1*a1 + (1-b0-b1)*a2.
No winding is culled. The depth test keeps the smallest z/w, and an exact tie
goes to the lowest triangle id, so the output is deterministic. Pixels on an
edge shared by two triangles go to one of them, never neither. Triangles with a
vertex at w <= 0 (behind the eye) are dropped rather than clipped against the
near plane. That cannot happen in the UV bake (w is 1), and it costs only
triangles that cross the camera plane in a perspective render. Fragments whose
z/w falls outside [-1, 1] are clipped, as the near and far planes clip them in
nvdiffrast.

Barycentrics, z/w and rast_db are rebuilt from `pos` with differentiable torch
ops, so gradients flow to `pos` and to `attr` through interpolate. Only the
choice of triangle per pixel is discrete, as it is in nvdiffrast.
"""

from __future__ import annotations

import importlib
import importlib.machinery
import importlib.util
import logging
import os
import sys
import types

import torch

log = logging.getLogger("bake_raster")

BACKEND_ENV = "BAKE_RASTER_BACKEND"
BUDGET_ENV = "BAKE_RASTER_CANDIDATE_BUDGET"
BACKENDS = ("nvdiffrast", "torch")
DEFAULT_BACKEND = "nvdiffrast"
# Candidate (pixel, triangle) pairs tested per pass. Each costs a few dozen bytes,
# so the default keeps one pass near 200 MB on any device.
DEFAULT_CANDIDATE_BUDGET = 1 << 22

_KEY_EMPTY = torch.iinfo(torch.int64).max
_W_EPS = 1e-8
_BBOX_EPS = 1e-4
_FLOAT_EXACT_IDS = 1 << 24  # 16777216: largest id a float32 holds exactly
_ID_BITS_BIAS = 0x4A800000  # bit pattern of 2**22 * 4, nvdiffrast's id encoding above 2**24


def encode_triangle_ids(ids: torch.Tensor) -> torch.Tensor:
    """triangle_id + 1 values -> the float32 channel nvdiffrast writes.

    Up to 2**24 the value is stored as a plain float. Above that a float32 cannot
    hold every integer, so the id is stored as the bit pattern bias + id, the
    same encoding nvdiffrast uses, which keeps both backends interchangeable.
    """
    ids = ids.to(torch.int64)
    plain = ids.to(torch.float32)
    big = (ids + _ID_BITS_BIAS).to(torch.int32).view(torch.float32)
    return torch.where(ids <= _FLOAT_EXACT_IDS, plain, big)


def decode_triangle_ids(values: torch.Tensor) -> torch.Tensor:
    """Inverse of encode_triangle_ids: float32 channel -> int64 triangle_id + 1."""
    values = values.to(torch.float32).contiguous()
    plain = values.to(torch.int64)
    big = values.view(torch.int32).to(torch.int64) - _ID_BITS_BIAS
    return torch.where(values <= float(_FLOAT_EXACT_IDS), plain, big)


def _orderable(z: torch.Tensor) -> torch.Tensor:
    """float32 -> int64 that sorts in the same order (sign-magnitude flip)."""
    bits = z.to(torch.float32).contiguous().view(torch.int32)
    flipped = torch.where(bits < 0, bits ^ 0x7FFFFFFF, bits)
    return flipped.to(torch.int64)


def _edges(v: torch.Tensor, fx: torch.Tensor, fy: torch.Tensor):
    """Homogeneous edge functions at pixel centre (fx, fy) for triangles v [N,3,4]."""
    px = v[..., 0] - fx.unsqueeze(-1) * v[..., 3]
    py = v[..., 1] - fy.unsqueeze(-1) * v[..., 3]
    a0 = px[:, 1] * py[:, 2] - py[:, 1] * px[:, 2]
    a1 = px[:, 2] * py[:, 0] - py[:, 2] * px[:, 0]
    a2 = px[:, 0] * py[:, 1] - py[:, 0] * px[:, 1]
    return a0, a1, a2


def _budget(candidate_budget: int | None) -> int:
    if candidate_budget is not None:
        return max(1, int(candidate_budget))
    raw = os.environ.get(BUDGET_ENV, "").strip()
    if raw:
        try:
            return max(1, int(raw))
        except ValueError:
            log.warning("%s=%r is not an integer; using %d", BUDGET_ENV, raw, DEFAULT_CANDIDATE_BUDGET)
    return DEFAULT_CANDIDATE_BUDGET


def _raster_one(p, faces, tids, height, width, budget, want_db):
    """Rasterise triangles faces[tids] of positions p [V,4] into one image."""
    device = p.device
    rast = torch.zeros(height * width, 4, dtype=torch.float32, device=device)
    db = torch.zeros(height * width, 4, dtype=torch.float32, device=device) if want_db else None

    with torch.no_grad():
        zkey = torch.full((height * width,), _KEY_EMPTY, dtype=torch.int64, device=device)
        if tids.numel():
            v = p.detach()[faces[tids]]  # [T,3,4]
            w = v[..., 3]
            front = (w > _W_EPS).all(dim=1)
            safe_w = torch.where(front.unsqueeze(1), w, torch.ones_like(w))
            sx = (v[..., 0] / safe_w + 1) * (width / 2) - 0.5
            sy = (v[..., 1] / safe_w + 1) * (height / 2) - 0.5
            area = (sx[:, 1] - sx[:, 0]) * (sy[:, 2] - sy[:, 0]) - (sx[:, 2] - sx[:, 0]) * (sy[:, 1] - sy[:, 0])
            x0 = torch.ceil(sx.min(dim=1).values - _BBOX_EPS).clamp(min=0)
            x1 = torch.floor(sx.max(dim=1).values + _BBOX_EPS).clamp(max=width - 1)
            y0 = torch.ceil(sy.min(dim=1).values - _BBOX_EPS).clamp(min=0)
            y1 = torch.floor(sy.max(dim=1).values + _BBOX_EPS).clamp(max=height - 1)
            bw = (x1 - x0 + 1).clamp(min=0).to(torch.int64)
            bh = (y1 - y0 + 1).clamp(min=0).to(torch.int64)
            keep = front & (area.abs() > 1e-12) & (bw > 0) & (bh > 0)
            v, tids_k = v[keep], tids[keep]
            x0, y0, bw = x0[keep].to(torch.int64), y0[keep].to(torch.int64), bw[keep]
            counts = bw * bh[keep]
            if counts.numel():
                ends = torch.cumsum(counts, dim=0)
                total = int(ends[-1])
                for start in range(0, total, budget):
                    g = torch.arange(start, min(total, start + budget), device=device, dtype=torch.int64)
                    t = torch.searchsorted(ends, g, right=True)
                    off = g - (ends[t] - counts[t])
                    px = x0[t] + off % bw[t]
                    py = y0[t] + off // bw[t]
                    fx = (px.to(torch.float32) + 0.5) * (2.0 / width) - 1.0
                    fy = (py.to(torch.float32) + 0.5) * (2.0 / height) - 1.0
                    vt = v[t]
                    a0, a1, a2 = _edges(vt, fx, fy)
                    s = a0 + a1 + a2
                    inside = ((a0 >= 0) & (a1 >= 0) & (a2 >= 0) & (s > 0)) | (
                        (a0 <= 0) & (a1 <= 0) & (a2 <= 0) & (s < 0)
                    )
                    zn = vt[:, 0, 2] * a0 + vt[:, 1, 2] * a1 + vt[:, 2, 2] * a2
                    wn = vt[:, 0, 3] * a0 + vt[:, 1, 3] * a1 + vt[:, 2, 3] * a2
                    zw = zn / torch.where(wn == 0, torch.ones_like(wn), wn)
                    inside &= (zw >= -1) & (zw <= 1)
                    if not bool(inside.any()):
                        continue
                    key = (_orderable(zw[inside]) << 32) | tids_k[t][inside]
                    zkey.scatter_reduce_(0, (py * width + px)[inside], key, reduce="amin", include_self=True)
        hit = torch.nonzero(zkey != _KEY_EMPTY, as_tuple=True)[0]
        win = zkey[hit] & 0xFFFFFFFF

    if hit.numel() == 0:
        return rast.view(height, width, 4), (db.view(height, width, 4) if want_db else None)

    vv = p[faces[win]]  # differentiable gather
    hx = (hit % width).to(torch.float32)
    hy = torch.div(hit, width, rounding_mode="floor").to(torch.float32)
    fx = (hx + 0.5) * (2.0 / width) - 1.0
    fy = (hy + 0.5) * (2.0 / height) - 1.0
    a0, a1, a2 = _edges(vv, fx, fy)
    s = a0 + a1 + a2
    b0 = a0 / s
    b1 = a1 / s
    zw = (vv[:, 0, 2] * a0 + vv[:, 1, 2] * a1 + vv[:, 2, 2] * a2) / (
        vv[:, 0, 3] * a0 + vv[:, 1, 3] * a1 + vv[:, 2, 3] * a2
    )
    b0c = b0.clamp(0.0, 1.0)
    b1c = b1.clamp(0.0, 1.0)
    scale = 1.0 / torch.clamp(b0c + b1c, min=1.0)
    values = torch.stack(
        [b0c * scale, b1c * scale, zw.clamp(-1.0, 1.0), encode_triangle_ids(win + 1)], dim=-1
    )
    rast = rast.index_put((hit,), values)

    if want_db:
        # a_i is linear in the pixel centre, so its derivatives are closed form:
        # d a_i / d fx = p_j.y w_k - w_j p_k.y, d a_i / d fy = w_j p_k.x - p_j.x w_k.
        x, y, w = vv[..., 0], vv[..., 1], vv[..., 3]

        def d_edge(i, j, k):
            return y[:, j] * w[:, k] - w[:, j] * y[:, k], w[:, j] * x[:, k] - x[:, j] * w[:, k]

        d0x, d0y = d_edge(0, 1, 2)
        d1x, d1y = d_edge(1, 2, 0)
        d2x, d2y = d_edge(2, 0, 1)
        dsx, dsy = d0x + d1x + d2x, d0y + d1y + d2y
        sx_scale, sy_scale = 2.0 / width, 2.0 / height
        dudx = (d0x * s - a0 * dsx) / (s * s) * sx_scale
        dudy = (d0y * s - a0 * dsy) / (s * s) * sy_scale
        dvdx = (d1x * s - a1 * dsx) / (s * s) * sx_scale
        dvdy = (d1y * s - a1 * dsy) / (s * s) * sy_scale
        db = db.index_put((hit,), torch.stack([dudx, dudy, dvdx, dvdy], dim=-1))
        db = db.view(height, width, 4)

    return rast.view(height, width, 4), db


class TorchRasterizeContext:
    """Stand-in for nvdiffrast's RasterizeCudaContext / RasterizeGLContext.

    The torch backend keeps no GPU state, so the context only records the device
    callers ask for. Accepts the same keyword arguments nvdiffrast's contexts do.
    """

    def __init__(self, device=None, output_db=True, mode="automatic"):
        self.device = torch.device(device) if device is not None else None
        self.output_db = bool(output_db)
        self.mode = mode
        self.active_depth_peeler = None


def rasterize(glctx, pos, tri, resolution, ranges=None, grad_db=True, candidate_budget=None):
    """Rasterise triangles; same arguments and output layout as nvdiffrast.rasterize.

    `pos` is [B,V,4] clip-space positions (instanced mode, `tri` shared by every
    batch item) or [V,4] together with `ranges` [B,2] of (first, count) triangle
    ranges (range mode). Returns (rast, rast_db); rast_db is an empty tensor when
    grad_db is False, as in nvdiffrast.
    """
    if not isinstance(pos, torch.Tensor) or not isinstance(tri, torch.Tensor):
        raise TypeError("pos and tri must be torch tensors")
    height, width = int(resolution[0]), int(resolution[1])
    if height <= 0 or width <= 0:
        raise ValueError(f"resolution must be positive, got {tuple(resolution)}")
    if tri.dim() != 2 or tri.shape[1] != 3:
        raise ValueError(f"tri must be [T,3], got {tuple(tri.shape)}")
    pos = pos.to(torch.float32)
    device = pos.device
    faces = tri.to(device=device, dtype=torch.int64)
    want_db = bool(grad_db) and getattr(glctx, "output_db", True)
    budget = _budget(candidate_budget)

    if ranges is not None and ranges.numel() > 0:
        if pos.dim() != 2 or pos.shape[1] != 4:
            raise ValueError(f"range mode needs pos [V,4], got {tuple(pos.shape)}")
        items = []
        for first, count in ranges.to("cpu", torch.int64).tolist():
            ids = torch.arange(first, first + count, device=device, dtype=torch.int64)
            items.append((pos, ids))
    else:
        if pos.dim() != 3 or pos.shape[2] != 4:
            raise ValueError(f"instanced mode needs pos [B,V,4], got {tuple(pos.shape)}")
        all_ids = torch.arange(faces.shape[0], device=device, dtype=torch.int64)
        items = [(pos[b], all_ids) for b in range(pos.shape[0])]

    rasts, dbs = [], []
    for p, ids in items:
        r, d = _raster_one(p, faces, ids, height, width, budget, want_db)
        rasts.append(r)
        if want_db:
            dbs.append(d)
    rast = torch.stack(rasts)
    rast_db = torch.stack(dbs) if want_db else torch.empty(0, device=device)
    return rast, rast_db


def interpolate(attr, rast, tri, rast_db=None, diff_attrs=None):
    """Interpolate vertex attributes over a rasterised image, as nvdiffrast does.

    `attr` is [V,C] (shared) or [B,V,C]. Returns (out [B,H,W,C], derivatives).
    Derivatives [B,H,W,2*len(diff)] in (d/dX, d/dY) pairs are produced when
    `diff_attrs` ("all" or a list of channel indices) and `rast_db` are given;
    otherwise an empty tensor, matching nvdiffrast.
    """
    batch, height, width, _ = rast.shape
    device = rast.device
    faces = tri.to(device=device, dtype=torch.int64)
    if attr.dim() == 2:
        attr = attr.unsqueeze(0).expand(batch, -1, -1)
    attr = attr.to(device=device, dtype=torch.float32)
    channels = attr.shape[-1]
    ids = decode_triangle_ids(rast[..., 3]) - 1  # [B,H,W]
    valid = ids >= 0
    b_idx, y_idx, x_idx = torch.nonzero(valid, as_tuple=True)
    f = faces[ids[valid]]  # [N,3]
    a0 = attr[b_idx, f[:, 0]]
    a1 = attr[b_idx, f[:, 1]]
    a2 = attr[b_idx, f[:, 2]]
    r = rast[b_idx, y_idx, x_idx]
    u, v = r[:, 0:1], r[:, 1:2]
    values = u * a0 + v * a1 + (1 - u - v) * a2
    out = torch.zeros(batch, height, width, channels, dtype=torch.float32, device=device)
    out = out.index_put((b_idx, y_idx, x_idx), values)

    if diff_attrs is None or rast_db is None or rast_db.numel() == 0:
        return out, torch.empty(0, device=device)
    chans = list(range(channels)) if diff_attrs == "all" else [int(c) for c in diff_attrs]
    d = rast_db[b_idx, y_idx, x_idx]
    da = []
    for c in chans:
        e0 = (a0[:, c] - a2[:, c])
        e1 = (a1[:, c] - a2[:, c])
        da += [e0 * d[:, 0] + e1 * d[:, 2], e0 * d[:, 1] + e1 * d[:, 3]]
    deriv = torch.zeros(batch, height, width, 2 * len(chans), dtype=torch.float32, device=device)
    deriv = deriv.index_put((b_idx, y_idx, x_idx), torch.stack(da, dim=-1))
    return out, deriv


def _make_torch_backend() -> types.ModuleType:
    mod = types.ModuleType("bake_raster.torch_backend")
    mod.__doc__ = "Pure-PyTorch rasteriser exposing the nvdiffrast.torch surface the bake uses."
    mod.__spec__ = importlib.machinery.ModuleSpec("bake_raster.torch_backend", None)
    mod.RasterizeCudaContext = TorchRasterizeContext
    mod.RasterizeGLContext = TorchRasterizeContext
    mod.rasterize = rasterize
    mod.interpolate = interpolate
    mod.BACKEND = "torch"
    return mod


TORCH_BACKEND = _make_torch_backend()


def backend_name(name: str | None = None) -> str:
    """Resolve the backend: explicit name, else BAKE_RASTER_BACKEND, else nvdiffrast."""
    raw = name if name is not None else os.environ.get(BACKEND_ENV, "")
    chosen = (raw or DEFAULT_BACKEND).strip().lower()
    if chosen not in BACKENDS:
        raise ValueError(f"{BACKEND_ENV}={raw!r} is not one of {', '.join(BACKENDS)}")
    return chosen


def _nvdiffrast_is_real() -> bool:
    shim = sys.modules.get("nvdiffrast.torch")
    if shim is TORCH_BACKEND:
        return False
    try:
        return importlib.util.find_spec("nvdiffrast") is not None
    except (ValueError, ImportError):
        return False


def load_backend(name: str | None = None):
    """Return the module-like object (`dr`) for the chosen backend."""
    chosen = backend_name(name)
    if chosen == "torch":
        return TORCH_BACKEND
    if not _nvdiffrast_is_real():
        raise RuntimeError(
            "nvdiffrast is not installed in this image; set BAKE_RASTER_BACKEND=torch "
            "to bake with the pure-PyTorch rasteriser"
        )
    return importlib.import_module("nvdiffrast.torch")


def _register_shim() -> None:
    pkg = types.ModuleType("nvdiffrast")
    pkg.__spec__ = importlib.machinery.ModuleSpec("nvdiffrast", None, is_package=True)
    pkg.__path__ = []
    pkg.torch = TORCH_BACKEND
    sys.modules["nvdiffrast"] = pkg
    sys.modules["nvdiffrast.torch"] = TORCH_BACKEND


def install(name: str | None = None, modules=("o_voxel.postprocess",)) -> str:
    """Route the named modules' module-level `dr` to the chosen backend.

    With the torch backend on an image that has no nvdiffrast, `nvdiffrast` and
    `nvdiffrast.torch` are registered as shims first, so upstream modules that
    `import nvdiffrast.torch as dr` at import time still load and bake through
    the torch rasteriser. Returns the backend name actually installed.
    """
    chosen = backend_name(name)
    if chosen == "torch" and not _nvdiffrast_is_real():
        _register_shim()
    dr = load_backend(chosen)
    for mod_name in modules:
        mod = sys.modules.get(mod_name) or importlib.import_module(mod_name)
        mod.dr = dr
    log.info("bake rasteriser: %s (%s)", chosen, ", ".join(modules) or "no modules rebound")
    return chosen
