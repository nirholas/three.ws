"""Smoke test for the served contract. Runs INSIDE the built image (and on any
machine with fastapi, httpx, Pillow, trimesh and google-cloud-storage):

    docker build -t model-sam3d-objects workers/model-sam3d-objects
    docker run --rm model-sam3d-objects python3 test_app_contract.py

It needs no GPU, no weights and no GCP credentials: the ASGI lifespan (which
opens the GCS client and starts the model load) is deliberately not run, so
every assertion is about request handling, not inference.

What it proves:
  1. The whole app module imports.
  2. The auth boundary rejects a wrong bearer on both authenticated routes.
  3. Malformed requests are refused with 422 and a sentence, before a task exists.
  4. The unauthenticated probes answer, and a dead pipeline says so on /health
     and /infer so the caller fails over.
  5. The photo and mask loaders refuse everything the SSRF guard should refuse.
"""

from __future__ import annotations

import os
import sys

os.environ.setdefault("API_KEY", "smoke-test-key")
os.environ.setdefault("GCS_BUCKET", "smoke-test-bucket")

KEY = os.environ["API_KEY"]
PASSED = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if not condition:
        print(f"FAIL  {name}  {detail}")
        sys.exit(1)
    PASSED += 1
    print(f"ok    {name}")


def main() -> int:
    import main as app_module
    from fastapi.testclient import TestClient

    client = TestClient(app_module.app)  # no `with`: lifespan stays off
    good = {"Authorization": f"Bearer {KEY}"}
    bad = {"Authorization": "Bearer wrong"}
    photo = "https://example.com/room.jpg"

    check("imports", app_module.app.title == "model-sam3d-objects")

    r = client.post("/infer", json={"image_url": photo, "boxes": [[0.1, 0.1, 0.5, 0.5]]}, headers=bad)
    check("infer rejects a wrong key", r.status_code == 401, str(r.status_code))
    r = client.get("/tasks/00000000-0000-4000-8000-000000000000", headers=bad)
    check("tasks rejects a wrong key", r.status_code == 401, str(r.status_code))

    r = client.post("/infer", json={"image_url": photo}, headers=good)
    check("infer without objects is 422", r.status_code == 422 and "name the objects" in r.text, r.text)
    r = client.post("/infer", json={"image_url": photo, "boxes": [[0.5, 0.5, 0.4, 0.4]]}, headers=good)
    check("infer with an inverted box is 422", r.status_code == 422 and "boxes[0]" in r.text, r.text)
    r = client.post(
        "/infer",
        json={"image_url": photo, "boxes": [[0.1, 0.1, 0.5, 0.5]], "mask_urls": ["https://example.com/m.png"]},
        headers=good,
    )
    check("infer with masks and boxes is 422", r.status_code == 422, r.text)

    r = client.get("/")
    check("descriptor answers", r.status_code == 200 and r.json()["model"] == "sam3d-objects")
    r = client.get("/health")
    check("health answers while loading", r.status_code == 200 and r.json()["ok"] is True)

    for url in ("http://169.254.169.254/latest/meta-data", "https://localhost/x.png", "file:///etc/passwd"):
        try:
            app_module._load_photo(url)
        except app_module.ImageSourceError:
            check(f"photo loader refuses {url}", True)
        else:
            check(f"photo loader refuses {url}", False)

    app_module._load_error = "weights missing"
    r = client.get("/health")
    check("dead pipeline drains on /health", r.status_code == 503 and r.json()["ok"] is False, r.text)
    r = client.post("/infer", json={"image_url": photo, "boxes": [[0.1, 0.1, 0.5, 0.5]]}, headers=good)
    check("dead pipeline fails /infer fast", r.status_code == 503, str(r.status_code))
    app_module._load_error = None

    print(f"\n{PASSED} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
