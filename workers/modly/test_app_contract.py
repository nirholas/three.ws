"""Smoke test for the served contract, run INSIDE the built image as a build gate:

    docker build -t modly workers/modly
    docker run --rm -e MODLY_CONTRACT_REQUIRE_BACKEND=1 modly python3 test_app_contract.py

It needs no GPU, no weights and no GCP credentials. The ASGI lifespan (which opens
the GCS client, stages weights and starts Modly) is deliberately not run.

Part A, the front (runs anywhere the host requirements are installed):

  1. The app module imports and the auth boundary rejects a wrong bearer.
  2. The unauthenticated probe surfaces (/ and /health) answer, and a dead
     backend says so on both /health and /infer so the caller fails over.
  3. Request validation: images XOR mesh_url, the six-view cap, unknown models,
     malformed post-process plans.
  4. The image decoder keeps alpha and refuses everything the SSRF guard should.
  5. Modly's child environment never carries the front's API key.

Part B, the backend (needs the image's /opt tree; enforced when
MODLY_CONTRACT_REQUIRE_BACKEND=1, which the Dockerfile sets):

  6. The pinned Modly starts on loopback with the pinned extensions, registers
     every enabled model, and reports exactly one problem per model: weights
     missing. Any extension error (a broken manifest, a venv Modly cannot find)
     fails the build instead of surfacing as a revision that never goes ready.
  7. Modly's repair, decimate and smooth ops run through the front's own client
     code, which proves pymeshlab and the Node + meshoptimizer runtime decimate
     needs are both present.
  8. Each extension venv imports its generator's model package (TripoSG with the
     compiled diso extension, hy3dgen's shape pipeline) and rembg.
"""

from __future__ import annotations

import asyncio
import base64
import io
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

os.environ.setdefault("API_KEY", "smoke-test-key")
os.environ.setdefault("GCS_BUCKET", "smoke-test-bucket")

KEY = os.environ["API_KEY"]
REQUIRE_BACKEND = os.environ.get("MODLY_CONTRACT_REQUIRE_BACKEND") == "1"

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


def _is_gpu_driver_absence(text: str) -> bool:
    if "cannot open shared object file" in text:
        return any(lib in text for lib in _GPU_DRIVER_LIBS)
    lowered = text.lower()
    return "nvidia driver" in lowered or "no cuda gpus" in lowered or "found no nvidia" in lowered


# ── Part A: the front ─────────────────────────────────────────────────────────

def front_checks(app_module) -> None:
    from fastapi.testclient import TestClient

    client = TestClient(app_module.app)
    good = {"Authorization": f"Bearer {KEY}"}
    bad = {"Authorization": "Bearer wrong-key"}

    res = client.get("/tasks/does-not-exist", headers=bad)
    check("GET /tasks rejects a wrong bearer", res.status_code == 401, f"got {res.status_code}")
    res = client.post("/infer", headers=bad, json={"images": [png_data_uri()]})
    check("POST /infer rejects a wrong bearer", res.status_code == 401, f"got {res.status_code}")
    res = client.get("/results/does-not-exist.glb", headers=bad)
    check("GET /results rejects a wrong bearer", res.status_code == 401, f"got {res.status_code}")

    res = client.get("/health")
    body = res.json()
    check("GET /health answers 200", res.status_code == 200, f"got {res.status_code}")
    check("health names the default model", body.get("model") == app_module.DEFAULT_MODEL, str(body)[:160])
    check("health lists the enabled models", body.get("models") == app_module.ENABLED_MODELS, str(body)[:160])
    check(
        "health lists the post-process steps",
        body.get("postprocess_steps") == ["repair", "decimate", "smooth", "uv_unwrap", "bake"],
        str(body.get("postprocess_steps")),
    )
    res = client.get("/")
    body = res.json()
    check("GET / answers 200 for the keep-warm ping", res.status_code == 200, f"got {res.status_code}")
    check("root names the service", body.get("service") == "model-modly", str(body)[:120])
    check("root lists the working endpoints", "POST /infer" in body.get("endpoints", []), str(body)[:160])
    check("root credits Modly", "lightningpixel/modly" in str(body.get("attribution")), str(body)[:200])

    # A dead backend must SAY it is dead, on both surfaces (the 2026-09-02 lesson
    # recorded in workers/model-trellis2/test_app_contract.py).
    app_module._load_error = "internal error (ref deadbeefcafe)"
    try:
        res = client.get("/health")
        body = res.json()
        check("a dead backend makes /health answer 503", res.status_code == 503, f"got {res.status_code}")
        check("a dead backend makes /health report ok:false", body.get("ok") is False, str(body)[:160])
        check("health surfaces the load error", "deadbeefcafe" in str(body.get("load_error")), str(body)[:160])
        res = client.post("/infer", headers=good, json={"images": [png_data_uri()]})
        check("a dead backend makes /infer refuse with 503", res.status_code == 503, f"got {res.status_code}")
    finally:
        app_module._load_error = None
    res = client.get("/health")
    check("a live backend still answers /health 200", res.status_code == 200, f"got {res.status_code}")
    check("a live backend reports ok:true", res.json().get("ok") is True, str(res.json())[:160])

    for label, payload in [
        ("an empty images array", {"images": []}),
        ("more than six views", {"images": [png_data_uri()] * 7}),
        ("neither images nor mesh_url", {}),
        ("both images and mesh_url", {"images": [png_data_uri()], "mesh_url": "https://example.com/a.glb"}),
        ("mesh_url without a postprocess step", {"mesh_url": "https://example.com/a.glb"}),
        ("a model this deployment does not serve", {"images": [png_data_uri()], "model": "sf3d/generate"}),
        ("an unknown postprocess step", {"images": [png_data_uri()], "postprocess": {"explode": True}}),
        ("an out-of-range decimate target", {"images": [png_data_uri()], "postprocess": {"decimate": 10}}),
        ("an unsupported bake size", {"images": [png_data_uri()], "postprocess": {"bake": {"texture_size": 1000}}}),
        ("an invalid generation param", {"images": [png_data_uri()], "params": {"guidance_scale": "loud"}}),
        ("an out-of-range seed", {"images": [png_data_uri()], "seed": -2}),
    ]:
        res = client.post("/infer", headers=good, json=payload)
        check(f"POST /infer rejects {label}", res.status_code == 422, f"got {res.status_code}: {res.text[:160]}")

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
            check(f"image decoder refuses {label}", False, "no exception raised")
        except app_module.ImageSourceError:
            check(f"image decoder refuses {label}", True)
        except Exception as exc:  # noqa: BLE001 - must be the caller-facing class
            check(f"image decoder refuses {label}", False, f"raised {type(exc).__name__}: {exc}")

    for label, src in [
        ("a loopback mesh url", "https://127.0.0.1/a.glb"),
        ("a file path mesh", "/opt/modly/api/main.py"),
        ("a non-mesh payload", "data:model/gltf-binary;base64," + base64.b64encode(b"definitely not a mesh").decode()),
    ]:
        try:
            app_module._load_caller_mesh(src)
            check(f"mesh loader refuses {label}", False, "no exception raised")
        except app_module.ImageSourceError:
            check(f"mesh loader refuses {label}", True)
        except Exception as exc:  # noqa: BLE001 - must be the caller-facing class
            check(f"mesh loader refuses {label}", False, f"raised {type(exc).__name__}: {exc}")

    import trimesh

    glb = trimesh.creation.icosphere(subdivisions=2).export(file_type="glb")
    mesh = app_module._load_caller_mesh("data:model/gltf-binary;base64," + base64.b64encode(glb).decode())
    check("mesh loader reads an inline GLB", len(mesh.faces) == 320, f"{len(mesh.faces)} faces")
    check("mesh suffix follows the url path", app_module._mesh_suffix("https://cdn.example/a/b.OBJ?x=1") == ".obj")
    check("mesh suffix defaults to glb", app_module._mesh_suffix("https://cdn.example/a/model") == ".glb")

    local_job_check(app_module)

    env = app_module._modly_env()
    check("Modly's environment never carries the front's API key", "API_KEY" not in env)
    check("Modly is pinned offline", env.get("HF_HUB_OFFLINE") == "1" and env.get("TRANSFORMERS_OFFLINE") == "1")
    check("Modly talks to itself on loopback", env.get("MODLY_API_URL", "").startswith("http://127.0.0.1:"))


def local_job_check(app_module) -> None:
    """A mesh_url job whose steps are all local (unwrap + bake) needs no Modly, so
    the whole job runner, local storage and the result route run for real here."""
    import numpy as np
    import trimesh
    from fastapi.testclient import TestClient

    import postprocess

    sphere = trimesh.creation.icosphere(subdivisions=3)
    colours = np.where(
        (sphere.vertices[:, 2] > 0)[:, None], [230, 40, 40, 255], [40, 40, 230, 255]
    ).astype(np.uint8)
    sphere.visual = trimesh.visual.ColorVisuals(mesh=sphere, vertex_colors=colours)
    mesh_uri = "data:model/gltf-binary;base64," + base64.b64encode(sphere.export(file_type="glb")).decode()

    out = Path(tempfile.mkdtemp(prefix="modly-contract-out-"))
    saved = (app_module.GCS_BUCKET, app_module.OUTPUT_DIR, app_module._local_storage, app_module.WORKSPACE_DIR)
    app_module.GCS_BUCKET = ""
    app_module.OUTPUT_DIR = str(out)
    app_module._local_storage = None
    app_module.WORKSPACE_DIR = out / "workspace"
    try:
        async def run() -> dict:
            app_module._ready = asyncio.Event()
            app_module._ready.set()
            app_module._sem = asyncio.Semaphore(1)
            task_id = str(uuid.uuid4())
            plan = [("uv_unwrap", {}), ("bake", {"texture_size": 256})]
            await app_module._update_task(task_id, status="queued", model=None)
            await app_module._run_inference(task_id, app_module.DEFAULT_MODEL, {}, plan, None, mesh_uri)
            return await app_module._resolve_task(task_id)

        task = asyncio.run(run())
        check("local post-process job finishes", task.get("status") == "done", str(task)[:300])
        steps = [entry["step"] for entry in task.get("postprocess_applied", [])]
        check("job reports the steps it applied", steps == ["uv_unwrap", "bake"], str(steps))
        bake_entry = task["postprocess_applied"][-1]
        check("bake transferred the source colour", bake_entry.get("baked") is True, str(bake_entry))
        client = TestClient(app_module.app)
        res = client.get(f"/results/{task['task_id']}.glb", headers={"Authorization": f"Bearer {KEY}"})
        check("result route serves the GLB", res.status_code == 200 and res.content[:4] == b"glTF", f"got {res.status_code}")
        from gltf_meshopt import decode_if_meshopt

        data, suffix = decode_if_meshopt(res.content, ".glb")
        result = postprocess.load_mesh(data, suffix)
        check("served GLB carries the baked texture", postprocess.has_colour(result) == "texture")
        check("job workspace is cleaned up", not (app_module.WORKSPACE_DIR / task["task_id"]).exists())
    finally:
        (app_module.GCS_BUCKET, app_module.OUTPUT_DIR, app_module._local_storage, app_module.WORKSPACE_DIR) = saved
        app_module._ready = None
        app_module._sem = None
        shutil.rmtree(out, ignore_errors=True)


# ── Part B: the backend ───────────────────────────────────────────────────────

def _backend_present(app_module) -> bool:
    return (app_module.MODLY_API_DIR / "main.py").is_file() and app_module.EXTENSIONS_DIR.is_dir()


def modly_checks(app_module) -> None:
    import trimesh

    import postprocess

    root = Path(tempfile.mkdtemp(prefix="modly-contract-"))
    app_module.MODELS_DIR = root / "models"
    app_module.WORKSPACE_DIR = root / "workspace"
    try:
        app_module._start_modly()
        app_module._wait_modly_http(180)
        check("pinned Modly starts and answers on loopback", True)

        problems = app_module._modly_readiness()
        expected = [f"{model}: weights missing from MODELS_DIR" for model in app_module.ENABLED_MODELS]
        check(
            "Modly registers every enabled model with only its weights missing",
            problems == expected,
            f"got {problems}",
        )

        job_dir = app_module.WORKSPACE_DIR / "contract"
        job_dir.mkdir(parents=True)
        source = job_dir / "input.glb"
        source.write_bytes(trimesh.creation.icosphere(subdivisions=4).export(file_type="glb"))

        async def run_ops():
            import httpx

            async with httpx.AsyncClient(base_url=app_module.MODLY_URL, timeout=180.0) as client:
                repaired, _ = await app_module._modly_op(client, "repair", source, {"fill_holes": True})
                decimated, details = await app_module._modly_op(client, "decimate", repaired, {"target_faces": 1000})
                smoothed, _ = await app_module._modly_op(
                    client, "smooth", decimated, {"iterations": 3, "lambda_": 0.5, "mode": "taubin"}
                )
                return repaired, decimated, details, smoothed

        repaired, decimated, details, smoothed = asyncio.run(run_ops())
        check("repair op writes a mesh in the workspace", repaired.is_file() and job_dir in repaired.parents)
        faces = len(postprocess.load_mesh(decimated.read_bytes(), decimated.suffix).faces)
        check("decimate op runs on Node + meshoptimizer", 0 < faces <= 1300, f"{faces} faces, details {details}")
        check("smooth op writes a mesh in the workspace", smoothed.is_file(), str(smoothed))
    finally:
        app_module._stop_modly()
        shutil.rmtree(root, ignore_errors=True)


VENV_IMPORTS = {
    "triposg/generate": "import diso, rembg; from triposg.pipelines.pipeline_triposg import TripoSGPipeline",
    "hunyuan3d-mini-turbo/generate": "import rembg; from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline",
}


def venv_checks(app_module) -> None:
    for model in app_module.ENABLED_MODELS:
        ext = model.split("/", 1)[0]
        python = app_module.EXTENSIONS_DIR / ext / "venv" / "bin" / "python"
        check(f"{ext} venv exists", python.is_file(), str(python))
        statement = VENV_IMPORTS[model]
        proc = subprocess.run([str(python), "-c", statement], capture_output=True, text=True, timeout=600)
        if proc.returncode == 0:
            check(f"{ext} venv imports its model package", True)
        elif _is_gpu_driver_absence(proc.stderr):
            last = proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else ""
            print(f"skip  {ext} venv import (no GPU on this host): {last}")
        else:
            check(f"{ext} venv imports its model package", False, proc.stderr.strip()[-600:])


def main() -> int:
    import main as app_module

    check("app module imports", True)
    front_checks(app_module)

    if _backend_present(app_module):
        modly_checks(app_module)
        venv_checks(app_module)
    elif REQUIRE_BACKEND:
        check("Modly backend present", False, f"no Modly at {app_module.MODLY_API_DIR} or {app_module.EXTENSIONS_DIR}")
    else:
        print(f"skip  backend checks (no Modly checkout at {app_module.MODLY_API_DIR}; run inside the image)")

    print(f"\n{PASSED} contract assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
