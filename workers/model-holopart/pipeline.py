"""
HoloPart (VAST-AI-Research/HoloPart, MIT) in-process pipeline wrapper: an
already part-segmented mesh in, a mesh with every part's occluded geometry
completed out. Unlike PartCrafter (which generates parts from a 2D image),
HoloPart takes a 3D mesh that is ALREADY split into named part geometries
(a trimesh.Scene GLB, one node per part, exactly the shape workers/segment
emits) and fills in the geometry each part is missing where it touches or
is hidden behind its neighbors.

Upstream's own script (scripts/inference_holopart.py) reads this straight
from `trimesh.Scene.geometry.items()` and, critically, writes
`part_mesh.name = part_id_list[i]` on every output part: node names survive
the round trip with no extra work from this wrapper, which is exactly what
work order 070's Task 3 (keep node names stable across sources) requires.
This wrapper mirrors workers/model-anigen's importable-pipeline pattern: load
the model once behind a lock, call it directly, no subprocess.
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path

log = logging.getLogger("model-holopart.pipeline")

_lock = threading.Lock()
_pipeline = None

NUM_SURFACE_SAMPLES = 20480
PART_NORMALIZE_SCALE = 0.7
MIN_PARTS = 2
MAX_PARTS = 64


def load_pipeline(holopart_weights_dir: str, device: str = "cuda"):
    """Load (once) and return the HoloPartPipeline singleton.

    Import is deferred to call time, not module top: this lets
    test_app_contract.py exercise request validation and output handling
    without HoloPart's checkout or its GPU dependencies installed.
    """
    global _pipeline
    with _lock:
        if _pipeline is None:
            import torch
            from holopart.pipelines.pipeline_holopart import HoloPartPipeline

            log.info("loading HoloPart pipeline: weights=%s", holopart_weights_dir)
            pipeline = HoloPartPipeline.from_pretrained(holopart_weights_dir)
            pipeline = pipeline.to(device, torch.float16)
            _pipeline = pipeline
        return _pipeline


class PartCompletionError(RuntimeError):
    """HoloPart ran but produced nothing usable: the input GLB had fewer
    than two named part geometries, or every decoded part came back empty.
    Not a transient failure; the caller's mesh needs re-segmenting first."""


def _prepare_batch(scene, device: str):
    """Build HoloPart's per-part + whole-object conditioning tensors from a
    trimesh.Scene whose geometries are already the named parts, mirroring
    upstream's own prepare_data() for the .glb branch exactly (including its
    per-part local normalization), minus its argparse/CLI plumbing."""
    import numpy as np
    import torch
    import trimesh
    from torch_cluster import nearest

    part_name_list: list[str] = []
    part_pcd_list = []
    whole_cond_list = []
    part_cond_list = []
    part_local_cond_list = []
    part_center_list = []
    part_scale_list = []

    geometries = list(scene.geometry.items())
    if len(geometries) < MIN_PARTS:
        raise PartCompletionError(
            f"input mesh has {len(geometries)} named part geometr{'y' if len(geometries) == 1 else 'ies'}; "
            f"HoloPart needs at least {MIN_PARTS} (segment the mesh into parts first)"
        )

    for i, (name, part_mesh) in enumerate(geometries):
        part_surface_points, face_idx = part_mesh.sample(NUM_SURFACE_SAMPLES, return_index=True)
        part_surface_normals = part_mesh.face_normals[face_idx]
        part_pcd = np.concatenate([part_surface_points, np.ones_like(part_surface_points[:, :1]) * i], axis=-1)
        part_pcd_list.append(part_pcd)

        part_surface_points_t = torch.FloatTensor(part_surface_points)
        part_surface_normals_t = torch.FloatTensor(part_surface_normals)
        part_cond = torch.cat([part_surface_points_t, part_surface_normals_t], dim=-1)
        part_local_cond = part_cond.clone()
        part_cond_max = part_local_cond[:, :3].max(dim=0)[0]
        part_cond_min = part_local_cond[:, :3].min(dim=0)[0]
        part_center_new = (part_cond_max + part_cond_min) / 2
        part_local_cond[:, :3] = part_local_cond[:, :3] - part_center_new
        part_scale_new = (part_local_cond[:, :3].abs().max() / (0.95 * PART_NORMALIZE_SCALE)).item()
        part_local_cond[:, :3] = part_local_cond[:, :3] / part_scale_new
        part_cond_list.append(part_cond)
        part_local_cond_list.append(part_local_cond)
        part_name_list.append(name)
        part_center_list.append(part_center_new)
        part_scale_list.append(part_scale_new)

    part_pcd = np.concatenate(part_pcd_list, axis=0)
    part_pcd_t = torch.FloatTensor(part_pcd).to(device)
    whole_mesh = scene.dump(concatenate=True)
    whole_surface_points, face_idx = whole_mesh.sample(NUM_SURFACE_SAMPLES, return_index=True)
    whole_surface_normals = whole_mesh.face_normals[face_idx]
    whole_surface_points_t = torch.FloatTensor(whole_surface_points)
    whole_surface_normals_t = torch.FloatTensor(whole_surface_normals)
    whole_surface_points_device = whole_surface_points_t.to(device)
    nearest_idx = nearest(whole_surface_points_device, part_pcd_t[:, :3])
    nearest_part = part_pcd_t[nearest_idx][:, 3].cpu()
    for i in range(len(part_cond_list)):
        surface_points_part_mask = (nearest_part == i).float()
        whole_cond = torch.cat(
            [whole_surface_points_t, whole_surface_normals_t, surface_points_part_mask[..., None]], dim=-1
        )
        whole_cond_list.append(whole_cond)

    return {
        "whole_cond": torch.stack(whole_cond_list, dim=0).to(device),
        "part_cond": torch.stack(part_cond_list, dim=0).to(device),
        "part_local_cond": torch.stack(part_local_cond_list, dim=0).to(device),
        "part_id_list": part_name_list,
        "part_center_list": part_center_list,
        "part_scale_list": part_scale_list,
    }


def _simplify_mesh(mesh, n_faces: int):
    import pymeshlab
    import trimesh

    pm_mesh = pymeshlab.Mesh(mesh.vertices, mesh.faces)
    ms = pymeshlab.MeshSet()
    ms.add_mesh(pm_mesh)
    ms.meshing_merge_close_vertices()
    ms.meshing_decimation_quadric_edge_collapse(targetfacenum=n_faces)
    simplified = ms.current_mesh()
    return trimesh.Trimesh(vertices=simplified.vertex_matrix(), faces=simplified.face_matrix())


def _golden_ratio_color(index: int) -> str:
    """Same visual convention as workers/segment/segment_core.py and
    workers/model-partcrafter/pipeline.py: a distinct, evenly-spread hue per
    part. Upstream's own script tints with `np.random.rand`; this wrapper
    uses the platform's deterministic scheme instead, so a completed part
    keeps the same color a caller already associated with that part id."""
    import colorsys

    golden_ratio_conjugate = 0.618033988749895
    hue = (index * golden_ratio_conjugate) % 1.0
    r, g, b = colorsys.hsv_to_rgb(hue, 0.55, 0.92)
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


def run_holopart(
    scene,
    output_glb: Path,
    *,
    holopart_weights_dir: str,
    seed: int = 42,
    num_inference_steps: int = 50,
    guidance_scale: float = 3.5,
    batch_size: int = 8,
    simplify_target_faces: int = 10000,
    device: str = "cuda",
) -> dict:
    """Run HoloPart end to end on an already part-segmented trimesh.Scene,
    writing a single named-node GLB (part names preserved verbatim from the
    input) to `output_glb`, and return a parts manifest shaped like
    workers/segment's (so both sources render through the same Parts Studio /
    Restyle Studio UI)."""
    import numpy as np
    import torch
    import trimesh

    from holopart.inference_utils import flash_extract_geometry

    pipeline = load_pipeline(holopart_weights_dir, device=device)
    batch = _prepare_batch(scene, device=device)

    part_surface = batch["part_cond"]
    whole_surface = batch["whole_cond"]
    part_local_surface = batch["part_local_cond"]
    part_id_list = batch["part_id_list"]
    part_center_list = batch["part_center_list"]
    part_scale_list = batch["part_scale_list"]

    latent_list = []
    with torch.no_grad():
        for i in range(0, len(part_surface), batch_size):
            meshes_latent = pipeline(
                part_surface=part_surface[i : i + batch_size],
                whole_surface=whole_surface[i : i + batch_size],
                part_local_surface=part_local_surface[i : i + batch_size],
                num_inference_steps=num_inference_steps,
                guidance_scale=guidance_scale,
                generator=torch.Generator(device=device).manual_seed(seed),
                output_type="latent",
            ).samples
            latent_list.append(meshes_latent)
        meshes_latent = torch.cat(latent_list, dim=0)
        pipeline.vae.set_flash_decoder()

        usable_parts = []
        out_scene = trimesh.Scene()
        parts_manifest: list[dict] = []
        for i, mesh_latent in enumerate(meshes_latent):
            output = flash_extract_geometry(
                mesh_latent.unsqueeze(0),
                pipeline.vae,
                bounds=(-1.05, -1.05, -1.05, 1.05, 1.05, 1.05),
                octree_depth=9,
                num_chunks=10000,
            )
            if not output or output[0] is None:
                continue
            meshes = [trimesh.Trimesh(mesh_v_f[0].astype(np.float32), mesh_v_f[1]) for mesh_v_f in output]
            part_mesh = trimesh.util.concatenate(meshes)
            if len(part_mesh.vertices) == 0:
                continue
            part_mesh = _simplify_mesh(part_mesh, simplify_target_faces)
            part_mesh.apply_scale(part_scale_list[i])
            part_mesh.apply_translation(part_center_list[i])

            node_name = part_id_list[i]
            color = _golden_ratio_color(i)
            rgba = trimesh.visual.color.hex_to_rgba(color)
            part_mesh.visual = trimesh.visual.ColorVisuals(
                part_mesh, vertex_colors=np.tile(rgba, (len(part_mesh.vertices), 1))
            )
            out_scene.add_geometry(part_mesh, node_name=node_name, geom_name=node_name)
            bbox = part_mesh.bounds
            parts_manifest.append({
                "id": node_name,
                "name": node_name,
                "region": node_name,
                "face_count": int(len(part_mesh.faces)),
                "vertex_count": int(len(part_mesh.vertices)),
                "bbox": {"min": bbox[0].tolist(), "max": bbox[1].tolist()},
                "centroid": part_mesh.centroid.tolist(),
                "volume": float(part_mesh.volume) if part_mesh.is_volume else 0.0,
                "color": color,
            })
            usable_parts.append(node_name)

    if not usable_parts:
        raise PartCompletionError("HoloPart completed no usable parts from this mesh")

    output_glb.parent.mkdir(parents=True, exist_ok=True)
    out_scene.export(output_glb, file_type="glb")

    return {
        "glb_bytes": output_glb.read_bytes(),
        "parts": parts_manifest,
        "part_count": len(usable_parts),
    }
