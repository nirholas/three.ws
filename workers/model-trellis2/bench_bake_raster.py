"""Benchmark the bake rasteriser backends on real TRELLIS.2 meshes.

Replays the UV-space bake step of ``o_voxel.postprocess.to_glb`` (rasterise the
UV layout in 100k-face chunks, keep the face id, interpolate 3D positions) on
meshes decoded by ``scripts/forge/decode-glb-mesh.mjs``, and reports per mesh:

- wall time of the rasterise loop plus the position interpolation,
- texel coverage against the analytic UV area of the layout,
- the largest texel-centre reprojection error (interpolating the UVs must land
  on the texel centre, a direct check of the barycentrics),
- with ``--backend both``: the share of texels both backends assign to the same
  face and the largest difference in interpolated 3D position.

Usage (one JSON line per mesh on stdout, a summary line last):

    node scripts/forge/decode-glb-mesh.mjs <out_dir> <mesh.glb>...
    python bench_bake_raster.py --raw-dir <out_dir> --size 2048 --backend both
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch

import bake_raster

CHUNK = 100_000  # the chunk size o_voxel.postprocess uses


def load_mesh(raw_dir: Path, mesh_id: str, device: torch.device):
    def read(suffix, dtype, cols):
        data = np.fromfile(raw_dir / f"{mesh_id}.{suffix}", dtype=dtype)
        return torch.from_numpy(data.reshape(-1, cols).copy()).to(device)

    return read("uv.f32", np.float32, 2), read("pos.f32", np.float32, 3), read("idx.i32", np.int32, 3)


def bake(dr, uvs, verts, faces, size):
    """The o_voxel UV bake loop, verbatim in behaviour."""
    ctx = dr.RasterizeCudaContext() if uvs.is_cuda else None
    uvs_rast = torch.cat([uvs * 2 - 1, torch.zeros_like(uvs[:, :1]), torch.ones_like(uvs[:, :1])], dim=-1).unsqueeze(0)
    rast = torch.zeros((1, size, size, 4), device=uvs.device, dtype=torch.float32)
    for i in range(0, faces.shape[0], CHUNK):
        chunk, _ = dr.rasterize(ctx, uvs_rast, faces[i:i + CHUNK], resolution=[size, size])
        mask = chunk[..., 3:4] > 0
        chunk[..., 3:4] += i
        rast = torch.where(mask, chunk, rast)
    pos = dr.interpolate(verts.unsqueeze(0), rast, faces)[0][0]
    return rast, pos


def timed_bake(dr, uvs, verts, faces, size):
    if uvs.is_cuda:
        torch.cuda.synchronize()
    start = time.perf_counter()
    rast, pos = bake(dr, uvs, verts, faces, size)
    if uvs.is_cuda:
        torch.cuda.synchronize()
    return rast, pos, time.perf_counter() - start


def uv_area_texels(uvs, faces, size):
    """Analytic texel count of the layout (charts are disjoint in a TRELLIS.2 unwrap)."""
    tri = uvs[faces.long()].double()
    e1, e2 = tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    area = 0.5 * (e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]).abs().sum().item()
    return area * size * size


def quality(dr, rast, uvs, faces, size):
    mask = rast[0, ..., 3] > 0
    uv_interp = dr.interpolate(uvs.unsqueeze(0), rast, faces)[0][0]
    centres = (torch.arange(size, device=uvs.device, dtype=torch.float32) + 0.5) / size
    gy, gx = torch.meshgrid(centres, centres, indexing="ij")
    err = torch.stack([uv_interp[..., 0] - gx, uv_interp[..., 1] - gy], -1)[mask].abs().max().item() * size
    return int(mask.sum().item()), err


def run(args) -> int:
    torch.set_num_threads(args.threads)
    device = torch.device(args.device)
    backends = ["nvdiffrast", "torch"] if args.backend == "both" else [args.backend]
    loaded = {name: bake_raster.load_backend(name) for name in backends}
    ids = sorted({p.name.split(".")[0] for p in Path(args.raw_dir).glob("*.idx.i32")})[: args.limit]
    if not ids:
        print(f"no decoded meshes in {args.raw_dir}", file=sys.stderr)
        return 2
    rows = []
    for mesh_id in ids:
        uvs, verts, faces = load_mesh(Path(args.raw_dir), mesh_id, device)
        row = {"mesh": mesh_id, "faces": int(faces.shape[0]), "size": args.size,
               "uv_area_texels": round(uv_area_texels(uvs, faces, args.size))}
        results = {}
        for name, dr in loaded.items():
            if device.type == "cuda":
                bake(dr, uvs, verts, faces, args.size)  # warm-up: kernel compile and allocator
            rast, pos, seconds = timed_bake(dr, uvs, verts, faces, args.size)
            covered, err = quality(dr, rast, uvs, faces, args.size)
            results[name] = (rast, pos)
            row[name] = {"seconds": round(seconds, 4), "covered_texels": covered,
                         "coverage_vs_uv_area": round(covered / row["uv_area_texels"], 5),
                         "max_texel_centre_error_texels": round(err, 6)}
        if len(results) == 2:
            (ra, pa), (rb, pb) = results["nvdiffrast"], results["torch"]
            ida, idb = ra[0, ..., 3], rb[0, ..., 3]
            union = (ida > 0) | (idb > 0)
            both = (ida > 0) & (idb > 0)
            row["same_face_share"] = round(((ida == idb) & union).sum().item() / max(1, union.sum().item()), 6)
            row["max_position_delta"] = round((pa - pb)[both & (ida == idb)].abs().max().item(), 8) if both.any() else 0.0
            row["time_ratio_torch_over_nvdiffrast"] = round(row["torch"]["seconds"] / row["nvdiffrast"]["seconds"], 4)
        rows.append(row)
        print(json.dumps(row), flush=True)
    summary = {"summary": True, "meshes": len(rows), "device": str(device), "size": args.size}
    for name in backends:
        summary[f"{name}_total_seconds"] = round(sum(r[name]["seconds"] for r in rows), 3)
        summary[f"{name}_min_coverage_vs_uv_area"] = min(r[name]["coverage_vs_uv_area"] for r in rows)
        summary[f"{name}_max_texel_centre_error_texels"] = max(r[name]["max_texel_centre_error_texels"] for r in rows)
    if len(backends) == 2:
        summary["min_same_face_share"] = min(r["same_face_share"] for r in rows)
        summary["time_ratio_torch_over_nvdiffrast"] = round(
            summary["torch_total_seconds"] / summary["nvdiffrast_total_seconds"], 4)
    print(json.dumps(summary), flush=True)
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--raw-dir", required=True)
    parser.add_argument("--size", type=int, default=2048)
    parser.add_argument("--backend", choices=["torch", "nvdiffrast", "both"], default="torch")
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--threads", type=int, default=int(os.environ.get("BENCH_THREADS", "4")))
    return run(parser.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
