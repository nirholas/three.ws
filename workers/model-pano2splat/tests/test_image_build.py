"""The image must ship gsplat's compiled CUDA extension.

PyPI serves gsplat 1.5.3 as a pure-Python wheel (py3-none-any), so a plain
`pip install gsplat` never compiles `gsplat.csrc`. gsplat then tries a JIT
build on first use, the runtime image has no nvcc, and every training run
died with "gsplat: No CUDA toolkit found" followed by
AttributeError: 'NoneType' object has no attribute 'CameraModelType'.
"""

import re
from pathlib import Path

DOCKERFILE = (Path(__file__).resolve().parent.parent / "Dockerfile").read_text()


def _stages():
    """Map each build stage name to the text of its instructions."""
    parts = re.split(r"^FROM\s+\S+\s+AS\s+(\S+)\s*$", DOCKERFILE, flags=re.M)
    return {parts[i]: parts[i + 1] for i in range(1, len(parts) - 1, 2)}


def _logical_lines(text):
    return re.sub(r"\\\n", " ", text).splitlines()


def test_gsplat_is_built_from_source_in_the_devel_stage():
    lines = [l for l in _logical_lines(_stages()["py-build"]) if re.search(r"pip install[^\n]*gsplat==", l)]
    assert lines, "py-build must install gsplat"
    for line in lines:
        assert re.search(r"--no-binary[ =](:all:|gsplat)", line), (
            "gsplat must be installed with --no-binary gsplat so its CUDA extension compiles "
            f"where nvcc exists; got: {line.strip()}"
        )


def test_both_stages_refuse_an_image_without_the_compiled_extension():
    for stage in ("py-build", "runtime"):
        text = " ".join(_logical_lines(_stages()[stage]))
        assert re.search(r"/opt/stages/splat_train/bin/python\s+-c\s+\"[^\"]*from gsplat import csrc", text), (
            f"the {stage} stage must import gsplat.csrc from the splat_train venv so a "
            "build without the compiled extension fails instead of shipping"
        )


def test_the_operator_mask_weights_ship_inside_the_image():
    # pano_sfm/masks.py loads DeepLabV3_MobileNet_V3_Large_Weights.DEFAULT. Fetched at run time,
    # every cold start depended on download.pytorch.org before SfM could begin.
    runtime = " ".join(_logical_lines(_stages()["runtime"]))
    user_at = runtime.find("USER app")
    fetch = re.search(r"/opt/stages/pano_sfm/bin/python\s+-c\s+\"[^\"]*DeepLabV3_MobileNet_V3_Large_Weights[^\"]*get_state_dict", runtime)
    assert fetch, "the runtime stage must pre-fetch the DeepLab weights with the pano_sfm venv"
    assert user_at != -1 and fetch.start() > user_at, "fetch them as the app user so they land in its torch cache"
