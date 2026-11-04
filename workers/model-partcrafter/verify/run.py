"""End-to-end run of the worker's own run_partcrafter on one reference image,
inside the built image, with no GPU (Cloud Build machines have none).

The only difference from production is the device: the worker's
load_pipeline moves the pipeline to CUDA fp16, so this seeds its module-level
cache with a CPU fp32 pipeline instead. Matting, diffusion (default steps),
decoding (default octree depth) and GLB assembly are the worker's code.

Usage (inside the image, workspace mounted at /ws):
    python3 /ws/run.py <image> <num_parts>
Writes /ws/out/parts.glb, /ws/out/manifest.json.
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, "/app")

import pipeline as P  # noqa: E402
from matting import BiRefNetMatter  # noqa: E402
from src.pipelines.pipeline_partcrafter import PartCrafterPipeline  # noqa: E402

image, parts = Path(sys.argv[1]), int(sys.argv[2])
weights = "/ws/weights/PartCrafter"
matting = "/app/models/birefnet-general.onnx"

P._pipeline = PartCrafterPipeline.from_pretrained(weights)
P._matter = BiRefNetMatter(matting)

out = Path("/ws/out")
out.mkdir(parents=True, exist_ok=True)
t = time.time()
res = P.run_partcrafter(
    image.read_bytes(), out / "parts.glb",
    partcrafter_weights_dir=weights, matting_model_path=matting,
    num_parts=parts, seed=0,
)
manifest = {k: v for k, v in res.items() if k != "glb_bytes"}
manifest["seconds"] = round(time.time() - t)
(out / "manifest.json").write_text(json.dumps(manifest, indent=1))
print(json.dumps(manifest, indent=1), flush=True)

import trimesh  # noqa: E402

print("scene nodes:", sorted(trimesh.load(out / "parts.glb").graph.nodes_geometry), flush=True)
