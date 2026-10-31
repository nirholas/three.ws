"""Orchestration for one LATO.2 retopology job, free of FastAPI and GCS.

`retopologize` takes a loaded source mesh and a `Runner` (the thing that turns a
normalised input mesh into LATO.2's generated mesh) and returns a gated result.
The production runner shells out to the pinned upstream `e2e_inference.py`; tests
pass a runner that returns known geometry, so the retry, gate and frame logic is
exercised without a GPU.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import trimesh

import lato_policy as lp

log = logging.getLogger("lato2")

LATO_ROOT = Path(os.environ.get("LATO_ROOT", "/app/LATO.2"))
INFERENCE_TIMEOUT_S = int(os.environ.get("LATO_TIMEOUT_S", "240"))
# Distinct seeds: a generative sampler that tore the topology once usually
# succeeds on another draw, and that is far cheaper than a QuadriFlow failover.
SEEDS = (42, 7, 1234)

# (normalised vertices, normalised faces) -> generated (vertices, faces) in the
# same normalised frame. Raises RuntimeError on a failed inference.
Runner = Callable[[np.ndarray, np.ndarray, int, int], "tuple[np.ndarray, np.ndarray]"]


class RetopoRejected(Exception):
    """No attempt produced a mesh fit to return. `reason` is a lato_policy gate
    code the caller maps to a QuadriFlow failover."""

    def __init__(self, reason: str, attempts: list[dict]):
        super().__init__(reason)
        self.reason = reason
        self.attempts = attempts


@dataclass
class RetopoResult:
    vertices: np.ndarray
    faces: np.ndarray
    colors: Optional[np.ndarray]
    report: dict
    fidelity: float
    seed: int
    attempts: list[dict] = field(default_factory=list)


def subprocess_runner(verts: np.ndarray, faces: np.ndarray, vert_num: int, seed: int):
    """Run the pinned upstream pipeline on one mesh and read its OBJ back."""
    script = LATO_ROOT / "scripts" / "e2e_inference.py"
    with tempfile.TemporaryDirectory(prefix="lato-") as tmp:
        src, out = Path(tmp) / "in", Path(tmp) / "out"
        src.mkdir()
        out.mkdir()
        trimesh.Trimesh(verts, faces, process=False).export(src / "mesh.obj")
        cmd = [
            sys.executable, "-I", str(script),
            "--mesh_dir", str(src), "--out_dir", str(out),
            "--vert_num", str(vert_num), "--seed", str(seed),
            "--num_workers", "0",
        ]
        proc = subprocess.run(
            cmd, cwd=str(LATO_ROOT), capture_output=True, text=True,
            timeout=INFERENCE_TIMEOUT_S,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"LATO.2 inference exited {proc.returncode}: {proc.stderr[-600:]}")
        produced = sorted(out.glob("*_pred.obj"))
        if not produced:
            raise RuntimeError("LATO.2 inference produced no mesh")
        gen = trimesh.load(produced[0], file_type="obj", process=False, force="mesh")
        return np.asarray(gen.vertices, dtype=np.float64), np.asarray(gen.faces, dtype=np.int64)


def transfer_colors(source: trimesh.Trimesh, points: np.ndarray) -> Optional[np.ndarray]:
    """Per-vertex RGBA for `points`, sampled from the source's texture (or vertex
    colours) at the nearest surface point. None when the source has neither."""
    visual = source.visual
    uv = getattr(visual, "uv", None)
    material = getattr(visual, "material", None)
    image = None
    if material is not None:
        image = getattr(material, "baseColorTexture", None) or getattr(material, "image", None)
    closest, _, tri = trimesh.proximity.closest_point(source, points)
    if uv is not None and image is not None and len(uv) == len(source.vertices):
        bary = trimesh.triangles.points_to_barycentric(source.triangles[tri], closest)
        uvs = (np.asarray(uv)[source.faces[tri]] * bary[:, :, None]).sum(axis=1)
        img = image.convert("RGBA")
        w, h = img.size
        px = np.asarray(img)
        x = np.clip((uvs[:, 0] % 1.0) * (w - 1), 0, w - 1).round().astype(int)
        y = np.clip((1.0 - (uvs[:, 1] % 1.0)) * (h - 1), 0, h - 1).round().astype(int)
        return px[y, x].astype(np.uint8)
    if visual.kind == "vertex":
        bary = trimesh.triangles.points_to_barycentric(source.triangles[tri], closest)
        vc = np.asarray(visual.vertex_colors, dtype=np.float64)[source.faces[tri]]
        return (vc * bary[:, :, None]).sum(axis=1).clip(0, 255).astype(np.uint8)
    return None


def retopologize(
    source: trimesh.Trimesh,
    target_faces: int,
    runner: Runner = subprocess_runner,
    seeds: tuple[int, ...] = SEEDS,
) -> RetopoResult:
    verts = np.asarray(source.vertices, dtype=np.float64)
    frame = lp.frame_of(verts)
    norm = lp.normalize(verts, frame)
    vert_num = lp.vertex_budget_from_faces(target_faces)

    attempts: list[dict] = []
    best: Optional[RetopoResult] = None
    for seed in seeds:
        try:
            gv, gf = runner(norm, np.asarray(source.faces, dtype=np.int64), vert_num, seed)
        except RuntimeError as exc:
            attempts.append({"seed": seed, "reason": "inference_failed", "detail": str(exc)[:300]})
            log.warning("LATO.2 seed %s failed: %s", seed, exc)
            continue
        gv, gf = lp.drop_debris(gv, gf)
        report = lp.topology_report(gv, gf)
        fid = lp.fidelity_error(gv, norm, 1.0) if len(gv) else float("inf")
        reason = lp.gate_reason(report, fid)
        attempts.append({"seed": seed, "reason": reason or "ok", "faces": report["faces"],
                         "boundary_edge_ratio": round(report["boundary_edge_ratio"], 4),
                         "fidelity": round(fid, 4)})
        if reason is None:
            world = lp.denormalize(gv, frame)
            return RetopoResult(world, gf, transfer_colors(source, world), report, fid, seed, attempts)
        if best is None:
            best = RetopoResult(gv, gf, None, report, fid, seed, attempts)
    reason = attempts[-1]["reason"] if attempts else "inference_failed"
    if best is not None:
        reason = lp.gate_reason(best.report, best.fidelity) or reason
    raise RetopoRejected(reason, attempts)
