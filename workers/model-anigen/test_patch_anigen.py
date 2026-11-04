"""Unit tests for patch_anigen.py against real excerpts of AniGen's own
source (fetched from VAST-AI-Research/AniGen at the commit this worker
pins, MIT licensed), not synthetic stand-ins: this proves the string
surgery matches what the Docker build will actually see.

No GPU, no torch, no AniGen checkout: `python3 test_patch_anigen.py`.
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import ast

from patch_anigen import (
    NVDIFFRAST_SENTINEL,
    POSTPROCESSING_DR_FUNCTIONS,
    assert_dsine_unreachable,
    patch_mesh_renderer,
    patch_normal_estimator,
    patch_postprocessing_utils,
)

_FAILED = False


def _check(cond: bool, label: str) -> None:
    global _FAILED
    status = "ok" if cond else "FAIL"
    print(f"  [{status}] {label}")
    if not cond:
        _FAILED = True


def _check_raises(fn, exc_type, label: str) -> None:
    try:
        fn()
    except exc_type:
        _check(True, label)
        return
    except Exception as exc:  # noqa: BLE001
        _check(False, f"{label} (raised {type(exc).__name__}, not {exc_type.__name__})")
        return
    _check(False, f"{label} (did not raise)")


# Real excerpt of anigen/utils/postprocessing_utils.py's top-of-file imports
# (VAST-AI-Research/AniGen, MIT), trimmed to what the patch touches plus
# enough surrounding context to prove it leaves everything else untouched.
POSTPROCESSING_UTILS_REAL = '''from typing import *
import gc
import numpy as np
import torch
import utils3d
import nvdiffrast.torch as dr
from tqdm import tqdm
import trimesh
import trimesh.visual
import xatlas
import pyvista as pv
from pymeshfix import _meshfix
import igraph
import cv2
from PIL import Image
from .random_utils import sphere_hammersley_sequence
from .render_utils import render_multiview
from ..renderers import GaussianRenderer
from ..representations import Strivec, Gaussian, MeshExtractResult


def _cuda_cleanup():
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


@torch.no_grad()
def _fill_holes(
    verts,
    faces,
):
    pass
'''


# Real excerpt of the two raster-bake functions in the same file at the pinned
# commit (c49db3d), bodies trimmed to their nvdiffrast call sites. Both keep
# calling `dr.*` after the import is removed, and the docstring still names
# nvdiffrast: the first real Docker build died on exactly this, because the
# fixture above omitted them. This worker never reaches either function
# (pipeline.py passes texture_size=0, the only gate on bake_texture, and
# nothing upstream calls bake_vertex_colors_to_texture).
POSTPROCESSING_UTILS_BAKE_REAL = POSTPROCESSING_UTILS_REAL + '''

def bake_vertex_colors_to_texture(
    dense_vertices: np.ndarray,
    dense_faces: np.ndarray,
    dense_vertex_colors: np.ndarray,
    simp_vertices: np.ndarray,
    simp_faces: np.ndarray,
    simp_uvs: np.ndarray,
    texture_size: int = 1024,
) -> np.ndarray:
    \"\"\"
    For each texel covered by the simplified mesh in UV space, the 3D position
    is computed via nvdiffrast interpolation, then the closest point on the
    dense mesh is queried and its vertex color is barycentric-interpolated.
    \"\"\"
    device = 'cuda'
    # Map UVs to clip space for nvdiffrast: [0,1] -> [-1,1], z=0, w=1
    glctx = dr.RasterizeCudaContext()
    rast_out, _ = dr.rasterize(glctx, uv_clip[None], faces_t, resolution=[texture_size, texture_size])
    pos_map, _ = dr.interpolate(verts_t[None].contiguous(), rast_out, faces_t)
    return pos_map


def bake_texture(
    vertices, faces, uvs, observations, masks, extrinsics, intrinsics,
    texture_size=2048, near=0.1, far=10.0, mode='fast', lambda_tv=1e-2, verbose=False,
):
    for step in range(10):
        render = dr.texture(texture, uv, uv_dr)[0]
    return render
'''

# Real excerpt of anigen/renderers/mesh_renderer.py (VAST-AI-Research/AniGen,
# MIT): the module-level import plus the exact __init__ it must be relocated
# into, and one dr.* call inside .render() that must survive untouched.
MESH_RENDERER_REAL = '''import torch
import nvdiffrast.torch as dr
from easydict import EasyDict as edict
from ..representations.mesh import MeshExtractResult
import torch.nn.functional as F


class MeshRenderer:
    """
    Renderer for the Mesh representation.
    """
    def __init__(self, rendering_options={}, device='cuda'):
        self.rendering_options = edict({
            "resolution": None,
        })
        self.rendering_options.update(rendering_options)
        self.glctx = dr.RasterizeCudaContext(device=device)
        self.device=device

    def render(self, mesh, extrinsics, intrinsics):
        rast, _ = dr.rasterize(self.glctx, None, None, (1, 1))
        return rast
'''


def test_patch_postprocessing_utils_removes_only_the_top_level_import():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "postprocessing_utils.py"
        path.write_text(POSTPROCESSING_UTILS_REAL)
        patch_postprocessing_utils(path)
        patched = path.read_text()
        _check("import nvdiffrast.torch as dr\n" not in patched, "top-level nvdiffrast import removed")
        _check("from .render_utils import render_multiview" in patched, "unrelated import left intact")
        _check("def _fill_holes(" in patched, "function bodies left intact")
        compile(patched, str(path), "exec")
        print("  [ok] patched file is syntactically valid Python")


def test_patch_postprocessing_utils_raises_on_drifted_marker():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "postprocessing_utils.py"
        path.write_text(POSTPROCESSING_UTILS_REAL.replace(
            "import nvdiffrast.torch as dr\n", "import nvdiffrast as nvd\n"
        ))
        _check_raises(
            lambda: patch_postprocessing_utils(path), AssertionError,
            "raises when the expected import line is not found (upstream drift)",
        )


def _dr_users(source: str) -> set[str]:
    """Top-level functions whose bodies reference the name `dr`."""
    users = set()
    for node in ast.parse(source).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if any(isinstance(n, ast.Name) and n.id == "dr" for n in ast.walk(node)):
                users.add(node.name)
    return users


def test_patch_postprocessing_utils_handles_the_real_bake_call_sites():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "postprocessing_utils.py"
        path.write_text(POSTPROCESSING_UTILS_BAKE_REAL)
        patch_postprocessing_utils(path)
        patched = path.read_text()
        tree = ast.parse(patched)
        imports_nvdiffrast = any(
            (isinstance(n, ast.Import) and any(a.name.startswith("nvdiffrast") for a in n.names))
            or (isinstance(n, ast.ImportFrom) and (n.module or "").startswith("nvdiffrast"))
            for n in ast.walk(tree)
        )
        _check(not imports_nvdiffrast, "no nvdiffrast import of any kind survives the patch")
        _check(
            _dr_users(patched) == {"bake_vertex_colors_to_texture", "bake_texture"},
            "dr is used only inside the two known raster-bake functions",
        )
        _check(NVDIFFRAST_SENTINEL in patched, "module-level dr is bound to the unavailable sentinel")
        compile(patched, str(path), "exec")
        print("  [ok] patched file with the real bake call sites is valid Python")


def test_nvdiffrast_sentinel_fails_loudly_when_touched():
    scope: dict = {}
    exec(NVDIFFRAST_SENTINEL, scope)
    dr = scope["dr"]
    try:
        dr.rasterize
    except RuntimeError as exc:
        _check("texture_size=0" in str(exc), "touching dr raises a RuntimeError naming the fix")
        return
    _check(False, "touching dr raises a RuntimeError naming the fix (did not raise)")


def test_patch_postprocessing_utils_raises_when_a_new_function_uses_dr():
    drifted = POSTPROCESSING_UTILS_BAKE_REAL + '''

def postprocess_mesh(vertices, faces):
    return dr.antialias(vertices, faces)
'''
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "postprocessing_utils.py"
        path.write_text(drifted)
        _check_raises(
            lambda: patch_postprocessing_utils(path), AssertionError,
            "raises when nvdiffrast reaches a function outside the known bake pair (upstream drift)",
        )


def test_known_dr_functions_constant_matches_the_bake_pair():
    _check(
        set(POSTPROCESSING_DR_FUNCTIONS) == {"bake_vertex_colors_to_texture", "bake_texture"},
        "the allowed dr users are exactly the two raster-bake functions",
    )


def test_patch_mesh_renderer_relocates_import_into_init():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "mesh_renderer.py"
        path.write_text(MESH_RENDERER_REAL)
        patch_mesh_renderer(path)
        patched = path.read_text()
        lines = patched.splitlines()
        top_lines = "\n".join(lines[:6])
        _check("import nvdiffrast" not in top_lines, "module-level nvdiffrast import removed from the top")
        init_idx = next(i for i, l in enumerate(lines) if "def __init__" in l)
        _check(
            "import nvdiffrast.torch as dr" in lines[init_idx + 1],
            "nvdiffrast import relocated to the first line of __init__",
        )
        _check("dr.rasterize(self.glctx, None, None, (1, 1))" in patched, "render() body left intact")
        compile(patched, str(path), "exec")
        print("  [ok] patched file is syntactically valid Python")


def test_patch_mesh_renderer_raises_on_drifted_marker():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "mesh_renderer.py"
        path.write_text(MESH_RENDERER_REAL.replace(
            "def __init__(self, rendering_options={}, device='cuda'):",
            "def __init__(self, rendering_options={}):",
        ))
        _check_raises(
            lambda: patch_mesh_renderer(path), AssertionError,
            "raises when the expected __init__ signature is not found (upstream drift)",
        )


# anigen/pipelines/anigen_image_to_3d.py at the pinned commit: the import
# (line 18) and from_pretrained's model loads (lines 53-75), verbatim.
PIPELINE_FROM_PRETRAINED_REAL = """from ..utils.model_utils import load_model_from_path, load_decoder
from ..utils.image_utils import load_dsine, preprocess_image, encode_image


class AnigenImageTo3DPipeline:
    @staticmethod
    def from_pretrained(
        ss_flow_path: str = 'ckpts/anigen/ss_flow_solo',
        slat_flow_path: str = 'ckpts/anigen/slat_flow_control',
        device: str = 'cuda',
        use_ema: bool = False
    ) -> "AnigenImageTo3DPipeline":
        \"\"\"
        Load pretrained models from paths.
        \"\"\"
        print("Loading models...")
        
        # Image Cond Model (DINOv2)
        dinov2_model = torch.hub.load('./ckpts/dinov2', 'dinov2_vitl14_reg', pretrained=True, source='local')
        dinov2_model.to(device).eval()

        # DSINE Model
        print("Loading DSINE...")
        dsine_model = load_dsine(device)

        # SLat Flow Model
        slat_model, slat_config = load_model_from_path(slat_flow_path, model_name_in_config='denoiser', device=device, use_ema=use_ema)
"""


def test_patch_normal_estimator_swaps_the_single_dsine_load():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "anigen_image_to_3d.py"
        path.write_text(PIPELINE_FROM_PRETRAINED_REAL)
        patch_normal_estimator(path)
        patched = path.read_text()
        calls = [
            n for n in ast.walk(ast.parse(patched))
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "load_dsine"
        ]
        _check(not calls, "no load_dsine call remains")
        _check("        dsine_model = load_normal_estimator(device)\n" in patched,
               "dsine_model now comes from load_normal_estimator")
        _check("from normal_estimator import load_normal_estimator" in patched,
               "imports the worker's estimator")
        _check("torch.hub.load('./ckpts/dinov2'" in patched, "DINOv2 load left intact")
        compile(patched, str(path), "exec")
        print("  [ok] patched file is syntactically valid Python")


def test_patch_normal_estimator_raises_on_drifted_marker():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "anigen_image_to_3d.py"
        path.write_text(PIPELINE_FROM_PRETRAINED_REAL.replace(
            "dsine_model = load_dsine(device)", "dsine_model = load_dsine(device, fp16=True)"
        ))
        _check_raises(
            lambda: patch_normal_estimator(path), AssertionError,
            "raises when the DSINE load line has changed (upstream drift)",
        )


def test_dsine_unreachable_scan_catches_a_second_call_site():
    with tempfile.TemporaryDirectory() as tmp:
        pkg = Path(tmp) / "anigen"
        (pkg / "utils").mkdir(parents=True)
        (pkg / "pipelines").mkdir()
        (pkg / "utils" / "image_utils.py").write_text(
            "def load_dsine(device):\n    return None\n"
        )
        (pkg / "pipelines" / "a.py").write_text("x = load_normal_estimator('cuda')\n")
        try:
            assert_dsine_unreachable(pkg)
            _check(True, "the definition alone passes")
        except AssertionError as exc:
            _check(False, f"the definition alone passes ({exc})")
        (pkg / "pipelines" / "other.py").write_text(
            "from ..utils import image_utils\nm = image_utils.load_dsine('cuda')\n"
        )
        _check_raises(
            lambda: assert_dsine_unreachable(pkg), AssertionError,
            "a new load_dsine call anywhere in the package fails the build",
        )


if __name__ == "__main__":
    test_patch_postprocessing_utils_removes_only_the_top_level_import()
    test_patch_postprocessing_utils_raises_on_drifted_marker()
    test_patch_postprocessing_utils_handles_the_real_bake_call_sites()
    test_nvdiffrast_sentinel_fails_loudly_when_touched()
    test_patch_postprocessing_utils_raises_when_a_new_function_uses_dr()
    test_known_dr_functions_constant_matches_the_bake_pair()
    test_patch_mesh_renderer_relocates_import_into_init()
    test_patch_mesh_renderer_raises_on_drifted_marker()
    test_patch_normal_estimator_swaps_the_single_dsine_load()
    test_patch_normal_estimator_raises_on_drifted_marker()
    test_dsine_unreachable_scan_catches_a_second_call_site()
    if _FAILED:
        print("\nFAILED")
        sys.exit(1)
    print("\nALL PASSED")
