"""Stage the pinned NVIDIA Cosmos Reason 2 8B weights from NGC and prove every byte.

The weights come from the NGC model registry (org nim, team nvidia, model
cosmos-reason2-8b), version hf-0303: the Hugging Face format checkpoint NVIDIA
publishes under the NVIDIA Open Model License (commercially usable). NGC records
a SHA-256 for every file; each staged file is checked against it, and
MANIFEST.json is written beside the weights:

    {"source": "ngc:...", "revision": ..., "files": {"<name>": {"size": n, "sha256": h}}}

serve.sh reads that manifest at every cold start and refuses to boot vLLM on a
tree whose sizes or revision drifted. Run by cloudbuild.weights.yaml; by hand:

    NGC_API_KEY=nvapi-... python3 stage_weights.py --version hf-0303 --out /workspace/weights
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

NGC = "https://api.ngc.nvidia.com/v2/org/nim/team/nvidia/models/cosmos-reason2-8b/versions"
# Hub bookkeeping NGC mirrored alongside the checkpoint; vLLM never reads it.
SKIP_PREFIXES = (".cache/",)
SKIP = {".gitattributes", "README.md"}
CHUNK = 8 * 1024 * 1024


def _request(url: str) -> urllib.request.Request:
    key = os.environ.get("NGC_API_KEY")
    if not key:
        raise SystemExit("NGC_API_KEY is required (an nvapi- key with NGC registry read)")
    req = urllib.request.Request(url, headers={"user-agent": "three.ws-model-cosmos-reason-stager"})
    req.add_header("authorization", f"Bearer {key}")
    return req


def wanted(path: str) -> bool:
    return path not in SKIP and not path.startswith(SKIP_PREFIXES)


def ngc_files(version: str, opener=urllib.request.urlopen) -> list[dict]:
    """Every checkpoint file in the NGC version with its size and hex SHA-256."""
    with opener(_request(f"{NGC}/{version}/files"), timeout=60) as resp:
        body = json.load(resp)
    files = []
    for f in body.get("modelFiles", []):
        if not wanted(f["path"]):
            continue
        digest = base64.b64decode(f["sha256_base64"]).hex()
        files.append({"path": f["path"], "size": int(f["sizeInBytes"]), "sha256": digest})
    if not files:
        raise SystemExit(f"NGC listed no files for {version}; refusing to stage an empty tree")
    return files


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def download(version: str, name: str, dest: Path, opener=urllib.request.urlopen) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with opener(_request(f"{NGC}/{version}/files/{name}"), timeout=900) as resp, tmp.open("wb") as out:
        for block in iter(lambda: resp.read(CHUNK), b""):
            out.write(block)
    tmp.replace(dest)


def verify(entry: dict, path: Path) -> dict:
    size = path.stat().st_size
    if size != entry["size"]:
        raise SystemExit(f"{entry['path']}: size {size} != NGC size {entry['size']}")
    digest = sha256_file(path)
    if digest != entry["sha256"]:
        raise SystemExit(f"{entry['path']}: sha256 {digest} != NGC sha256 {entry['sha256']}")
    return {"size": size, "sha256": digest}


def stage(version: str, out: Path, opener=urllib.request.urlopen) -> dict:
    files = {}
    for entry in ngc_files(version, opener):
        path = out / entry["path"]
        if not (path.exists() and path.stat().st_size == entry["size"]):
            print(f"download {entry['path']} ({entry['size']} bytes)", flush=True)
            download(version, entry["path"], path, opener)
        files[entry["path"]] = verify(entry, path)
        print(f"ok {entry['path']} {files[entry['path']]['sha256']}", flush=True)
    if not any(name.endswith(".safetensors") for name in files):
        raise SystemExit(f"{version}: no .safetensors shards staged")
    manifest = {"source": "ngc:nim/nvidia/cosmos-reason2-8b", "revision": version, "files": files}
    (out / "MANIFEST.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))
    (out / "REVISION").write_text(version + "\n")
    return manifest


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--version", required=True)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args(argv)
    manifest = stage(args.version, args.out)
    total = sum(f["size"] for f in manifest["files"].values())
    print(f"staged {len(manifest['files'])} files, {total} bytes, version {args.version}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
