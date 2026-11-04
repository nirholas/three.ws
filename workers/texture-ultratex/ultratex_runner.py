"""Runs the upstream UltraTex inference for one mesh and returns the textured GLB.

UltraTex ships batch, dataset-driven scripts rather than a mesh-in/GLB-out API,
so the operator wires the exact invocation through ULTRATEX_INFER_CMD, a
shell-free argv template with these placeholders: {mesh} (local GLB path),
{prompt}, {negative_prompt}, {num_views}, {texture_size}, {out_dir}. The command
must write {out_dir}/textured.glb. The image pins Python 3.12, PyTorch 2.5.1
and Triton 3.1.0 because the upstream kernels require them.
"""

from __future__ import annotations

import os
import shlex
import subprocess
import tempfile
from pathlib import Path

OUTPUT_NAME = "textured.glb"


class RunnerUnavailable(RuntimeError):
    """The UltraTex runtime is not configured in this image."""


def _argv(template: str, values: dict) -> list[str]:
    return [p.format(**values) for p in shlex.split(template)]


def run_ultratex(mesh_bytes: bytes, prompt: str, negative_prompt: str, num_views: int,
                 texture_size: int, timeout_s: int) -> bytes:
    template = os.environ.get("ULTRATEX_INFER_CMD", "").strip()
    if not template:
        raise RunnerUnavailable("ULTRATEX_INFER_CMD is not set; the UltraTex runtime is not installed in this image")
    with tempfile.TemporaryDirectory(prefix="ultratex-") as tmp:
        work = Path(tmp)
        mesh_path = work / "input.glb"
        mesh_path.write_bytes(mesh_bytes)
        out_dir = work / "out"
        out_dir.mkdir()
        argv = _argv(template, {
            "mesh": str(mesh_path), "prompt": prompt, "negative_prompt": negative_prompt,
            "num_views": num_views, "texture_size": texture_size, "out_dir": str(out_dir),
        })
        proc = subprocess.run(argv, capture_output=True, timeout=timeout_s, check=False)
        if proc.returncode != 0:
            tail = proc.stderr.decode("utf-8", "replace")[-400:]
            raise RuntimeError(f"UltraTex exited {proc.returncode}: {tail}")
        out = out_dir / OUTPUT_NAME
        if not out.is_file():
            raise RuntimeError(f"UltraTex finished without writing {OUTPUT_NAME}")
        return out.read_bytes()
