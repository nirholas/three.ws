"""Two surgical fixes to the pinned PartCrafter checkout (MIT), applied at
image build time. Each replacement must match exactly once, so an upstream
change that moves either line fails the build instead of shipping unpatched.

1. pipeline_partcrafter.py decodes every part inside a bare `except:` that
   turns any exception into `mesh = None` and discards it. A decode that
   runs out of GPU memory or finds no surface then surfaces only as this
   worker's generic "no usable parts" error, with nothing in the logs to say
   why. The patch keeps upstream's skip-the-part behaviour but logs the
   traceback first.
2. inference_utils.expand_edge_region_fast allocates its grid with a
   hardcoded device='cuda' while every other tensor follows the caller's
   device, so decoding fails (silently, via 1) anywhere but CUDA. The patch
   takes the device from the input tensor, which is a no-op on the L4.

Usage: python3 patch_upstream.py <partcrafter checkout root>
"""
import sys
from pathlib import Path

PATCHES = [
    (
        "src/pipelines/pipeline_partcrafter.py",
        "                except:\n                    mesh_v_f = None\n",
        "                except Exception:\n"
        "                    import logging\n"
        "                    logging.getLogger(\"partcrafter.decode\").exception(\"decoding part %d failed\", i)\n"
        "                    mesh_v_f = None\n",
    ),
    (
        "src/utils/inference_utils.py",
        "device='cuda', dtype=dtype, requires_grad=False)",
        "device=edge_coords.device, dtype=dtype, requires_grad=False)",
    ),
]


def main(root: Path) -> None:
    for rel, old, new in PATCHES:
        path = root / rel
        text = path.read_text()
        count = text.count(old)
        if count != 1:
            raise SystemExit(f"{rel}: expected exactly one match for the patch target, found {count}")
        path.write_text(text.replace(old, new))
        print(f"patched {rel}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
