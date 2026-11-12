"""Image layout contract: the served interpreter must import the COMPILED
extensions, never their source trees.

    cd workers/model-trellis2 && python3 -m pytest test_image_layout.py -q

Regression for the TRELLIS.2 lane never loading in production (2026-11-10 and
2026-11-11, revision model-trellis2-00001): the Dockerfile put
/app/TRELLIS.2/o-voxel on PYTHONPATH, so `import o_voxel` resolved to the source
package, which has no compiled `_C`. The pipeline load died with "cannot import
name '_C' from partially initialized module 'o_voxel'", and TRELLIS.2's loader
then retried the checkpoint as a Hugging Face Hub id, which is the misleading
"cannot find the requested files" error the logs showed instead.

Runs against the repo checkout only (the Dockerfile is not copied into the image).
"""

from pathlib import Path

import pytest

DOCKERFILE = Path(__file__).with_name("Dockerfile")

# Packages the Dockerfile builds from a source tree with `pip install`. Their
# source directories must never shadow the installed build.
PIP_BUILT_SOURCE_TREES = ("/app/TRELLIS.2/o-voxel", "/tmp/ext")

pytestmark = pytest.mark.skipif(not DOCKERFILE.exists(), reason="repo checkout only")


def _env_value(name: str) -> str:
    text = DOCKERFILE.read_text()
    for line in text.splitlines():
        stripped = line.strip().rstrip("\\").strip()
        if stripped.startswith(f"{name}="):
            return stripped.split("=", 1)[1].strip()
    raise AssertionError(f"{name} is not set in the Dockerfile")


def test_pythonpath_never_shadows_a_compiled_extension_with_its_source():
    entries = [e for e in _env_value("PYTHONPATH").split(":") if e]
    for entry in entries:
        for tree in PIP_BUILT_SOURCE_TREES:
            assert not entry.startswith(tree), (
                f"PYTHONPATH entry {entry} shadows the pip-installed build of {tree}"
            )


def test_trellis2_sources_stay_importable():
    assert "/app/TRELLIS.2" in _env_value("PYTHONPATH").split(":")


def test_build_gate_asserts_o_voxel_resolves_to_the_installed_package():
    # The build must fail if `o_voxel` ever resolves outside site/dist-packages
    # again, instead of a revision shipping that can never load.
    text = DOCKERFILE.read_text()
    assert "find_spec(\"o_voxel\")" in text or "find_spec('o_voxel')" in text


def _copied_files() -> set[str]:
    """Every file name a COPY instruction (with its continuation lines) brings in."""
    names, in_copy = set(), False
    for line in DOCKERFILE.read_text().splitlines():
        stripped = line.strip()
        if stripped.startswith("COPY "):
            in_copy = not stripped.startswith("COPY --from")
            stripped = stripped[5:]
        if in_copy:
            names.update(tok for tok in stripped.rstrip("\\").split() if tok.endswith(".py"))
            in_copy = line.rstrip().endswith("\\")
    return names


def test_bake_rasteriser_ships_and_is_gated_at_build_time():
    # BAKE_RASTER_BACKEND switches the bake between nvdiffrast and the torch
    # rasteriser; the module must be in the image and its suite in the build gate.
    copied = _copied_files()
    assert {"bake_raster.py", "test_bake_raster.py"} <= copied
    assert "/app/test_bake_raster.py" in DOCKERFILE.read_text()


def test_worker_installs_the_bake_backend_before_the_pipeline_import():
    # o_voxel.postprocess imports nvdiffrast at module load. install() must run
    # first so the torch backend works on an image without nvdiffrast.
    source = DOCKERFILE.with_name("main.py").read_text()
    body = source.split("def _load_pipeline():", 1)[1]
    assert body.index("bake_raster.install()") < body.index("from trellis2.pipelines import")
