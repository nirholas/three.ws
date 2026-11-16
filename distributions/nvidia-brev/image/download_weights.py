"""
Build-time fetch of every weight the image runs, pinned to exact revisions.

Run once in the Docker builder stage. At runtime HF_HUB_OFFLINE=1 is set, so a
missing file fails the build here instead of a user's first generation.

  stabilityai/TripoSR      MIT          config.yaml + model.ckpt (1.68 GB)
  facebook/dino-vitb16     Apache-2.0   config.json only: TripoSR builds the ViT
                                        from this config and loads every weight
                                        from model.ckpt
  u2net (rembg)            Apache-2.0   176 MB ONNX matting model
"""

import hashlib
import os
import sys
from pathlib import Path

from huggingface_hub import hf_hub_download

TRIPOSR_REPO = "stabilityai/TripoSR"
TRIPOSR_REVISION = "5b521936b01fbe1890f6f9baed0254ab6351c04a"
DINO_REPO = "facebook/dino-vitb16"
DINO_REVISION = "f205d5d8e640a89a2b8ef0369670dfc37cc07fc2"
TRIPOSR_CKPT_BYTES = 1_677_246_742

dest = Path(sys.argv[1] if len(sys.argv) > 1 else "/opt/weights/triposr")
dest.mkdir(parents=True, exist_ok=True)

for name in ("config.yaml", "model.ckpt"):
    path = hf_hub_download(TRIPOSR_REPO, name, revision=TRIPOSR_REVISION, local_dir=dest)
    print(f"{TRIPOSR_REPO}@{TRIPOSR_REVISION[:7]} {name}: {os.path.getsize(path):,} bytes")

ckpt = dest / "model.ckpt"
if ckpt.stat().st_size != TRIPOSR_CKPT_BYTES:
    raise SystemExit(f"model.ckpt is {ckpt.stat().st_size} bytes, expected {TRIPOSR_CKPT_BYTES}")

# TripoSR's tokenizer resolves the DINO config through the HF cache by repo id
# (tsr/models/tokenizers/image.py), so this one goes to HF_HOME, not dest.
path = hf_hub_download(DINO_REPO, "config.json", revision=DINO_REVISION)
print(f"{DINO_REPO}@{DINO_REVISION[:7]} config.json -> {path}")
# The tokenizer asks for the default revision ("main"); point main at the pin so
# an offline lookup resolves to exactly the file fetched above.
refs = Path(os.environ["HF_HOME"]) / "hub" / "models--facebook--dino-vitb16" / "refs"
refs.mkdir(parents=True, exist_ok=True)
(refs / "main").write_text(DINO_REVISION)

from rembg import new_session  # noqa: E402  (after the HF downloads: rembg is heavy)

new_session("u2net")
u2net = Path(os.environ["U2NET_HOME"]) / "u2net.onnx"
digest = hashlib.sha256(u2net.read_bytes()).hexdigest()
print(f"u2net.onnx: {u2net.stat().st_size:,} bytes sha256 {digest}")
