"""Input-format tests for the segment service (main.py): which mesh formats the
worker accepts, how it refuses FBX, and how a failed task reports its cause.
No GCS, no network, no running server:

    python3 workers/segment/test_segment_input.py

Also runs as a Docker build gate (see Dockerfile). It pins the 2026-10-09 fix:
the worker used to list `.fbx` as accepted, but trimesh 4.x has no FBX reader
and this image carries no converter, so every FBX was queued and then died
inside the parser as an opaque `internal error (ref ...)`.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("GCS_BUCKET", "test-bucket")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import trimesh  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import segment_core as seg  # noqa: E402

PASS = 0
SUPPORTED_LABEL = "GLB, GLTF, OBJ, STL, PLY, OFF or DAE"


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASS
    if not condition:
        print(f"FAIL  {name}  {detail}")
        sys.exit(1)
    PASS += 1
    print(f"ok    {name}")


def with_fetched_bytes(data: bytes, fn, *args):
    """Run fn with the SSRF-hardened fetch replaced by a fixed payload."""
    real = main.fetch_remote_bytes
    main.fetch_remote_bytes = lambda *_a, **_k: data
    try:
        return fn(*args)
    finally:
        main.fetch_remote_bytes = real


# ── the advertised formats are the ones trimesh can read ─────────────────────────

_readable = set(trimesh.exchange.load.mesh_formats())
check(
    "every accepted suffix has a trimesh loader",
    all(s.lstrip(".") in _readable for s in main.SUPPORTED_INPUT_FORMATS),
    f"{sorted(main.SUPPORTED_INPUT_FORMATS)} vs {sorted(_readable)}",
)
check("fbx is not an accepted input suffix", ".fbx" not in main.SUPPORTED_INPUT_FORMATS)
check("trimesh in this image really cannot read fbx", "fbx" not in _readable)
check("the label names the accepted formats", main.SUPPORTED_INPUT_LABEL == SUPPORTED_LABEL)

# ── an .fbx URL is a 422 at the door ─────────────────────────────────────────────

client = TestClient(main.app)
_auth = {"authorization": f"Bearer {main.API_KEY}"}

_fbx_job = client.post("/segment", json={"mesh": "https://example.com/rig.FBX?sig=1"}, headers=_auth)
check(
    "an FBX mesh URL is a 422 that names the supported formats",
    _fbx_job.status_code == 422 and SUPPORTED_LABEL in _fbx_job.text,
    f"{_fbx_job.status_code} {_fbx_job.text[:300]}",
)
check(
    "the 422 points at the remesh convert path",
    "remesh" in _fbx_job.text and "convert" in _fbx_job.text,
    _fbx_job.text[:300],
)
check(
    "a bad method is still a 422 (the mesh validator did not swallow others)",
    client.post(
        "/segment", json={"mesh": "https://example.com/m.glb", "method": "nope"}, headers=_auth
    ).status_code == 422,
)

# ── an FBX is caught by its bytes, whatever the URL says ─────────────────────────

for label, data, url in (
    ("binary FBX behind an extensionless URL", main.FBX_BINARY_MAGIC + b"\x00" * 32, "https://example.com/dl?sig=1"),
    ("ASCII FBX behind a .bin URL", b"; FBX 7.4.0 project file\n", "https://example.com/model.bin"),
    ("ASCII FBX with a BOM and leading blank line", b"\xef\xbb\xbf\n; FBX 6.1.0\n", "https://example.com/m"),
    ("an .fbx URL whatever the bytes", b"glTF\x02\x00\x00\x00", "https://example.com/model.fbx#frag"),
):
    try:
        with_fetched_bytes(data, main._fetch_mesh, url)
        check(f"{label} is refused as an input error", False, "accepted")
    except seg.SegmentInputError as exc:
        check(f"{label} is refused as an input error", "FBX input is not supported" in str(exc), str(exc))

check(
    "a DAE URL keeps its loader",
    with_fetched_bytes(b"<?xml", main._fetch_mesh, "https://example.com/m.dae")[1] == ".dae",
)
check(
    "an extensionless GLB still loads as glb",
    with_fetched_bytes(b"glTF", main._fetch_mesh, "https://example.com/dl")[1] == ".glb",
)

# ── DAE, the format the old FBX claim sat beside, segments end to end ────────────

_a = trimesh.creation.box(extents=(1, 1, 1))
_b = trimesh.creation.box(extents=(1, 1, 1))
_b.apply_translation([5.0, 0, 0])
_dae = trimesh.exchange.dae.export_collada(trimesh.util.concatenate([_a, _b]))
_glb, _manifest = with_fetched_bytes(
    _dae, main._run_segmentation, "https://example.com/two.dae", "connected", 24, 4, 40.0, None
)
check(
    "a DAE segments end to end through pycollada",
    _glb[:4] == b"glTF" and _manifest["part_count"] == 2 and _manifest["source_faces"] == 24,
    f"parts={_manifest.get('part_count')} faces={_manifest.get('source_faces')}",
)

# ── a failed task says whose fault it was ────────────────────────────────────────


async def _run_task_on(data: bytes, url: str) -> dict:
    main._sem = asyncio.Semaphore(1)
    main._tasks["seg-in"] = {"task_id": "seg-in", "status": "queued", "method": "auto"}
    real = main.fetch_remote_bytes
    main.fetch_remote_bytes = lambda *_a, **_k: data
    try:
        await main._process("seg-in", url, "auto", 24, 64, 40.0, None)
    finally:
        main.fetch_remote_bytes = real
    return main._tasks.pop("seg-in")


_task = asyncio.run(_run_task_on(main.FBX_BINARY_MAGIC + b"\x00" * 32, "https://example.com/dl"))
check(
    "an FBX job fails with caller-facing copy, not an opaque ref",
    _task["status"] == "failed"
    and _task.get("error_kind") == "input"
    and "FBX input is not supported" in _task["error"]
    and SUPPORTED_LABEL in _task["error"],
    str(_task),
)

# safe_error logs the full traceback for operators; that expected trace is not
# a test failure, so keep it out of the build log.
logging.getLogger("worker_security").setLevel(logging.CRITICAL)
_task = asyncio.run(_run_task_on(b"definitely not a mesh", "https://example.com/broken.glb"))
check(
    "an unexpected parser failure stays opaque and is marked internal",
    _task["status"] == "failed"
    and _task.get("error_kind") == "internal"
    and _task["error"].startswith("internal error (ref "),
    str(_task),
)

print(f"\nOK  {PASS} checks passed")
