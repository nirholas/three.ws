"""Service-path proof, run as a Cloud Run job: ``python selftest.py``.

Starts the real FastAPI app on localhost, signs a URL for one fixture photo, then drives
POST /infer and GET /tasks/{id} exactly as a client would, and downloads the three signed
result URLs it gets back. Exits non-zero on any failure.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time

import httpx
import uvicorn

os.environ.setdefault("API_KEY", "selftest")

import main  # noqa: E402
from storage import GcsStore  # noqa: E402


def say(**kw) -> None:
    print(json.dumps(kw), flush=True)


def run() -> int:
    key = os.environ["API_KEY"]
    fixture = os.environ["SELFTEST_OBJECT"]
    fixtures = GcsStore(os.environ.get("VERIFY_FIXTURE_BUCKET", "three-ws-capture-fixtures"))
    photo_url = fixtures.signed_url(fixture)
    say(event="signed_fixture", ok=photo_url.startswith("https://storage.googleapis.com/"))

    server = uvicorn.Server(uvicorn.Config(main.app, host="127.0.0.1", port=8081, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    base = "http://127.0.0.1:8081"
    for _ in range(100):
        try:
            if httpx.get(base + "/health", timeout=2).status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.2)
    health = httpx.get(base + "/health").json()
    say(event="health", **health)
    if not health.get("gpu_available") or not health.get("weights_present"):
        return 1

    auth = {"Authorization": f"Bearer {key}"}
    t0 = time.time()
    r = httpx.post(base + "/infer", json={"image_url": photo_url, "job_id": "selftest"}, headers=auth, timeout=30)
    say(event="infer", status=r.status_code, body=r.json())
    if r.status_code != 202:
        return 1
    task_id = r.json()["task_id"]
    task = {}
    while time.time() - t0 < 900:
        task = httpx.get(f"{base}/tasks/{task_id}", headers=auth, timeout=30).json()
        if task["status"] in ("succeeded", "failed"):
            break
        time.sleep(3)
    say(event="task", seconds=round(time.time() - t0, 1), task=task)
    if task.get("status") != "succeeded":
        return 1
    result = task["result"]
    for name in ("glb_url", "ply_url", "depth_url"):
        got = httpx.get(result[name], timeout=120)
        say(event="download", name=name, status=got.status_code, bytes=len(got.content))
        if got.status_code != 200 or not got.content:
            return 1
    bad = httpx.post(base + "/infer", json={"image_url": "http://169.254.169.254/"}, headers=auth, timeout=10)
    say(event="ssrf", status=bad.status_code)
    return 0 if bad.status_code == 400 else 1


if __name__ == "__main__":
    sys.exit(run())
