"""stage_weights.sh must fail loudly when a repo listing fails: stdlib only.

    cd workers/model-pixal3d && python3 -m pytest test_stage_weights.py -q

The listing feeds the copy loop through a process substitution, whose exit
status `set -euo pipefail` never sees. A failed listing (no python3 in the
image, a Hugging Face outage, a rate limit) used to leave the loop with no
input, so the script printed "weights staged" and exited 0 having copied
nothing. Stub `curl` and `gcloud` on PATH make every network call fail.
"""

import os
import pathlib
import stat
import subprocess
import tempfile

SCRIPT = pathlib.Path(__file__).with_name("stage_weights.sh")


def _stub(bin_dir, name, body):
    path = bin_dir / name
    path.write_text("#!/usr/bin/env bash\n" + body + "\n")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def test_failed_listing_exits_nonzero_and_never_claims_success():
    with tempfile.TemporaryDirectory() as tmp:
        bin_dir = pathlib.Path(tmp)
        _stub(bin_dir, "curl", "exit 22")
        _stub(bin_dir, "gcloud", "exit 1")
        env = dict(os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}")
        env.pop("HF_TOKEN", None)
        result = subprocess.run(
            ["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60
        )
    assert result.returncode != 0, result.stdout + result.stderr
    assert "staged" not in result.stdout


def test_stages_the_moge_camera_estimator_beside_the_other_aux_weights():
    # Stub a Hub that lists one file per repo and a bucket that already holds
    # every object at the listed size, so the run is a pure dry walk of which
    # repo lands under which prefix.
    with tempfile.TemporaryDirectory() as tmp:
        bin_dir = pathlib.Path(tmp)
        _stub(bin_dir, "curl", 'echo \'{"siblings":[{"rfilename":"model.pt","size":7}]}\'')
        _stub(bin_dir, "gcloud", "echo 7")
        env = dict(os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}", SKIP_MVADAPTER="1")
        env.pop("HF_TOKEN", None)
        result = subprocess.run(
            ["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60
        )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "skip  gs://three-ws-model-weights/pixal3d/moge/model.pt" in result.stdout
