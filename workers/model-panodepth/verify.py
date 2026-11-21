"""Verification entrypoint, run as a Cloud Run Job: ``python verify.py``.

Runs the real model on the real 360 photos named in VERIFY_OBJECTS (comma
separated object names in VERIFY_FIXTURE_BUCKET), through exactly the code path
the service uses, uploads each result to
gs://$RESULT_BUCKET/depth/verify-<date>/<id>/ and prints one JSON line per photo
plus a summary with the median seconds per photo.
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import torch

import pano_depth
import pipeline
from storage import GcsStore, content_type_for


def main() -> int:
    fixture_bucket = os.environ.get("VERIFY_FIXTURE_BUCKET", "three-ws-capture-fixtures")
    result_bucket = os.environ.get("RESULT_BUCKET", "three-ws-pano-captures")
    objects = [o.strip() for o in os.environ["VERIFY_OBJECTS"].split(",") if o.strip()]
    weights = os.environ.get("WEIGHTS_PATH", "/weights/panodepth/moge-2-vitl-normal/model.pt")
    stamp = os.environ.get("VERIFY_STAMP") or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    gpu = torch.cuda.get_device_name(0) if device == "cuda" else None
    print(json.dumps({"event": "start", "device": device, "gpu": gpu, "torch": torch.__version__, "photos": len(objects)}), flush=True)
    if device != "cuda" and os.environ.get("ALLOW_CPU") != "1":
        print(json.dumps({"event": "error", "message": "no GPU visible"}), flush=True)
        return 1

    t = time.time()
    model = pano_depth.load_model(weights, device)
    load_s = time.time() - t
    print(json.dumps({"event": "model_loaded", "seconds": round(load_s, 2)}), flush=True)

    store = GcsStore(result_bucket)
    src = GcsStore(fixture_bucket)._bucket()
    totals, summary = [], []
    for name in objects:
        pid = Path(name).stem
        data = src.blob(name).download_as_bytes()
        with tempfile.TemporaryDirectory() as tmp:
            t0 = time.time()
            stats = pipeline.run(data, Path(tmp), model)
            wall = time.time() - t0
            prefix = f"depth/verify-{stamp}/{pid}/"
            for f in ("depth.exr", "scene.ply", "scene.glb"):
                store.upload_file(prefix + f, Path(tmp) / f)
            store.write_json(prefix + "stats.json", stats)
        totals.append(wall)
        summary.append({"id": pid, "wall_s": round(wall, 2), **stats})
        print(json.dumps({"event": "photo", "id": pid, "wall_s": round(wall, 2), "prefix": f"gs://{result_bucket}/{prefix}", "stats": stats}), flush=True)

    print(json.dumps({
        "event": "summary", "gpu": gpu, "photos": len(totals),
        "median_s_per_photo": round(statistics.median(totals), 2), "max_s": round(max(totals), 2),
        "model_load_s": round(load_s, 2), "prefix": f"gs://{result_bucket}/depth/verify-{stamp}/",
    }), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
