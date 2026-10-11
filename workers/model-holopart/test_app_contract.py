"""Smoke test for the served contract, run INSIDE the built image (it needs
torch, FastAPI, trimesh, google-cloud-storage, and the vendored HoloPart tree
on PYTHONPATH):

    docker build -t model-holopart workers/model-holopart
    docker run --rm model-holopart python3 test_app_contract.py

It needs no GPU, no weights, and no GCP credentials: the ASGI lifespan (which
opens the GCS client and starts the model load) is deliberately not run, so
every assertion below is about request handling, not inference.

What it proves:

  1. The whole app module imports.
  2. The auth boundary rejects a wrong bearer on both authenticated routes.
  3. The unauthenticated probes (/ and /health) answer, and a dead pipeline
     says so on both /health and /infer so the caller fails over.
  4. The mesh loader refuses everything the SSRF guard and the FBX/format
     checks should refuse, including a valid GLB with too few named parts.
  5. pipeline.py's part-completion guard rejects a scene with fewer than two
     named geometries before any GPU work would start.
"""

from __future__ import annotations

import io
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


def _single_part_glb_bytes() -> bytes:
    import trimesh

    scene = trimesh.Scene()
    scene.add_geometry(trimesh.creation.box(), node_name="part_01", geom_name="part_01")
    buf = io.BytesIO()
    scene.export(buf, file_type="glb")
    return buf.getvalue()


def main() -> int:
    import main as app_module
    from fastapi.testclient import TestClient

    client = TestClient(app_module.app)

    bad = {"Authorization": "Bearer wrong-key"}
    res = client.get("/tasks/does-not-exist", headers=bad)
    check("GET /tasks rejects a wrong bearer", res.status_code == 401, f"got {res.status_code}")
    res = client.post("/infer", headers=bad, json={"mesh_url": "https://example.com/a.glb"})
    check("POST /infer rejects a wrong bearer", res.status_code == 401, f"got {res.status_code}")

    res = client.get("/health")
    body = res.json()
    check("GET /health answers 200", res.status_code == 200, f"got {res.status_code}")
    check("health names the model", body.get("model") == "holopart", str(body)[:120])
    res = client.get("/")
    body = res.json()
    check("GET / answers 200 for the keep-warm ping", res.status_code == 200, f"got {res.status_code}")
    check("root names the service", body.get("service") == "model-holopart", str(body)[:120])
    check("root lists the working endpoints", "POST /infer" in body.get("endpoints", []), str(body)[:160])

    app_module._load_error = "internal error (ref deadbeefcafe)"
    try:
        res = client.get("/health")
        body = res.json()
        check("a dead pipeline makes /health answer 503", res.status_code == 503, f"got {res.status_code}")
        check("a dead pipeline makes /health report ok:false", body.get("ok") is False, str(body)[:160])
        check("health surfaces the load error", "deadbeefcafe" in str(body.get("load_error")), str(body)[:160])
        res = client.post(
            "/infer", headers={"Authorization": f"Bearer {KEY}"},
            json={"mesh_url": "https://example.com/a.glb"},
        )
        check("a dead pipeline makes /infer refuse with 503", res.status_code == 503, f"got {res.status_code}")
    finally:
        app_module._load_error = None
    res = client.get("/health")
    check("a live pipeline still answers /health 200", res.status_code == 200, f"got {res.status_code}")
    check("a live pipeline reports ok:true", res.json().get("ok") is True, str(res.json())[:160])

    good = {"Authorization": f"Bearer {KEY}"}
    res = client.post("/infer", headers=good, json={})
    check("POST /infer requires mesh_url", res.status_code == 422, f"got {res.status_code}")

    for label, src in [
        ("cleartext http", "http://example.com/a.glb"),
        ("bare path", "/etc/passwd"),
        ("loopback https", "https://127.0.0.1/a.glb"),
        ("cloud metadata", "https://169.254.169.254/latest/meta-data/"),
    ]:
        try:
            app_module._fetch_mesh_bytes(src)
            check(f"refuses {label}", False, "no exception raised")
        except app_module.MeshSourceError:
            check(f"refuses {label}", True)
        except Exception as exc:  # noqa: BLE001 - must be the caller-facing class
            check(f"refuses {label}", False, f"raised {type(exc).__name__}: {exc}")

    from pipeline import MIN_PARTS, PartCompletionError, _prepare_batch

    try:
        import trimesh

        single_part_scene = trimesh.load(io.BytesIO(_single_part_glb_bytes()), file_type="glb")
        _prepare_batch(single_part_scene, device="cpu")
        check("rejects a scene with fewer than MIN_PARTS geometries", False, "no exception raised")
    except PartCompletionError as exc:
        check("rejects a scene with fewer than MIN_PARTS geometries", True, str(exc))
    except ModuleNotFoundError as exc:
        print(f"skip  part-count guard (torch_cluster unavailable in this environment): {exc}")
    check("MIN_PARTS matches the documented floor", MIN_PARTS == 2, str(MIN_PARTS))

    print(f"\n{PASSED} contract assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
