#!/usr/bin/env python3
"""
Vendor the ICT-FaceKit expression model into avatar-sources/ict-facekit/.

ICT-FaceKit (USC Institute for Creative Technologies, MIT license) ships a
26,719-vertex face model with 53 ARKit-named expression shapes, one full OBJ
per shape (~143 MB for the set). Nothing downstream needs the full OBJs: the
expression transfer (scripts/build-ict-expression-targets.py) reads the neutral
mesh once and each expression as a per-vertex delta from it. So this script
fetches one pinned commit and writes a compact, lossless-to-1e-5-cm derivative:

  avatar-sources/ict-facekit/
    LICENSE                      upstream MIT license, verbatim
    CREDITS.md                   upstream credits, verbatim
    vertex_indices.json          upstream landmark / region indices, verbatim
    neutral.obj.gz               generic_neutral_mesh.obj positions + faces
    expressions/<name>.delta.gz  "<vertex> dx dy dz" lines, ICT units (cm)

Re-run it only to move to a newer upstream commit; the output is committed.

    python3 scripts/vendor-ict-facekit.py [--commit <sha>]

Standard library only, so it runs before the worker's Python deps exist.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "avatar-sources" / "ict-facekit"
REPO = "USC-ICT/ICT-FaceKit"
PINNED_COMMIT = "da5f95a607f5e6b37755b38d3385d7f2853732e5"

# Deltas smaller than this (in ICT centimetres, i.e. 0.1 micron) are scan noise
# and are dropped so the sparse files stay small. Far below one texel of motion.
DELTA_EPSILON_CM = 1e-5


def _raw_url(commit: str, path: str) -> str:
    return f"https://raw.githubusercontent.com/{REPO}/{commit}/{path}"


def _fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "three.ws-vendor-ict-facekit"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def _positions(obj_text: str) -> list[tuple[float, float, float]]:
    out = []
    for line in obj_text.splitlines():
        if line.startswith("v "):
            _, x, y, z = line.split()[:4]
            out.append((float(x), float(y), float(z)))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--commit", default=PINNED_COMMIT, help="upstream commit to vendor")
    args = ap.parse_args()
    commit = args.commit

    print(f"vendoring {REPO}@{commit}")
    indices = json.loads(_fetch(_raw_url(commit, "FaceXModel/vertex_indices.json")))
    names = list(indices["expressions"])

    neutral_text = _fetch(_raw_url(commit, "FaceXModel/generic_neutral_mesh.obj")).decode("utf8")
    neutral = _positions(neutral_text)
    print(f"  neutral: {len(neutral)} vertices, {len(names)} expressions")

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "expressions").mkdir(exist_ok=True)
    for fname in ("LICENSE", "CREDITS.md"):
        (OUT / fname).write_bytes(_fetch(_raw_url(commit, fname)))
    (OUT / "vertex_indices.json").write_text(json.dumps(indices, indent=1) + "\n")

    # Neutral: keep positions and polygon vertex indices (UVs and normals are
    # unused by the transfer). Header names the source and license.
    lines = [
        f"# ICT-FaceKit generic_neutral_mesh.obj @ {commit}",
        "# Copyright (c) 2020 USC Institute for Creative Technologies. MIT license, see LICENSE.",
    ]
    lines += [f"v {x:.6f} {y:.6f} {z:.6f}" for x, y, z in neutral]
    for line in neutral_text.splitlines():
        if line.startswith("f "):
            lines.append("f " + " ".join(c.split("/")[0] for c in line.split()[1:]))
    with gzip.open(OUT / "neutral.obj.gz", "wt", compresslevel=9) as fh:
        fh.write("\n".join(lines) + "\n")

    def vendor_expression(name: str) -> tuple[str, int]:
        shape = _positions(_fetch(_raw_url(commit, f"FaceXModel/{name}.obj")).decode("utf8"))
        if len(shape) != len(neutral):
            raise RuntimeError(f"{name}: {len(shape)} vertices, neutral has {len(neutral)}")
        rows = [f"# ICT-FaceKit {name} - generic_neutral_mesh @ {commit}, cm, MIT license"]
        for i, (a, b) in enumerate(zip(shape, neutral)):
            d = (a[0] - b[0], a[1] - b[1], a[2] - b[2])
            if max(abs(d[0]), abs(d[1]), abs(d[2])) > DELTA_EPSILON_CM:
                rows.append(f"{i} {d[0]:.5f} {d[1]:.5f} {d[2]:.5f}")
        with gzip.open(OUT / "expressions" / f"{name}.delta.gz", "wt", compresslevel=9) as fh:
            fh.write("\n".join(rows) + "\n")
        return name, len(rows) - 1

    with ThreadPoolExecutor(max_workers=8) as pool:
        for name, count in pool.map(vendor_expression, names):
            print(f"  {name}: {count} moving vertices")

    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
