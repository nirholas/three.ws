"""
Non-humanoid rigging pipeline: chains two VAST-AI-Research CLIs (both MIT,
LICENSE files read 2026-10-09) over temp files, exactly per the command
contract in their own READMEs. Neither project exposes a Python import API,
so this worker calls them as subprocesses, the same way their own docs do.

  1. UniRig's generate_skeleton.sh predicts a joint hierarchy for an
     arbitrary mesh (quadruped, creature, prop) and writes it as .fbx.
  2. UniRig's merge.sh grafts that skeleton onto the ORIGINAL .glb (adds
     joint nodes; no skinning weights yet).
  3. SkinTokens' demo.py --use_skeleton --use_transfer takes the
     skeleton-merged .glb and predicts ONLY the skinning weights, preserving
     the original texture and scale, and writes a fully rigged .glb.

Kept dependency-light (stdlib subprocess only) so the chaining/error-handling
logic is unit-tested without a GPU or either upstream checkout; see
test_pipeline.py, which substitutes tiny real scripts at the exact paths the
command builders expect.
"""

from __future__ import annotations

import logging
import re
import subprocess
from pathlib import Path

from skeleton_roots import SkeletonNormalizeError, single_root_skeleton

log = logging.getLogger("rig-nonhuman.pipeline")

# Each stage is a multi-second-to-minute autoregressive model forward pass on
# one mesh; generous but finite so a wedged subprocess cannot hang a task
# forever. The caller still enforces an overall job timeout on top of this.
SUBPROCESS_TIMEOUT_S = 600.0


def build_skeleton_cmd(mesh_glb: Path, skeleton_fbx: Path) -> list[str]:
    """UniRig: predict a skeleton for `mesh_glb`, write it to `skeleton_fbx`."""
    return [
        "bash", "launch/inference/generate_skeleton.sh",
        "--input", str(mesh_glb),
        "--output", str(skeleton_fbx),
    ]


def build_merge_cmd(skeleton_fbx: Path, mesh_glb: Path, merged_glb: Path) -> list[str]:
    """UniRig: graft `skeleton_fbx` onto `mesh_glb`, write `merged_glb`."""
    return [
        "bash", "launch/inference/merge.sh",
        "--source", str(skeleton_fbx),
        "--target", str(mesh_glb),
        "--output", str(merged_glb),
    ]


def build_skin_cmd(merged_glb: Path, rigged_glb: Path) -> list[str]:
    """SkinTokens: predict skin weights for the already-skeletoned
    `merged_glb`, preserving texture/scale, write the final `rigged_glb`."""
    return [
        "python3", "demo.py",
        "--input", str(merged_glb),
        "--output", str(rigged_glb),
        "--use_skeleton",
        "--use_transfer",
    ]


class PipelineStepError(RuntimeError):
    """One of the three subprocess steps failed: non-zero exit, a timeout, or
    a reported success that wrote no output file. The message carries the
    step name plus the tails of the step's stdout and stderr: UniRig reports
    its own failures with print() on stdout (merge.py's "failed to load ..."),
    and merge.sh backgrounds the python process and always exits 0, so a
    stderr-only tail threw the actual cause away. main.py returns the message
    to the caller as the task error, so absolute paths in the tails are
    reduced to their final component; the full, unredacted capture goes to
    the server log."""


TAIL_LINES = 20


_ABS_PATH = re.compile(r"(?<![\w.])/(?:[\w.\-]+/)+([\w.\-]+)")


def _tail(text: str | None) -> str:
    lines = (text or "").strip().splitlines()[-TAIL_LINES:]
    return _ABS_PATH.sub(r"\1", "\n".join(lines))


def _describe(result: subprocess.CompletedProcess) -> str:
    parts = []
    out, err = _tail(result.stdout), _tail(result.stderr)
    if out:
        parts.append(f"stdout tail:\n{out}")
    if err:
        parts.append(f"stderr tail:\n{err}")
    return "\n".join(parts) if parts else "(no output captured)"


def _run(cmd: list[str], cwd: Path, step: str) -> subprocess.CompletedProcess:
    log.info("[%s] %s (cwd=%s)", step, " ".join(cmd), cwd)
    try:
        return subprocess.run(
            cmd, cwd=str(cwd), capture_output=True, text=True,
            timeout=SUBPROCESS_TIMEOUT_S, check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise PipelineStepError(
            f"{step} timed out after {SUBPROCESS_TIMEOUT_S:.0f}s"
        ) from exc


def _run_step(cmd: list[str], cwd: Path, step: str, output: Path) -> None:
    result = _run(cmd, cwd, step)
    if result.returncode != 0:
        log.error("[%s] exit %s\nstdout:\n%s\nstderr:\n%s", step, result.returncode, result.stdout, result.stderr)
        raise PipelineStepError(f"{step} failed (exit {result.returncode}): {_describe(result)}")
    if not output.exists():
        log.error("[%s] no output %s\nstdout:\n%s\nstderr:\n%s", step, output, result.stdout, result.stderr)
        raise PipelineStepError(
            f"{step} reported success but wrote no output file: {_describe(result)}"
        )


def run_pipeline(mesh_glb: Path, workdir: Path, unirig_dir: Path, skintokens_dir: Path) -> Path:
    """Run the full skeleton -> merge -> skin chain over `mesh_glb`.

    Returns the path to the final rigged .glb, written inside `workdir`.
    `unirig_dir` and `skintokens_dir` are the two upstream checkouts' root
    directories (their relative script paths are run with that cwd)."""
    skeleton_fbx = workdir / "skeleton.fbx"
    merged_glb = workdir / "merged.glb"
    rigged_glb = workdir / "rigged.glb"

    _run_step(
        build_skeleton_cmd(mesh_glb, skeleton_fbx), unirig_dir,
        "unirig-skeleton", skeleton_fbx,
    )
    _run_step(
        build_merge_cmd(skeleton_fbx, mesh_glb, merged_glb), unirig_dir,
        "unirig-merge", merged_glb,
    )
    # UniRig can emit more than one root joint; SkinTokens accepts exactly
    # one ("multiple roots found"). See skeleton_roots.py.
    try:
        reparented = single_root_skeleton(merged_glb)
    except SkeletonNormalizeError as exc:
        raise PipelineStepError(f"unirig-merge wrote an unusable file: {exc}") from exc
    if reparented:
        log.info("[unirig-merge] re-parented %d extra root joint(s) under the main skeleton", reparented)
    _run_step(
        build_skin_cmd(merged_glb, rigged_glb), skintokens_dir,
        "skintokens-skin", rigged_glb,
    )
    return rigged_glb
