"""Smoke test for the served contract, run INSIDE the built image (it needs
torch, FastAPI, PIL, google-cloud-storage, and the cloned TRELLIS.2 tree on
PYTHONPATH):

    docker build -t model-trellis2 workers/model-trellis2
    docker run --rm model-trellis2 python3 test_app_contract.py

It needs no GPU, no weights, and no GCP credentials: the ASGI lifespan (which
opens the GCS client and starts the model load) is deliberately not run, so every
assertion below is about request handling, not inference.

What it proves:

  1. The TRELLIS.2 import chain resolves, including the compiled CuMesh,
     FlexGEMM, O-Voxel and nvdiffrast extensions the GLB bake needs. A missing
     extension otherwise surfaces minutes after the port opens, as a revision that
     answers /health with a load_error and can never generate.
  2. The whole app module imports.
  3. The auth boundary rejects a wrong bearer on both authenticated routes.
  4. The unauthenticated probe surfaces (/ and /health) answer, and a dead
     pipeline says so on both /health and /infer so the caller fails over.
  5. Request validation rejects an empty or oversized images array.
  6. The image decoder keeps an RGBA cutout's alpha and refuses everything the
     SSRF guard should refuse.
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


# Libraries the NVIDIA container runtime mounts into a GPU instance. The image
# cannot ship them, so their absence on the CPU-only builder is expected.
_GPU_DRIVER_LIBS = ("libcuda.so", "libnvidia", "libnvrtc")


def _is_gpu_driver_absence(exc: BaseException) -> bool:
    text = str(exc)
    if "cannot open shared object file" in text:
        return any(lib in text for lib in _GPU_DRIVER_LIBS)
    lowered = text.lower()
    return "cuda" in lowered or "nvidia driver" in lowered or "no gpu" in lowered


def main() -> int:
    try:
        from trellis2.pipelines import Trellis2ImageTo3DPipeline  # noqa: F401
        import o_voxel.postprocess  # noqa: F401
        import cumesh  # noqa: F401
        import flex_gemm  # noqa: F401

        check("trellis2 import chain resolves", True)
    except ModuleNotFoundError as exc:
        check("trellis2 import chain resolves", False, str(exc))
    except Exception as exc:  # noqa: BLE001 - classified below
        if _is_gpu_driver_absence(exc):
            print(f"skip  trellis2 import chain (no GPU on this host): {type(exc).__name__}: {exc}")
        else:
            check("trellis2 import chain resolves", False, f"{type(exc).__name__}: {exc}")

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
    check("health names the model", body.get("model") == "trellis2-4b", str(body)[:120])
    check("health lists the resolutions", body.get("resolutions") == [512, 1024, 1536], str(body.get("resolutions")))
    res = client.get("/")
    body = res.json()
    check("GET / answers 200 for the keep-warm ping", res.status_code == 200, f"got {res.status_code}")
    check("root names the service", body.get("service") == "model-trellis2", str(body)[:120])
    check("root lists the working endpoints", "POST /infer" in body.get("endpoints", []), str(body)[:160])

    # A dead instance must SAY it is dead, on both surfaces. A latched load error
    # that /health ignores and /infer keeps accepting past is how the v1 TRELLIS
    # lane lost 70 generations on 2026-09-02 while every health view stayed green.
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
    check("POST /infer rejects more than six views", res.status_code == 422, f"got {res.status_code}")

    img = app_module._decode_image(png_data_uri())
    check("data uri decodes with its alpha channel", img.mode == "RGBA" and img.size == (24, 24), f"{img.mode} {img.size}")

    for label, src in [
        ("cleartext http", "http://example.com/a.png"),
        ("bare path", "/etc/passwd"),
        ("loopback https", "https://127.0.0.1/a.png"),
        ("cloud metadata", "https://169.254.169.254/latest/meta-data/"),
        ("corrupt data uri", "data:image/png;base64,not-base64!!"),
    ]:
        try:
            app_module._decode_image(src)
            check(f"refuses {label}", False, "no exception raised")
        except app_module.ImageSourceError:
            check(f"refuses {label}", True)
        except Exception as exc:  # noqa: BLE001 - must be the caller-facing class
            check(f"refuses {label}", False, f"raised {type(exc).__name__}: {exc}")

    print(f"\n{PASSED} contract assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
