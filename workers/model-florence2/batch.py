"""
Batch describe: the Cloud Run job entry point for verification and backfill.

    python batch.py gs://bucket/path/in.json gs://bucket/path/out.json

in.json is ``[{ "id": "<creation uuid>", "image_url": "https://..." }, ...]``
as written by ``scripts/creation-descriptions-backfill.mjs --export``. The job
describes each image with the same code the service runs and writes
``{ items: [{ id, image_url, ok, result? , error? }], stats }`` to out.json,
which ``--import`` then stores. No database access from the GPU job: the API
side owns every write.

Resumable: out.json is rewritten every CHECKPOINT items, and a rerun skips ids
already present in it.
"""

from __future__ import annotations

import json
import logging
import statistics
import sys
import time
from urllib.parse import urlsplit

import httpx

import describe as florence
from worker_security import (
    UnsafeUrlError,
    UnsupportedImageError,
    fetch_remote_bytes,
    open_caller_image,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("florence2.batch")

CHECKPOINT = 25
MAX_IMAGE_BYTES = 12 * 1024 * 1024


def _blob(uri: str):
    from google.cloud import storage

    parts = urlsplit(uri)
    if parts.scheme != "gs":
        raise SystemExit(f"expected a gs:// uri, got {uri}")
    return storage.Client().bucket(parts.netloc).blob(parts.path.lstrip("/"))


def read_json(uri: str):
    blob = _blob(uri)
    if not blob.exists():
        return None
    return json.loads(blob.download_as_text())


def write_json(uri: str, data) -> None:
    _blob(uri).upload_from_string(json.dumps(data, ensure_ascii=False), content_type="application/json")


def summarize(items, wall_s: float) -> dict:
    ok = [i for i in items if i.get("ok")]
    lat = [i["result"]["latency_ms"] for i in ok]
    return {
        "total": len(items),
        "ok": len(ok),
        "failed": len(items) - len(ok),
        "device": ok[0]["result"]["device"] if ok else florence.device(),
        "model": florence.MODEL_ID,
        "model_version": florence.resolved_revision() or florence.MODEL_REVISION,
        "latency_ms_p50": int(statistics.median(lat)) if lat else None,
        "latency_ms_mean": int(statistics.fmean(lat)) if lat else None,
        "latency_ms_max": max(lat) if lat else None,
        "wall_seconds": round(wall_s, 1),
    }


def describe_one(entry: dict) -> dict:
    out = {"id": entry.get("id"), "image_url": entry.get("image_url")}
    try:
        data = fetch_remote_bytes(entry["image_url"], timeout=30.0, max_bytes=MAX_IMAGE_BYTES)
        img = open_caller_image(data, "RGB")
        out.update(ok=True, result=florence.describe(img))
    except (UnsafeUrlError, UnsupportedImageError, httpx.HTTPError, ValueError, KeyError) as exc:
        out.update(ok=False, error=f"{type(exc).__name__}: {str(exc)[:200]}")
    return out


def main(argv) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    src, dst = argv[1], argv[2]
    entries = read_json(src) or []
    prior = read_json(dst) or {}
    items = list(prior.get("items") or [])
    done = {i.get("id") for i in items}
    todo = [e for e in entries if e.get("id") not in done]
    log.info("batch: %d entries, %d already done, %d to describe", len(entries), len(done), len(todo))

    t_load = time.monotonic()
    florence.load()
    load_s = time.monotonic() - t_load
    t0 = time.monotonic()
    for n, entry in enumerate(todo, 1):
        items.append(describe_one(entry))
        if n % CHECKPOINT == 0 or n == len(todo):
            stats = summarize(items, time.monotonic() - t0)
            stats["model_load_seconds"] = round(load_s, 1)
            write_json(dst, {"items": items, "stats": stats})
            log.info("batch: %d/%d described (%d ok)", n, len(todo), stats["ok"])
    if not todo:
        write_json(dst, {"items": items, "stats": summarize(items, 0)})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
