"""Smoke test for the served contract, run INSIDE the built image (it needs
torch, FastAPI, PIL, google-cloud-storage, and the cloned Pixal3D/MV-Adapter
trees on PYTHONPATH):

    docker build -t model-pixal3d workers/model-pixal3d
    docker run --rm model-pixal3d python3 test_app_contract.py

It needs no GPU, no weights, and no GCP credentials: the ASGI lifespan (which
opens the GCS client and starts weight staging) is deliberately not run, so
every assertion below is about request handling, not inference.

What it proves, mirroring workers/model-trellis2's identical-purpose test:

  1. The Pixal3D import chain resolves, including the compiled CuMesh,
     FlexGEMM, O-Voxel and nvdiffrast extensions the GLB bake needs (same
     backbone as TRELLIS.2), plus natten (its neighborhood-attention blocks)
     and MoGe (the single-view camera estimator).
  2. The whole app module imports.
  3. The auth boundary rejects a wrong bearer on both authenticated routes.
  4. The unauthenticated probe surfaces (/ and /health) answer, and a dead
     pipeline says so on both /health and /infer so the caller fails over.
  5. Request validation: an empty or 5+ image array is rejected, a
     view_labels length mismatch is rejected, fill_other_sides with more
     than one image is rejected.
  6. The image decoder keeps an RGBA cutout's alpha and refuses everything
     the SSRF guard should refuse.
"""

from __future__ import annotations

import base64
import io
import os
import re
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
# Triton's driver discovery (pulled in by flex_gemm) reports how many GPU
# backends it found. Zero is the CPU-only builder; any other count is a real fault.
_TRITON_DRIVER_COUNT = re.compile(r"^(\d+) active drivers \(.*\)\. There should only be one\.$")


def _is_gpu_driver_absence(exc: BaseException) -> bool:
    text = str(exc)
    triton = _TRITON_DRIVER_COUNT.match(text.strip())
    if triton:
        return triton.group(1) == "0"
    if "cannot open shared object file" in text:
        return any(lib in text for lib in _GPU_DRIVER_LIBS)
    lowered = text.lower()
    return "cuda" in lowered or "nvidia driver" in lowered or "no gpu" in lowered


def main() -> int:
    try:
        from pixal3d.pipelines.pixal3d_image_to_3d import Pixal3DImageTo3DPipeline  # noqa: F401
        import o_voxel.postprocess  # noqa: F401
        import cumesh  # noqa: F401
        import flex_gemm  # noqa: F401
        import natten  # noqa: F401
        import moge  # noqa: F401

        check("pixal3d import chain resolves", True)
    except ModuleNotFoundError as exc:
        check("pixal3d import chain resolves", False, str(exc))
    except Exception as exc:  # noqa: BLE001 - classified below
        if _is_gpu_driver_absence(exc):
            print(f"skip  pixal3d import chain (no GPU on this host): {type(exc).__name__}: {exc}")
        else:
            check("pixal3d import chain resolves", False, f"{type(exc).__name__}: {exc}")

    # The optional fill-other-sides rung imports MV-Adapter's own inference
    # script lazily on the first fill request; resolve that exact path here so a
    # missing dependency fails the build, not a paying caller.
    mvadapter_src = os.environ.get("MVADAPTER_SRC", "/opt/mvadapter-src")
    if os.path.isdir(mvadapter_src):
        if mvadapter_src not in sys.path:
            sys.path.insert(0, mvadapter_src)
        try:
            import scripts.inference_i2mv_sdxl  # noqa: F401

            check("mv-adapter import chain resolves", True)
        except ModuleNotFoundError as exc:
            check("mv-adapter import chain resolves", False, str(exc))
        except Exception as exc:  # noqa: BLE001 - classified below
            if _is_gpu_driver_absence(exc):
                print(f"skip  mv-adapter import chain (no GPU on this host): {type(exc).__name__}: {exc}")
            else:
                check("mv-adapter import chain resolves", False, f"{type(exc).__name__}: {exc}")
        finally:
            sys.path.remove(mvadapter_src)
            for name in [m for m in sys.modules if m == "scripts" or m.startswith("scripts.")]:
                del sys.modules[name]

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
    check("health names the model", body.get("model") == "pixal3d", str(body)[:120])
    check("health lists the resolutions", body.get("resolutions") == [1024, 1536], str(body.get("resolutions")))
    check("health reports max_images", body.get("max_images") == 4, str(body)[:160])
    res = client.get("/")
    body = res.json()
    check("GET / answers 200 for the keep-warm ping", res.status_code == 200, f"got {res.status_code}")
    check("root names the service", body.get("service") == "model-pixal3d", str(body)[:120])
    check("root lists the working endpoints", "POST /infer" in body.get("endpoints", []), str(body)[:160])

    # A dead instance must SAY it is dead, on both surfaces. See
    # workers/model-trellis2's identical check for why this matters.
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
    res = client.post("/infer", headers=good, json={"images": [png_data_uri()] * 5})
    check("POST /infer rejects more than four images", res.status_code == 422, f"got {res.status_code}")
    res = client.post(
        "/infer", headers=good,
        json={"images": [png_data_uri(), png_data_uri()], "view_labels": ["front"]},
    )
    check("POST /infer rejects a view_labels length mismatch", res.status_code == 400, f"got {res.status_code}")
    res = client.post(
        "/infer", headers=good,
        json={"images": [png_data_uri(), png_data_uri()], "fill_other_sides": True},
    )
    check("POST /infer rejects fill_other_sides with more than one image", res.status_code == 400, f"got {res.status_code}")

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

    # Task records live in a publicly readable bucket, where an upload with no
    # Cache-Control is edge-cacheable for an hour; a poll that reads a frozen
    # copy fails a live job as orphaned (europe-west4, 2026-11-14). Drive the
    # real _update_task against a recording bucket: the submit write and a
    # heartbeat must both go out no-store.
    import asyncio

    class _RecordingBlob:
        def __init__(self, sink):
            self.cache_control = None
            self._sink = sink

        def upload_from_string(self, data, content_type=None):
            self._sink.append((self.cache_control, content_type, data))

    class _RecordingBucket:
        def __init__(self):
            self.writes = []

        def blob(self, _name):
            return _RecordingBlob(self.writes)

    bucket = _RecordingBucket()
    saved_bucket = app_module._bucket
    app_module._bucket = bucket
    try:
        asyncio.run(app_module._update_task("contract-task", status="queued"))
        asyncio.run(app_module._update_task("contract-task"))
    finally:
        app_module._bucket = saved_bucket
    check(
        "task record writes are uncacheable (submit and heartbeat)",
        len(bucket.writes) == 2
        and all(cc == "no-store" and ct == "application/json" for cc, ct, _ in bucket.writes),
        f"{[(cc, ct) for cc, ct, _ in bucket.writes]}",
    )

    print(f"\n{PASSED} contract assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
