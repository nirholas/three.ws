"""Stage the pinned Phi-4-mini-instruct weights and prove every byte.

Downloads one exact Hugging Face revision, checks every file against the
checksum the Hub records for it (the LFS SHA-256 for weight shards and the
tokenizer, the git blob SHA-1 for every small file), and writes MANIFEST.json
with each file's size and SHA-256 beside the weights:

    {"repo": ..., "revision": ..., "files": {"<name>": {"size": n, "sha256": h}}}

serve.sh reads that manifest at every cold start and refuses to boot vLLM on a
tree whose sizes or revision drifted, so a half-synced bucket can never serve
traffic. Run by workers/model-phi/cloudbuild.weights.yaml; usable by hand:

    python3 stage_weights.py --repo microsoft/Phi-4-mini-instruct \
        --revision <sha> --out /workspace/weights
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

HUB = "https://huggingface.co"
# Never served by vLLM and not needed to load the model.
SKIP = {".gitattributes", "README.md", "CODE_OF_CONDUCT.md", "SECURITY.md", "sample_finetune.py", "data_summary_card.md"}
CHUNK = 8 * 1024 * 1024


def hub_tree(repo: str, revision: str, opener=urllib.request.urlopen) -> list[dict]:
    """Every file in the repo at `revision` with the Hub's size and LFS sha256."""
    url = f"{HUB}/api/models/{repo}/tree/{revision}?recursive=1"
    with opener(url, timeout=60) as resp:
        entries = json.load(resp)
    files = [e for e in entries if e.get("type") == "file" and e["path"] not in SKIP]
    if not files:
        raise SystemExit(f"{repo}@{revision}: the Hub listed no files; refusing to stage an empty tree")
    return files


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def download(repo: str, revision: str, name: str, dest: Path, opener=urllib.request.urlopen) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    url = f"{HUB}/{repo}/resolve/{revision}/{name}"
    req = urllib.request.Request(url, headers={"user-agent": "three.ws-model-phi-stager"})
    token = os.environ.get("HF_TOKEN")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    with opener(req, timeout=600) as resp, tmp.open("wb") as out:
        for block in iter(lambda: resp.read(CHUNK), b""):
            out.write(block)
    tmp.replace(dest)


def git_blob_sha1(path: Path) -> str:
    """The id git gives a file's content: sha1(b"blob <size>\0" + bytes)."""
    h = hashlib.sha1()
    h.update(f"blob {path.stat().st_size}\0".encode())
    with path.open("rb") as f:
        for block in iter(lambda: f.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def verify_entry(entry: dict, path: Path) -> dict:
    """Size and checksum for one staged file, checked against the Hub record."""
    size = path.stat().st_size
    if size != entry["size"]:
        raise SystemExit(f"{entry['path']}: size {size} != Hub size {entry['size']}")
    digest = sha256_file(path)
    lfs = entry.get("lfs") or {}
    if lfs.get("oid"):
        if digest != lfs["oid"]:
            raise SystemExit(f"{entry['path']}: sha256 {digest} != Hub LFS oid {lfs['oid']}")
    else:
        blob = git_blob_sha1(path)
        if blob != entry.get("oid"):
            raise SystemExit(f"{entry['path']}: git blob {blob} != Hub oid {entry.get('oid')}")
    return {"size": size, "sha256": digest}


def stage(repo: str, revision: str, out: Path, opener=urllib.request.urlopen) -> dict:
    entries = hub_tree(repo, revision, opener)
    files = {}
    for entry in entries:
        path = out / entry["path"]
        if not (path.exists() and path.stat().st_size == entry["size"]):
            print(f"download {entry['path']} ({entry['size']} bytes)", flush=True)
            download(repo, revision, entry["path"], path, opener)
        files[entry["path"]] = verify_entry(entry, path)
        print(f"ok {entry['path']} {files[entry['path']]['sha256']}", flush=True)
    if not any(name.endswith(".safetensors") for name in files):
        raise SystemExit(f"{repo}@{revision}: no .safetensors shards staged")
    manifest = {"repo": repo, "revision": revision, "files": files}
    (out / "MANIFEST.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))
    (out / "REVISION").write_text(revision + "\n")
    return manifest


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", required=True)
    ap.add_argument("--revision", required=True)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args(argv)
    manifest = stage(args.repo, args.revision, args.out)
    total = sum(f["size"] for f in manifest["files"].values())
    print(f"staged {len(manifest['files'])} files, {total} bytes, revision {args.revision}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
