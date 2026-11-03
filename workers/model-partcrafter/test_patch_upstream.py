"""Regression checks for patch_upstream.py, run in the image build against the
patched PartCrafter checkout (no GPU, no weights).

1. expand_edge_region_fast must allocate on its input's device. Unpatched, it
   hardcodes device='cuda', so this call raises off a GPU and upstream's bare
   `except:` turned that into "PartCrafter decoded no usable parts".
2. The part-decode handler must log the exception instead of discarding it.
3. Re-running the patcher on the patched tree must fail loudly, which is the
   same guard that fails the build if upstream moves a target line.
"""
import subprocess
import sys
from pathlib import Path

import torch

ROOT = Path("/app/partcrafter-src")
sys.path.insert(0, str(ROOT))

from src.utils import inference_utils  # noqa: E402


def test_expand_edge_region_follows_input_device() -> None:
    edge = torch.tensor([[1, 1, 1], [2, 3, 4]], dtype=torch.int64)
    out = inference_utils.expand_edge_region_fast(edge, grid_size=8, dtype=torch.float32)
    assert out.device.type == "cpu", out.device
    # Each low-res cell expands to its 8 high-res children, and the 5^3 max
    # pool marks a neighbourhood around both edge cells.
    assert out.shape[1] == 3 and out.shape[0] % 8 == 0 and out.shape[0] > 16, out.shape
    assert int(out.max()) < 16 and int(out.min()) >= 0


def test_decode_failures_are_logged() -> None:
    src = (ROOT / "src/pipelines/pipeline_partcrafter.py").read_text()
    assert "                except:\n" not in src, "bare except still present"
    assert 'getLogger("partcrafter.decode").exception(' in src


def test_patcher_refuses_a_moved_target() -> None:
    res = subprocess.run(
        [sys.executable, str(Path(__file__).with_name("patch_upstream.py")), str(ROOT)],
        capture_output=True, text=True,
    )
    assert res.returncode != 0, "patcher re-applied cleanly to an already patched tree"
    assert "expected exactly one match" in (res.stdout + res.stderr)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
    print("patch_upstream checks passed")
