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
     module top. At the pinned commit `dr` is used only inside the two
     raster-bake functions, `bake_vertex_colors_to_texture` (no caller
     anywhere upstream) and `bake_texture` (reached only when the pipeline
     runs with texture_size > 0; this worker always passes 0, see
     pipeline.py). The import is replaced by a sentinel `dr` that raises a
     RuntimeError naming the fix if anything ever touches it, and an AST
     check proves `dr` is still confined to exactly those two functions, so
     upstream adding nvdiffrast to any other function fails the build.
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

import ast
import sys
from pathlib import Path

POSTPROCESSING_UTILS_IMPORT = "import nvdiffrast.torch as dr\n"

# The only top-level functions in postprocessing_utils.py allowed to use `dr`
# (both raster texture bakes, unreachable from this worker; see above).
POSTPROCESSING_DR_FUNCTIONS = ("bake_vertex_colors_to_texture", "bake_texture")

# Bound in place of the import. Kept a module-level constant so the unit test
# can execute the exact text the build writes.
NVDIFFRAST_SENTINEL = (
    "class _NvdiffrastUnavailable:\n"
    "    def __getattr__(self, name):\n"
    "        raise RuntimeError(\n"
    "            'nvdiffrast is not installed in the three.ws AniGen worker (its '\n"
    "            'license forbids commercial use), so AniGen\\'s raster texture '\n"
    "            'bake is unavailable; run the pipeline with texture_size=0'\n"
    "        )\n"
    "\n"
    "\n"
    "dr = _NvdiffrastUnavailable()\n"
)


def _imports_nvdiffrast(tree: ast.AST) -> bool:
    for node in ast.walk(tree):
        if isinstance(node, ast.Import) and any(a.name.split(".")[0] == "nvdiffrast" for a in node.names):
            return True
        if isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[0] == "nvdiffrast":
            return True
    return False


def _top_level_dr_users(tree: ast.Module) -> set[str]:
    users = set()
    for node in tree.body:
        if any(isinstance(n, ast.Name) and n.id == "dr" for n in ast.walk(node)):
            users.add(getattr(node, "name", type(node).__name__))
    return users

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
    without_import = text.replace(POSTPROCESSING_UTILS_IMPORT, "", 1)
    tree = ast.parse(without_import)
    if _imports_nvdiffrast(tree):
        raise AssertionError(
            f"{path}: another nvdiffrast import remains after removing the "
            "top-level one; re-check the nvdiffrast surface before patching blind"
        )
    users = _top_level_dr_users(tree)
    unexpected = users - set(POSTPROCESSING_DR_FUNCTIONS)
    if unexpected:
        raise AssertionError(
            f"{path}: nvdiffrast (`dr`) is now used outside the known raster-bake "
            f"functions, in {sorted(unexpected)}; re-check whether this worker's "
            "call path reaches it before patching blind"
        )
    patched = _insert_after_imports(without_import, tree, NVDIFFRAST_SENTINEL)
    path.write_text(patched)
    print(f"patched {path}: replaced the nvdiffrast import with a fail-loud sentinel "
          f"(dr used only in {sorted(users)})")


def _insert_after_imports(source: str, tree: ast.Module, block: str) -> str:
    """Insert `block` right after the module's leading import statements."""
    last_import_end = 0
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            last_import_end = node.end_lineno
        elif not (isinstance(node, ast.Expr) and isinstance(getattr(node, "value", None), ast.Constant)):
            break
    lines = source.splitlines(keepends=True)
    return "".join(lines[:last_import_end]) + "\n\n" + block + "".join(lines[last_import_end:])


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
