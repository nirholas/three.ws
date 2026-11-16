"""Build the Triton model repository from the rembg ONNX weights.

    python3 export_triton_models.py --weights ~/.u2net --repo /models

For every model in rembg_policy.CANONICAL_MODELS this writes
``<repo>/<model>/1/model.onnx`` next to the committed
``model_repository/<model>/config.pbtxt`` (copied in by the Dockerfile).

Two rewrites, both gated so the image cannot ship a model that drifts:

* Only the first graph output is kept. rembg reads ``ort_outs[0]`` and nothing
  else, so the side outputs (six extra full-size maps for isnet, six for the
  u2net family) were pure wasted device memory and copy time.
* For the models whose graphs are batch-agnostic, dim 0 of the input and the
  output becomes the symbolic ``batch``, so Triton's dynamic batcher can stack
  concurrent requests into one execution. silueta and birefnet-general-lite
  bake batch 1 into Resize scales and Reshape targets; rewriting them would
  either fail or silently compute garbage, so they keep their static shape and
  are served with ``max_batch_size: 0``.

The gates run on ONNX Runtime CPU against the untouched upstream file: the
rewritten graph must reproduce the reference output for a single image, and
the batched graph must reproduce two single-image runs when fed a batch of two.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort

# Models whose graphs accept any leading batch dimension (verified by the gate
# below on every build, not just assumed).
BATCHABLE = {"isnet-general-use", "u2net", "u2net_human_seg"}

# The ONNX file name rembg downloads for each canonical model.
WEIGHT_FILES = {
    "isnet-general-use": "isnet-general-use.onnx",
    "u2net": "u2net.onnx",
    "u2net_human_seg": "u2net_human_seg.onnx",
    "silueta": "silueta.onnx",
    "birefnet-general-lite": "birefnet-general-lite.onnx",
}

# Largest tolerated difference on a sigmoid-range output. Batched kernels may
# reorder float accumulation; anything beyond this is a real graph change.
TOLERANCE = 1e-4


def rewrite(src: Path, batchable: bool) -> onnx.ModelProto:
    model = onnx.load(str(src))
    del model.graph.output[1:]
    if batchable:
        for value in list(model.graph.input) + list(model.graph.output):
            dim = value.type.tensor_type.shape.dim[0]
            dim.Clear()
            dim.dim_param = "batch"
        # Stale intermediate shapes pin batch 1; ORT re-infers them on load.
        del model.graph.value_info[:]
    onnx.checker.check_model(model)
    return model


def _session(path: Path) -> ort.InferenceSession:
    return ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])


def gate(src: Path, dst: Path, batchable: bool) -> float:
    """Return the worst absolute difference; exit non-zero past TOLERANCE."""
    ref, new = _session(src), _session(dst)
    inp = ref.get_inputs()[0]
    out_name = ref.get_outputs()[0].name
    shape = [d for d in inp.shape[1:]]
    rng = np.random.default_rng(7)
    batch = rng.uniform(-2.0, 2.0, size=(2 if batchable else 1, *shape)).astype(np.float32)
    expected = np.concatenate(
        [ref.run([out_name], {inp.name: batch[i : i + 1]})[0] for i in range(len(batch))]
    )
    got = new.run(None, {inp.name: batch})[0]
    if got.shape != expected.shape:
        sys.exit(f"{src.name}: rewritten output shape {got.shape} != reference {expected.shape}")
    worst = float(np.abs(got - expected).max())
    if worst > TOLERANCE:
        sys.exit(f"{src.name}: rewritten graph drifts by {worst:.3e} (limit {TOLERANCE:.0e})")
    return worst


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--weights", type=Path, required=True, help="rembg weights dir (U2NET_HOME)")
    parser.add_argument("--repo", type=Path, required=True, help="Triton model repository root")
    parser.add_argument("--configs", type=Path, default=Path(__file__).parent / "model_repository")
    args = parser.parse_args()

    for name, filename in WEIGHT_FILES.items():
        candidates = list(args.weights.rglob(filename))
        if not candidates:
            sys.exit(f"{name}: {filename} not found under {args.weights}")
        src = candidates[0]
        version_dir = args.repo / name / "1"
        version_dir.mkdir(parents=True, exist_ok=True)
        dst = version_dir / "model.onnx"
        batchable = name in BATCHABLE
        onnx.save(rewrite(src, batchable), str(dst))
        worst = gate(src, dst, batchable)
        shutil.copyfile(args.configs / name / "config.pbtxt", args.repo / name / "config.pbtxt")
        mode = "batched" if batchable else "static batch 1"
        print(f"ok    {name}: {mode}, max diff vs upstream {worst:.2e}")


if __name__ == "__main__":
    main()
