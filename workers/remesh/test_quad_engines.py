"""Quad engine selection: AutoRemesher first, QuadriFlow as the fallback.

Covers the contract of _quad_remesh(mesh, target, engine):
  - `auto` returns AutoRemesher's result when it is within bounds;
  - `auto` falls back to QuadriFlow when AutoRemesher fails, is missing, or
    returns too few faces / too few quads;
  - `autoremesher` never silently swaps engines;
  - AutoRemesher's density is calibrated toward the requested face count;
  - the real autoremesher-cli (when present, as in the worker image) produces a
    quad-dominant remesh of an open and a closed mesh.

The fake engines are real executables (Python scripts), so the real subprocess,
OBJ parsing, and fallback code runs. No GPU, no GCS: `python3 test_quad_engines.py`.
"""

from __future__ import annotations

import os
import stat
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("GCS_BUCKET", "test-bucket")

import numpy as np
import trimesh

import main as remesh

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'ok  ' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        FAILURES.append(name)


# Writes a grid of `quads` quad faces (plus `tris` triangles) to the -o path.
# `quads` is an expression of t, the -t target triangle count passed in.
FAKE_ENGINE = """#!{python}
import sys
args = sys.argv[1:]
out = args[args.index("-o") + 1]
t = int(args[args.index("-t") + 1]) if "-t" in args else int(args[args.index("-f") + 1])
quads = int({quads})
tris = int({tris})
if {fail}:
    sys.stderr.write("solver exploded\\n")
    sys.exit(3)
lines = []
for i in range(quads + tris + 1):
    lines.append(f"v {{i}} 0 0")
    lines.append(f"v {{i}} 1 0")
for i in range(quads):
    a = 2 * i + 1
    lines.append(f"f {{a}} {{a + 1}} {{a + 3}} {{a + 2}}")
for i in range(quads, quads + tris):
    a = 2 * i + 1
    lines.append(f"f {{a}} {{a + 1}} {{a + 3}}")
open(out, "w").write("\\n".join(lines) + "\\n")
"""


def fake_engine(directory: Path, name: str, quads: str, tris: str = "0", fail: str = "False") -> str:
    path = directory / name
    path.write_text(FAKE_ENGINE.format(python=sys.executable, quads=quads, tris=tris, fail=fail))
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return str(path)


def main() -> int:
    sphere = trimesh.creation.icosphere(subdivisions=3)

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        # QuadriFlow stand-in: exactly the requested face count, all quads.
        remesh.QUADRIFLOW_BIN = fake_engine(tmp, "quadriflow", quads="t")
        remesh.QUADRIFLOW_BUDGET_S = 30.0

        try:
            remesh._quad_remesh(sphere, 1000, "voxel")
            check("an unknown engine is rejected", False, "no error raised")
        except ValueError:
            check("an unknown engine is rejected", True)

        # AutoRemesher stand-in on target: t triangles -> t/2 quads.
        remesh.AUTOREMESHER_BIN = fake_engine(tmp, "ar-good", quads="t / 2")
        _, polys, ratio, engine = remesh._quad_remesh(sphere, 2000, "auto")
        check("auto uses AutoRemesher when it is within bounds", engine == "autoremesher", engine)
        check("auto keeps AutoRemesher's face count", len(polys) == 2000, str(len(polys)))
        check("auto reports AutoRemesher's quad ratio", ratio == 1.0, str(ratio))

        # Calibration: the first run lands at a quarter of the target, so the
        # next run must rescale -t and come back on target.
        calls = tmp / "calls.log"
        calibrating = fake_engine(tmp, "ar-calibrate", quads="t / 8")
        Path(calibrating).write_text(
            Path(calibrating).read_text().replace(
                "quads = int(t / 8)",
                f"open({str(calls)!r}, 'a').write(str(t) + '\\n')\nquads = int(t / 8)",
            )
        )
        remesh.AUTOREMESHER_BIN = calibrating
        _, polys, _, engine = remesh._quad_remesh(sphere, 2000, "autoremesher")
        targets = [int(x) for x in calls.read_text().split()]
        check("calibration reruns with a rescaled target", targets == [4000, 16000], str(targets))
        check("calibration lands on the requested face count", len(polys) == 2000, str(len(polys)))

        # A crash under `auto` falls back; under `autoremesher` it is an error.
        remesh.AUTOREMESHER_BIN = fake_engine(tmp, "ar-crash", quads="t / 2", fail="True")
        _, polys, _, engine = remesh._quad_remesh(sphere, 1500, "auto")
        check("auto falls back to QuadriFlow when AutoRemesher fails", engine == "quadriflow", engine)
        check("the fallback returns QuadriFlow's result", len(polys) == 1500, str(len(polys)))
        try:
            remesh._quad_remesh(sphere, 1500, "autoremesher")
            check("an explicit autoremesher failure is not swapped for QuadriFlow", False, "no error")
        except RuntimeError as exc:
            check(
                "an explicit autoremesher failure is not swapped for QuadriFlow",
                "solver exploded" in str(exc), str(exc),
            )

        # A missing binary under `auto` falls back.
        remesh.AUTOREMESHER_BIN = str(tmp / "does-not-exist")
        _, _, _, engine = remesh._quad_remesh(sphere, 1000, "auto")
        check("auto falls back when the AutoRemesher binary is missing", engine == "quadriflow", engine)

        # Out-of-bounds results under `auto` fall back: too triangle-heavy...
        remesh.AUTOREMESHER_BIN = fake_engine(tmp, "ar-tris", quads="t / 4", tris="t / 4")
        _, _, _, engine = remesh._quad_remesh(sphere, 1000, "auto")
        check("auto rejects a result below the quad-ratio floor", engine == "quadriflow", engine)
        # ... or too far under the face count after every calibration run.
        remesh.AUTOREMESHER_BIN = fake_engine(tmp, "ar-tiny", quads="10")
        _, _, _, engine = remesh._quad_remesh(sphere, 1000, "auto")
        check("auto rejects a result far off the face count", engine == "quadriflow", engine)

    # The real engine, built from autoremesher_cli/ (always present in the image).
    real = os.environ.get("AUTOREMESHER_BIN", "autoremesher-cli")
    if remesh._binary_path(real) is None:
        print(f"skip  real autoremesher-cli: {real} not found (it is built into the worker image)")
    else:
        remesh.AUTOREMESHER_BIN = real
        verts, polys, ratio, engine = remesh._quad_remesh(sphere, 1000, "autoremesher")
        check("real AutoRemesher remeshes a closed sphere", engine == "autoremesher" and len(polys) > 0)
        check("real AutoRemesher output is quad-dominant", ratio >= 0.9, f"quad_ratio={ratio}")
        check(
            "real AutoRemesher lands near the requested face count",
            abs(len(polys) - 1000) / 1000 <= remesh.AUTOREMESHER_ACCEPT_TOLERANCE,
            str(len(polys)),
        )
        check("real AutoRemesher indices stay in range", max(max(p) for p in polys) < len(verts))

        open_sphere = trimesh.creation.icosphere(subdivisions=3)
        keep = np.asarray(open_sphere.vertices)[open_sphere.faces].mean(axis=1)[:, 1] < 0.85
        open_sphere.update_faces(keep)
        open_sphere.remove_unreferenced_vertices()
        _, opolys, oratio, _ = remesh._quad_remesh(open_sphere, 1000, "autoremesher")
        check("real AutoRemesher survives an open boundary", len(opolys) > 0 and oratio >= 0.85,
              f"{len(opolys)} polys, quad_ratio={oratio}")

    if FAILURES:
        print(f"\n{len(FAILURES)} failed")
        return 1
    print("\nall quad engine checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
