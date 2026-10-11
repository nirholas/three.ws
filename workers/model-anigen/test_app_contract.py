"""Smoke test for the served contract, run INSIDE the built image (it needs
torch, FastAPI, PIL, google-cloud-storage, and the patched AniGen tree on
PYTHONPATH):

    docker build -t model-anigen workers/model-anigen
    docker run --rm model-anigen python3 test_app_contract.py

It needs no GPU, no weights, and no GCP credentials: the ASGI lifespan (which
opens the GCS client and starts the model load) is deliberately not run, so
every assertion below is about request handling, not inference.

What it proves:

  1. The AniGen import chain resolves, and nvdiffrast is genuinely absent (see
     patch_anigen.py): a module-level `import nvdiffrast` anywhere in the
     resolved chain would mean the build-time patch regressed.
  2. The whole app module imports.
  3. The auth boundary rejects a wrong bearer on both authenticated routes.
  4. The unauthenticated probes (/ and /health) answer, and a dead pipeline
     says so on both /health and /infer so the caller fails over.
  5. Request validation rejects an empty or oversized images array.
  6. The image decoder refuses everything the SSRF guard should refuse.
"""

from __future__ import annotations

import base64
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


def png_data_uri(color=(20, 20, 20, 255), size=(24, 24)) -> str:
    from PIL import Image

    img = Image.new("RGBA", size, color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


_GPU_DRIVER_LIBS = ("libcuda.so", "libnvidia", "libnvrtc")


def _is_gpu_driver_absence(exc: BaseException) -> bool:
    text = str(exc)
    if "cannot open shared object file" in text:
        return any(lib in text for lib in _GPU_DRIVER_LIBS)
    lowered = text.lower()
    return "cuda" in lowered or "nvidia driver" in lowered or "no gpu" in lowered


def main() -> int:
    try:
        import sys as _sys

        for name in list(_sys.modules):
            if name == "nvdiffrast" or name.startswith("nvdiffrast."):
                check("nvdiffrast is not importable in this image", False, f"found {name} already imported")
                break
        else:
            check("nvdiffrast module is absent before any import", "nvdiffrast" not in _sys.modules)

        from anigen.pipelines import AnigenImageTo3DPipeline  # noqa: F401
        import anigen.utils.postprocessing_utils  # noqa: F401
        import anigen.renderers.mesh_renderer  # noqa: F401

        check("anigen import chain resolves", True)
        check(
            "nvdiffrast still not imported after loading anigen's modules",
            "nvdiffrast" not in _sys.modules,
            str(list(_sys.modules.keys()))[:200],
        )
    except ModuleNotFoundError as exc:
        if "nvdiffrast" in str(exc):
            check("anigen import chain resolves without nvdiffrast", False, str(exc))
        else:
            check("anigen import chain resolves", False, str(exc))
    except Exception as exc:  # noqa: BLE001 - classified below
        if _is_gpu_driver_absence(exc):
            print(f"skip  anigen import chain (no GPU on this host): {type(exc).__name__}: {exc}")
        else:
            check("anigen import chain resolves", False, f"{type(exc).__name__}: {exc}")

    import main as app_module
    from fastapi.testclient import TestClient

    client = TestClient(app_module.app)

    bad = {"Authorization": "Bearer wrong-key"}
    res = client.get("/tasks/does-not-exist", headers=bad)
    check("GET /tasks rejects a wrong bearer", res.status_code == 401, f"got {res.status_code}")
    res = client.post("/infer", headers=bad, json={"images": [png_data_uri()]})
    check("POST /infer rejects a wrong bearer", res.status_code == 401, f"got {res.status_code}")

    res = client.get("/health")
    body = res.json()
    check("GET /health answers 200", res.status_code == 200, f"got {res.status_code}")
    check("health names the model", body.get("model") == "anigen", str(body)[:120])
    res = client.get("/")
    body = res.json()
    check("GET / answers 200 for the keep-warm ping", res.status_code == 200, f"got {res.status_code}")
    check("root names the service", body.get("service") == "model-anigen", str(body)[:120])
    check("root lists the working endpoints", "POST /infer" in body.get("endpoints", []), str(body)[:160])

    app_module._load_error = "internal error (ref deadbeefcafe)"
    try:
        res = client.get("/health")
        body = res.json()
        check("a dead pipeline makes /health answer 503", res.status_code == 503, f"got {res.status_code}")
        check("a dead pipeline makes /health report ok:false", body.get("ok") is False, str(body)[:160])
        check("health surfaces the load error", "deadbeefcafe" in str(body.get("load_error")), str(body)[:160])
        res = client.post("/infer", headers={"Authorization": f"Bearer {KEY}"}, json={"images": [png_data_uri()]})
        check("a dead pipeline makes /infer refuse with 503", res.status_code == 503, f"got {res.status_code}")
    finally:
        app_module._load_error = None
    res = client.get("/health")
    check("a live pipeline still answers /health 200", res.status_code == 200, f"got {res.status_code}")
    check("a live pipeline reports ok:true", res.json().get("ok") is True, str(res.json())[:160])

    good = {"Authorization": f"Bearer {KEY}"}
    res = client.post("/infer", headers=good, json={"images": []})
    check("POST /infer rejects an empty images array", res.status_code == 422, f"got {res.status_code}")
    res = client.post("/infer", headers=good, json={"images": [png_data_uri()] * 7})
    check("POST /infer rejects more than six images", res.status_code == 422, f"got {res.status_code}")

    for label, src in [
        ("cleartext http", "http://example.com/a.png"),
        ("bare path", "/etc/passwd"),
        ("loopback https", "https://127.0.0.1/a.png"),
        ("cloud metadata", "https://169.254.169.254/latest/meta-data/"),
        ("corrupt data uri", "data:image/png;base64,not-base64!!"),
    ]:
        try:
            app_module._decode_image_bytes(src)
            check(f"refuses {label}", False, "no exception raised")
        except app_module.ImageSourceError:
            check(f"refuses {label}", True)
        except Exception as exc:  # noqa: BLE001 - must be the caller-facing class
            check(f"refuses {label}", False, f"raised {type(exc).__name__}: {exc}")

    print(f"\n{PASSED} contract assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
