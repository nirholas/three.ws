"""Build-time assertion that the installed stack is the one this image pins.

Run by the Dockerfile right after the pip installs. audio-separator brings its
own torch and numpy requirements, and without this gate a transitive resolution
that swapped the cu124 wheel for a CPU-only build would only surface at
inference time, as "Torch not compiled with CUDA enabled", after a 40-minute
build had already reported success.

It also proves the avatar script's import chain resolves. LongCat's
run_demo_avatar_single_audio_to_video.py imports
`audio_separator.separator.Separator` at module scope, and that module imports
`onnxruntime`, which audio-separator only declares behind an optional extra.
Without the explicit onnxruntime-gpu pin, the image built green and every
avatar job died with ModuleNotFoundError before rendering a frame. Listing the
execution providers needs no GPU, so this runs on the CPU-only builder.
"""

from __future__ import annotations

import re
import sys

import diffusers
import huggingface_hub
import numpy
import torch
import transformers

failures = []

if not torch.__version__.startswith("2.6.0"):
    failures.append(f"torch drifted to {torch.__version__}, expected 2.6.0")
if "cu124" not in torch.__version__ and torch.version.cuda != "12.4":
    failures.append(
        f"expected a cu124 torch build, got {torch.__version__} (cuda {torch.version.cuda})"
    )
if not numpy.__version__.startswith("1.26"):
    failures.append(f"numpy drifted to {numpy.__version__}, expected 1.26.x")
if not transformers.__version__.startswith("4.41"):
    failures.append(f"transformers drifted to {transformers.__version__}, expected 4.41.x")
if not diffusers.__version__.startswith("0.35"):
    failures.append(f"diffusers drifted to {diffusers.__version__}, expected 0.35.x")

# diffusers 0.35.1 declares huggingface-hub>=0.34.0. pip reports a violation as a
# non-fatal warning, so without this check the image ships with a hub too old
# for the library that calls it and fails when a pipeline first touches it.
HUB_FLOOR = (0, 34, 0)
# Tolerate pre-release strings like "1.0.0rc1" or "0.35.0.dev0": take the leading
# digits of each of the first three segments, so a release-candidate hub reports a
# version rather than crashing the gate that is meant to protect the build.
hub_parts = tuple(
    int(re.match(r"\d*", part).group() or 0)
    for part in (huggingface_hub.__version__.split(".") + ["0", "0", "0"])[:3]
)
if hub_parts < HUB_FLOOR:
    failures.append(
        f"huggingface-hub {huggingface_hub.__version__} is below the "
        f"{'.'.join(str(n) for n in HUB_FLOOR)} floor diffusers {diffusers.__version__} requires"
    )

# onnxruntime-gpu 1.20.x is the last line built for any CUDA 12.x with cuDNN 9;
# 1.21 and later need CUDA 12.8, newer than this image's 12.4 runtime. A CPU-only
# `onnxruntime` wheel arriving through some later extra would replace the module
# and silently drop the CUDA provider, so check both.
try:
    import onnxruntime
except ImportError as exc:
    providers = []
    failures.append(f"onnxruntime is not installed ({exc}); pin onnxruntime-gpu in requirements-model.txt")
else:
    providers = onnxruntime.get_available_providers()
    if not onnxruntime.__version__.startswith("1.20."):
        failures.append(
            f"onnxruntime drifted to {onnxruntime.__version__}, expected 1.20.x (CUDA 12.x + cuDNN 9 build)"
        )
    if "CUDAExecutionProvider" not in providers:
        failures.append(
            f"onnxruntime {onnxruntime.__version__} has no CUDAExecutionProvider ({providers}); "
            "a CPU-only onnxruntime wheel replaced onnxruntime-gpu"
        )

# The exact import the avatar script makes at module scope. A failure here is the
# one every job would otherwise hit first.
try:
    from audio_separator.separator import Separator  # noqa: F401
except Exception as exc:  # noqa: BLE001
    failures.append(f"audio_separator.separator does not import: {type(exc).__name__}: {exc}")

if failures:
    for line in failures:
        print(f"PIN DRIFT  {line}", file=sys.stderr)
    sys.exit(1)

print(
    "pins ok:",
    f"torch {torch.__version__}",
    f"cuda {torch.version.cuda}",
    f"numpy {numpy.__version__}",
    f"transformers {transformers.__version__}",
    f"diffusers {diffusers.__version__}",
    f"huggingface-hub {huggingface_hub.__version__}",
    f"onnxruntime {onnxruntime.__version__} ({', '.join(providers)})",
    "audio_separator.separator ok",
)
