"""
Build-time patch: remove every module-level dependency on nvdiffrast from the
vendored AniGen checkout.

Why: AniGen (VAST-AI-Research/AniGen) is MIT, but two of its files import
nvdiffrast at module scope. nvdiffrast's own license (NVlabs/nvdiffrast,
LICENSE.txt, "Nvidia Source Code License (1-Way Commercial)", section 3.3)
restricts use to "non-commercially... for research or evaluation purposes
only", which three.ws's monetized Forge lane cannot satisfy. Rather than
install a restricted-license package, this worker never installs nvdiffrast
at all and patches the two files that reference it so the package loads
cleanly.

Repo-wide search confirmed (gh api search/code, 2026-10-11) these are the
ONLY two Python files under `anigen/` (excluding the optional, unused
`anigen/4drecon/` video add-on) that reference nvdiffrast:

  1. anigen/utils/postprocessing_utils.py: `import nvdiffrast.torch as dr` at
     module top. Used only inside `_fill_holes`, `bake_vertex_colors_to_texture`,
     `bake_texture`, `render_multiview_mesh_colors`, `to_glb`, `simplify_gs` -
     none of which this worker ever calls (it always runs the pipeline with
     fill_holes=False, texture_size=0; see pipeline.py). Deleting the
     module-level import is enough: Python resolves `dr.*` lazily inside
     those function bodies, so the module still imports cleanly, and only an
     accidental call to one of those unused functions would raise NameError.
  2. anigen/renderers/mesh_renderer.py: same import, consumed only by
     MeshRenderer.__init__/.render. Moved into __init__ as a local import (the
     lazy-import pattern anigen/renderers/__init__.py's own __getattr__
     already uses for submodule loading) so merely importing mesh_renderer.py
     (forced transitively: postprocessing_utils.py -> render_utils.py's
     `from ..renderers import ... MeshRenderer` -> the package's lazy
     __getattr__ -> mesh_renderer.py) no longer touches nvdiffrast.
     Instantiating MeshRenderer still would, but nothing in this worker's
     call path does.

Each patch asserts its exact target text is present before editing, so a
future AniGen version that moves or rewrites these lines fails the Docker
build loudly instead of silently shipping unpatched (and therefore either
broken, or secretly dependent on a restricted-license package).
"""
from __future__ import annotations

import sys
from pathlib import Path

POSTPROCESSING_UTILS_IMPORT = "import nvdiffrast.torch as dr\n"

MESH_RENDERER_MODULE_IMPORT = "import nvdiffrast.torch as dr\n"
MESH_RENDERER_INIT_MARKER = "    def __init__(self, rendering_options={}, device='cuda'):\n"
MESH_RENDERER_LOCAL_IMPORT = "        import nvdiffrast.torch as dr\n"


def patch_postprocessing_utils(path: Path) -> None:
    text = path.read_text()
    if POSTPROCESSING_UTILS_IMPORT not in text:
        raise AssertionError(
            f"{path}: expected top-level '{POSTPROCESSING_UTILS_IMPORT.strip()}' "
            "not found; AniGen's postprocessing_utils.py has changed, re-check "
            "the nvdiffrast surface before patching blind"
        )
    patched = text.replace(POSTPROCESSING_UTILS_IMPORT, "", 1)
    if "nvdiffrast" in patched:
        raise AssertionError(
            f"{path}: nvdiffrast is still referenced after removing the import; "
            "a new module-level usage appeared, re-check before patching blind"
        )
    path.write_text(patched)
    print(f"patched {path}: removed module-level nvdiffrast import")


def patch_mesh_renderer(path: Path) -> None:
    text = path.read_text()
    if MESH_RENDERER_MODULE_IMPORT not in text:
        raise AssertionError(
            f"{path}: expected top-level '{MESH_RENDERER_MODULE_IMPORT.strip()}' "
            "not found; AniGen's mesh_renderer.py has changed, re-check the "
            "nvdiffrast surface before patching blind"
        )
    if MESH_RENDERER_INIT_MARKER not in text:
        raise AssertionError(
            f"{path}: expected MeshRenderer.__init__ signature not found; "
            "cannot safely relocate the nvdiffrast import"
        )
    without_top_import = text.replace(MESH_RENDERER_MODULE_IMPORT, "", 1)
    patched = without_top_import.replace(
        MESH_RENDERER_INIT_MARKER,
        MESH_RENDERER_INIT_MARKER + MESH_RENDERER_LOCAL_IMPORT,
        1,
    )
    if "import nvdiffrast" not in patched:
        raise AssertionError(f"{path}: patch lost the nvdiffrast import entirely")
    path.write_text(patched)
    print(f"patched {path}: moved nvdiffrast import into MeshRenderer.__init__")


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: patch_anigen.py <anigen-checkout-root>", file=sys.stderr)
        sys.exit(2)
    root = Path(sys.argv[1])
    patch_postprocessing_utils(root / "anigen" / "utils" / "postprocessing_utils.py")
    patch_mesh_renderer(root / "anigen" / "renderers" / "mesh_renderer.py")


if __name__ == "__main__":
    main()
