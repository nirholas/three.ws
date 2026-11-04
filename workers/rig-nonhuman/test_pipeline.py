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
from skeleton_roots import write_glb

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


def _merged_glb(path: Path, two_roots: bool) -> None:
    """A minimal GLB shaped like UniRig's merge output: an Armature node over
    the skin's joints. With two_roots the last joint is a second root, the
    shape the fox QA run produced on 2026-11-04."""
    doc = {
        "asset": {"version": "2.0"},
        "scenes": [{"nodes": [0, 4]}],
        "nodes": [
            {"name": "Armature", "children": [1, 3] if two_roots else [1]},
            {"name": "bone_1", "children": [2], "translation": [0.0, 1.0, 0.0]},
            {"name": "bone_2", **({} if two_roots else {"children": [3]}), "translation": [0.0, 1.0, 0.0]},
            {"name": "bone_3", "translation": [0.2, 2.1, 0.0] if two_roots else [0.2, 0.1, 0.0]},
            {"name": "character", "mesh": 0, "skin": 0},
        ],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "skins": [{"joints": [1, 2, 3]}],
    }
    write_glb(path, doc, b"\x00" * 16)


def _fake_merge_copying(path: Path, source: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = '"$6"'  # merge.sh --source S --target T --output O: O is $6
    path.write_text(f"#!/bin/sh\ncp '{source}' {out}\nexit 0\n")
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


# Applies SkinTokens' real rule (Asset.set_order: one root joint or
# "multiple roots found") to its --input before writing --output.
_SKIN_CHECKING_ROOTS = """
import json, struct, sys
args = sys.argv[1:]
src, dst = args[args.index('--input') + 1], args[args.index('--output') + 1]
data = open(src, 'rb').read()
size = struct.unpack_from('<I', data, 12)[0]
doc = json.loads(data[20:20 + size])
parent = {c: i for i, n in enumerate(doc['nodes']) for c in n.get('children', [])}
joints = set(doc['skins'][0]['joints'])
roots = [j for j in joints if parent.get(j) not in joints]
if len(roots) != 1:
    print('ValueError: multiple roots found', file=sys.stderr)
    sys.exit(1)
open(dst, 'wb').write(data)
"""


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
        _merged_glb(root / "merge-output.glb", two_roots=False)
        _fake_merge_copying(unirig_dir / "launch/inference/merge.sh", root / "merge-output.glb")
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


def test_missing_output_error_carries_the_step_stdout():
    """UniRig's merge.sh backgrounds `python -m src.inference.merge`, waits,
    and always exits 0; merge.py reports a failed load or export with print()
    on stdout and returns. The production fox run on 2026-11-04 surfaced only
    "unirig-merge reported success but wrote no output file", with the cause
    thrown away. The error must carry the step's own output."""
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
        merge = unirig_dir / "launch/inference/merge.sh"
        merge.write_text(
            "#!/bin/sh\n"
            f"echo 'failed to load {workdir / 'skeleton.fbx'}'\n"
            "echo done\n"
            "exit 0\n"
        )
        merge.chmod(merge.stat().st_mode | stat.S_IEXEC)
        try:
            run_pipeline(mesh_glb, workdir, unirig_dir, skintokens_dir)
            _check(False, "expected PipelineStepError for a silent merge failure")
        except PipelineStepError as exc:
            _check("wrote no output file" in str(exc), f"still names the missing output: {exc}")
            _check("failed to load skeleton.fbx" in str(exc), f"carries merge.py's stdout: {exc}")
            _check(str(root) not in str(exc), f"absolute work paths are redacted: {exc}")
    finally:
        shutil.rmtree(root)


def test_two_root_merge_output_reaches_skinning_with_one_root():
    """The fox QA run: UniRig's skeleton had two root joints and SkinTokens
    died with "multiple roots found". The pipeline must hand SkinTokens a
    single-rooted skeleton."""
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
        _merged_glb(root / "merge-output.glb", two_roots=True)
        _fake_merge_copying(unirig_dir / "launch/inference/merge.sh", root / "merge-output.glb")
        (skintokens_dir / "demo.py").write_text(_SKIN_CHECKING_ROOTS)
        try:
            result = run_pipeline(mesh_glb, workdir, unirig_dir, skintokens_dir)
            _check(result.exists(), "skinning accepted the merged skeleton")
        except PipelineStepError as exc:
            _check(False, f"two-root skeleton reached SkinTokens unchanged: {exc}")
    finally:
        shutil.rmtree(root)


def test_unreadable_merge_output_is_a_named_merge_failure():
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
        try:
            run_pipeline(mesh_glb, workdir, unirig_dir, skintokens_dir)
            _check(False, "expected PipelineStepError for a non-GLB merge output")
        except PipelineStepError as exc:
            _check("unirig-merge" in str(exc) and "GLB" in str(exc), f"names the step and format: {exc}")
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
    test_missing_output_error_carries_the_step_stdout()
    test_two_root_merge_output_reaches_skinning_with_one_root()
    test_unreadable_merge_output_is_a_named_merge_failure()
    if _FAILED:
        print("\nFAILED")
        sys.exit(1)
    print("\nALL PASSED")
