"""Export real Forge creations end to end and record both validators' verdicts.

    python bench.py --out /path/to/scratch [--ids id1,id2,...] [--json results.json]
    USD_EXPORT_KEY=... python bench.py --worker https://<usd-export-service> [--json results.json]

Each id is a public Forge creation. The prompt, category and GLB URL come from
the live API (`GET https://three.ws/api/forge-creation?id=`). Locally, the GLB
is downloaded from its CDN URL and the exporter runs exactly as the worker runs
it. With --worker, each creation is exported by the deployed service instead
(POST /export, poll /tasks/<id>) and the row is read from the report.json it
published, so the table measures the production pipeline end to end. The result table (labels, sizes, masses, hull counts, error and warning
counts per validator, timings) is what docs/openusd-export.md reports.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request

from export import ExportOptions, export_glb
from gltf_meshopt import decode_if_meshopt

API = "https://three.ws/api/forge-creation?id="
# Ten props across four generation lanes plus one auto-rigged avatar.
DEFAULT_IDS = [
    "1e4c9d74-65e0-4b73-b2d9-f07325c760d6",
    "8a0cff6a-652f-461b-8d76-f4659ce0fc6d",
    "cbc2a58e-8bff-44cd-8324-a6282449fbbb",
    "943c6787-ebf4-44da-83f3-2317eef49bb1",
    "c8547eed-446b-456f-b52a-79ea46430766",
    "5fe20c33-15e3-491e-91af-cf4ada42beea",
    "3891b587-1d4b-4856-8bf6-9b75278bd5cb",
    "6ad4d72d-a696-4530-9ce1-3a7fd4a80046",
    "c1a4378a-a859-490a-af1c-4f5306824def",
    "f25348ec-0f5a-4bcc-a6f1-8a42967f513d",
    "168db152-5a66-48d9-b897-0752df6843f0",
]
UA = {"User-Agent": "three.ws-usd-export-bench/1"}


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def creation(cid: str) -> dict:
    body = json.loads(_get(API + cid))
    return body.get("creation") or body


def run_one(cid: str, out_root: str, cache_dir: str) -> dict:
    meta = creation(cid)
    url = meta.get("glb_url")
    if url and url.startswith("/"):
        url = "https://three.ws" + url
    cache = os.path.join(cache_dir, f"{cid}.glb")
    if not os.path.exists(cache):
        with open(cache, "wb") as fh:
            fh.write(_get(url))
    with open(cache, "rb") as fh:
        glb, _ = decode_if_meshopt(fh.read(), ".glb")
    t0 = time.monotonic()
    rep = export_glb(glb, os.path.join(out_root, cid), ExportOptions(
        prompt=meta.get("prompt"), category=meta.get("model_category"), source_url=url, creation_id=cid))
    return row_from_report(cid, meta, rep, round(time.monotonic() - t0, 1))


def run_worker(cid: str, worker: str, key: str) -> dict:
    meta = creation(cid)
    url = meta.get("glb_url")
    if url and url.startswith("/"):
        url = "https://three.ws" + url
    body = {"glb_url": url, "creation_id": cid}
    if meta.get("prompt"):
        body["prompt"] = meta["prompt"]
    if meta.get("model_category"):
        body["category"] = meta["model_category"]
    auth = {**UA, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    t0 = time.monotonic()
    req = urllib.request.Request(f"{worker}/export", data=json.dumps(body).encode(), headers=auth, method="POST")
    with urllib.request.urlopen(req, timeout=60) as resp:
        task = json.loads(resp.read())
    while task["status"] not in ("done", "error"):
        time.sleep(3)
        req = urllib.request.Request(f"{worker}/tasks/{task['task_id']}", headers=auth)
        with urllib.request.urlopen(req, timeout=60) as resp:
            task = json.loads(resp.read())
    if task["status"] == "error":
        raise RuntimeError(f"{cid}: worker export failed: {task.get('error')}")
    rep = json.loads(_get(task["files"]["report"]))
    row = row_from_report(cid, meta, rep, round(time.monotonic() - t0, 1))
    row["task_id"] = task["task_id"]
    row["files"] = task["files"]
    return row


def row_from_report(cid: str, meta: dict, rep: dict, seconds: float) -> dict:
    v = rep["validation"]
    return {
        "id": cid,
        "prompt": (meta.get("prompt") or "")[:80],
        "lane": meta.get("backend"),
        "label": rep["semantics"]["label"],
        "rigged": rep["rigged"],
        "triangles": rep["stats"]["triangles"],
        "joints": rep["stats"]["joints"],
        "size_m": rep["stats"]["size_m"],
        "scale_method": rep["scale"].get("method"),
        "mass_kg": (rep["physics"] or {}).get("mass_kg"),
        "hulls": ((rep["physics"] or {}).get("collision") or {}).get("hulls"),
        "usdchecker": {k: {"errors": len(v[k]["usdchecker"]["errors"]), "warnings": len(v[k]["usdchecker"]["warnings"])} for k in ("usd", "usdz")},
        "asset_validator": {k: {"errors": len(v[k]["asset_validator"]["errors"]), "warnings": len(v[k]["asset_validator"]["warnings"]),
                                "warning_rules": sorted({w["rule"] for w in v[k]["asset_validator"]["warnings"]})} for k in ("usd", "usdz")},
        "passed": v["passed"],
        "usdz_bytes": rep["files"]["asset.usdz"],
        "seconds": seconds,
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="scratch directory for a local run")
    ap.add_argument("--worker", help="base URL of a deployed usd-export-service")
    ap.add_argument("--ids")
    ap.add_argument("--json")
    args = ap.parse_args(argv)
    if not args.out and not args.worker:
        ap.error("pass --out for a local run or --worker for the deployed service")
    ids = args.ids.split(",") if args.ids else DEFAULT_IDS
    if args.out:
        cache = os.path.join(args.out, "_glb")
        os.makedirs(cache, exist_ok=True)
    key = os.environ.get("USD_EXPORT_KEY", "")
    if args.worker and not key:
        ap.error("set USD_EXPORT_KEY to the worker's bearer secret")
    rows = []
    for cid in ids:
        row = run_worker(cid, args.worker.rstrip("/"), key) if args.worker else run_one(cid, args.out, cache)
        rows.append(row)
        print(json.dumps(row), flush=True)
    summary = {"models": len(rows), "passed": sum(r["passed"] for r in rows),
               "mode": f"worker {args.worker}" if args.worker else "local", "rows": rows}
    if args.json:
        with open(args.json, "w") as fh:
            json.dump(summary, fh, indent=2)
            fh.write("\n")
    print(f"{summary['passed']}/{summary['models']} exports passed both validators", file=sys.stderr)
    return 0 if summary["passed"] == summary["models"] else 1


if __name__ == "__main__":
    sys.exit(main())
