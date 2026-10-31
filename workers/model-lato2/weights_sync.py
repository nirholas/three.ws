"""Boot-time checkpoint sync, then serve.

`python weights_sync.py --serve` copies the LATO.2 checkpoints from the staged
weights bucket into LATO_ROOT/ckpt (skipping any file already present at the
expected size), prefetches the DINOv2 backbone the V-Flow checkpoint names, then
replaces itself with uvicorn. Doing it before the server binds means Cloud Run's
startup probe covers the download and no request can arrive before the weights.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

log = logging.getLogger("lato2-weights")

REQUIRED = (
    "vflow.pt", "vvae.pt", "offset_head.pt", "tflow.pt", "tvae.pt", "voxel_encoder.pt",
)


def plan_downloads(remote: dict[str, int], local: dict[str, int]) -> list[str]:
    """Names to fetch: every required checkpoint that is missing locally or whose
    size differs from the bucket's. Raises when the bucket lacks a required one."""
    missing = [n for n in REQUIRED if n not in remote]
    if missing:
        raise RuntimeError(f"weights bucket is missing {', '.join(missing)}")
    return [n for n in REQUIRED if local.get(n) != remote[n]]


def find_key(obj, key: str, depth: int = 0):
    """First value stored under `key` anywhere in a nested dict, or None."""
    if depth > 6 or not isinstance(obj, dict):
        return None
    if key in obj:
        return obj[key]
    for v in obj.values():
        found = find_key(v, key, depth + 1)
        if found is not None:
            return found
    return None


def sync(uri: str, dest: Path) -> None:
    from google.cloud import storage

    bucket_name, _, prefix = uri.removeprefix("gs://").partition("/")
    client = storage.Client()
    blobs = {b.name.rsplit("/", 1)[-1]: b for b in client.list_blobs(bucket_name, prefix=prefix.rstrip("/") + "/")}
    dest.mkdir(parents=True, exist_ok=True)
    local = {p.name: p.stat().st_size for p in dest.glob("*.pt")}
    for name in plan_downloads({n: b.size for n, b in blobs.items()}, local):
        log.info("fetching %s (%d bytes)", name, blobs[name].size)
        blobs[name].download_to_filename(str(dest / name))


def prefetch_dino(ckpt: Path) -> None:
    try:
        import torch

        cfg = torch.load(ckpt / "vflow.pt", map_location="cpu", weights_only=False)
        version = find_key(cfg, "dino_version")
        if not version:
            log.warning("vflow.pt names no dino_version; DINOv2 loads on first job")
            return
        hub = ckpt / "dinov2"
        torch.hub.set_dir(str(hub))
        torch.hub.load("facebookresearch/dinov2", str(version), source="github", pretrained=True)
        log.info("DINOv2 %s ready in %s", version, hub)
    except Exception as exc:
        log.warning("DINOv2 prefetch skipped (%s); it loads on first job", exc)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    root = Path(os.environ.get("LATO_ROOT", "/app/LATO.2"))
    uri = os.environ.get("WEIGHTS_GCS_URI")
    if uri:
        sync(uri, root / "ckpt")
        prefetch_dino(root / "ckpt")
    if "--serve" in sys.argv:
        os.execvp("uvicorn", ["uvicorn", "main:app", "--host", "0.0.0.0", "--port",
                              os.environ.get("PORT", "8080"), "--workers", "1",
                              "--timeout-keep-alive", "300"])


if __name__ == "__main__":
    main()
