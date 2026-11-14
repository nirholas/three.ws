"""Regression test for the quad-remesh time budget.

Production bug (remesh-service, 2026-11-14): "quad remesh failed: quad remesh
ran out of its 600s budget; last solver said: solver ('-mcf', '-sharp') timed
out". _quad_remesh hands the first solver the ENTIRE remaining budget as its
subprocess timeout, so when the minimum-cost-flow solver hangs on a dense mesh
it burns all 600s and the faster fallback solvers in QUADRIFLOW_ATTEMPTS never
run. The ladder exists precisely so a stuck first solver is not fatal.

The solver here is a real executable (a shell script) that hangs when given
`-mcf` and writes a real quad OBJ otherwise, so the real subprocess, timeout
and fallback code runs. No GPU, no GCS: `python3 test_quad_budget.py`.
"""

from __future__ import annotations

import os
import stat
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("GCS_BUCKET", "test-bucket")

import trimesh

import main as remesh

SOLVER = """#!/bin/sh
out=""
hang=0
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    -mcf) hang=1 ;;
  esac
  shift
done
if [ "$hang" = 1 ]; then exec sleep 60; fi
printf 'v 0 0 0\\nv 1 0 0\\nv 1 1 0\\nv 0 1 0\\nf 1 2 3 4\\n' > "$out"
"""


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        binary = Path(tmp) / "fake-quadriflow"
        binary.write_text(SOLVER)
        binary.chmod(binary.stat().st_mode | stat.S_IEXEC)
        remesh.QUADRIFLOW_BIN = str(binary)
        remesh.QUADRIFLOW_BUDGET_S = 8.0

        started = time.monotonic()
        try:
            verts, polys, quad_ratio = remesh._quad_remesh(trimesh.creation.icosphere(subdivisions=2), 1000)
        except RuntimeError as exc:
            print(f"FAIL  a hung first solver must not starve the fallbacks: {exc}")
            return 1
        elapsed = time.monotonic() - started
        if not (len(polys) == 1 and quad_ratio == 1.0):
            print(f"FAIL  fallback solver output not returned: {polys} {quad_ratio}")
            return 1
        if elapsed > remesh.QUADRIFLOW_BUDGET_S:
            print(f"FAIL  exceeded the shared budget: {elapsed:.1f}s")
            return 1
        print(f"ok    a hung -mcf solver is cut off and the fallback solver succeeds ({elapsed:.1f}s)")

        remesh.QUADRIFLOW_BUDGET_S = 3.0
        binary.write_text(SOLVER.replace('if [ "$hang" = 1 ]', 'if true'))
        started = time.monotonic()
        try:
            remesh._quad_remesh(trimesh.creation.icosphere(subdivisions=2), 1000)
        except RuntimeError as exc:
            took = time.monotonic() - started
            if "quad remesh failed" not in str(exc) or took > 3.5:
                print(f"FAIL  all-solvers-hang case: {exc} after {took:.1f}s")
                return 1
            print(f"ok    when every solver hangs it fails inside the budget with a clear error ({took:.1f}s)")
            return 0
        print("FAIL  expected a RuntimeError when every solver hangs")
        return 1


if __name__ == "__main__":
    sys.exit(main())
