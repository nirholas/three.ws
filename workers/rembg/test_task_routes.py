"""The HTTP routes end to end: submit, cross-instance poll, and the traffic split.

    API_KEY=x GCS_BUCKET=x python3 workers/rembg/test_task_routes.py

Runs the real FastAPI app (real decode, real rembg cutout on the baked-in
default model) with the GCS bucket swapped for a dict-backed stand-in that
raises the real google.api_core NotFound, and the GPU lane behind
httpx.MockTransport. Needs the ONNX weights (the Docker build gate has them).
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import sys

os.environ.setdefault("API_KEY", "routes-test")
os.environ.setdefault("GCS_BUCKET", "routes-test")

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from google.api_core import exceptions as gcs_errors  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

import main  # noqa: E402

PASS = 0
AUTH = {"Authorization": f"Bearer {os.environ['API_KEY']}"}


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASS
    if not condition:
        print(f"FAIL  {name}  {detail}")
        sys.exit(1)
    PASS += 1
    print(f"ok    {name}")


class _Blob:
    def __init__(self, bucket, name):
        self.bucket, self.name = bucket, name

    def upload_from_string(self, data, content_type=None):
        self.bucket.objects[self.name] = data if isinstance(data, bytes) else data.encode()

    def download_as_bytes(self):
        if self.bucket.broken:
            raise gcs_errors.ServiceUnavailable("backend error")
        if self.name not in self.bucket.objects:
            raise gcs_errors.NotFound(self.name)
        return self.bucket.objects[self.name]


class Bucket:
    def __init__(self):
        self.objects, self.broken = {}, False

    def blob(self, name):
        return _Blob(self, name)


def portrait_data_uri() -> str:
    img = Image.new("RGB", (480, 360), (232, 236, 240))
    draw = ImageDraw.Draw(img)
    draw.ellipse([170, 40, 310, 180], fill=(198, 86, 60))
    draw.rounded_rectangle([140, 170, 340, 350], radius=30, fill=(44, 90, 156))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


bucket = Bucket()
main._bucket = bucket
main._sem = asyncio.Semaphore(2)
client = TestClient(main.app)  # no lifespan: no real GCS client is built

# ── submit, then poll from an instance that never saw the job ────────────────
resp = client.post("/remove", json={"image": portrait_data_uri()}, headers=AUTH)
check("submit answers 202", resp.status_code == 202, resp.text)
task_id = resp.json()["task_id"]
record = json.loads(bucket.objects[f"rembg/tasks/{task_id}.json"])
check("the terminal record is published to the bucket", record["status"] == "done", str(record))
check("the cutout PNG was uploaded", f"rembg/{task_id}.png" in bucket.objects)
check("published records omit retention bookkeeping", "created_at" not in record)

main._tasks.clear()  # this process now plays an instance that never saw the job
resp = client.get(f"/tasks/{task_id}", headers=AUTH)
check("a poll on another instance finds the job", resp.status_code == 200, resp.text)
check("and gets the result URL", resp.json().get("result_url", "").endswith(f"/rembg/{task_id}.png"),
      resp.text)

resp = client.get("/tasks/8a1d2c3b-0000-4000-8000-000000000000", headers=AUTH)
check("an unknown id is still a 404", resp.status_code == 404, resp.text)
resp = client.get("/tasks/not-a-uuid", headers=AUTH)
check("a malformed id is a 404 without touching storage", resp.status_code == 404, resp.text)

bucket.broken = True
resp = client.get("/tasks/8a1d2c3b-0000-4000-8000-000000000000", headers=AUTH)
check("a storage outage is a retryable 503, not a false 404", resp.status_code == 503, resp.text)
bucket.broken = False

resp = client.get(f"/tasks/{task_id}")
check("polls still need the key", resp.status_code == 401)

# ── traffic split ────────────────────────────────────────────────────────────
LANE_TASK = "0b9f0c8e-5d3c-4a8e-9b51-2f1c6d7e8a90"


def lane_ok(request):
    return httpx.Response(202, json={"task_id": LANE_TASK, "status": "queued", "model": "isnet-general-use"})


def lane_down(request):
    return httpx.Response(503, text="no capacity")


main.TRITON_FORWARD_URL = "https://rembg-triton.example.run.app"
main.TRITON_FORWARD_PERCENT = 100.0
main._forward_client = httpx.AsyncClient(transport=httpx.MockTransport(lane_ok))
before = len(main._tasks)
resp = client.post("/remove", json={"image": portrait_data_uri()}, headers=AUTH)
check("a forwarded submit returns the lane's task id",
      resp.status_code == 202 and resp.json()["task_id"] == LANE_TASK, resp.text)
check("a forwarded job is not run locally", len(main._tasks) == before)

main._forward_client = httpx.AsyncClient(transport=httpx.MockTransport(lane_down))
resp = client.post("/remove", json={"image": portrait_data_uri()}, headers=AUTH)
local_id = resp.json()["task_id"]
check("a refused forward falls back to a local job",
      resp.status_code == 202 and local_id != LANE_TASK and local_id in main._tasks, resp.text)
check("the fallback job completes", main._tasks[local_id]["status"] == "done", str(main._tasks[local_id]))

health = client.get("/health").json()
check("health reports the split and its counters",
      health["triton_forward"]["forwarded"] == 1 and health["triton_forward"]["fallbacks"] == 1,
      str(health["triton_forward"]))
check("health names the inference backend", health["inference_backend"] == "onnxruntime")

print(f"\n{PASS} checks passed")
