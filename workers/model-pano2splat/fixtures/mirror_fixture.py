"""
Mirror one real, redistributable capture into the fixture bucket and merge its
entry into gs://<FIXTURE_BUCKET>/insta360/MANIFEST.json.

Every insta360 order appends to the same manifest, so the merge is a
read-modify-write guarded by the object's generation: if a sibling wrote the
manifest between our read and our write, the write is refused and we re-read.

    python fixtures/mirror_fixture.py \
        --id commons-moscow-metro-interior \
        --url "https://upload.wikimedia.org/.../file.webm" \
        --page-url "https://commons.wikimedia.org/wiki/File:..." \
        --license "CC0" --license-url "https://creativecommons.org/publicdomain/zero/1.0/" \
        --author "Svetlov Artem" --camera-model "unknown spherical camera" \
        --source-kind equirect_video --verify --added-by 337

The file is streamed straight from the source into the bucket (no local copy)
while its SHA-256 is computed, so multi-GB 8K captures need no local disk.

Credentials: Application Default Credentials, or, on a workstation whose ADC is
a scope-limited VM identity, the gcloud CLI login via
GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)".
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sys
import time

import httpx
from google.api_core.exceptions import PreconditionFailed
from google.cloud import storage
from google.oauth2.credentials import Credentials

MANIFEST_OBJECT = "insta360/MANIFEST.json"
USER_AGENT = "three.ws-worker/1.0 (+https://three.ws)"
CHUNK = 8 * 1024 * 1024


class _HashingReader:
    """File-like wrapper over an httpx byte stream that hashes as it is read."""

    def __init__(self, stream):
        self._iter = stream.iter_bytes(CHUNK)
        self._buf = b""
        self.sha256 = hashlib.sha256()
        self.total = 0
        self._returned = 0

    def tell(self) -> int:
        """Bytes handed to the uploader so far (the resumable upload tracks this)."""
        return self._returned

    def read(self, size: int = -1) -> bytes:
        while size < 0 or len(self._buf) < size:
            try:
                chunk = next(self._iter)
            except StopIteration:
                break
            self.sha256.update(chunk)
            self.total += len(chunk)
            self._buf += chunk
        if size < 0:
            out, self._buf = self._buf, b""
        else:
            out, self._buf = self._buf[:size], self._buf[size:]
        self._returned += len(out)
        return out


def _stream_to_bucket(url: str, blob: storage.Blob, content_type: str) -> tuple[str, int]:
    with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(60.0, read=300.0)) as client:
        with client.stream("GET", url, headers={"User-Agent": USER_AGENT}) as resp:
            resp.raise_for_status()
            reader = _HashingReader(resp)
            blob.chunk_size = 64 * 1024 * 1024
            blob.upload_from_file(reader, content_type=content_type, rewind=False)
    return reader.sha256.hexdigest(), reader.total


def _merge_manifest(bucket: storage.Bucket, entry: dict) -> None:
    for attempt in range(8):
        blob = bucket.blob(MANIFEST_OBJECT)
        if blob.exists():
            blob.reload()
            generation = blob.generation
            manifest = json.loads(blob.download_as_bytes(if_generation_match=generation))
        else:
            generation = 0
            manifest = {"version": 1, "fixtures": []}
        fixtures = [f for f in manifest.get("fixtures", []) if f.get("id") != entry["id"]]
        fixtures.append(entry)
        manifest["fixtures"] = sorted(fixtures, key=lambda f: f["id"])
        manifest["updated_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
        try:
            bucket.blob(MANIFEST_OBJECT).upload_from_string(
                json.dumps(manifest, indent=2) + "\n",
                content_type="application/json",
                if_generation_match=generation,
            )
            return
        except PreconditionFailed:
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError("manifest kept changing under us; re-run to merge")


def _client() -> storage.Client:
    token = os.environ.get("GOOGLE_OAUTH_ACCESS_TOKEN")
    if token:
        project = os.environ.get("GOOGLE_CLOUD_PROJECT", "aerial-vehicle-466722-p5")
        return storage.Client(project=project, credentials=Credentials(token))
    return storage.Client()


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--id", required=True, help="stable fixture id, kebab-case")
    p.add_argument("--url", required=True, help="direct download URL of the original file")
    p.add_argument("--page-url", required=True, help="human page that states the license")
    p.add_argument("--license", required=True)
    p.add_argument("--license-url", required=True)
    p.add_argument("--author", required=True)
    p.add_argument("--camera-model", required=True)
    p.add_argument(
        "--source-kind", required=True,
        choices=["equirect_video", "equirect_images", "insv", "insp"],
    )
    p.add_argument("--content-type", default="application/octet-stream")
    p.add_argument("--ext", default=None, help="object extension; defaults to the URL's")
    p.add_argument("--verify", action="store_true", help="include in the GPU verify harness")
    p.add_argument("--added-by", required=True, help="campaign order number")
    p.add_argument("--note", default="")
    p.add_argument("--bucket", default=os.environ.get("FIXTURE_BUCKET", "three-ws-capture-fixtures"))
    args = p.parse_args(argv)

    ext = args.ext or os.path.splitext(args.url.split("?", 1)[0])[1].lower()
    obj = f"insta360/{args.id}{ext}"
    bucket = _client().bucket(args.bucket)
    blob = bucket.blob(obj)

    t0 = time.time()
    sha, size = _stream_to_bucket(args.url, blob, args.content_type)
    print(f"mirrored {size} bytes in {time.time() - t0:.0f}s -> gs://{args.bucket}/{obj} sha256={sha}")

    entry = {
        "id": args.id,
        "objects": [obj],
        "source_kind": args.source_kind,
        "source_url": args.url.split("?", 1)[0],
        "page_url": args.page_url,
        "license": args.license,
        "license_url": args.license_url,
        "author": args.author,
        "camera_model": args.camera_model,
        "bytes": size,
        "sha256": sha,
        "verify": bool(args.verify),
        "added_by": args.added_by,
        "added_at": dt.date.today().isoformat(),
    }
    if args.note:
        entry["note"] = args.note
    _merge_manifest(bucket, entry)
    print(json.dumps(entry, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
