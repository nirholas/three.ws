"""Triton serving parity, run as the Dockerfile.triton build gate:

    TRITON_GRPC_URL=127.0.0.1:8001 python3 test_triton_parity.py <image> [<image> ...]

Needs a running tritonserver over the exported repository (the build starts
one on CPU, since Cloud Build has no GPU) and the upstream rembg weights for
the reference. For every served model it cuts real photos out twice, once
through rembg's own ONNX Runtime session and once through Triton, and
requires the alpha masks to match. Then it fires concurrent requests at the
batched model, checks that dynamic batching actually stacked them, and that
batching changed no output.
"""

from __future__ import annotations

import sys
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import rembg
from PIL import Image

import triton_backend
from rembg_policy import CANONICAL_MODELS

PASS = 0
# uint8 alpha may differ by a rounding step where float accumulation order
# differs; the mean must stay at noise level and the binary mask identical.
MAX_ALPHA_STEP = 2
MAX_MEAN_DIFF = 0.05
MIN_IOU = 0.999


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASS
    if not condition:
        print(f"FAIL  {name}  {detail}")
        sys.exit(1)
    PASS += 1
    print(f"ok    {name}")


def alpha(img: Image.Image) -> np.ndarray:
    return np.asarray(img.convert("RGBA"))[..., 3].astype(np.int16)


def compare(a: np.ndarray, b: np.ndarray) -> dict:
    diff = np.abs(a - b)
    ma, mb = a >= 128, b >= 128
    union = np.logical_or(ma, mb).sum()
    iou = float(np.logical_and(ma, mb).sum() / union) if union else 1.0
    return {"max": int(diff.max()), "mean": float(diff.mean()), "iou": iou}


def main(paths: list[str]) -> None:
    if not paths:
        sys.exit("pass at least one real photo")
    images = [Image.open(p).convert("RGBA") for p in paths]
    client = triton_backend.make_client()
    triton_backend.wait_until_ready(client, CANONICAL_MODELS, timeout_s=900)
    check("every model is loaded and warm on Triton", True)

    for model in CANONICAL_MODELS:
        reference = rembg.new_session(model, providers=["CPUExecutionProvider"])
        served = triton_backend.build_session(client, model)
        for path, img in zip(paths, images):
            stats = compare(alpha(rembg.remove(img, session=reference)),
                            alpha(rembg.remove(img, session=served)))
            check(
                f"{model} matches ONNX Runtime on {path.rsplit('/', 1)[-1]}",
                stats["max"] <= MAX_ALPHA_STEP and stats["mean"] <= MAX_MEAN_DIFF
                and stats["iou"] >= MIN_IOU,
                str(stats),
            )

    # Dynamic batching: 8 concurrent jobs on the batched default model.
    model = "isnet-general-use"
    served = triton_backend.build_session(client, model)
    singles = [alpha(rembg.remove(img, session=served)) for img in images]
    before = triton_backend.scrape().models.get(model, {})
    jobs = [images[i % len(images)] for i in range(8)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        outs = list(pool.map(lambda im: alpha(rembg.remove(im, session=served)), jobs))
    time.sleep(2.5)  # Triton refreshes its counters every 2 s
    after = triton_backend.scrape().models.get(model, {})
    executions = after.get("executions", 0) - before.get("executions", 0)
    inferences = after.get("inferences", 0) - before.get("inferences", 0)
    check("concurrent requests were all served", inferences >= 8, f"{inferences} inferences")
    check("the dynamic batcher stacked concurrent requests",
          0 < executions < inferences, f"{inferences} inferences in {executions} executions")
    for i, out in enumerate(outs):
        stats = compare(out, singles[i % len(images)])
        check(f"batched job {i} matches its unbatched cutout",
              stats["max"] <= MAX_ALPHA_STEP and stats["iou"] >= MIN_IOU, str(stats))

    print(f"\n{PASS} checks passed")


if __name__ == "__main__":
    main(sys.argv[1:])
