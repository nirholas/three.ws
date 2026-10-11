"""Unit tests for pipeline.py: command construction against the real UniRig
and SkinTokens CLI contracts, and the subprocess-chaining/error-handling
logic. No GPU and no upstream checkout: each test that exercises run_pipeline
substitutes a tiny real script at the exact relative path the command
builders invoke, so the chaining code actually executes a subprocess (just
not the multi-gigabyte model behind it).

No GPU, no torch, no GCP: `python3 test_pipeline.py`.
"""

from __future__ import annotations

import shutil
import stat
import sys
import tempfile
from pathlib import Path

from pipeline import (
    PipelineStepError,
    build_merge_cmd,
    build_skeleton_cmd,
    build_skin_cmd,
    run_pipeline,
)

_FAILED = False


def _check(cond: bool, label: str) -> None:
    global _FAILED
    status = "ok" if cond else "FAIL"
    print(f"  [{status}] {label}")
    if not cond:
        _FAILED = True


def test_skeleton_cmd_matches_unirig_cli_contract():
    tmp = Path("/tmp/x")
    cmd = build_skeleton_cmd(tmp / "in.glb", tmp / "out.fbx")
    _check(cmd == [
        "bash", "launch/inference/generate_skeleton.sh",
        "--input", str(tmp / "in.glb"),
        "--output", str(tmp / "out.fbx"),
    ], "skeleton cmd matches UniRig's generate_skeleton.sh contract")


def test_merge_cmd_matches_unirig_cli_contract():
    tmp = Path("/tmp/x")
    cmd = build_merge_cmd(tmp / "skel.fbx", tmp / "in.glb", tmp / "merged.glb")
    _check(cmd == [
        "bash", "launch/inference/merge.sh",
        "--source", str(tmp / "skel.fbx"),
        "--target", str(tmp / "in.glb"),
        "--output", str(tmp / "merged.glb"),
    ], "merge cmd matches UniRig's merge.sh contract")


def test_skin_cmd_matches_skintokens_cli_contract():
    tmp = Path("/tmp/x")
    cmd = build_skin_cmd(tmp / "merged.glb", tmp / "rigged.glb")
    _check(cmd == [
        "python3", "demo.py",
        "--input", str(tmp / "merged.glb"),
        "--output", str(tmp / "rigged.glb"),
        "--use_skeleton",
        "--use_transfer",
    ], "skin cmd matches SkinTokens' demo.py --use_skeleton --use_transfer contract")


def _fake_bash_script(path: Path, writes: Path | None = None, exit_code: int = 0) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = "#!/bin/sh\n"
    if writes is not None:
        body += f"echo fake > '{writes}'\n"
    body += f"exit {exit_code}\n"
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


def _fake_py_script(path: Path, writes: Path | None = None, exit_code: int = 0) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["import sys"]
    if writes is not None:
        lines.append(f"open(r'{writes}', 'w').write('fake')")
    lines.append(f"sys.exit({exit_code})")
    path.write_text("\n".join(lines) + "\n")


def _stub_checkouts(root: Path) -> tuple[Path, Path]:
    unirig_dir = root / "unirig"
    skintokens_dir = root / "skintokens"
    unirig_dir.mkdir()
    skintokens_dir.mkdir()
    return unirig_dir, skintokens_dir


def test_run_pipeline_chains_all_three_steps():
    root = Path(tempfile.mkdtemp())
    try:
        unirig_dir, skintokens_dir = _stub_checkouts(root)
        workdir = root / "work"
        workdir.mkdir()
        mesh_glb = workdir / "mesh.glb"
        mesh_glb.write_bytes(b"glTF-fake-mesh")

        _fake_bash_script(
            unirig_dir / "launch/inference/generate_skeleton.sh", workdir / "skeleton.fbx"
        )
        _fake_bash_script(unirig_dir / "launch/inference/merge.sh", workdir / "merged.glb")
        _fake_py_script(skintokens_dir / "demo.py", workdir / "rigged.glb")

        result = run_pipeline(mesh_glb, workdir, unirig_dir, skintokens_dir)

        _check(result == workdir / "rigged.glb", "returns the final rigged.glb path")
        _check(result.exists(), "final output file exists")
        _check((workdir / "skeleton.fbx").exists(), "intermediate skeleton.fbx exists")
        _check((workdir / "merged.glb").exists(), "intermediate merged.glb exists")
    finally:
        shutil.rmtree(root)


def test_run_pipeline_raises_on_nonzero_exit():
    root = Path(tempfile.mkdtemp())
    try:
        unirig_dir, skintokens_dir = _stub_checkouts(root)
        workdir = root / "work"
        workdir.mkdir()
        mesh_glb = workdir / "mesh.glb"
        mesh_glb.write_bytes(b"glTF-fake-mesh")

        _fake_bash_script(
            unirig_dir / "launch/inference/generate_skeleton.sh",
            workdir / "skeleton.fbx",
            exit_code=1,
        )
        try:
            run_pipeline(mesh_glb, workdir, unirig_dir, skintokens_dir)
            _check(False, "expected PipelineStepError for nonzero exit")
        except PipelineStepError as exc:
            _check("unirig-skeleton failed" in str(exc), f"error names the failed step: {exc}")
    finally:
        shutil.rmtree(root)


def test_run_pipeline_raises_on_missing_output_despite_zero_exit():
    root = Path(tempfile.mkdtemp())
    try:
        unirig_dir, skintokens_dir = _stub_checkouts(root)
        workdir = root / "work"
        workdir.mkdir()
        mesh_glb = workdir / "mesh.glb"
        mesh_glb.write_bytes(b"glTF-fake-mesh")

        # Exits 0 but never writes skeleton.fbx: the no-output case a crashed
        # model process can produce without a nonzero exit code.
        _fake_bash_script(unirig_dir / "launch/inference/generate_skeleton.sh")
        try:
            run_pipeline(mesh_glb, workdir, unirig_dir, skintokens_dir)
            _check(False, "expected PipelineStepError for missing output")
        except PipelineStepError as exc:
            _check("wrote no output file" in str(exc), f"missing-output case named: {exc}")
    finally:
        shutil.rmtree(root)


def test_run_pipeline_stops_before_skinning_if_merge_fails():
    root = Path(tempfile.mkdtemp())
    try:
        unirig_dir, skintokens_dir = _stub_checkouts(root)
        workdir = root / "work"
        workdir.mkdir()
        mesh_glb = workdir / "mesh.glb"
        mesh_glb.write_bytes(b"glTF-fake-mesh")

        _fake_bash_script(
            unirig_dir / "launch/inference/generate_skeleton.sh", workdir / "skeleton.fbx"
        )
        _fake_bash_script(unirig_dir / "launch/inference/merge.sh", exit_code=2)
        # No demo.py stub at all: if the pipeline wrongly proceeded to
        # skinning, this would fail with "No such file" instead of merge's.
        try:
            run_pipeline(mesh_glb, workdir, unirig_dir, skintokens_dir)
            _check(False, "expected PipelineStepError for merge failure")
        except PipelineStepError as exc:
            _check("unirig-merge failed" in str(exc), f"stopped at merge, not skinning: {exc}")
    finally:
        shutil.rmtree(root)


if __name__ == "__main__":
    test_skeleton_cmd_matches_unirig_cli_contract()
    test_merge_cmd_matches_unirig_cli_contract()
    test_skin_cmd_matches_skintokens_cli_contract()
    test_run_pipeline_chains_all_three_steps()
    test_run_pipeline_raises_on_nonzero_exit()
    test_run_pipeline_raises_on_missing_output_despite_zero_exit()
    test_run_pipeline_stops_before_skinning_if_merge_fails()
    if _FAILED:
        print("\nFAILED")
        sys.exit(1)
    print("\nALL PASSED")
