"""Serving contract, run at build time. No GPU, no GCS: the bucket client is
never constructed because the lifespan is not entered."""
import os

os.environ.setdefault("API_KEY", "build-gate")
os.environ.setdefault("GCS_BUCKET", "build-gate")

import asyncio

from fastapi import HTTPException

import main

failures = []


def check(name, cond):
    if not cond:
        failures.append(name)
        print("FAIL", name)


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


routes = {r.path for r in main.app.routes}
check("routes", {"/retopo", "/tasks/{task_id}", "/health"} <= routes)
check("health", run(main.health()) == {"ok": True, "service": "model-lato2"})

for bad in ("", "Bearer wrong"):
    try:
        run(main.get_task("x", bad))
        check("auth rejects " + repr(bad), False)
    except HTTPException as exc:
        check("auth rejects " + repr(bad), exc.status_code == 401)

try:
    run(main.get_task("missing", "Bearer build-gate"))
    check("unknown task 404", False)
except HTTPException as exc:
    check("unknown task 404", exc.status_code == 404)

req = main.RetopoRequest(mesh="https://example.com/a.glb", output_format=".GLB")
check("format normalised", req.output_format == "glb" and req.target_faces == 4000)
for kwargs in ({"target_faces": 50}, {"target_faces": 99999}, {"output_format": "fbx"}):
    try:
        main.RetopoRequest(mesh="https://example.com/a.glb", **kwargs)
        check("rejects " + repr(kwargs), False)
    except ValueError:
        pass

try:
    main._load_source("http://169.254.169.254/latest/meta-data")
    check("ssrf refused", False)
except main.InputError:
    pass

if failures:
    raise SystemExit(f"{len(failures)} contract failures")
print("lato2 app contract ok")
