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
from glb_fixtures import QUADRUPED, SKINTOKENS_TRIM_SCRIPT, skin_joint_count, unweighted_merge_glb
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
    the skin's joints, with real geometry and skin accessors. With two_roots
    the last joint is a second root, the shape the fox QA run produced on
    2026-11-04."""
    bones = [
        ("bone_1", -1, (0.0, 1.0, 0.0)),
        ("bone_2", 0, (0.0, 1.0, 0.0)),
        ("bone_3", -1, (0.2, 2.1, 0.0)) if two_roots else ("bone_3", 1, (0.2, 0.1, 0.0)),
    ]
    unweighted_merge_glb(path, bones=bones, neutral_bone=False)


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
        (skintokens_dir / "demo.py").write_text(SKINTOKENS_TRIM_SCRIPT)

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


def _pipeline_with_merge_output(root: Path, merge_output: Path, skin_script: str) -> tuple[Path, Path, Path, Path]:
    unirig_dir, skintokens_dir = _stub_checkouts(root)
    workdir = root / "work"
    workdir.mkdir()
    mesh_glb = workdir / "mesh.glb"
    mesh_glb.write_bytes(b"glTF-fake-mesh")
    _fake_bash_script(
        unirig_dir / "launch/inference/generate_skeleton.sh", workdir / "skeleton.fbx"
    )
    _fake_merge_copying(unirig_dir / "launch/inference/merge.sh", merge_output)
    (skintokens_dir / "demo.py").write_text(skin_script)
    return mesh_glb, workdir, unirig_dir, skintokens_dir


def test_unweighted_unirig_skeleton_survives_skintokens_trim():
    """Production, 2026-11-04 to 2026-11-14: every non-humanoid rig came back
    with exactly one joint (bone_0). UniRig's merge grafts the skeleton with
    no weights, so Blender's exporter puts every vertex on neutral_bone, and
    SkinTokens' --use_skeleton loader runs Asset.trim_skeleton, which deletes
    every joint whose subtree has no skin weight. Only neutral_bone survived.
    The whole UniRig skeleton must reach SkinTokens' predictor."""
    root = Path(tempfile.mkdtemp())
    try:
        unweighted_merge_glb(root / "merge-output.glb")
        args = _pipeline_with_merge_output(root, root / "merge-output.glb", SKINTOKENS_TRIM_SCRIPT)
        result = run_pipeline(*args)
        kept = skin_joint_count(result)
        _check(kept == len(QUADRUPED), f"SkinTokens keeps all {len(QUADRUPED)} UniRig joints (kept {kept})")
    except PipelineStepError as exc:
        _check(False, f"pipeline failed instead of rigging: {exc}")
    finally:
        shutil.rmtree(root)


# Writes a rig whose skin has exactly one joint, whatever the input.
_SKIN_ONE_JOINT = """
import json, struct, sys
args = sys.argv[1:]
src, dst = args[args.index('--input') + 1], args[args.index('--output') + 1]
data = open(src, 'rb').read()
size = struct.unpack_from('<I', data, 12)[0]
doc = json.loads(data[20:20 + size])
doc['skins'][0]['joints'] = doc['skins'][0]['joints'][:1]
doc['skins'][0].pop('inverseBindMatrices', None)
body = json.dumps(doc).encode()
body += b' ' * (-len(body) % 4)
rest = data[20 + size:]
chunks = struct.pack('<II', len(body), 0x4E4F534A) + body + rest
open(dst, 'wb').write(b'glTF' + struct.pack('<II', 2, 12 + len(chunks)) + chunks)
"""


def test_single_joint_rig_is_a_named_failure_not_a_success():
    """A rig with one joint cannot move anything. The worker used to hand it
    back as done; it must fail the task with a message that says why."""
    root = Path(tempfile.mkdtemp())
    try:
        unweighted_merge_glb(root / "merge-output.glb")
        args = _pipeline_with_merge_output(root, root / "merge-output.glb", _SKIN_ONE_JOINT)
        try:
            run_pipeline(*args)
            _check(False, "expected PipelineStepError for a one-joint rig")
        except PipelineStepError as exc:
            msg = str(exc)
            _check("skintokens-skin" in msg and "1 joint" in msg, f"names the step and the joint count: {msg}")
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
    test_unweighted_unirig_skeleton_survives_skintokens_trim()
    test_single_joint_rig_is_a_named_failure_not_a_success()
    if _FAILED:
        print("\nFAILED")
        sys.exit(1)
    print("\nALL PASSED")
